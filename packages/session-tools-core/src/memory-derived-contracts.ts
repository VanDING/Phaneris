import { z } from 'zod'
import { MemorySourceSchema, MemoryAssessmentSchema, type MemoryRecord } from './memory-contracts'

const id = z.string().trim().min(1).max(200)
export const ScenarioCaptureSchema = z.object({ requestId: id, key: id, title: z.string().trim().min(1).max(200),
  goalQuote: z.string().trim().min(1).max(2000), projectId: id.optional(), condition: z.string().trim().min(1).max(500).optional(),
  expectedRevision: z.number().int().positive().optional(), intent: z.enum(['automatic', 'user_request']).optional(), assessment: MemoryAssessmentSchema,
  sources: z.array(MemorySourceSchema).min(1).max(16), atoms: z.array(z.object({ id, expectedRevision: z.number().int().positive() }).strict()).min(1).max(16),
}).strict()
export const ScenarioQuerySchema = z.object({ query: z.string().max(500).optional(), projectId: id.optional(), scope: z.enum(['current', 'workspace']).optional(),
  id: id.optional(), atomOffset: z.number().int().nonnegative().optional(), sourceOffset: z.number().int().nonnegative().optional(),
  includeWorkspace: z.boolean().optional(), limit: z.number().int().min(1).max(20).optional(),
  cursor: z.object({ version: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), fingerprint: z.string() }).strict().optional(),
}).strict().refine(input => input.scope !== 'workspace' || input.projectId === undefined, 'Workspace-wide scenario lookup cannot specify a project filter')
  .refine(input => input.id || input.atomOffset === undefined && input.sourceOffset === undefined, 'Scenario detail continuations require an exact id')
export type ScenarioCapture = z.infer<typeof ScenarioCaptureSchema>
export type ScenarioQuery = z.infer<typeof ScenarioQuerySchema>
export interface CollaborationProfile {
  version: number; items: Array<Pick<MemoryRecord, 'id' | 'revision' | 'content' | 'condition' | 'projectId' | 'sources'>>
  coverage: { scanned: number; candidateRecords: number; omitted: number; maxChars: number }
}
export interface ScenarioResult {
  id: string; revision: number; title: string; goal: string; condition?: string; projectId?: string; derivedVersion: string
  goalChars: number; goalTruncated: boolean; navigationOnly?: boolean
  atoms: Array<Pick<MemoryRecord, 'id' | 'revision' | 'kind' | 'content' | 'condition' | 'projectId' | 'sources'> & { contentTruncated: boolean; contentChars: number; sourceCount: number }>
  sources: MemoryRecord['sources']
  atomRange: { offset: number; end: number; total: number }; nextAtomOffset: number | null
  sourceRange: { offset: number; end: number; total: number }; nextSourceOffset: number | null
}
export interface ScenarioPage {
  version: number; items: ScenarioResult[]; nextCursor: NonNullable<ScenarioQuery['cursor']> | null
  scope: { projectId?: string; includesWorkspace: boolean; workspaceWide: boolean }
  coverage: { scanned: number; maxScan: number; hasMore: boolean; unavailable: number }
}
