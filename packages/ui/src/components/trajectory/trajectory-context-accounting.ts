import type { Message } from '@phaneris/core/types'
import type { TrajectoryContextGroup, TrajectoryRequestContext } from './trajectory-context'
import { contextItemChanges } from './RunContextChanges'

const toolRoles = new Set(['tool', 'toolResult', 'tool_result'])
const amount = (group: TrajectoryContextGroup | undefined) => group?.attributedTokens ?? group?.estimatedTokens ?? 0

/** Only anchor output when its response extends the same observable conversation. */
function retainedOutput(previous: Message, current: Message) {
  const before = previous.contextSnapshot, after = current.contextSnapshot
  const output = previous.usage?.output
  if (!before || !after || output === undefined || !Number.isFinite(output) || output < 0
    || current.requestSeq !== previous.requestSeq! + 1
    || before.provider !== after.provider || before.model !== after.model
    || before.messages.length >= after.messages.length) return undefined
  if (!before.messages.every((entry, index) => {
    const next = after.messages[index]!
    return entry.role === next.role && (entry.content?.hash ?? entry.hash) === (next.content?.hash ?? next.hash)
  })) return undefined
  const added = after.messages.slice(before.messages.length)
  const assistant = added.filter(entry => entry.role === 'assistant')
  if (assistant.length !== 1) return undefined
  const blocks = previous.outputBlocks ?? []
  const calls = blocks.some(block => block.type === 'tool-call')
  const text = blocks.some(block => block.type === 'text' && block.content?.trim()) || !!previous.content.trim()
  if (blocks.length === 0 && added.some(entry => toolRoles.has(entry.role))) return undefined
  const chars = blocks.filter(block => block.type === 'text' || block.type === 'thinking')
    .reduce((sum, block) => sum + (block.content?.length ?? 0), 0) + (blocks.some(block => block.type === 'text') ? 0 : previous.content.length)
  if (assistant[0]!.content && assistant[0]!.content.textChars !== chars) return undefined
  const reasoning = previous.usage?.reasoning
  // Mixed text + calls has no measured split; leave that uncertainty visible.
  if (calls && (text || reasoning === undefined || !Number.isFinite(reasoning) || reasoning < 0 || reasoning > output)) return undefined
  return { output: Math.round(output), assistant: Math.round(calls ? reasoning! : output), added }
}

/**
 * A measured total constrains attribution, not unchanged content. Start with
 * retained estimates and keep a visible remainder. As intact responses enter
 * the next request, output/reasoning metering constrains their contribution.
 * A single new result category can then receive the remaining input increment.
 * Ambiguous changes keep their estimates; the remainder absorbs uncertainty.
 */
export function attributeContextTokens(
  current: TrajectoryRequestContext,
  previous: TrajectoryRequestContext | undefined,
  request: Message,
  previousRequest: Message | undefined,
): readonly TrajectoryContextGroup[] {
  const input = current.inputTokens
  if (input === undefined) return current.groups
  const comparable = previous?.inputTokens !== undefined
    && previous.provider === current.provider && previous.model === current.model
    && previous.groups.every(group => group.attributedTokens !== null)
  const changes = new Map(current.groups.map(group => [group.category,
    contextItemChanges(group.items, previous?.groups.find(entry => entry.category === group.category)?.items ?? [])]))
  const amounts = new Map(current.groups.map(group => {
    const old = comparable ? previous.groups.find(entry => entry.category === group.category) : undefined
    return [group.category, old
      ? Math.max(0, amount(old) + (changes.get(group.category)!.length ? group.estimatedTokens - old.estimatedTokens : 0))
      : group.estimatedTokens]
  }))
  const retained = comparable && previousRequest ? retainedOutput(previousRequest, request) : undefined
  if (retained && input - previous!.inputTokens! >= retained.output) {
    const assistantBefore = previous!.groups.find(group => group.category === 'assistant')
    amounts.set('assistant', amount(assistantBefore) + retained.assistant)
    const resultCategories = current.groups.filter(group => (group.category === 'tool' || group.category === 'skill')
      && changes.get(group.category)!.some(change => change.change === 'added'))
    const category = resultCategories.length === 1 ? resultCategories[0]!.category : undefined
    const unchangedRest = category && current.groups.every(group => group.category === 'assistant'
      || group.category === category || changes.get(group.category)!.length === 0)
    if (category && unchangedRest && retained.added.every(entry => entry.role === 'assistant' || toolRoles.has(entry.role))) {
      amounts.set(category, amount(previous!.groups.find(group => group.category === category))
        + input - previous!.inputTokens! - retained.assistant)
    }
  }
  const sum = [...amounts.values()].reduce((total, tokens) => total + tokens, 0)
  // Conflicting evidence cannot justify shrinking unrelated categories.
  const unavailable = sum > input
  const remainder = unavailable ? input : input - sum
  const groups = current.groups.map(group => ({ ...group,
    attributedTokens: unavailable ? null : amounts.get(group.category)!,
    share: input > 0 && !unavailable ? amounts.get(group.category)! / input : 0,
  }))
  if (remainder > 0 || unavailable) groups.push({ category: 'unknown', items: [], chars: 0, estimatedTokens: 0,
    imageCount: 0, attributedTokens: remainder, share: input > 0 ? remainder / input : 0 })
  return groups
}
