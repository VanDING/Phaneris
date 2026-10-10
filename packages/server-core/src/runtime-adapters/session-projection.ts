import { sumTokenUsage } from '@phaneris/core/utils'
import type { PiUsage, Message } from '@phaneris/core/types'
import type { RuntimeEvent, ToolOutcome } from '@phaneris/shared/durable-runtime'
import type { RuntimeUsageRow } from '../durable-runtime/index.js'

/**
 * Reorder and overwrite the model-visible portion of the rich legacy UI cache
 * from canonical facts. Rich UI-only metadata remains a compatibility overlay;
 * execution order, content, tool input and settled outcome come from runtime.db.
 */
export function projectCanonicalSessionMessages(events: RuntimeEvent[], legacy: Message[]): Message[] {
  const byMessageId = new Map(legacy.map(message => [message.id, message]))
  const byToolCallId = new Map(legacy.filter(message => message.toolUseId).map(message => [message.toolUseId!, message]))
  const canonical: Message[] = []
  const canonicalToolIndex = new Map<string, number>()
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  for (const event of ordered) {
    if (!event.modelVisible || event.partial) continue
    if (event.type === 'legacy_context_imported') {
      const payload = event.payload as {
        kind?: unknown; messageId?: unknown; content?: unknown; toolCallId?: unknown
        toolName?: unknown; args?: unknown; result?: unknown; isError?: unknown; hasOutcome?: unknown
      }
      if ((payload.kind === 'user' || payload.kind === 'assistant') && typeof payload.messageId === 'string' && typeof payload.content === 'string') {
        const cached = byMessageId.get(payload.messageId)
        if (cached) canonical.push({ ...cached, content: payload.content, durableOperationId: event.operationId, durableSeq: event.seq })
      } else if (payload.kind === 'tool' && typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
        const cached = byToolCallId.get(payload.toolCallId)
        if (cached) {
          canonicalToolIndex.set(payload.toolCallId, canonical.length)
          canonical.push({
            ...cached,
            toolName: payload.toolName,
            toolInput: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args as Record<string, unknown> : cached.toolInput,
            toolResult: payload.hasOutcome === true
              ? (typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result))
              : cached.toolResult,
            toolStatus: payload.hasOutcome === true ? (payload.isError === true ? 'error' : 'completed') : cached.toolStatus,
            isError: payload.hasOutcome === true ? payload.isError === true : cached.isError,
            durableOperationId: event.operationId,
            durableSeq: event.seq,
          })
        }
      }
      continue
    }

    if (event.type === 'user_message_committed' || event.type === 'assistant_message_committed') {
      const payload = event.payload as { messageId?: unknown; content?: unknown }
      if (typeof payload.messageId !== 'string' || typeof payload.content !== 'string') continue
      const cached = byMessageId.get(payload.messageId)
      if (!cached) continue
      canonical.push({
        ...cached,
        role: event.type === 'user_message_committed' ? 'user' : 'assistant',
        content: payload.content,
        durableOperationId: event.operationId,
        durableSeq: event.seq,
      })
      continue
    }
    if (event.type === 'tool_call_observed') {
      const payload = event.payload as { providerToolCallId?: unknown; toolName?: unknown; args?: unknown; toolOperationId?: unknown }
      if (typeof payload.providerToolCallId !== 'string' || typeof payload.toolName !== 'string') continue
      const cached = byToolCallId.get(payload.providerToolCallId)
      if (!cached) continue
      canonicalToolIndex.set(payload.providerToolCallId, canonical.length)
      canonical.push({
        ...cached,
        toolUseId: payload.providerToolCallId,
        toolName: payload.toolName,
        toolInput: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
          ? payload.args as Record<string, unknown>
          : cached.toolInput,
        durableOperationId: typeof payload.toolOperationId === 'string' ? payload.toolOperationId : cached.durableOperationId,
        durableSeq: event.seq,
      })
      continue
    }
    if (event.type === 'tool_outcome_committed') {
      const outcome = event.payload as ToolOutcome
      const index = canonicalToolIndex.get(outcome.providerToolCallId)
      if (index === undefined) continue
      const cached = canonical[index]!
      canonical[index] = {
        ...cached,
        toolResult: typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result),
        toolStatus: outcome.isError ? 'error' : 'completed',
        isError: outcome.isError,
        durableOperationId: outcome.operationId,
        durableSeq: event.seq,
      }
    }
  }

  // Preserve UI-only messages (warnings, plans, status/compaction records) in
  // their existing slots while replacing semantic slots in canonical order.
  let semanticIndex = 0
  const merged: Message[] = []
  for (const message of legacy) {
    // Empty assistant records carry request usage, not model-visible text.
    const modelVisible = message.role === 'user' || (message.role === 'assistant' && !(message.usage && !message.content)) || Boolean(message.toolUseId)
    if (modelVisible) {
      const replacement = canonical[semanticIndex++]
      if (replacement) merged.push(replacement)
    } else {
      merged.push(message)
    }
  }
  merged.push(...canonical.slice(semanticIndex))
  return merged
}

export interface DurableUsageProjection {
  attempts: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextTokens: number
  costUsd: number
  unknownCostRequests: number
  estimatedCostRequests: number
  cacheReadTokens: number
  cacheCreationTokens: number
  full: PiUsage
  lastFullUsage?: PiUsage
}

/** Rebuild cumulative usage exclusively from unique request facts. */
export function projectDurableUsage(rows: RuntimeUsageRow[]): DurableUsageProjection {
  const ordered = [...new Map(rows.map(row => [row.usageId, row])).values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.usageId.localeCompare(right.usageId))
  const usages = ordered.map(row => {
    const payload = row.payload as { usage?: Partial<PiUsage> } | undefined
    const usage = payload?.usage
    return sumTokenUsage([{
      input: row.inputTokens ?? usage?.input ?? 0,
      output: row.outputTokens ?? usage?.output ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
      reasoning: usage?.reasoning,
      cacheWrite1h: usage?.cacheWrite1h,
      totalTokens: 0,
      cost: {
        input: usage?.cost?.input ?? 0,
        output: usage?.cost?.output ?? 0,
        cacheRead: usage?.cost?.cacheRead ?? 0,
        cacheWrite: usage?.cost?.cacheWrite ?? 0,
        total: row.costUsd ?? usage?.cost?.total ?? 0,
      },
    }])
  })
  const full = sumTokenUsage(usages)
  // Auxiliary usage contributes to totals, never to conversational context.
  const lastConversationIndex = ordered.findLastIndex(row =>
    !['cache_warm', 'decision', 'image_generation'].includes((row.payload as { kind?: string } | undefined)?.kind ?? ''))
  const lastFullUsage = lastConversationIndex >= 0 ? usages[lastConversationIndex] : undefined
  return {
    attempts: ordered.length,
    inputTokens: full.input + full.cacheRead + full.cacheWrite,
    outputTokens: full.output,
    totalTokens: full.totalTokens,
    contextTokens: lastFullUsage?.totalTokens ?? 0,
    costUsd: full.cost.total,
    unknownCostRequests: ordered.filter(row => row.costUsd === undefined && (row.payload as { usage?: PiUsage } | undefined)?.usage?.cost?.total === undefined).length,
    estimatedCostRequests: ordered.filter(row => (row.payload as { costSource?: string } | undefined)?.costSource === 'estimated').length,
    cacheReadTokens: full.cacheRead,
    cacheCreationTokens: full.cacheWrite,
    full,
    lastFullUsage,
  }
}
