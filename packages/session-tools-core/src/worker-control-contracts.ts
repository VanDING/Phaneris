import { z } from 'zod'
import { WorkerConfigSchema, type AssistantWork, type AssistantDelegationReceipt } from './delegation-contracts'

const base = { commandId: z.string().min(1).max(200), id: z.string().min(1).max(200), expectedSeq: z.number().int().nonnegative() }
export const WorkerControlSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('pause') }).strict(),
  z.object({ ...base, action: z.literal('resume') }).strict(),
  z.object({ ...base, action: z.literal('retry') }).strict(),
  z.object({ ...base, action: z.literal('message'), message: z.string().trim().min(1).max(6000),
    delivery: z.enum(['queued', 'interrupt']).optional().describe('Default queued: preserve the current attempt and deliver at its next safe turn. Use interrupt only when the current work must stop now.') }).strict(),
  z.object({ ...base, action: z.literal('configure'), config: WorkerConfigSchema }).strict(),
  z.object({ ...base, action: z.literal('plan'), priority: z.number().int().min(-100).max(100).optional(),
    title: z.string().trim().min(1).max(200).optional(), description: z.string().max(12000).optional(),
    progress: z.number().int().min(0).max(100).optional(), dependencySessionIds: z.array(z.string().min(1)).max(64).optional() }).strict(),
])
export type WorkerControl = z.infer<typeof WorkerControlSchema>
export interface WorkerControlReceipt {
  commandId: string; delegationId: string; action: WorkerControl['action']; expectedSeq: number
  phase: 'accepted' | 'waiting' | 'applied' | 'rejected'; at: number; updatedAt: number; error?: string
  actor: 'user' | 'assistant'
  initialState: AssistantDelegationReceipt['state']
  delivery?: 'staged' | 'queued' | 'delivered'
  input?: { sessionId: string; messageId: string }
  /** Successful Runtime model outcome that consumed this exact input. */
  processedAt?: number
  /** Host-captured provenance of model-authored supplemental requirements. */
  evidence?: import('@phaneris/core/types').SessionDelegationInput['materialDependencies']
}
export interface WorkerControlResult { command: WorkerControlReceipt; work: AssistantWork }
export interface WorkerControlApplication { state: AssistantDelegationReceipt['state']; phase?: 'applied' | 'waiting'; error?: string;
  delivery?: WorkerControlReceipt['delivery']; input?: WorkerControlReceipt['input'] }
