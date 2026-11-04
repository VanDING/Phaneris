import { z } from 'zod'

const id = z.string().min(1).max(200).regex(/^\S(?:[\s\S]*\S)?$/, 'Identifier must not have surrounding whitespace')
export const MemorySourceSchema = z.object({ sessionId: id, messageId: id }).strict()
export const MemorySourceReadSchema = MemorySourceSchema.extend({ expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() })
export const MemorySuppressionQuerySchema = z.object({ limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.object({ version: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(1000) }).strict().optional() }).strict()
export const MemorySuppressionBundleSchema = z.object({ formatVersion: z.literal(1), workspaceId: id,
  entries: z.array(z.object({ memoryId: id, source: MemorySourceSchema }).strict()).min(1).max(1000) }).strict()
export const MemorySuppressionMergeSchema = MemorySuppressionBundleSchema.extend({ requestId: id }).strict()
export type MemorySuppressionQuery = z.infer<typeof MemorySuppressionQuerySchema>
export type MemorySuppressionMerge = z.infer<typeof MemorySuppressionMergeSchema>
export interface MemorySuppressionPage {
  formatVersion: 1; workspaceId: string; version: number
  entries: Array<{ memoryId: string; source: MemorySource }>
  nextCursor: { version: number; offset: number; limit: number } | null
}
export interface MemorySuppressionMergeResult { version: number; inserted: number; affectedIds: string[] }
export { HistoryQuerySchema } from '@phaneris/session-tools-core/history-contracts'
export type { HistoryQuery, HistoryMatch, HistoryPage } from '@phaneris/session-tools-core/history-contracts'
export const MemoryQuerySchema = z.object({
  text: z.string().max(500).optional(), projectId: id.optional(), condition: z.string().trim().min(1).max(500).optional(),
  includeWorkspace: z.boolean().optional(),
  ids: z.array(id).min(1).max(16).optional(), includeRetired: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional(),
  cursor: z.object({ version: z.number().int().nonnegative(), offset: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative().nullable(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict()
const sources = z.array(MemorySourceSchema).min(1).max(16)
const content = z.string().min(1).max(8000).refine(value => value.trim().length > 0, 'Content must not be blank')
const expectedRevision = z.number().int().positive()
const relation = z.object({ requestId: id, id, expectedRevision, related: z.array(z.object({ id, expectedRevision }).strict()).min(1).max(15),
  reason: z.string().trim().min(1).max(1000), sources })
export const MemoryMutationSchema = z.discriminatedUnion('action', [
  relation.extend({ action: z.literal('dispute') }).strict(),
  relation.extend({ action: z.literal('resolve'), winnerId: id.optional() }).strict(),
  z.object({ action: z.literal('remember'), requestId: id, key: id, content,
    kind: z.enum(['fact', 'decision', 'experience']), basis: z.enum(['user_stated', 'inferred']),
    projectId: id.optional(), condition: z.string().trim().min(1).max(500).optional(),
    validFrom: z.number().int().nonnegative().optional(), validUntil: z.number().int().nonnegative().optional(), sources }).strict(),
  z.object({ action: z.literal('revise'), requestId: id, id, expectedRevision, content, sources,
    validFrom: z.number().int().nonnegative().nullable().optional(), validUntil: z.number().int().nonnegative().nullable().optional() }).strict(),
  z.object({ action: z.literal('transition'), requestId: id, id, expectedRevision,
    state: z.enum(['active', 'dormant', 'expired', 'invalidated', 'forgotten']) }).strict(),
])

export type MemorySource = z.infer<typeof MemorySourceSchema>
export type MemorySourceRead = z.infer<typeof MemorySourceReadSchema>
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>
export type MemoryMutation = z.infer<typeof MemoryMutationSchema>
export type MemoryState = import('@phaneris/core/types').MemoryLifecycleState
export interface MemoryRecord {
  id: string
  workspaceId: string
  key: string | null
  projectId?: string
  condition?: string
  kind: 'fact' | 'decision' | 'experience'
  basis: 'user_stated' | 'inferred'
  content: string | null
  sources: Array<MemorySource & { contentHash: string }>
  state: MemoryState
  revision: number
  createdAt: number
  updatedAt: number
  validFrom?: number
  validUntil?: number
  dispute?: { relatedMemoryIds: string[]; reason: string; raisedAt: number; sources: Array<MemorySource & { contentHash: string }> }
  supersededBy?: string
  supersedes?: Array<{ id: string; revision: number }>
  retirementReason?: string
  lastValidatedAt?: number
  redacted: boolean
}
export interface MemoryQueryResult {
  items: MemoryRecord[]
  nextCursor: { version: number; offset: number; expiresAt: number | null; fingerprint: string } | null
  version: number
}
export interface MemoryMutationResult { record: MemoryRecord; version: number; affectedIds?: string[] }
export interface MemorySourceResult extends MemorySource { content: string; role: string; timestamp?: number; contentHash: string; directUser: boolean }
export interface MemoryChanged { workspaceId: string; id: string; version: number }
