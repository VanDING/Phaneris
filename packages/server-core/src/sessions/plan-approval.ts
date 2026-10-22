import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** Bind approval to the immutable message shown to the user, never a mutable file read. */
export function buildPlanApproval(messages: readonly { id: string; role: string; content: string; planPath?: string }[], planPath?: string, expectedMessageId?: string): string {
  const plan = messages.findLast(message => message.role === 'plan' && message.planPath)
  if (!plan || !plan.content.trim()) throw new Error('No submitted plan is available for approval.')
  if (expectedMessageId && plan.id !== expectedMessageId) throw new Error('The displayed plan has been superseded. Review the latest plan before accepting.')
  if (planPath && resolve(planPath) !== resolve(plan.planPath!)) throw new Error('This plan is no longer the latest submitted plan. Review the latest plan before accepting.')
  const hash = createHash('sha256').update(plan.content).digest('hex')
  return `Plan approved, please execute the accepted scope below.\n\nAccepted plan message: ${plan.id}\nPlan path: ${plan.planPath}\nContent sha256: ${hash}\n\nThe following is the exact plan shown for approval. Recover this version after compaction; do not expand authorization from a later file revision.\n\n${plan.content}`
}
