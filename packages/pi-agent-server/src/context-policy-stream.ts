import type { StreamFn } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai'
import { calculateContextTokens, estimateTokens } from '@earendil-works/pi-coding-agent'
import { contextHandoffBudget, HANDOFF_INSTRUCTION, validateHandoffDocument, type ContextPolicy } from '../../shared/src/agent/context-policy.ts'

export type HandoffSignal = { phase: 'generating' | 'ready' | 'failed'; document?: string; error?: string }

/** Occupancy of the exact prefix the provider is about to receive. */
function measureContext(messages: TranscriptContext['messages']): number {
  let billedTokens = 0
  let lastUsage = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role !== 'assistant') continue
    if (message.stopReason === 'error' || message.stopReason === 'aborted') continue
    const tokens = calculateContextTokens(message.usage)
    if (tokens <= 0) continue
    billedTokens = tokens
    lastUsage = index
    break
  }
  // The last billed request already covered everything before it, system prompt
  // and tool declarations included; only the messages appended since need
  // estimating. Without a usable usage, estimate the whole prefix.
  let used = billedTokens
  for (let index = lastUsage + 1; index < messages.length; index++) {
    used += estimateTokens(messages[index]!)
  }
  return used
}

/**
 * Runs at the actual provider boundary: every request — first and follow-up,
 * after each tool batch — passes through here, so a handoff starts as soon as
 * the budget is spent rather than waiting for the task to finish.
 */
export function createContextPolicyStream(
  stream: StreamFn,
  policy: () => ContextPolicy,
  notify: (signal: HandoffSignal) => void,
  consumeForcedHandoff: () => boolean,
): StreamFn {
  let previousUsed = 0
  return (model, context, options) => {
    // A forced retry means "generate the document now", whatever the measured
    // budget says — the user is recovering a handoff that already failed.
    const forced = consumeForcedHandoff()
    const active = forced ? 'handoff' : policy()
    if (active === 'compact') return stream(model, context, options)
    const currentTools = getCurrentTools(context.messages)
    const used = measureContext(context.messages)
    const growth = previousUsed > 0 ? Math.max(0, used - previousUsed) : 0
    previousUsed = used
    const budget = contextHandoffBudget(model.contextWindow, used, model.maxTokens, growth)
    const handoff = active === 'handoff' && (forced || used >= budget.triggerTokens)
    const manualFull = active === 'manual' && used + Math.min(model.maxTokens, 8192) + 2048 >= model.contextWindow
    if (!handoff && !manualFull) return stream(model, context, options)

    const target = createAssistantMessageEventStream()
    const fail = (error: string) => {
      if (handoff) notify({ phase: 'failed', error })
      const message: AssistantMessage = {
        role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: options?.signal?.aborted ? 'aborted' : 'error', errorMessage: error, timestamp: Date.now(),
      }
      target.push({ type: 'error', reason: message.stopReason as 'error' | 'aborted', error: message })
    }
    void (async () => {
      try {
        if (manualFull) { fail('Context capacity reached. Compact manually or start a new session to continue.'); return }
        if (!budget.canGenerate) { fail('Not enough context remains to generate a reliable handoff. The original history is preserved.'); return }
        notify({ phase: 'generating' })
        const source = await stream(model, {
          messages: [
            ...context.messages,
            {
              role: 'system',
              content: 'Do not use tools during handoff generation.',
              toolsRemoved: currentTools.map(tool => ({ name: tool.name })),
              timestamp: Date.now(),
            },
            { role: 'user', content: HANDOFF_INSTRUCTION, timestamp: Date.now() },
          ],
        } as typeof context, { ...options, maxTokens: budget.outputTokens, reasoning: undefined })
        for await (const event of source) {
          if (options?.signal?.aborted) { fail('Handoff cancelled'); return }
          if (event.type === 'done') {
            const document = event.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
            if (event.message.stopReason !== 'stop' || !validateHandoffDocument(document) || event.message.content.some(block => block.type === 'toolCall')) {
              fail('Handoff document was incomplete. Retry the handoff; ordinary execution remains paused.'); return
            }
            notify({ phase: 'ready', document })
          } else if (event.type === 'error') {
            notify({ phase: 'failed', error: event.error.errorMessage ?? 'Handoff generation failed' })
          }
          target.push(event)
        }
      } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    })()
    return target
  }
}
