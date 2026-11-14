import { z } from 'zod'

const id = z.string().trim().min(1).max(200)
const revision = z.string().regex(/^[a-f0-9]{64}$/)
export const TaskOutputSchema = z.object({
  key: id, role: z.enum(['final', 'supporting', 'intermediate']), title: z.string().trim().min(1).max(200).optional(), parentKey: id.optional(),
  path: z.string().trim().min(1).max(4096).optional(), artifactId: id.optional(), expectedRevision: revision.optional(),
}).strict().refine(output => !!output.path !== !!output.artifactId, 'Select exactly one file path or Artifact id')

export const ReportTaskResultSchema = z.object({
  requestId: id, expectedRevision: z.number().int().positive().optional(), summary: z.string().trim().min(1).max(4000), outputs: z.array(TaskOutputSchema).max(32),
}).strict().superRefine((command, ctx) => {
  const keys = new Set(command.outputs.map(output => output.key))
  if (keys.size !== command.outputs.length) ctx.addIssue({ code: 'custom', message: 'Output keys must be unique' })
  for (const output of command.outputs) if (output.role === 'supporting' && !command.outputs.some(parent => parent.key === output.parentKey && parent.role === 'final'))
    ctx.addIssue({ code: 'custom', message: 'Supporting material requires a final parentKey' })
})
export type ReportTaskResult = z.infer<typeof ReportTaskResultSchema>
export const TaskDeliverableSelectionSchema = z.object({ delegationId: id, expectedRevision: z.number().int().positive(), keys: z.array(id).max(32) }).strict()
export const TaskReviewSchema = z.object({
  delegationId: id, expectedSeq: z.number().int().nonnegative(),
  result: z.object({ sessionId: id, messageId: id }).strict(),
  outcome: z.enum(['accepted', 'rework', 'needs_user_review']), reason: z.string().trim().min(1).max(2000),
}).strict()
export type TaskReview = z.infer<typeof TaskReviewSchema>
export const AssistantDeliveryAckSchema = z.object({
  eventIds: z.array(z.string().min(1).max(500)).max(20), deliverables: z.array(TaskDeliverableSelectionSchema).max(20).optional(),
  reviews: z.array(TaskReviewSchema).min(1).max(20).optional()
    .describe('Explicit review of the actual result against the original requirements. accepted completes the managed Session, rework reopens it, needs_user_review keeps it pending. ACK/output selection alone never completes work. Read the exact result first; use the current receipt seq. A settled review cannot be changed for the same result.'),
}).strict().superRefine((command, ctx) => {
  if (!command.eventIds.length && !command.reviews?.length) ctx.addIssue({ code: 'custom', message: 'Select events or an explicit task review' })
  if (command.reviews && new Set(command.reviews.map(item => item.delegationId)).size !== command.reviews.length)
    ctx.addIssue({ code: 'custom', message: 'Review each task only once per command' })
  if (command.deliverables && new Set(command.deliverables.map(item => item.delegationId)).size !== command.deliverables.length)
    ctx.addIssue({ code: 'custom', message: 'Select each task manifest only once' })
})
export type AssistantDeliveryAck = z.infer<typeof AssistantDeliveryAckSchema>
export type TaskDeliverableSelection = z.infer<typeof TaskDeliverableSelectionSchema>
export const TaskOutputVisibilitySchema = z.object({ delegationId: id, expectedRevision: z.number().int().positive(), key: id, visible: z.boolean() }).strict()
export type TaskOutputVisibility = z.infer<typeof TaskOutputVisibilitySchema>

export interface TaskOutputReference {
  hidden?: boolean
  id: string; key: string; role: 'final' | 'supporting' | 'intermediate'; parentKey?: string
  artifactId: string; revision: string; title: string; sourcePath: string; mimeType: string; size: number
}
export interface TaskOutputManifest {
  revision: number; summary: string; outputs: TaskOutputReference[]
  inputMessageId: string; producerSessionId: string; runOperationId: string
  result?: { sessionId: string; messageId: string }
  selectedKeys?: string[]
}
export interface TaskDeliverable extends TaskOutputReference {
  manifestRevision: number
  delegationId: string; taskTitle: string; createdAt: number
  result: { sessionId: string; messageId: string }; supporting: TaskOutputReference[]
}
