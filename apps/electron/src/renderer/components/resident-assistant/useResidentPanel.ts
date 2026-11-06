import * as React from 'react'
import type { AssistantWork, AssistantWorkPage, AssistantWorkQuery } from '@phaneris/session-tools-core/delegation-contracts'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'

export type ResidentWorkView = NonNullable<AssistantWorkQuery['view']>
const emptyPage = (): AssistantWorkPage => ({ items: [], deliverables: [], nextAfter: null, lastSeq: 0 })

/** One bounded view. Background refresh never discards pages being read. */
export function useResidentPanel(workspaceId: string, view: ResidentWorkView, search: string) {
  const [page, setPage] = React.useState(emptyPage)
  const [recent, setRecent] = React.useState<AssistantWork[]>([])
  const pageRef = React.useRef(page)
  const [messaging, setMessaging] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getMessagingConfig>>>()
  const [bindings, setBindings] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getMessagingBindings>>>([])
  const [error, setError] = React.useState<string>()
  const [messagingError, setMessagingError] = React.useState<string>()
  const [loading, setLoading] = React.useState(true)
  const [hasUpdates, setHasUpdates] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState<number>()
  const generation = React.useRef(0)
  const invalidateWork = React.useCallback(() => { generation.current++ }, [])
  const inFlight = React.useRef<number | undefined>(undefined)
  const connection = useTransportConnectionState()
  const connected = !connection || connection.status === 'connected'
  const refresh = React.useCallback(async (mode: 'background' | 'reset' | 'more' = 'reset') => {
    if (!connected || inFlight.current === generation.current) return
    const token = generation.current, previous = pageRef.current
    if (mode === 'more' && !previous.nextCursor) return
    inFlight.current = token; setLoading(true)
    const result = await Promise.allSettled([window.electronAPI.getAssistantWork(workspaceId, {
      view, search: search || undefined, limit: 20, cursor: mode === 'more' ? previous.nextCursor! : undefined,
    }), ...(view === 'current' ? [window.electronAPI.getAssistantWork(workspaceId, { view: 'history', state: 'result_ready', limit: 3 })] : [])])
    if (token !== generation.current) return
    if (result[1]?.status === 'fulfilled') setRecent(result[1].value.items.filter(item => item.state === 'result_ready'))
    if (result[0].status === 'fulfilled') {
      const incoming = result[0].value
      if (mode === 'background' && (previous.items.length > 20 || (previous.deliverables?.length ?? 0) > 20)) {
        setHasUpdates(incoming.lastSeq !== previous.lastSeq || incoming.total !== previous.total)
      } else {
        const next = mode === 'more' ? { ...incoming,
          items: [...new Map([...previous.items, ...incoming.items].map(item => [item.id, item])).values()],
          deliverables: [...new Map([...(previous.deliverables ?? []), ...(incoming.deliverables ?? [])].map(item => [item.id, item])).values()],
        } : incoming
        pageRef.current = next; setPage(next); setHasUpdates(false)
      }
      setError(undefined); setUpdatedAt(Date.now())
    } else setError(String(result[0].reason))
    inFlight.current = undefined; setLoading(false)
  }, [workspaceId, connected, view, search])
  React.useEffect(() => {
    generation.current++; inFlight.current = undefined
    pageRef.current = emptyPage(); setPage(pageRef.current); setHasUpdates(false)
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh('background') }, 5000)
    const visible = () => { if (!document.hidden) void refresh('background') }
    document.addEventListener('visibilitychange', visible)
    const artifacts = window.electronAPI.onArtifactsChanged(id => { if (id === workspaceId) void refresh('background') })
    return () => { invalidateWork(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); artifacts() }
  }, [workspaceId, refresh, invalidateWork])
  const messagingGeneration = React.useRef(0)
  const invalidateMessaging = React.useCallback(() => { messagingGeneration.current++ }, [])
  const refreshMessaging = React.useCallback(async () => {
    const token = ++messagingGeneration.current
    const result = await Promise.allSettled([Promise.all([window.electronAPI.getMessagingConfig(), window.electronAPI.getMessagingBindings()])])
    if (token !== messagingGeneration.current) return
    if (result[0].status === 'rejected') { setMessagingError(String(result[0].reason)); return }
    setMessaging(result[0].value[0]); setBindings(result[0].value[1]); setMessagingError(undefined)
  }, [])
  React.useEffect(() => {
    messagingGeneration.current++
    void refreshMessaging()
    const off = window.electronAPI.onMessagingBindingChanged(id => { if (id === workspaceId) void refreshMessaging() })
    const timer = window.setInterval(() => { if (!document.hidden) void refreshMessaging() }, 30000)
    return () => { invalidateMessaging(); off(); clearInterval(timer) }
  }, [workspaceId, connected, refreshMessaging, invalidateMessaging])
  return { page, recent, error, hasUpdates, messaging, bindings, messagingError, connected, loading, updatedAt, refresh, refreshMessaging }
}

