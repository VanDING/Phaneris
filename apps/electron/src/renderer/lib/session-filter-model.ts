/**
 * Session filtering, as a pure function.
 *
 * This is the "which sessions does the navigator show" decision: a primary filter
 * derived from the route (all / flagged / archived / status / label / view) plus
 * three layered secondary filters (status, labels, projects) that each support
 * include and exclude modes.
 *
 * It lived inline in `AppShell` — 110 lines inside a `useMemo` in a 3.8k-line
 * component, readable only by mounting the whole shell. Nothing in it touches
 * React: given the same metas, filter state and label config, it returns the same
 * rows. That makes it testable directly, and it is the part of AppShell most
 * worth being able to test that way, because it is where "the sidebar shows the
 * wrong sessions" bugs live.
 *
 * Two behaviours worth stating because they are easy to break:
 *
 * - `archived` is the only filter that reads archived sessions. Every other
 *   filter, including the secondary ones, operates on active sessions, so
 *   archiving something removes it from everywhere except the archive.
 * - Excludes are applied *after* includes, and always as a removal. A label
 *   filter that both includes and excludes the same id therefore ends with it
 *   excluded.
 */
import type { SessionMeta } from '@/atoms/sessions'
import { extractLabelId, getDescendantIds, matchesLabelFilter, type LabelConfig } from '@phaneris/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import type { SessionFilter } from '../../shared/types'

/** include keeps matching items; exclude removes them. */
export type FilterMode = 'include' | 'exclude'
export type FilterMap = Map<string, FilterMode>

export interface SessionFilterInputs {
  /** Sessions in the active workspace, archived and active alike. */
  workspaceMetas: SessionMeta[]
  /** `workspaceMetas` minus archived. The base for almost every filter. */
  activeMetas: SessionMeta[]
  /** Primary filter from the route; `null` means "not a session surface". */
  sessionFilter: SessionFilter | null
  listFilter: FilterMap
  labelFilter: FilterMap
  projectFilter: FilterMap
  labelConfigs: LabelConfig[]
  /** Views matching a session, for the `view` filter kind. */
  evaluateViews: (session: SessionMeta) => Array<{ id: string }>
}

const statusOf = (session: SessionMeta) => (session.sessionStatus || 'todo') as SessionStatusId
const labelsOf = (session: SessionMeta) => session.labels ?? []

function splitModes(filter: FilterMap): { includes: Set<string>; excludes: Set<string> } {
  const includes = new Set<string>()
  const excludes = new Set<string>()
  for (const [id, mode] of filter) (mode === 'include' ? includes : excludes).add(id)
  return { includes, excludes }
}

export function filterSessions({
  workspaceMetas,
  activeMetas,
  sessionFilter,
  listFilter,
  labelFilter,
  projectFilter,
  labelConfigs,
  evaluateViews,
}: SessionFilterInputs): SessionMeta[] {
  if (!sessionFilter) return []

  let result: SessionMeta[]
  switch (sessionFilter.kind) {
    case 'archived':
      // The only filter that looks at archived sessions.
      result = workspaceMetas.filter(session => session.isArchived)
      break
    case 'flagged':
      result = activeMetas.filter(session => session.isFlagged)
      break
    case 'state':
      result = activeMetas.filter(session => statusOf(session) === sessionFilter.stateId)
      break
    case 'label':
      // Shared predicate with the session list so the two cannot drift.
      result = activeMetas.filter(session => matchesLabelFilter(session, sessionFilter, labelConfigs))
      break
    case 'view':
      result = activeMetas.filter(session => {
        const matched = evaluateViews(session)
        return sessionFilter.viewId === '__all__' ? matched.length > 0 : matched.some(view => view.id === sessionFilter.viewId)
      })
      break
    case 'allSessions':
    default:
      result = activeMetas
  }

  const statuses = splitModes(listFilter)
  if (statuses.includes.size > 0) result = result.filter(session => statuses.includes.has(statusOf(session)))
  if (statuses.excludes.size > 0) result = result.filter(session => !statuses.excludes.has(statusOf(session)))

  const labels = splitModes(labelFilter)
  // Expand every id to include its descendants before matching.
  const labelIncludes = new Set<string>()
  for (const id of labels.includes) for (const expanded of [id, ...getDescendantIds(labelConfigs, id)]) labelIncludes.add(expanded)
  const labelExcludes = new Set<string>()
  for (const id of labels.excludes) for (const expanded of [id, ...getDescendantIds(labelConfigs, id)]) labelExcludes.add(expanded)
  if (labelIncludes.size > 0) result = result.filter(session => labelsOf(session).some(entry => labelIncludes.has(extractLabelId(entry))))
  if (labelExcludes.size > 0) result = result.filter(session => !labelsOf(session).some(entry => labelExcludes.has(extractLabelId(entry))))

  const projects = splitModes(projectFilter)
  if (projects.includes.size > 0) {
    result = result.filter(session => {
      const projectId = (session as { projectId?: string }).projectId
      return projectId !== undefined && projects.includes.has(projectId)
    })
  }
  if (projects.excludes.size > 0) {
    result = result.filter(session => {
      const projectId = (session as { projectId?: string }).projectId
      return projectId === undefined || !projects.excludes.has(projectId)
    })
  }

  return result
}


