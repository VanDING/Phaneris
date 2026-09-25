import { RPC_CHANNELS, type CalendarEntry, type CalendarEntryInput, type Session } from '@phaneris/shared/protocol'
import { isValidPlanValue, planDateKey, planTimeOfDay } from '@phaneris/shared/work-items'
import { pushTyped, type RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.calendar.LIST,
  RPC_CHANNELS.calendar.CREATE,
  RPC_CHANNELS.calendar.UPDATE,
  RPC_CHANNELS.calendar.DELETE,
] as const

/**
 * Reject a planning value the read path would not be able to interpret.
 *
 * Writing first and validating never is how `2026-9-2` reached the store: it
 * passed every check, then produced `NaN-NaN-NaN` on drag and corrupted
 * lexicographic range comparison. Failing at the boundary keeps the store
 * interpretable and gives the editor a message it can show.
 */
function assertWritable(value: string, field: string): void {
  if (!isValidPlanValue(value)) {
    throw new Error(`Invalid ${field}: expected YYYY-MM-DD or YYYY-MM-DDTHH:mm, received "${value}"`)
  }
}

function sessionToEntry(session: Session): CalendarEntry | null {
  const date = planDateKey(session.startAt) ?? planDateKey(session.dueAt)
  if (!date) return null
  const startTime = planTimeOfDay(session.startAt)
  const endTime = planTimeOfDay(session.dueAt)
  return {
    id: session.id,
    title: session.name?.trim() || session.preview?.trim() || 'Untitled schedule',
    date,
    endDate: planDateKey(session.dueAt) ?? date,
    time: startTime,
    endTime,
    allDay: !startTime,
    note: session.description,
    projectId: session.projectId,
    createdAt: session.createdAt ?? session.lastMessageAt,
    updatedAt: session.lastMessageAt,
  }
}

function temporal(date: string, clock?: string): string {
  return clock ? `${date}T${clock}` : date
}

function broadcastChanged(server: RpcServer, workspaceId: string): void {
  pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  pushTyped(server, RPC_CHANNELS.workItems.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
}

/**
 * Calendar projection: every visible Session carrying a date.
 *
 * There is no legacy CalendarEntry store and no migration. The previous
 * one-shot migration re-ran on every LIST, wrote its completion marker last,
 * and created its own sessions through a path that re-broadcast a change —
 * so a single interrupted pass became an unbounded session-creation loop.
 */
export function registerCalendarHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.calendar.LIST, async (_ctx, workspaceId: string) => {
    await deps.sessionManager.waitForInit()
    return deps.sessionManager.getSessions(workspaceId)
      .filter((session) => !session.hidden && !session.isArchived && !session.taskDraft)
      .flatMap((session) => {
        const entry = sessionToEntry(session)
        return entry ? [entry] : []
      })
  })

  server.handle(RPC_CHANNELS.calendar.CREATE, async (_ctx, workspaceId: string, input: CalendarEntryInput) => {
    const endDate = input.endDate ?? input.date
    assertWritable(input.date, 'date')
    assertWritable(endDate, 'endDate')
    if (endDate < input.date) throw new Error('End date must not be before the start date')
    const session = await deps.sessionManager.createSession(workspaceId, {
      name: input.title.trim(),
      projectId: input.projectId,
      sessionStatus: 'backlog',
      description: input.note,
      startAt: temporal(input.date, input.allDay ? undefined : input.time),
      dueAt: temporal(endDate, input.allDay ? undefined : input.endTime),
    })
    broadcastChanged(server, workspaceId)
    return sessionToEntry(session)!
  })

  server.handle(RPC_CHANNELS.calendar.UPDATE, async (_ctx, workspaceId: string, entryId: string, input: CalendarEntryInput) => {
    const session = deps.sessionManager.getSessions(workspaceId).find(({ id }) => id === entryId)
    if (!session) throw new Error(`Session not found: ${entryId}`)
    const endDate = input.endDate ?? input.date
    assertWritable(input.date, 'date')
    assertWritable(endDate, 'endDate')
    if (endDate < input.date) throw new Error('End date must not be before the start date')
    await deps.sessionManager.renameSession(entryId, input.title.trim())
    await deps.sessionManager.setSessionProjectId(entryId, input.projectId ?? null)
    await deps.sessionManager.updateSessionPlanning(entryId, {
      description: input.note ?? null,
      startAt: temporal(input.date, input.allDay ? undefined : input.time),
      dueAt: temporal(endDate, input.allDay ? undefined : input.endTime),
    })
    broadcastChanged(server, workspaceId)
    return sessionToEntry(deps.sessionManager.getSessions(workspaceId).find(({ id }) => id === entryId)!)!
  })

  server.handle(RPC_CHANNELS.calendar.DELETE, async (_ctx, workspaceId: string, entryId: string) => {
    const exists = deps.sessionManager.getSessions(workspaceId).some(({ id }) => id === entryId)
    if (exists) await deps.sessionManager.updateSessionPlanning(entryId, { startAt: null, dueAt: null })
    broadcastChanged(server, workspaceId)
  })
}
