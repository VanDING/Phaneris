import { z } from 'zod'
import { MemoryAssessmentSchema, MemorySourceSchema } from './memory-contracts'

const id = z.string().trim().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/)
/** Persisted append marker, validated by the Project file owner rather than the model. */
export const ProjectMemoryEntrySchema = z.object({ version: z.literal(1), id: hash, fingerprint: hash, noteHash: hash,
  source: MemorySourceSchema.extend({ contentHash: hash }).strict(), heading: z.string() }).strict()
export const ProjectMemoryReadSchema = z.object({ projectId: id.optional(), expectedContentHash: hash.optional(),
  offset: z.number().int().nonnegative().optional(), maxChars: z.number().int().min(0).max(12000).optional(),
}).strict()
export const ProjectMemorySearchSchema = z.object({ projectId: id.optional(), query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(10).optional(),
  cursor: z.object({ contentHash: hash, fingerprint: hash, offset: z.number().int().nonnegative() }).strict().optional(),
}).strict()
export const ProjectMemoryAppendSchema = z.object({ projectId: id.optional(), requestId: id, expectedContentHash: hash,
  note: z.string().trim().min(1).max(4000), intent: z.enum(['automatic', 'user_request']).optional(), assessment: MemoryAssessmentSchema,
  evidence: z.object({ source: MemorySourceSchema, quote: z.string().trim().min(1).max(4000) }).strict(),
}).strict()
export type ProjectMemoryRead = z.infer<typeof ProjectMemoryReadSchema>
export type ProjectMemorySearch = z.infer<typeof ProjectMemorySearchSchema>
export type ProjectMemoryAppendInput = z.infer<typeof ProjectMemoryAppendSchema>
export interface ProjectMemoryReference { projectId: string; path: string; uri: string; contentHash: string; readAt: number; sizeBytes: number }
export interface ProjectMemoryReadResult {
  reference: ProjectMemoryReference; content: string; range: { offset: number; end: number; fullChars: number; startLine: number; endLine: number }; nextOffset: number | null
  eligibleSources?: Array<import('./memory-contracts').MemorySource & { role: 'user' | 'observation' | 'source'; quoteHint?: string }>
  eligibleSourcesTruncated?: boolean
}
export interface ProjectMemorySearchResult {
  reference: ProjectMemoryReference
  items: Array<{ title: string; content: string; truncated: boolean; range: { offset: number; end: number; startLine: number; endLine: number } }>
  nextCursor: NonNullable<ProjectMemorySearch['cursor']> | null; coverage: { paragraphs: number; matched: number }
}
export interface ProjectMemoryAppendResult { path: string; heading: string; bytesAppended: number; entryId: string; contentHash: string; replayed: boolean }
