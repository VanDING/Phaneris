import * as React from 'react'
import { useStore } from 'jotai'
import { addSessionAtom, sessionMetaMapAtom } from '@/atoms/sessions'

/** The same Host singleton is registered in the normal Session view model. */
export function useResidentAssistantSession(workspaceId: string | null, enabled: boolean): { ready: boolean; sessionId?: string; error?: string } {
  const store = useStore()
  const [state, setState] = React.useState<{ workspaceId: string; sessionId?: string; error?: string }>()
  React.useEffect(() => {
    if (!workspaceId || !enabled) return
    let cancelled = false
    window.electronAPI.getResidentAssistant(workspaceId).then(session => {
      if (cancelled) return
      if (!store.get(sessionMetaMapAtom).has(session.id)) store.set(addSessionAtom, session)
      setState({ workspaceId, sessionId: session.id })
    }).catch(error => { if (!cancelled) setState({ workspaceId, error: String(error) }) })
    return () => { cancelled = true }
  }, [workspaceId, enabled, store])
  return state?.workspaceId === workspaceId ? { ...state, ready: true } : { ready: false }
}
