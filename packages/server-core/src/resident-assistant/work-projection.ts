import type { Message, SessionInputExecutionsPage } from '@phaneris/core/types'
import type { AssistantDelegationReceipt, AssistantWorkExecution } from '@phaneris/session-tools-core/delegation-contracts'

/** Read-only observations of the original input; later human work has its own attribution. */
export function projectWorkExecution(receipt: AssistantDelegationReceipt, session: {
  messages: readonly Message[]; processing: boolean; thinking: boolean; streaming: boolean
}, page: SessionInputExecutionsPage): AssistantWorkExecution {
  const index = session.messages.findIndex(message => message.id === receipt.inputMessageId)
  const input = session.messages[index]
  const after = index < 0 ? [] : session.messages.slice(index + 1)
  const later = after.findIndex(message => message.role === 'user' && !message.inputSource && !message.hidden)
  const original = later < 0 ? after : after.slice(0, later)
  const failure = original.findLast(message => message.role === 'error')
  const tool = original.findLast(message => message.role === 'tool' && ['executing', 'pending'].includes(message.toolStatus ?? ''))
  const continuationSessionId = receipt.result?.sessionId !== receipt.sessionId ? receipt.result?.sessionId : undefined
  const notStarted = input?.delegationInput?.submittedAt === undefined && ['saved', 'queued', 'rejected'].includes(input?.inputReception?.disposition ?? '')
    && ['accepted', 'preparing', 'submitting', 'cancelled', 'failed'].includes(receipt.state)
  const activity: AssistantWorkExecution['activity'] = receipt.state === 'cancelled' ? 'cancelled' : receipt.state === 'failed' ? 'failed'
    : receipt.state === 'result_ready' ? 'completed' : receipt.state === 'needs_attention' || receipt.state === 'cancel_requested' ? 'waiting'
      : session.processing && later < 0 ? tool ? 'tool' : session.thinking ? 'thinking' : session.streaming ? 'responding' : 'requesting'
        : page.items[0]?.phase === 'model_effect_pending' ? 'requesting' : notStarted ? 'queued' : 'unknown'
  const followUp = later < 0 ? undefined : after.slice(later).findLast(message => message.role === 'user' && !message.inputSource && !message.hidden)
  const result = followUp ? after.slice(after.indexOf(followUp) + 1).findLast(message => message.role === 'assistant' && !message.isIntermediate && message.content.trim()) : undefined
  return { source: 'runtime', inputMessageId: receipt.inputMessageId!, sourceAvailable: !!input,
    coverage: page.total ? continuationSessionId || original.some(message => message.inputSource?.kind === 'runtime_continuation') ? 'original_input_with_continuation' : 'original_input' : notStarted ? 'not_started' : 'unknown',
    attempts: page.items, nextBefore: page.nextBefore, totalAttempts: page.total, continuationSessionId, activity, toolName: tool?.toolDisplayMeta?.displayName ?? tool?.toolName,
    ...(failure ? { error: { messageId: failure.id, summary: (failure.errorOriginal || failure.errorDetails?.join('\n') || failure.content).slice(0, 2000), code: failure.errorCode } } : {}),
    ...(followUp ? { followUp: { inputMessageId: followUp.id, at: followUp.timestamp, isProcessing: session.processing,
      ...(result ? { result: { sessionId: receipt.sessionId!, messageId: result.id } } : {}) } } : {}) }
}
