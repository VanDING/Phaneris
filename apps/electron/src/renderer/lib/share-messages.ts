import type { Message } from '@phaneris/core/types'
import { groupImmutableMessagesByTurn } from '@phaneris/ui'

export interface ShareMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Position in the original message sequence, used to mark omissions. */
  position: number
}

/** Snapshot the same finalized answers rendered by TurnCard, not activity text. */
export function collectShareMessages(messages: Message[], isProcessing: boolean): ShareMessage[] {
  const result: ShareMessage[] = []
  const turns = groupImmutableMessagesByTurn(messages, { isSessionProcessing: isProcessing })
  for (const [position, turn] of turns.entries()) {
    if (turn.type === 'user' && turn.message.content.trim()) {
      let content = turn.message.content
      const editBadges = (turn.message.badges ?? []).filter(badge => badge.type === 'context' && badge.rawText?.includes('<edit_request>')).sort((a, b) => b.start - a.start)
      for (const badge of editBadges) content = content.slice(0, badge.start) + content.slice(badge.end)
      if (content.trim()) result.push({ id: turn.message.id, role: 'user', content: content.trim(), position })
    }
    if (turn.type === 'assistant' && turn.isComplete && turn.response?.messageId && turn.response.text.trim()) {
      result.push({ id: turn.response.messageId, role: 'assistant', content: turn.response.text, position })
    }
  }
  return result
}
