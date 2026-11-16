import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import {
  type CreateWorkItemInput,
  type UpdateWorkItemInput,
} from '@phaneris/shared/work-items'
import type { RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workItems.LIST,
  RPC_CHANNELS.workItems.CREATE,
  RPC_CHANNELS.workItems.UPDATE,
  RPC_CHANNELS.workItems.DELETE,
] as const

/**
 * Task/board projection. Sessions are the single source of truth: there is no
 * separate WorkItem store and no legacy migration. The previous migration ran
 * on every LIST, wrote its completion marker last, and created sessions through
 * a path that re-broadcast a change — an interrupted pass therefore looped,
 * minting a duplicate session per legacy item on each retry.
 */
export function registerWorkItemHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.workItems.LIST, (_ctx, workspaceId: string) =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).list())
  server.handle(RPC_CHANNELS.workItems.CREATE, (_ctx, workspaceId: string, input: CreateWorkItemInput) =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).create(input))
  server.handle(RPC_CHANNELS.workItems.UPDATE, (_ctx, workspaceId: string, itemId: string, patch: UpdateWorkItemInput) =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).update(itemId, patch))
  server.handle(RPC_CHANNELS.workItems.DELETE, (_ctx, workspaceId: string, itemId: string): Promise<void> =>
    deps.sessionManager.getWorkspacePlanning(workspaceId).remove(itemId))

}
