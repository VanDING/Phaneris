/**
 * Which surface owns the screen's single `h1`.
 *
 * DESIGN.md: "One `h1` per screen: the primary surface title. Navigator,
 * workbench and artifact sub-panel headers are `h2`." The shell has to decide
 * that per route, because the title lives in different places: the chat header
 * for sessions, the page's own header for settings and pages, and the *navigator*
 * for the management lists, where the list is what the user came to see and the
 * content pane shows a bare empty state.
 *
 * This lived inside AppShell and pushed it over the file-size ratchet; it is also
 * the one piece of that screen-shape decision that is pure and worth reading on
 * its own. Every `false` means "something else on this route already emits an
 * `h1`", never "this screen may have none".
 */
import type { NavigationState } from '../../shared/types'
import {
  isAutomationsNavigation,
  isPagesNavigation,
  isPluginsNavigation,
  isProjectsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isSourcesNavigation,
} from '@/context/NavigationContext'

export function navigatorOwnsHeadingOne(
  navState: NavigationState,
  flags: { isSessionsListVisible: boolean; isWorkbenchFullWidth: boolean },
): boolean {
  if (flags.isSessionsListVisible) return false          // the chat header owns it
  if (isSettingsNavigation(navState)) return false       // every settings page titles itself
  if (isPagesNavigation(navState)) return false          // the library grid titles itself (navigator is 0-wide here)
  // A full-width workbench hides the primary surface, so the navigator is the
  // only thing left that can carry the screen's heading.
  if (flags.isWorkbenchFullWidth) return true
  if (isProjectsNavigation(navState)) return false       // ProjectManagementSurface titles itself
  if (isSourcesNavigation(navState)) return !navState.details
  if (isSkillsNavigation(navState)) return navState.details?.type !== 'skill'
  if (isPluginsNavigation(navState)) return navState.details?.type !== 'plugin'
  if (isAutomationsNavigation(navState)) return !navState.details
  return false
}
