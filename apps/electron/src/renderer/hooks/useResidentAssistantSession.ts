import * as React from 'react'
import { useStore } from 'jotai'
import { upsertSessionMetadataAtom } from '@/atoms/sessions'

/** The same Host singleton is registered in the normal Session view model. */
export function useResidentAssistantSession(workspaceId: string | null, enabled: boolean): { ready: boolean; sessionId?: string; error?: string } {
  const store = useStore()
  const [state, setState] = React.useState<{ workspaceId: string; sessionId?: string; error?: string }>()
  React.useEffect(() => {
    if (!workspaceId || !enabled) return
    let cancelled = false
    window.electronAPI.getResidentAssistantMetadata(workspaceId).then(session => {
      if (cancelled) return
      store.set(upsertSessionMetadataAtom, session)
      setState({ workspaceId, sessionId: session.id })
    }).catch(error => { if (!cancelled) setState({ workspaceId, error: String(error) }) })
    return () => { cancelled = true }
  }, [workspaceId, enabled, store])
  return state?.workspaceId === workspaceId ? { ...state, ready: true } : { ready: false }
}
