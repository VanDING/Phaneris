import { z } from 'zod'
import { MemoryQuerySchema, type MemoryRecord, type MemoryQuery } from './memory-contracts'

export const MemoryLookupSchema = MemoryQuerySchema.omit({ text: true }).extend({ query: z.string().max(500).optional(),
  scope: z.enum(['current', 'workspace']).optional(), limit: z.number().int().min(1).max(20).optional() }).strict()
  .refine(input => input.scope !== 'workspace' || input.projectId === undefined, 'Workspace-wide scope cannot also specify a project filter')
export const MemoryInspectSchema = z.object({ id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(),
  offset: z.number().int().nonnegative().optional(), maxChars: z.number().int().min(1).max(4000).optional(),
  sourceOffset: z.number().int().nonnegative().optional(), proofSourceOffset: z.number().int().nonnegative().optional(),
  lineageOffset: z.number().int().nonnegative().optional() }).strict()
export type MemoryLookupQuery = z.infer<typeof MemoryLookupSchema>
export type MemoryInspectQuery = z.infer<typeof MemoryInspectSchema>
export interface MemoryLookupItem extends Pick<MemoryRecord, 'id' | 'key' | 'projectId' | 'kind' | 'basis' | 'state' | 'revision' | 'redacted' | 'validFrom' | 'validUntil' | 'updatedAt' | 'lastValidatedAt' | 'supersededBy'> {
  condition?: string; conditionChars: number; content: string | null; contentChars: number; contentTruncated: boolean
  sources: MemoryRecord['sources']; sourceCount: number; supersedesCount: number; disputed: boolean
}
export interface MemoryLookupResult {
  items: MemoryLookupItem[]; nextCursor: NonNullable<MemoryQuery['cursor']> | null; version: number
  scope: { projectId?: string; includesWorkspace: boolean; workspaceWide: boolean }
  budget: { maxChars: number; usedChars: number; requestedItems: number; scannedRecords: number; scanLimit: number }
}
interface Range { offset: number; end: number; total: number }
export interface MemoryInspectResult {
  record: MemoryRecord
  contentRange: { offset: number; end: number; fullChars: number }; nextOffset: number | null
  sourceRange: Range; nextSourceOffset: number | null
  proofSourceRange: Range; nextProofSourceOffset: number | null
  lineageRange: Range; nextLineageOffset: number | null
}
