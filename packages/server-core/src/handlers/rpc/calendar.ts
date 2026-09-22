import { RPC_CHANNELS, type CalendarEntry, type CalendarEntryInput, type Session } from '@phaneris/shared/protocol'
import { pushTyped, type RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.calendar.LIST,
  RPC_CHANNELS.calendar.CREATE,
  RPC_CHANNELS.calendar.UPDATE,
  RPC_CHANNELS.calendar.DELETE,
] as const

function day(value: string | undefined): string | undefined {
  return value?.slice(0, 10)
}

function time(value: string | undefined): string | undefined {
  return value?.includes('T') ? value.slice(11, 16) : undefined
}

function sessionToEntry(session: Session): CalendarEntry | null {
  const date = day(session.startAt) ?? day(session.dueAt)
  if (!date) return null
  const startTime = time(session.startAt)
  const endTime = time(session.dueAt)
  return {
    id: session.id,
    title: session.name?.trim() || session.preview?.trim() || 'Untitled schedule',
    date,
    endDate: day(session.dueAt) ?? date,
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
