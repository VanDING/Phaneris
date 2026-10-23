import type { SessionState, ThinkingDeltaEvent } from '../types'
import type { Message } from '../../../shared/types'
import { appendMessage, findStreamingMessage, generateMessageId, updateMessageAt } from '../helpers'
import { recordMessageTextUpdate } from '@phaneris/core/utils'

/** Thinking shares the assistant request identity but never enters answer text. */
export function handleThinkingDelta(state: SessionState, event: ThinkingDeltaEvent): SessionState {
  const index = findStreamingMessage(state.session.messages, event.turnId)
  const current = index < 0 ? undefined : state.session.messages[index]
  if (!current && !event.delta) return state
  const blocks = [...(current?.outputBlocks ?? [])]
  const position = blocks.findIndex(block => block.type === 'thinking' && block.index === event.blockIndex)
  const previous = position < 0 ? undefined : blocks[position]
  const next = { type: 'thinking', index: event.blockIndex, content: (previous?.content ?? '') + event.delta, isStreaming: !event.complete }
  if (position < 0) blocks.push(next)
  else blocks[position] = next
  const message: Message = current ? { ...current, outputBlocks: blocks } : {
    id: generateMessageId(), role: 'assistant', content: '', timestamp: Date.now(), turnId: event.turnId,
    isPending: true, isStreaming: true, outputBlocks: blocks,
  }
  const session = index < 0 ? appendMessage(state.session, message, false) : updateMessageAt(state.session, index, message)
  if (index >= 0 && position >= 0) recordMessageTextUpdate(state.session.messages, session.messages, index)
  return { session,
    streaming: { ...state.streaming, content: state.streaming?.content ?? '', turnId: event.turnId,
      messageIndex: index < 0 ? state.session.messages.length : index, messageId: message.id } }
}
