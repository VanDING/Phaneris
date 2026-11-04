import type { StoredMessage } from '@phaneris/core/types'

/** A historical role=user is insufficient for either a user assertion or authorization. */
export function isDirectUserMessage(message: StoredMessage): boolean {
  return message.type === 'user' && !message.hidden && !message.inputSource
    && !/^(?:assistant-work:|agent-message:)/.test(message.id)
    && !/^\s*\[Message from session\b/i.test(message.content)
}

/** Tool input/result fields own the evidence even when the display text is empty.
 * Search and exact reads must hash and expose the same deterministic source view. */
export function historySourceContent(message: StoredMessage): string {
  if (message.type !== 'tool') return message.content
  return JSON.stringify({ content: message.content, toolName: message.toolName, toolUseId: message.toolUseId,
    toolInput: message.toolInput, toolResult: message.toolResult, toolStatus: message.toolStatus, isError: message.isError })
}
