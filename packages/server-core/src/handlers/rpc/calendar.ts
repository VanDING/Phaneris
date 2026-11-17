import { RPC_CHANNELS, type CalendarEntryInput } from '@phaneris/shared/protocol'
import type { RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.calendar.LIST,
  RPC_CHANNELS.calendar.CREATE,
  RPC_CHANNELS.calendar.UPDATE,
  RPC_CHANNELS.calendar.DELETE,
] as const

/**
 * Calendar projection: every visible Session carrying a date.
 *
 * There is no legacy CalendarEntry store and no migration. The previous
 * one-shot migration re-ran on every LIST, wrote its completion marker last,
 * and created its own sessions through a path that re-broadcast a change —
 * so a single interrupted pass became an unbounded session-creation loop.
 */
export function registerCalendarHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.calendar.LIST, (_ctx, workspaceId: string) =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).listCalendar())
  server.handle(RPC_CHANNELS.calendar.CREATE, (_ctx, workspaceId: string, input: CalendarEntryInput) =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).createCalendar(input))
  server.handle(RPC_CHANNELS.calendar.UPDATE, (_ctx, workspaceId: string, entryId: string, input: CalendarEntryInput) =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).updateCalendar(entryId, input))
  // Published compatibility: calendar deletion clears dates and retains the Session.
  server.handle(RPC_CHANNELS.calendar.DELETE, (_ctx, workspaceId: string, entryId: string): Promise<void> =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).clearSchedule(entryId))

}
