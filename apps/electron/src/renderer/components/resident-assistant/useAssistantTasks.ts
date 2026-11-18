import * as React from 'react'
import type { TaskPageView } from '@phaneris/session-tools-core/task-delegation-contracts'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'

const emptyPage = (): TaskPageView => ({ observedAt: Date.now(), items: [], counts: {}, total: 0 })

/**
 * One bounded read of the delegation board.
 *
 * The panel never derives task state from Session metadata: definition version,
 * execution stage and acceptance are Host facts, and a background refresh must
 * not discard a page the user is reading.
 */
export function useAssistantTasks(workspaceId: string, limit = 50) {
  const [page, setPage] = React.useState(emptyPage)
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(true)
  const [updatedAt, setUpdatedAt] = React.useState<number>()
  const generation = React.useRef(0)
  const pageRef = React.useRef(page)
  // Invalidation goes through a stable callback so effect cleanup never captures
  // the mutable ref value itself.
  const invalidate = React.useCallback(() => { generation.current++ }, [])
  const connection = useTransportConnectionState()
  const connected = !connection || connection.status === 'connected'
  const refresh = React.useCallback(async () => {
    if (!connected) return
    const token = generation.current
    setLoading(true)
    const result = await Promise.allSettled([window.electronAPI.getAssistantTasks(workspaceId, { limit })])
    if (token !== generation.current) return
    if (result[0].status === 'fulfilled') { pageRef.current = result[0].value; setPage(result[0].value); setError(undefined); setUpdatedAt(Date.now()) }
    else setError(String(result[0].reason))
    setLoading(false)
  }, [workspaceId, connected, limit])
  React.useEffect(() => {
    generation.current++
    pageRef.current = emptyPage(); setPage(pageRef.current)
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 5000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    // A committed definition, control or acceptance decision pushes here, so the
    // board does not have to poll faster to feel current.
    const changed = window.electronAPI.onAssistantTasksChanged(id => { if (id === workspaceId) void refresh() })
    return () => { invalidate(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); changed() }
  }, [workspaceId, refresh, invalidate])
  return { page, error, loading, updatedAt, connected, refresh }
}
