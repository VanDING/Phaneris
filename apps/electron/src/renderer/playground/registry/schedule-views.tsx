/**
 * Playground entry for the Calendar schedule view.
 *
 * Renders the full container against mocked calendar entries via the mock
 * electronAPI (listCalendarEntries / create / update / delete), inside the
 * provider stack the mobile-webui demos use.
 */

import * as React from 'react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { AppShellProvider, useOptionalAppShellContext } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { NavigationProvider, routes, useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { ensureMockElectronAPI } from '../mock-utils'
import type { ComponentEntry } from './types'
import { ProjectManagementSurface } from '@/components/projects/ProjectManagementSurface'
import { useProjects } from '@/hooks/useProjects'
import { isProjectsNavigation, type ProjectManagementView } from '../../../shared/types'

ensureMockElectronAPI()

const WORKSPACE_ID = 'ws-playground-schedule'

/** AppShell override: seeded workspace id, no-op session creation. */
function ScheduleAppShell({ children }: { children: React.ReactNode }) {
  const parent = useOptionalAppShellContext()
  const value = React.useMemo(
    () => ({
      ...parent,
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspaceSlug: 'schedule',
      onCreateSession: async () => ({ id: 'mock-session', name: 'Mock' }),
    }),
    [parent],
  )
  return <AppShellProvider value={value as never}>{children}</AppShellProvider>
}

/**
 * Fills `projectsAtom` for the preview.
 *
 * The real AppShell does this (`AppShell.tsx:1023`), but this preview swaps in a
 * stub shell, so the atom stayed empty and EVERY projection lost its project
 * filter — the calendar and the board were missing it too. The preview therefore
 * misrepresented the product, and it hid header regressions behind a "no
 * projects" state. It must render INSIDE the JotaiProvider: the preview uses its
 * own store, so a call in the provider component itself would write to the
 * ambient store the views never read.
 */
function ProjectsLoader() {
  useProjects(WORKSPACE_ID)
  return null
}

/**
 * The full provider stack the Projects surface needs.
 *
 * Shared by the projection previews and the schedule editor so both exercise the
 * same contexts; a preview that assembled its own stack could pass while the real
 * surface fails.
 */
function ScheduleProviders({ children }: { children: React.ReactNode }) {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <ProjectsLoader />
      <ActionRegistryProvider>
        <DismissibleLayerProvider>
          <ModalProvider>
            <EscapeInterruptProvider>
              <FocusProvider>
                <NavigationProvider
                  workspaceId={WORKSPACE_ID}
                  workspaceSlug="schedule"
                  onCreateSession={async () => ({}) as never}
                  isReady
                  isSessionsReady
                >
                  <ScheduleAppShell>
                    <div className="h-full w-full bg-background">{children}</div>
                  </ScheduleAppShell>
                </NavigationProvider>
              </FocusProvider>
            </EscapeInterruptProvider>
          </ModalProvider>
        </DismissibleLayerProvider>
      </ActionRegistryProvider>
    </JotaiProvider>
  )
}

function ProjectManagementViewPreview({ view }: { view: ProjectManagementView }) {
  return (
    <ScheduleProviders>
      {/* The preview pins `state`, so in-view navigation cannot switch projections
          here — each projection gets its own entry instead. */}
      <ProjectManagementSurface state={{ navigator: 'projects', view, details: null }} />
    </ScheduleProviders>
  )
}

/**
 * The Projects surface driven by the REAL navigation state.
 *
 * The projection previews above pin `state`, which keeps them stable to look at
 * but also makes in-view navigation untestable: opening the schedule editor from
 * the calendar, or the task editor from a card, replaces the whole surface and
 * simply cannot happen when the state is a constant. This entry renders the same
 * surface the app renders, from `useNavigationState()`, so a gesture in the
 * calendar really does open the editor its route names — which is the only way to
 * assert that a dragged time range arrives in the editor intact.
 */
function LiveProjectsSurface() {
  const state = useNavigationState()
  const { navigate } = useNavigation()
  const landed = React.useRef(false)
  React.useEffect(() => {
    if (landed.current) return
    if (isProjectsNavigation(state)) {
      landed.current = true
      return
    }
    /*
     * The provider finishes its own first-mount reconciliation AFTER this effect
     * (children's effects run first), so navigating synchronously here is
     * overwritten and the surface stays on All Sessions. One tick later it sticks.
     * Passing `?ws=<slug>&route=calendar` in the URL avoids the wait entirely, and
     * is what the verification suite does.
     */
    const timer = window.setTimeout(() => {
      landed.current = true
      navigate(routes.view.projectManagement('calendar'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [navigate, state])

  if (!isProjectsNavigation(state)) {
    return <div className="grid h-full place-items-center text-sm text-foreground/45">Opening the calendar…</div>
  }
  return <ProjectManagementSurface state={state} />
}

function LiveProjectsSurfacePreview() {
  return (
    <ScheduleProviders>
      <LiveProjectsSurface />
    </ScheduleProviders>
  )
}

/*
 * The standalone schedule editor preview is gone with the page: creating and
 * editing schedule entries now happens in the shared Task Definition editor, which
 * `projects-surface-live` reaches through real navigation.
 */

export const scheduleViewComponents: ComponentEntry[] = [
  {
    category: 'Project Management',
    id: 'projects-overview-view',
    name: 'Projects Overview',
    description: 'Project Management overview with the shared projection switcher.',
    component: () => <ProjectManagementViewPreview view="overview" />,
    props: [],
    variants: [{ name: 'Overview', props: {} }],
  },
  {
    category: 'Project Management',
    id: 'work-item-list-view',
    name: 'Work Item List',
    description: 'List projection with local controls left and the shared projection switcher right.',
    component: () => <ProjectManagementViewPreview view="list" />,
    props: [],
    variants: [{ name: 'List', props: {} }],
  },
  {
    category: 'Project Management',
    id: 'work-item-board-view',
    name: 'Work Item Board',
    description: 'Board projection with New Task left and the shared projection switcher right.',
    component: () => <ProjectManagementViewPreview view="board" />,
    props: [],
    variants: [{ name: 'Board', props: {} }],
  },
  {
    category: 'Project Management',
    id: 'calendar-view',
    name: 'Calendar View',
    description: 'Calendar projection with date controls left and the shared projection switcher right.',
    component: () => <ProjectManagementViewPreview view="calendar" />,
    props: [],
    variants: [{ name: 'Calendar', props: {} }],
  },
  {
    category: 'Project Management',
    id: 'projects-surface-live',
    name: 'Projects Surface (live navigation)',
    description: 'The real Projects surface driven by navigation state, so in-view routes — the schedule editor, the task editor — can be reached and verified.',
    component: () => <LiveProjectsSurfacePreview />,
    props: [],
    variants: [{ name: 'Calendar', props: {} }],
  },
  {
    category: 'Project Management',
    id: 'gantt-view',
    name: 'Gantt View',
    description: 'Gantt projection over the plan fixture: hierarchy with a rolled-up summary, a milestone, a 5-day bar and two undated items.',
    component: () => <ProjectManagementViewPreview view="gantt" />,
    props: [],
    variants: [{ name: 'Gantt', props: {} }],
  },
]
