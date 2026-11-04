import { getWorkspaceByNameOrId } from '@phaneris/shared/config/workspace-selection'
import { RPC_CHANNELS, type MemoryMutation, type MemoryQuery, type MemorySourceRead, type HistoryQuery, type MemorySuppressionQuery, type MemorySuppressionMerge } from '@phaneris/shared/protocol'
import type { RequestContext, RpcServer } from '../../transport/types'
import { pushTyped } from '../../transport/push'
import type { HandlerDeps } from '../handler-deps'
import { AssistantMemoryStore } from '../../resident-assistant/memory-store'

export const HANDLED_CHANNELS = [RPC_CHANNELS.assistantMemory.QUERY, RPC_CHANNELS.assistantMemory.HISTORY, RPC_CHANNELS.assistantMemory.MUTATE, RPC_CHANNELS.assistantMemory.READ_SOURCE, RPC_CHANNELS.assistantMemory.SUPPRESSION_EXPORT, RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE] as const

export function registerAssistantMemoryHandlers(
  server: RpcServer,
  deps: Pick<HandlerDeps, 'windowManager'>,
  resolveWorkspace: (id: string) => { id: string; rootPath: string } | null = getWorkspaceByNameOrId,
): void {
  function access<T>(ctx: RequestContext, workspaceId: string, operation: (store: AssistantMemoryStore) => T): T {
    const accepted = ctx.workspaceId ?? (ctx.webContentsId !== null ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) : null)
    if (!accepted || accepted !== workspaceId) throw new Error('Workspace context does not permit this memory request')
    const workspace = resolveWorkspace(workspaceId)
    if (!workspace || workspace.id !== workspaceId) throw new Error('Workspace not found')
    const store = new AssistantMemoryStore(workspace)
    try { return operation(store) } finally { store.close() }
  }
  server.handle(RPC_CHANNELS.assistantMemory.QUERY, (ctx, workspaceId: string, query: MemoryQuery) =>
    access(ctx, workspaceId, store => store.query(query)))
  server.handle(RPC_CHANNELS.assistantMemory.SUPPRESSION_EXPORT, (ctx, workspaceId: string, query: MemorySuppressionQuery) =>
    access(ctx, workspaceId, store => store.exportSuppression(query)))
  server.handle(RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE, (ctx, workspaceId: string, command: MemorySuppressionMerge) => {
    const result = access(ctx, workspaceId, store => store.mergeSuppression(command))
    pushTyped(server, RPC_CHANNELS.assistantMemory.CHANGED, { to: 'workspace', workspaceId },
      { workspaceId, id: command.entries[0]!.memoryId, version: result.version })
    return result
  })
  server.handle(RPC_CHANNELS.assistantMemory.HISTORY, (ctx, workspaceId: string, query: HistoryQuery) =>
    access(ctx, workspaceId, store => store.history(query)))
  server.handle(RPC_CHANNELS.assistantMemory.READ_SOURCE, (ctx, workspaceId: string, source: MemorySourceRead) =>
    access(ctx, workspaceId, store => store.readSource(source)))
  server.handle(RPC_CHANNELS.assistantMemory.MUTATE, (ctx, workspaceId: string, command: MemoryMutation) => {
    const result = access(ctx, workspaceId, store => store.mutate(command))
    pushTyped(server, RPC_CHANNELS.assistantMemory.CHANGED, { to: 'workspace', workspaceId },
      { workspaceId, id: result.record.id, version: result.version })
    return result
  })
}
