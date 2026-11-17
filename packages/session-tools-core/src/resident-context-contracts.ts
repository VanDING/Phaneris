import { z } from 'zod'
import type { RequestContextSnapshot } from '@phaneris/core/types'

export const ResidentSourceSchema = z.object({ sessionId: z.string().min(1).max(200), messageId: z.string().min(1).max(200),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  range: z.object({ offset: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().refine(r => r.end > r.offset).optional(),
  quote: z.string().min(1).max(6000).optional().describe('Exact unique original text instead of numeric UTF-16 offsets. The Host resolves it into a versioned range; use a precise clause for partial correction.') }).strict().refine(s => !s.quote || !s.range, 'Use quote or range, not both')
const branchIds = z.array(z.string().min(1).max(200)).min(1).max(8)
export const ResidentContextSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('branches'), branchId: z.string().min(1).max(200).optional(), query: z.string().max(500).optional(), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal('create'), requestId: z.string().min(1).max(200), label: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal('select'), branchIds, temporary: z.boolean().optional().describe('Only for a Host resident_event inbox input; preserves the foreground while handling late results. Omit for direct user work or resumption.') }).strict(),
  z.object({ action: z.literal('associate'), branchIds, source: ResidentSourceSchema.optional(), role: z.enum(['requirement', 'evidence', 'shared']), supersedes: z.array(ResidentSourceSchema).max(32).optional(), moveFromBranchIds: branchIds.optional() }).strict(),
  z.object({ action: z.literal('hibernate'), branchIds }).strict(),
  z.object({ action: z.literal('checkpoint'), requestId: z.string().min(1).max(200), branchId: z.string().min(1).max(200).optional(),
    conclusions: z.string().max(6000), unresolved: z.array(z.string().max(1000)).max(20), next: z.array(z.string().max(1000)).max(20), sources: z.array(ResidentSourceSchema).max(32).optional() }).strict(),
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('topics'), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal('resume'), topicId: z.string().min(1).max(200), anchors: z.array(ResidentSourceSchema).max(32).optional() }).strict(),
  z.object({ action: z.literal('anchors'), anchors: z.array(ResidentSourceSchema).max(32) }).strict(),
  z.object({ action: z.literal('focus'), label: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional(),
    anchors: z.array(ResidentSourceSchema).max(32) }).strict(),
])
export type ResidentContextCommand = z.infer<typeof ResidentContextSchema>
/** Legacy focus/topic commands remain UI/RPC adapters, never model policy. */
export const AssistantContextSchema = z.discriminatedUnion('action', [ResidentContextSchema.options[0], ResidentContextSchema.options[1],
  ResidentContextSchema.options[2], ResidentContextSchema.options[3], ResidentContextSchema.options[4], ResidentContextSchema.options[5], ResidentContextSchema.options[6]])
export type ResidentSource = z.infer<typeof ResidentSourceSchema>
export interface ResidentDependencies {
  sources: Array<import('@phaneris/core/types').SourceMaterialReference & { ranges?: Array<{ offset: number; end: number }> }>
  memories: import('@phaneris/core/types').MemoryMaterialReference[]
  scenarios?: import('@phaneris/core/types').ScenarioMaterialReference[]
  knowledge?: import('@phaneris/core/types').KnowledgeMaterialReference[]
}
export interface ResidentSegment {
  id: string
  topicId?: string
  runOperationId: string
  inputMessageId: string
  createdAt: number
  cursor: number
  generationFloor: number
  memoryVersion: number
  dependencies: ResidentDependencies
  selectedInputs: string[]
  omittedItems: number
  eventIds: string[]
  branchIds?: string[]
  branchRevisions?: Record<string, number>
  materials?: Array<ResidentSource & { contentHash: string; characters: number }>
  reading?: { bytesRead: number; indexScanBytes: number; decodedRecords: number; selectedCharacters: number; rebuilds: number }
  requests: Array<{ providerRequestId: string; requestHash: string; dependencies: ResidentDependencies; branchRevisions?: Record<string, number>; configRevision?: string; invalidation?: import('@phaneris/core/types').SessionDelegationInput['invalidation']; snapshot?: RequestContextSnapshot; disposition: 'entered' | 'committed' | 'stale' }>
}
export interface ResidentContextState {
  workspaceId: string
  sessionId: string
  revision: number
  focus: { label: string; topicId?: string; projectId?: string; afterMessageId?: string; anchors: ResidentSource[] }
  activeSegment?: ResidentSegment
  topics?: { items: Array<Omit<ResidentTopic, 'anchors' | 'originalInputIds'> & { anchorCount: number; originalInputCount: number }>; nextOffset: number | null }
  branches?: { items: ContextBranch[]; total: number; nextOffset: number | null }
  branchSources?: { branchId: string; items: Array<ResidentSource & { role: string; contentHash?: string; unclassified?: boolean }>; total: number; nextOffset: number | null }
  selectedBranchIds?: string[]
}
export interface ContextBranch { id: string; sessionId: string; label: string; projectId?: string; revision: number; state: 'active' | 'dormant'; createdAt: number; updatedAt: number; imported?: boolean }
export interface ContextCheckpoint { id: string; branchId: string; projectId?: string; revision: number; conclusions: string; unresolved: string[]; next: string[];
  coverage: Array<ResidentSource & { contentHash: string; cursor: number }>; dependencies?: ResidentDependencies; createdAt: number }
export interface ResidentTopic {
  id: string; label: string; projectId?: string; anchors: ResidentSource[]; originalInputIds: string[]; createdAt: number; updatedAt: number
}

export const ResidentEventsQuerySchema = z.object({ after: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() }).strict()
export interface ResidentInboxEvent {
  branchIds?: string[]
  projectId?: string | null
  eventId: string; sequence: number; workspaceId: string; delegationId: string; assistantSessionId: string; originMessageId: string
  kind: string; sessionId?: string; inputMessageId?: string; result?: { sessionId: string; messageId: string }
  request?: { sessionId: string; requestId: string; kind: 'permission' | 'ask_user' }
  createdAt: number
  phase: 'pending' | 'prepared' | 'entered' | 'handled' | 'attention' | 'delivered'
  enteredRunId?: string; delivery?: { sessionId: string; messageId: string }
}
export interface ResidentEventsPage { items: ResidentInboxEvent[]; nextAfter: number | null }
