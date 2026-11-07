import { RPC_CHANNELS, type Session } from '@phaneris/shared/protocol'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext } from '../../transport/types'
import type { AssistantDispatch, AssistantWorkQuery } from '@phaneris/session-tools-core/delegation-contracts'

export const HANDLED_CHANNELS = [RPC_CHANNELS.residentAssistant.GET, RPC_CHANNELS.residentAssistant.CONTEXT, RPC_CHANNELS.residentAssistant.EVENTS, RPC_CHANNELS.residentAssistant.DISPATCH,
  RPC_CHANNELS.residentAssistant.WORK, RPC_CHANNELS.residentAssistant.CONTROL, RPC_CHANNELS.residentAssistant.ORIGINALS, RPC_CHANNELS.residentAssistant.EXECUTION_MODE, RPC_CHANNELS.residentAssistant.CANCEL_WORK, RPC_CHANNELS.residentAssistant.OUTPUT_VISIBILITY] as const

/** Identity/settings replies share the bounded Session metadata projection. */
function residentMetadata(session: Session): Session {
  return { ...session, messages: [], messageCount: session.messages.length }
}

export function registerResidentAssistantHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.residentAssistant.ORIGINALS, (ctx, workspaceId: string, sessionId: string, query: import('@phaneris/session-tools-core/session-history-contracts').SessionHistoryQuery) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.readAssistantOriginals(workspaceId, sessionId, query)
  })
  server.handle(RPC_CHANNELS.residentAssistant.EXECUTION_MODE, async (ctx, workspaceId: string, mode: import('@phaneris/shared/agent/mode-types').PermissionMode) => {
    assertWorkspace(ctx, workspaceId)
    return residentMetadata(await deps.sessionManager.setAssistantExecutionMode(workspaceId, mode))
  })
  server.handle(RPC_CHANNELS.residentAssistant.CONTROL, (ctx, workspaceId: string, command: import('@phaneris/session-tools-core/worker-control-contracts').WorkerControl) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.controlAssistantWork(workspaceId, command)
  })
  server.handle(RPC_CHANNELS.residentAssistant.OUTPUT_VISIBILITY, (ctx, workspaceId: string, command: import('@phaneris/session-tools-core/task-result-contracts').TaskOutputVisibility) => {
    assertWorkspace(ctx, workspaceId)
    return deps.sessionManager.setAssistantOutputVisibility(workspaceId, command)
  })
  function assertWorkspace(ctx: RequestContext, workspaceId: string): void {
    const accepted = ctx.workspaceId ?? (ctx.webContentsId !== null ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) : null)
    if (!accepted || accepted !== workspaceId) throw new Error('Workspace context does not permit this assistant request')
  }
  server.handle(RPC_CHANNELS.residentAssistant.GET, async (ctx, workspaceId: string) => {
    assertWorkspace(ctx, workspaceId)
    const session = await deps.sessionManager.getOrCreateResidentAssistant(workspaceId)
    // The identity operation is bounded; the shared Session read protocol owns
    // timelines, including the potentially much larger diagnostic snapshots.
    return residentMetadata(session)
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
