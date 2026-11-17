/**
 * Navigation helpers
 *
 * Small pure helpers over `NavigationState`. Keep these stateless and free of
 * React/Jotai imports — they're consumed both inside hooks (SurfaceContainer)
 * and in synchronous callbacks (CompactBackButton).
 */

import { buildRouteFromNavigationState } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import type { NavigationState } from '../../shared/types'

/**
 * Returns true when the focused panel's nav state is in "detail" mode —
 * i.e. the user has drilled past the navigator into a specific item.
 *
 * Used by compact-mode logic to flip the layout from navigator-only to
 * content-only with a back-button overlay.
 *
 * Per-navigator semantics:
 * - sessions: a session is selected
 * - settings: a subpage is selected (bare `settings` route → false)
 * - sources / skills / automations: a detail item is selected
 * - plugins: never — the bundle list is the whole section (P7-2)
 * - pages: always — both the library grid and a page render in the content
 *   panel (pages has no navigator list to fall back to)
 */
export function isDetailNavState(navState: NavigationState | null): boolean {
  if (!navState) return false
  switch (navState.navigator) {
    case 'sessions':
      return navState.details !== null
    case 'settings':
      return navState.subpage !== null
    case 'sources':
    case 'skills':
    case 'automations':
      return navState.details !== null
    case 'plugins':
      return false
    case 'projects':
      return navState.details !== null || navState.view !== 'overview'
    case 'pages':
      return true
    case 'other':
      // Bound workbench panels are standalone — never "detail" mode.
      return false
  }
}

/**
 * Route used by compact mode when returning from a Primary detail/projection
 * to its navigator. Project projections return to Project overview; bound
 * workbench routes are handled by the dock and therefore have no root route.
 */
export function buildNavigatorRootRoute(navState: NavigationState): ViewRoute | null {
  switch (navState.navigator) {
    case 'sessions':
    case 'sources':
    case 'skills':
    case 'plugins':
    case 'automations':
      return buildRouteFromNavigationState({ ...navState, details: null }) as ViewRoute
    case 'settings':
      return buildRouteFromNavigationState({ ...navState, subpage: null }) as ViewRoute
    case 'projects':
      return buildRouteFromNavigationState({ ...navState, view: 'overview', details: null }) as ViewRoute
    case 'pages':
      return buildRouteFromNavigationState({ ...navState, details: null }) as ViewRoute
    case 'other':
      return null
  }
}

/** Full-width libraries/projections have no middle navigation column. */
export function hasNavigator(navState: NavigationState | null): boolean {
  if (!navState || navState.navigator === 'other' || navState.navigator === 'pages') return false
  return navState.navigator !== 'projects' || navState.view === 'overview'
}

/** Opening a list is explicit intent; opening a session preserves its list preference. */
export function shouldRevealNavigator(navState: NavigationState | null): boolean {
  return hasNavigator(navState) && (navState?.navigator !== 'sessions' || !navState.details)
}

/**
 * How the three columns share a narrowing window.
 *
 * They used to be independent: the sidebar (200) and navigator (300) were taken
 * first and the content column got the remainder, so an 800px window left the chat
 * 288px — narrower than a phone, and the reason a 34-character CJK line wrapped
 * into eight.
 *
 * The order of concession is by what each column can afford to lose:
 *
 * 1. The sidebar drops to its rail (48). It is a list of global destinations, all
 *    of which still have an icon there, and the rail is an affordance the app
 *    already ships.
 * 2. The navigator shrinks toward its floor. It is a list of names, which stays
 *    usable as it narrows.
 * 3. Only then is the navigator dropped, and the caller is at compact-mode
 *    territory anyway.
 *
 * The content column keeps `CONTENT_FLOOR` throughout. It is the only column
 * whose job is reading, so it is the one column that never yields.
 */
export const CONTENT_FLOOR = 480
export const NAVIGATOR_FLOOR = 220
/** Panel sashes and the shell inset: width the panels do not get to use. */
const CHROME_GUTTER = 12

export interface ColumnWidths {
  /** Use the rail width instead of the full sidebar. */
  sidebarRail: boolean
  /** 0 means the caller should hide the navigator entirely. */
  navigator: number
}

export function fitColumns(
  windowWidth: number,
  sidebarWidth: number,
  railWidth: number,
  navigatorWidth: number,
): ColumnWidths {
  // First frame: nothing measured yet, so honour the configured layout.
  if (windowWidth <= 0) return { sidebarRail: false, navigator: navigatorWidth }

  const budget = windowWidth - CONTENT_FLOOR - CHROME_GUTTER

  if (sidebarWidth + navigatorWidth <= budget) {
    return { sidebarRail: false, navigator: navigatorWidth }
  }
  const withRail = budget - railWidth
  if (withRail >= navigatorWidth) {
    return { sidebarRail: true, navigator: navigatorWidth }
  }
  if (withRail >= NAVIGATOR_FLOOR) {
    return { sidebarRail: true, navigator: withRail }
  }
  // Not enough room for a readable navigator even railed: hide it rather than
  // render a column of clipped names.
  return { sidebarRail: true, navigator: 0 }
}
