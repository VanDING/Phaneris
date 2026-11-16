import type { CalendarEntry, CalendarEntryInput, Session } from '@phaneris/shared/protocol'
import { calendarPlanningFields, workItemToCalendarEntry, type CreateWorkItemInput, type UpdateWorkItemInput, type WorkItem } from '@phaneris/shared/work-items'

/** Derived conversation links belong to read models, never to an internal edit. */
export type PlanningCreate = Omit<CreateWorkItemInput, 'sessionIds' | 'primarySessionId'>
export type PlanningUpdate = Omit<UpdateWorkItemInput, 'sessionIds' | 'primarySessionId' | 'archivedAt'>
interface PlanningHost {
  waitForInit(): Promise<void>
  getSessions(workspaceId: string): Session[]
  createPlanningItem(workspaceId: string, input: PlanningCreate): Promise<Session>
  updatePlanningItem(workspaceId: string, id: string, patch: PlanningUpdate): Promise<void>
  deleteSession(id: string): Promise<void>
}

function visible(session: Session): boolean { return !session.hidden && !session.isArchived && !session.taskDraft }
function project(session: Session, residentIds: ReadonlySet<string>, legacyCalendar = false): WorkItem {
  const managedBy = session.parentSessionId && residentIds.has(session.parentSessionId) ? session.parentSessionId : undefined
  const preview = session.preview?.trim()
  return {
    id: session.id,
    title: session.name?.trim() || (legacyCalendar ? preview : preview?.slice(0, 240)) || (legacyCalendar ? 'Untitled schedule' : 'Untitled task'),
    description: session.description, acceptanceCriteria: session.acceptanceCriteria, projectId: session.projectId,
    statusId: session.sessionStatus ?? 'todo', columnId: session.kanbanColumn,
    startAt: session.startAt, dueAt: session.dueAt, progress: session.progress, dependencyIds: session.dependencySessionIds ?? [],
    parentId: managedBy && !session.handoffFromSessionId ? undefined : session.parentSessionId,
    managedBySessionId: managedBy, sessionIds: [session.id], primarySessionId: session.id, isMilestone: session.isMilestone,
    createdAt: session.createdAt ?? session.lastMessageAt, updatedAt: session.lastMessageAt, archivedAt: session.archivedAt,
  }
}

/** Session facts are read once; legacy calendar presentation remains explicit. */
export function createWorkspacePlanning(workspaceId: string, host: PlanningHost) {
  function snapshot() {
    const sessions = host.getSessions(workspaceId)
    return { sessions, residentIds: new Set(sessions.filter(session => session.sessionKind === 'resident_assistant').map(session => session.id)) }
  }
  function legacyEntry(session: Session): CalendarEntry | null { return workItemToCalendarEntry(project(session, new Set(), true)) }
  return {
    async list(): Promise<WorkItem[]> {
      await host.waitForInit()
      const { sessions, residentIds } = snapshot()
      return sessions.filter(visible).map(session => project(session, residentIds))
    },
    async listCalendar(): Promise<CalendarEntry[]> {
      await host.waitForInit()
      const { sessions } = snapshot()
      return sessions.filter(visible).flatMap(session => { const entry = legacyEntry(session); return entry ? [entry] : [] })
    },
    async create(input: PlanningCreate): Promise<WorkItem> {
      const session = await host.createPlanningItem(workspaceId, input)
      const { sessions, residentIds } = snapshot()
      return project(sessions.find(value => value.id === session.id) ?? session, residentIds)
    },
    async update(id: string, patch: PlanningUpdate): Promise<WorkItem> {
      await host.updatePlanningItem(workspaceId, id, patch)
      const { sessions, residentIds } = snapshot(), updated = sessions.find(session => session.id === id)
      if (!updated) throw new Error(`Session not found after update: ${id}`)
      return project(updated, residentIds)
    },
    async clearSchedule(id: string): Promise<void> {
      if (host.getSessions(workspaceId).some(session => session.id === id)) await host.updatePlanningItem(workspaceId, id, { startAt: null, dueAt: null })
    },
    async remove(id: string): Promise<void> {
      if (host.getSessions(workspaceId).some(session => session.id === id)) await host.deleteSession(id)
    },
    async createCalendar(input: CalendarEntryInput): Promise<CalendarEntry> {
      const session = await host.createPlanningItem(workspaceId, { title: input.title.trim(), projectId: input.projectId,
        statusId: 'backlog', description: input.note, ...calendarPlanningFields(input) })
      return legacyEntry(session)!
    },
    async updateCalendar(id: string, input: CalendarEntryInput): Promise<CalendarEntry> {
      await host.updatePlanningItem(workspaceId, id, { title: input.title.trim(), projectId: input.projectId ?? null,
        description: input.note ?? null, ...calendarPlanningFields(input) })
      const session = host.getSessions(workspaceId).find(value => value.id === id)
      if (!session) throw new Error(`Session not found after update: ${id}`)
      return legacyEntry(session)!
    },
  }
}
export type WorkspacePlanning = ReturnType<typeof createWorkspacePlanning>
