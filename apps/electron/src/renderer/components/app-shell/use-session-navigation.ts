import { useMemo } from 'react'
import { isSessionsNavigation, useNavigationState } from '@/contexts/NavigationContext'

/** Navigation subscription and session-route projection have one renderer owner. */
export function useSessionNavigation() {
  const navState = useNavigationState()
  const sessionsContext = useMemo(() => isSessionsNavigation(navState)
    ? { filter: navState.filter, sessionId: navState.details?.sessionId ?? null } : null, [navState])
  return { navState, sessionsContext, isSessionsListVisible: sessionsContext !== null }
}
