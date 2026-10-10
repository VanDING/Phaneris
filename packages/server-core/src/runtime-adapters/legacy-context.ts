import type { RuntimeEvent } from '@phaneris/shared/durable-runtime'
import type { DurableRuntime } from '../durable-runtime/index.js'
import { redactDurablePayload } from '../durable-runtime/index.js'

  /**
   * Safe compatibility import for branch/history context. These facts carry an
   * explicit unverified provenance and never create tool dispatch evidence or
   * operation state, so they cannot authorize recovery/replay.
   */
export function importLegacyContext(
    runtime: DurableRuntime,
    workspaceRootPath: string,
    sessionId: string,
    messages: import('@phaneris/core/types').Message[],
    importedAt = Date.now(),
  ): number[] {
    const operationId = `legacy-import:${sessionId}`
    const events: RuntimeEvent[] = messages.flatMap((message, index) => {
      const kind = message.toolUseId
        ? 'tool'
        : message.role === 'user'
          ? 'user'
          : message.role === 'assistant'
            ? 'assistant'
            : undefined
      if (!kind) return []
      return [{
        eventId: `${operationId}:${index}:${message.toolUseId ?? message.id}`,
        sessionId,
        turnId: message.turnId,
        operationId,
        type: 'legacy_context_imported' as const,
        schemaVersion: 1 as const,
        modelVisible: true,
        partial: false,
        payload: redactDurablePayload({
          provenance: 'legacy_cache_unverified',
          dispatchEvidence: false,
          kind,
          messageId: message.id,
          content: message.content,
          toolCallId: message.toolUseId,
          toolName: message.toolName,
          args: message.toolInput,
          result: message.toolResult,
          isError: message.isError ?? message.toolStatus === 'error',
          hasOutcome: (message.toolStatus === 'completed' || message.toolStatus === 'error')
            && message.toolResult !== undefined,
        }),
        createdAt: message.timestamp || importedAt,
      }]
    })
    return events.length > 0 ? runtime.evidence.appendExternalFacts(workspaceRootPath, events) : []
  }
