import { useTranslation } from 'react-i18next'
import * as React from 'react'
import type { ProjectsNavigationState } from '../../../shared/types'
import ProjectInfoPage from '@/pages/ProjectInfoPage'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { CalendarView } from '@/components/app-shell/kanban/CalendarView'
import { KanbanBoardContainer } from '@/components/app-shell/kanban/KanbanBoardContainer'
import { WorkItemListView } from '@/components/app-shell/kanban/WorkItemListView'
import { TaskEditorOverlay } from './TaskEditorOverlay'
import { GanttView } from '@/components/app-shell/kanban/GanttView'
import { SurfaceErrorBoundary } from '@/components/app-shell/SurfaceErrorBoundary'

export interface ProjectManagementSurfaceProps {
  state: ProjectsNavigationState
}

function assertNeverProjectManagementView(view: never): never {
  throw new Error(`Unsupported Project Management view: ${String(view)}`)
}

/**
 * The single Primary Surface for project-oriented work.
 *
 * Overview, Kanban and Calendar are projections within this component. Future
 * projections must be added to the shared registry and handled exhaustively
 * here; they do not become new top-level panel kinds.
 */
export function ProjectManagementSurface({ state }: ProjectManagementSurfaceProps) {
  const { t } = useTranslation()
  /*
   * Detail routes now fall through to their projection. The two full-page editors
   * they used to render were replaced by the shared Task Definition overlay, so
   * `kanban/work-item/:id` and `calendar/schedule/:id` degrade to "show me the
   * board / the calendar" instead of a blank pane — an old link lands somewhere
   * real. Removing the route vocabulary itself is a navigation-layer change with
   * its own blast radius (parser, persisted URLs, session list) and is not needed
   * to retire the pages.
   */
  let content: React.ReactNode
  switch (state.view) {
    case 'list':
      content = <WorkItemListView />
      break
    case 'board':
      content = <KanbanBoardContainer />
      break
    case 'calendar':
      content = <CalendarView />
      break
    case 'gantt':
      content = <GanttView />
      break
    case 'overview':
      if (state.details?.type === 'project') {
        content = <ProjectInfoPage projectSlug={state.details.projectSlug} />
        break
      }
      content = (
        <div className="flex h-full flex-col">
          <PanelHeader
            title={t('sidebar.projects')}
            centerTitleInPanel
          />
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p className="text-sm">{t('projectsList.noProjectSelected')}</p>
          </div>
        </div>
      )
      break
    default:
      return assertNeverProjectManagementView(state.view)
  }

  return (
    <div className="@container/panel relative h-full min-h-0 overflow-hidden">
      <div key={state.view} className="motion-view-enter h-full min-h-0">
        <SurfaceErrorBoundary surface={`projects/${state.view}`} resetKey={state.view}>
          {content}
        </SurfaceErrorBoundary>
      </div>
      {/*
        The create/edit surface for project work. It covers the projection rather
        than replacing it, so opening it from the calendar or the timeline leaves
        the user where they were instead of moving them to the board.
      */}
      <TaskEditorOverlay />
    </div>
  )
}
