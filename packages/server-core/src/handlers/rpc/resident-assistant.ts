import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext } from '../../transport/types'
import type { AssistantDispatch, AssistantWorkQuery } from '@phaneris/session-tools-core/delegation-contracts'

export const HANDLED_CHANNELS = [RPC_CHANNELS.residentAssistant.GET, RPC_CHANNELS.residentAssistant.CONTEXT, RPC_CHANNELS.residentAssistant.EVENTS, RPC_CHANNELS.residentAssistant.DISPATCH,
  RPC_CHANNELS.residentAssistant.WORK, RPC_CHANNELS.residentAssistant.CANCEL_WORK] as const

export function registerResidentAssistantHandlers(server: RpcServer, deps: HandlerDeps): void {
  function assertWorkspace(ctx: RequestContext, workspaceId: string): void {
    const accepted = ctx.workspaceId ?? (ctx.webContentsId !== null ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) : null)
    if (!accepted || accepted !== workspaceId) throw new Error('Workspace context does not permit this assistant request')
  }
  server.handle(RPC_CHANNELS.residentAssistant.GET, async (ctx, workspaceId: string) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.getOrCreateResidentAssistant(workspaceId)
  })
  server.handle(RPC_CHANNELS.residentAssistant.CONTEXT, (ctx, workspaceId: string, command: import('@phaneris/session-tools-core/resident-context-contracts').ResidentContextCommand) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.assistantContext(workspaceId, command)
  })
  server.handle(RPC_CHANNELS.residentAssistant.EVENTS, (ctx, workspaceId: string, query: { after?: number; limit?: number }) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.assistantEvents(workspaceId, query)
  })
  server.handle(RPC_CHANNELS.residentAssistant.DISPATCH, (ctx, workspaceId: string, request: AssistantDispatch) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.dispatchAssistantWork(workspaceId, request)
  })
  server.handle(RPC_CHANNELS.residentAssistant.WORK, (ctx, workspaceId: string, query: AssistantWorkQuery) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.getAssistantWork(workspaceId, query)
  })
  server.handle(RPC_CHANNELS.residentAssistant.CANCEL_WORK, (ctx, workspaceId: string, id: string) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.cancelAssistantWork(workspaceId, id)
  })
}
