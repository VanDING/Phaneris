import type { SessionScopedToolCallbacks } from '@phaneris/shared/agent'
import { loadSession } from '@phaneris/shared/sessions'
import { isDirectUserMessage } from './source-provenance'
import { AssistantMemoryStore } from './memory-store'

/** Sources and paths come from Host identity, never model-provided workspace IDs. */
export function buildResidentMemoryCallbacks({ workspace, memory, assertResidentRole, track, sessionId, currentRun, currentProject }: {
  workspace: { id: string; rootPath: string }; memory: AssistantMemoryStore; assertResidentRole(): void
  track?: (dependencies: Partial<import('@phaneris/session-tools-core/resident-context-contracts').ResidentDependencies>) => void
  sessionId?: string; currentRun?: () => string; currentProject?: () => string | undefined
}): Pick<SessionScopedToolCallbacks, 'assistantMemoryInspectFn' | 'assistantMemoryMaintenanceFn' | 'assistantMemorySearchFn' | 'assistantMemoryReadFn' | 'assistantHistorySearchFn' | 'assistantContextHistoryFn'> {
  function withMemory<T>(operation: (store: AssistantMemoryStore) => T): T {
    assertResidentRole()
    return operation(memory)
  }
  return {
    ...(currentRun ? { assistantMemoryMaintenanceFn: async (input: import('@phaneris/session-tools-core/memory-maintenance-contracts').MemoryMaintenanceCommand) => withMemory(store => {
      const command = input.action === 'next' ? { ...input, projectId: input.scope === 'workspace' ? undefined : input.projectId ?? currentProject?.() } : input
      const result = store.maintain(command, currentRun())
      if (result.status === 'source') track?.({ sources: [{ sessionId: result.source.sessionId, messageId: result.source.messageId,
        contentHash: result.source.contentHash, ranges: [result.range] }] })
      return result
    }) } : {}),
    ...(sessionId ? { assistantContextHistoryFn: async (input: { query?: string; offset?: number; limit?: number }) => withMemory(store => {
      const messages = loadSession(workspace.rootPath, sessionId)?.messages.filter(message => isDirectUserMessage(message)
        && !store.isSourceSuppressed({ sessionId, messageId: message.id }) && message.content.toLocaleLowerCase().includes((input.query ?? '').toLocaleLowerCase())) ?? []
      const offset = input.offset ?? 0, limit = input.limit ?? 10
      const items = messages.slice(offset, offset + limit).map(message => { const source = store.readSource({ sessionId, messageId: message.id }); return { ...source, content: source.content.slice(0, 2000), fullChars: source.content.length } })
      track?.({ sources: items.map(item => ({ sessionId, messageId: item.messageId, contentHash: item.contentHash, ranges: [{ offset: 0, end: item.content.length }] })) })
      return { items, nextOffset: offset + limit < messages.length ? offset + limit : null }
    }) } : {}),
    assistantHistorySearchFn: async input => withMemory(store => {
      const projectId = input.scope === 'workspace' ? undefined : input.projectId ?? currentProject?.()
      const result = store.history({ ...input, projectId, includeWorkspace: input.includeWorkspace ?? !!projectId }); track?.({ sources: result.items.map(item => ({ sessionId: item.sessionId, messageId: item.messageId, contentHash: item.contentHash, ranges: [item.range] })) }); return result
    }),
    assistantMemorySearchFn: async input => withMemory(store => {
      const projectId = input.scope === 'workspace' ? undefined : input.projectId ?? currentProject?.()
      const result = store.lookup({ ...input, projectId, includeWorkspace: input.includeWorkspace ?? !!projectId })
      const visible = result.items.filter(item => !item.redacted)
      track?.({ memories: visible.map(item => ({ id: item.id, revision: item.revision, observedState: item.state, observedDispute: item.disputed })), sources: visible.flatMap(item => item.sources) }); return result
    }),
    assistantMemoryInspectFn: async input => withMemory(store => {
      const result = store.inspect(input), record = result.record
      if (!record.redacted) track?.({ memories: [{ id: record.id, revision: record.revision, observedState: record.state, observedDispute: !!record.dispute }], sources: record.sources })
      return result
    }),
    assistantMemoryReadFn: async input => withMemory(store => {
      const source = store.readSource(input)
      const offset = Math.min(input.offset ?? 0, source.content.length)
      const end = Math.min(offset + (input.maxChars ?? 5000), source.content.length)
      track?.({ sources: [{ sessionId: source.sessionId, messageId: source.messageId, contentHash: source.contentHash, ranges: [{ offset, end }] }] })
      return { ...source, content: source.content.slice(offset, end),
        range: { offset, end, fullChars: source.content.length }, nextOffset: end < source.content.length ? end : null }
    }),
  }
}
