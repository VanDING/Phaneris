import type { TokenUsage } from '@phaneris/core/types'

export interface SessionCompletionEvent {
  /** Actual producer when the logical task has continued through a context handoff. */
  resultSessionId?: string
  inputMessageIds?: string[]
  sessionId: string
  workspaceId: string
  reason: 'complete' | 'interrupted' | 'error' | 'timeout'
  /** The final (non-intermediate) assistant message id for this turn, if any. */
  finalMessageId?: string
  /** Convenience copy of the final assistant message text (same as getSessionFinalText). */
  finalText?: string
  /** The session's cumulative token usage, so the Conductor can meter token_budget without re-fetching. */
  tokenUsage?: TokenUsage
}
