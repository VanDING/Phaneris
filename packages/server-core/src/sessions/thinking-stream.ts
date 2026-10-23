import type { AgentEvent, Message, TrajectorySourceBlock } from '@phaneris/core/types'

const streams = new WeakMap<object, { turnId: string; blocks: TrajectorySourceBlock[]; startedAt: number }>()
export function clearThinkingStream(owner: object): void { streams.delete(owner) }
export function rememberThinkingDelta(owner: object, event: Extract<AgentEvent, { type: 'thinking_delta' }>): void {
  const state = streams.get(owner)?.turnId === event.turnId ? streams.get(owner)! : { turnId: event.turnId, blocks: [], startedAt: Date.now() }
  const block = state.blocks.find(block => block.index === event.blockIndex)
  if (block) block.content = (block.content ?? '') + event.text
  else if (event.text) state.blocks.push({ type: 'thinking', index: event.blockIndex, content: event.text })
  streams.set(owner, state)
}
/** Preserve received display content at cancellation without inventing a model outcome. */
export function takeInterruptedThinking(owner: { messages: Message[]; streamingText: string }, timestamp: number): Message | undefined {
  const state = streams.get(owner); streams.delete(owner)
  if (!state?.blocks.length || owner.messages.some(message => message.role === 'assistant' && message.turnId === state.turnId)) return
  return { id: `thinking-${state.turnId}`, role: 'assistant', turnId: state.turnId, content: owner.streamingText,
    timestamp: Math.min(state.startedAt, timestamp), isIntermediate: true, outputBlocks: state.blocks }
}
