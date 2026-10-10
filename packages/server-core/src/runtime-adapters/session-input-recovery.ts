import type { Message, StoredAttachment } from '@phaneris/core/types'
import type { SendMessageOptions } from '@phaneris/shared/protocol'
import type { DurableRuntime, RuntimeScope, RuntimeInputReceipt } from '../durable-runtime/index.js'
import type { QueuedSessionInput } from './session-runtime-view.js'

/** Compatibility storage supplies candidates; only Host decides whether they can be delivered. */
export function recoverSessionQueue(runtime: DurableRuntime, scope: RuntimeScope, messages: Message[]) {
  const admissions = new Map(runtime.queries.events(scope.workspaceRootPath, { sessionId: scope.sessionId })
    .filter(event => event.type === 'user_input_admitted').map(event => {
      const payload = event.payload as { messageId: string; options?: SendMessageOptions; attachments?: StoredAttachment[] }
      return [payload.messageId, payload] as const
    }))
  const candidates = messages.filter(message => message.role === 'user' && message.isQueued === true).map(message => ({
    message: message.content, messageId: message.id, storedAttachments: message.attachments ?? admissions.get(message.id)?.attachments,
    options: admissions.get(message.id)?.options ?? (message.hidden ? { hidden: true } : undefined),
    reception: message.inputReception as RuntimeInputReceipt | undefined,
  } satisfies QueuedSessionInput & { reception?: RuntimeInputReceipt }))
  const recovered = runtime.execution.recoverQueued(scope, candidates)
  if (recovered.held) {
    const id = `recovery-inputs:${scope.sessionId}`
    if (!messages.some(message => message.id === id)) messages.push({ id, role: 'warning', timestamp: Date.now(),
      content: 'Some saved inputs have uncertain delivery evidence. They were retained and will not be sent automatically. Review the prior turn before retrying.' })
  }
  return recovered
}
