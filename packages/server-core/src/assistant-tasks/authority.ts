import { z } from 'zod'

/**
 * Authorization and approval records for one workspace.
 *
 * A mandate says who allowed which action on which target, under which condition
 * and until when. An approval is deliberately narrower: it binds the exact
 * effect that was shown to the user — recipient, channel, file version — so a
 * later change to any of those makes the approval unusable instead of silently
 * authorizing something else.
 */
const id = z.string().min(1).max(200)

export const MANDATE_ACTIONS = ['read', 'draft', 'send', 'write', 'dispatch', 'delete'] as const
export type MandateAction = (typeof MANDATE_ACTIONS)[number]

export const MandateInputSchema = z.object({
  requestId: id,
  action: z.enum(MANDATE_ACTIONS),
  /** Data or destination this mandate covers, e.g. 'calendar:primary' or 'mail:external'. */
  target: z.string().min(1).max(400),
  /** Standing mandates survive the task; invocation mandates expire with it. */
  scope: z.enum(['invocation', 'standing']),
  /** The user statement that granted it. Required for a standing mandate. */
  quote: z.string().min(1).max(6000).optional(),
  expiresAt: z.number().int().positive().optional(),
}).strict()
export type MandateInput = z.infer<typeof MandateInputSchema>

export const ApprovalInputSchema = z.object({
  requestId: id,
  mandateId: id.optional(),
  action: z.enum(MANDATE_ACTIONS),
  /** The exact effect shown to the user. Any change invalidates the approval. */
  effect: z.object({
    target: z.string().min(1).max(400),
    /** Channel or connector that performs it. */
    channel: z.string().min(1).max(200),
    /** Content boundary: recipient set plus the exact file version being sent. */
    recipients: z.array(z.string().min(1).max(400)).max(64).optional(),
    artifact: z.object({ artifactId: id, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
    /** Free-form effect digest the Host computed when it showed the card. */
    digest: z.string().min(1).max(200),
  }).strict(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(4000).optional(),
}).strict()
export type ApprovalInput = z.infer<typeof ApprovalInputSchema>

export interface MandateRecord {
  id: string
  action: MandateAction
  target: string
  scope: 'invocation' | 'standing'
  quote?: string
  expiresAt?: number
  revokedAt?: number
  inputMessageId?: string
  createdAt: number
}

export interface ApprovalRecord {
  id: string
  mandateId?: string
  action: MandateAction
  effect: z.infer<typeof ApprovalInputSchema>['effect']
  decision: 'approved' | 'rejected'
  reason?: string
  /** Set when a later change made this approval inapplicable. */
  invalidatedAt?: number
  invalidatedReason?: string
  createdAt: number
}

/**
 * An approval is usable only for the exact effect it was granted for and only
 * while no later change has superseded that effect.
 */
export function approvalUsable(approval: ApprovalRecord, effect: ApprovalRecord['effect']): { usable: boolean; reason?: string } {
  if (approval.decision !== 'approved') return { usable: false, reason: 'The effect was rejected' }
  if (approval.invalidatedAt) return { usable: false, reason: approval.invalidatedReason ?? 'The approval was invalidated' }
  if (approval.effect.digest !== effect.digest) return { usable: false, reason: 'The effect changed after approval' }
  if (approval.effect.channel !== effect.channel) return { usable: false, reason: 'The channel changed after approval' }
  const before = [...(approval.effect.recipients ?? [])].sort().join('\n')
  const after = [...(effect.recipients ?? [])].sort().join('\n')
  if (before !== after) return { usable: false, reason: 'The recipients changed after approval' }
  if (approval.effect.artifact?.artifactId !== effect.artifact?.artifactId) return { usable: false, reason: 'The artifact changed after approval' }
  if (approval.effect.artifact?.revision !== effect.artifact?.revision) return { usable: false, reason: 'The artifact version changed after approval' }
  return { usable: true }
}

/** A standing mandate for this action and target, still in force at `now`. */
export function mandateInForce(mandates: readonly MandateRecord[], action: MandateAction, target: string, now: number): MandateRecord | undefined {
  return mandates.find(mandate => mandate.action === action && mandate.target === target
    && !mandate.revokedAt && (mandate.expiresAt === undefined || mandate.expiresAt > now))
}
