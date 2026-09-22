import { RPC_CHANNELS, type Session } from '@phaneris/shared/protocol'
import {
  type CreateWorkItemInput,
  type UpdateWorkItemInput,
  type WorkItem,
} from '@phaneris/shared/work-items'
import { pushTyped, type RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workItems.LIST,
  RPC_CHANNELS.workItems.CREATE,
  RPC_CHANNELS.workItems.UPDATE,
  RPC_CHANNELS.workItems.DELETE,
] as const

/**
 * Preview text is a projection convenience only: it backs the fallback title
 * when a Session has no name. The header stores the first user message in full,
 * which is unbounded, so it is trimmed before crossing IPC.
 */
const PREVIEW_LIMIT = 240

function projectPreview(session: Session): string | undefined {
  const preview = session.preview?.trim()
  if (!preview) return undefined
  return preview.length > PREVIEW_LIMIT ? preview.slice(0, PREVIEW_LIMIT) : preview
}

function broadcastChanged(server: RpcServer, workspaceId: string): void {
  pushTyped(server, RPC_CHANNELS.workItems.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
}

function sessionToWorkItem(session: Session): WorkItem {
  return {
    id: session.id,
    title: session.name?.trim() || projectPreview(session) || 'Untitled task',
    description: session.description,
    acceptanceCriteria: session.acceptanceCriteria,
    projectId: session.projectId,
    statusId: session.sessionStatus ?? 'backlog',
    columnId: session.kanbanColumn,
    startAt: session.startAt,
    dueAt: session.dueAt,
    progress: session.progress,
    dependencyIds: session.dependencySessionIds ?? [],
    parentId: session.parentSessionId,
    sessionIds: [session.id],
    primarySessionId: session.id,
    isMilestone: session.isMilestone,
    createdAt: session.createdAt ?? session.lastMessageAt,
    updatedAt: session.lastMessageAt,
    archivedAt: session.archivedAt,
  }
}

/**
 * Visible planning projection of Sessions.
 *
 * Archived sessions are excluded here rather than in each view: a long-lived
 * workspace accumulates far more finished sessions than live work, and every
 * projection (board, calendar, timeline) is a view of current work.
 */
function visiblePlanningSessions(deps: HandlerDeps, workspaceId: string): Session[] {
  return deps.sessionManager.getSessions(workspaceId).filter((session) =>
    !session.hidden && !session.isArchived && !session.taskDraft,
  )
}

async function updateSessionFromWorkItem(
  deps: HandlerDeps,
  workspaceId: string,
  sessionId: string,
  patch: UpdateWorkItemInput,
): Promise<WorkItem> {
  const session = deps.sessionManager.getSessions(workspaceId).find(({ id }) => id === sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  if (patch.title !== undefined) await deps.sessionManager.renameSession(sessionId, patch.title.trim())
  if ('projectId' in patch) await deps.sessionManager.setSessionProjectId(sessionId, patch.projectId ?? null)
  if (patch.statusId !== undefined) await deps.sessionManager.setSessionStatus(sessionId, patch.statusId)
  if ('columnId' in patch) await deps.sessionManager.setKanbanColumn(sessionId, patch.columnId ?? null)
  await deps.sessionManager.updateSessionPlanning(sessionId, {
    ...('description' in patch ? { description: patch.description } : {}),
    ...('acceptanceCriteria' in patch ? { acceptanceCriteria: patch.acceptanceCriteria } : {}),
    ...('startAt' in patch ? { startAt: patch.startAt } : {}),
    ...('dueAt' in patch ? { dueAt: patch.dueAt } : {}),
    ...('progress' in patch ? { progress: patch.progress } : {}),
    ...(patch.dependencyIds ? { dependencySessionIds: patch.dependencyIds } : {}),
    ...('parentId' in patch ? { parentSessionId: patch.parentId } : {}),
    ...(patch.isMilestone !== undefined ? { isMilestone: patch.isMilestone } : {}),
  })
  const updated = deps.sessionManager.getSessions(workspaceId).find(({ id }) => id === sessionId)
  if (!updated) throw new Error(`Session not found after update: ${sessionId}`)
  return sessionToWorkItem(updated)
}

/**
 * Task/board projection. Sessions are the single source of truth: there is no
 * separate WorkItem store and no legacy migration. The previous migration ran
 * on every LIST, wrote its completion marker last, and created sessions through
 * a path that re-broadcast a change — an interrupted pass therefore looped,
 * minting a duplicate session per legacy item on each retry.
 */
export function registerWorkItemHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.workItems.LIST, async (_ctx, workspaceId: string) => {
    await deps.sessionManager.waitForInit()
    return visiblePlanningSessions(deps, workspaceId).map(sessionToWorkItem)
  })

  server.handle(RPC_CHANNELS.workItems.CREATE, async (_ctx, workspaceId: string, input: CreateWorkItemInput) => {
    const session = await deps.sessionManager.createSession(workspaceId, {
      name: input.title.trim(),
      projectId: input.projectId,
      sessionStatus: input.statusId ?? 'backlog',
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      startAt: input.startAt,
      dueAt: input.dueAt,
      progress: input.progress,
      dependencySessionIds: input.dependencyIds,
      parentSessionId: input.parentId,
      isMilestone: input.isMilestone,
    })
    if (input.columnId) await deps.sessionManager.setKanbanColumn(session.id, input.columnId)
    broadcastChanged(server, workspaceId)
    const created = deps.sessionManager.getSessions(workspaceId).find(({ id }) => id === session.id) ?? session
    return sessionToWorkItem(created)
  })

  server.handle(RPC_CHANNELS.workItems.UPDATE, async (_ctx, workspaceId: string, itemId: string, patch: UpdateWorkItemInput) => {
    const item = await updateSessionFromWorkItem(deps, workspaceId, itemId, patch)
    broadcastChanged(server, workspaceId)
    return item
  })

  server.handle(RPC_CHANNELS.workItems.DELETE, async (_ctx, workspaceId: string, itemId: string) => {
    const exists = deps.sessionManager.getSessions(workspaceId).some(({ id }) => id === itemId)
    if (exists) await deps.sessionManager.deleteSession(itemId)
    broadcastChanged(server, workspaceId)
  })
}
