import { atom } from 'jotai'
import type { ViewRoute } from '../../../shared/routes'

/** Independent foreground presentation; the Primary route stays mounted below it. */
export const residentNavigationAtom = atom<{
  workspaceId: string
  sessionId: string
  route: ViewRoute
  open: boolean
  closing?: boolean
  returnFocus?: boolean
} | null>(null)

export const residentOriginAtom = atom({ left: 0, top: 9, width: 360, height: 30 })
export const residentReturnFocusAtom = atom(0)
