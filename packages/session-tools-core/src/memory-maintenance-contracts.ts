import { z } from 'zod'
import type { HistoryMatch } from './history-contracts'

const id = z.string().min(1).max(200)
export const MemoryMaintenanceCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('next'), projectId: id.optional(), sessionId: id.optional(), scope: z.enum(['current', 'workspace']).optional() }).strict()
    .refine(input => input.scope !== 'workspace' || input.projectId === undefined, 'Workspace-wide extraction cannot also specify a project filter'),
  z.object({ action: z.literal('acknowledge'), checkpointId: z.string().regex(/^[a-f0-9]{64}$/),
    conclusion: z.enum(['candidates', 'no_candidate']), reason: z.string().min(1).max(1000),
    candidateIds: z.array(id).min(1).max(16).optional() }).strict().superRefine((input, ctx) => {
      if ((input.conclusion === 'candidates') !== !!input.candidateIds?.length) ctx.addIssue({ code: 'custom', message: 'Only candidates conclusions require candidateIds' })
    }),
])
export type MemoryMaintenanceCommand = z.infer<typeof MemoryMaintenanceCommandSchema>
export interface MemoryExtractionCoverage {
  pendingSessions: number
  unreadableSessions: number
  processedMessages: number
  partialMessages: number
  pendingMessages: number
  unavailableMessages: number
  unparsedAttachmentMessages: number
}
export type MemoryMaintenanceResult = {
  status: 'source'
  checkpointId: string
  requestIdPrefix: string
  source: Omit<HistoryMatch, 'snippet' | 'range'>
  content: string
  range: { offset: number; end: number; fullChars: number }
  coverage: MemoryExtractionCoverage
} | { status: 'acknowledged'; checkpointId: string; coverage: MemoryExtractionCoverage }
  | { status: 'idle' | 'budget_exhausted' | 'blocked'; coverage: MemoryExtractionCoverage }
