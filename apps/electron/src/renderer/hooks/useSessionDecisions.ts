import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionDecisionQuery, SessionDecisionReport } from '@phaneris/shared/decisions/session'

export type DecisionLoadState = 'loading' | 'ready' | 'error' | 'unsupported'
export function useSessionDecisions(sessionId: string | undefined, workspaceId: string | undefined, query: SessionDecisionQuery = {}, enabled = true, serverScope = workspaceId) {
  const key = JSON.stringify([serverScope, workspaceId, sessionId, query.feature, query.status, query.turnId])
  const [value, setValue] = useState<{ key: string; state: DecisionLoadState; report?: SessionDecisionReport; paging?: boolean }>({ key, state: 'loading' })
  const generation = useRef(0)
  const loader = useRef<(cursor?: string) => Promise<void>>(async () => {})
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
    const current = ++generation.current
    let latest: SessionDecisionReport | undefined, loaded = 40
    setValue({ key, state: 'loading' })
    if (!enabled || !sessionId || !workspaceId) return
    const load = async (cursor?: string, snapshotRetry = false) => {
      const requestGeneration = ++generation.current
      if (typeof window.electronAPI?.getSessionDecisions !== 'function') { setValue({ key, state: 'unsupported' }); return }
      if (cursor) setValue(previous => ({ ...previous, paging: true }))
      try {
        let report = await window.electronAPI.getSessionDecisions(sessionId, { ...query, cursor, limit: cursor ? 40 : Math.min(100, loaded) })
        if (disposed || requestGeneration !== generation.current) return
        if (report?.schemaVersion !== 1) { setValue({ key, state: 'unsupported' }); return }
        if (report.sessionId !== sessionId || report.workspaceId !== workspaceId) throw new Error('Decision report ownership mismatch')
        // Retain loaded history and its keyed details when new records arrive.
        const added = latest ? Math.max(0, report.totals.points + report.totals.legacyCalls - latest.totals.points - latest.totals.legacyCalls) : 0
        const target = loaded + added
        while (!cursor && report.nextCursor && report.items.length < target) {
          const page = await window.electronAPI.getSessionDecisions(sessionId, { ...query, cursor: report.nextCursor, limit: Math.min(100, target - report.items.length) })
          if (disposed || requestGeneration !== generation.current) return
          if (page.revision !== report.revision || page.workspaceId !== workspaceId || page.sessionId !== sessionId) throw new Error('Decision snapshot changed; reload the first page')
          report = { ...page, items: [...report.items, ...page.items] }
        }
        if (cursor && latest?.revision === report.revision) report = { ...report, items: [...latest.items, ...report.items.filter(item => !latest!.items.some(old => old.id === item.id))] }
        latest = report
        loaded = Math.max(40, report.items.length)
        setValue({ key, state: 'ready', report })
      } catch (error) {
        if (disposed || requestGeneration !== generation.current) return
        const message = error instanceof Error ? error.message : String(error)
        if (!snapshotRetry && /snapshot changed/.test(message)) { await load(undefined, true); return }
        setValue({ key, state: /unknown channel|unknown method|not registered|not supported|no handler|method not found/i.test(message) ? 'unsupported' : 'error' })
      }
    }
    loader.current = load
    void load()
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { void load() }, 180) }
    const unsubscribe = window.electronAPI.onSessionDecisionsChanged?.(id => { if (id === sessionId) refresh() })
    const reconnect = window.electronAPI.onTransportConnectionStateChanged?.(() => {
      ++generation.current
      setValue({ key, state: 'loading' })
      refresh()
    })
    return () => { disposed = true; if (generation.current >= current) ++generation.current; clearTimeout(timer); unsubscribe?.(); reconnect?.() }
    // The serialized key owns the query and prevents stale session/filter responses from painting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  const retry = useCallback(() => { setValue({ key, state: 'loading' }); void loader.current() }, [key])
  const state = value.key === key ? value : { key, state: 'loading' as const }
  const loadMore = () => { if (state.report?.nextCursor && !state.paging) void loader.current(state.report.nextCursor) }
  return { ...state, retry, loadMore }
}
