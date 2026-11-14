import type { Message, SessionDelegationInput } from '@phaneris/core/types'
import type { AssistantDelegationReceipt } from '@phaneris/session-tools-core/delegation-contracts'
import type { TaskReview } from '@phaneris/session-tools-core/task-result-contracts'

interface TaskSession {
  id: string; sessionStatus?: string; isArchived?: boolean; messages: Message[]
  runtime: { isProcessing: boolean }
}
interface TaskOwner { root: TaskSession; target: TaskSession; chain: TaskSession[]; messages: Message[] }
interface LifecyclePort {
  owner(receipt: AssistantDelegationReceipt): Promise<TaskOwner>
  admission<T>(sessionId: string, action: () => Promise<T>): Promise<T>
  heldSessionIds(): readonly string[]
  authorize(receipt: AssistantDelegationReceipt, input: Message): void
  status(sessionId: string, status: string): Promise<void>
}

/** Session owns business state. Input/result guards prevent old delivery from
 * closing a later human turn, a manually edited status, or another assignment. */
export class SessionTaskLifecycle {
  constructor(private readonly port: LifecyclePort) {}

  private input(owner: TaskOwner, receipt: AssistantDelegationReceipt): Message | undefined {
    const input = owner.root.messages.find(message => message.id === receipt.inputMessageId)
    if (input?.inputSource?.kind !== 'delegation' || input.inputSource.delegationId !== receipt.id || !input.delegationInput) return
    const messages = owner.chain.flatMap(session => session.messages)
    const following = messages.slice(messages.indexOf(input) + 1)
    if (following.some(message => message.role === 'user' && (!message.inputSource || message.inputSource.kind === 'delegation'))) return
    return input
  }

  async settled(receipt: AssistantDelegationReceipt): Promise<void> {
    if (!receipt.sessionId || !receipt.inputMessageId) return
    const desired = receipt.state === 'cancelled' ? 'cancelled'
      : ['result_ready', 'failed', 'needs_attention'].includes(receipt.state) ? 'needs-review' : undefined
    if (!desired) return
    const owner = await this.port.owner(receipt)
    await this.port.admission(owner.target.id, async () => {
      const input = this.input(owner, receipt), guard = input?.delegationInput?.statusControl
      if (!guard || guard.withdrawn || owner.root.isArchived || guard.review || (owner.root.sessionStatus ?? 'todo') !== guard.expectedStatus) return
      if (owner.chain.some(session => session.runtime.isProcessing || this.port.heldSessionIds().includes(session.id))) return
      guard.expectedStatus = desired
      await this.port.status(owner.root.id, desired)
    })
  }

  async review(receipt: AssistantDelegationReceipt, command: TaskReview, mayApply: () => boolean): Promise<NonNullable<SessionDelegationInput['statusControl']>['review']> {
    const owner = await this.port.owner(receipt)
    return this.port.admission(owner.target.id, async () => {
      if (!mayApply()) throw new Error('Task receipt changed while reviewing; inspect the current result')
      const input = this.input(owner, receipt)
      if (!input) throw new Error('A later direct input or assignment owns this Session; the old result cannot close it')
      if (command.outcome === 'accepted' && input.delegationInput!.completionPolicy === 'user_review')
        throw new Error('The original assignment requires personal user review; keep this Session pending review')
      this.port.authorize(receipt, input)
      const guard = input.delegationInput!.statusControl
      if (!guard || guard.withdrawn || owner.root.isArchived || (owner.root.sessionStatus ?? 'todo') !== guard.expectedStatus)
        throw new Error('Session status was edited outside this assignment; preserve the manual status and review the current work')
      if (owner.chain.some(session => session.runtime.isProcessing || this.port.heldSessionIds().includes(session.id)))
        throw new Error('Execution or an unsettled tool effect still owns this Session')
      const review = { result: command.result, outcome: command.outcome, reason: command.reason }
      if (guard.review) {
        if (guard.review.outcome !== review.outcome || guard.review.result.sessionId !== review.result.sessionId || guard.review.result.messageId !== review.result.messageId)
          throw new Error('This result already has a different review; continue the original Session for revised work')
        // Retried model wording is not a new conclusion. Keep the first reason
        // immutable while allowing the same result/outcome to finish its ACK.
        await this.port.status(owner.root.id, guard.expectedStatus)
        return guard.review
      }
      const desired = command.outcome === 'accepted' ? 'done' : command.outcome === 'rework' ? 'todo' : 'needs-review'
      guard.review = review
      guard.expectedStatus = desired
      // The review reference, status guard and actual status are persisted in
      // the same Session write. A lost tool ACK can safely retry this result.
      await this.port.status(owner.root.id, desired)
      return review
    })
  }
}
