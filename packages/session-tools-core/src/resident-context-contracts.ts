import { z } from 'zod'
import type { RequestContextSnapshot } from '@phaneris/core/types'
import type { WorkPreparationBinding } from '@phaneris/shared/durable-runtime/types'
export type { WorkPreparationBinding } from '@phaneris/shared/durable-runtime/types'

export const ResidentSourceSchema = z.object({ sessionId: z.string().min(1).max(200), messageId: z.string().min(1).max(200),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  range: z.object({ offset: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().refine(r => r.end > r.offset).optional(),
  quote: z.string().min(1).max(6000).optional().describe('Exact unique original text instead of numeric UTF-16 offsets. The Host resolves it into a versioned range; use a precise clause for partial correction.') }).strict().refine(s => !s.quote || !s.range, 'Use quote or range, not both')
const branchIds = z.array(z.string().min(1).max(200)).min(1).max(8)
const preparationTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('keep') }).strict(),
  z.object({ kind: z.literal('select'), branchIds }).strict(),
  z.object({ kind: z.literal('create'), label: z.string().min(1).max(200) }).strict(),
])
export const ResidentContextSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('branches'), branchId: z.string().min(1).max(200).optional(), query: z.string().max(500).optional(), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal('create'), requestId: z.string().min(1).max(200), label: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal('select'), branchIds, temporary: z.boolean().optional().describe('Only for a Host resident_event inbox input; preserves the foreground while handling late results. Omit for direct user work or resumption.') }).strict(),
  z.object({ action: z.literal('associate'), branchIds, source: ResidentSourceSchema.optional(), role: z.enum(['requirement', 'evidence', 'shared']), supersedes: z.array(ResidentSourceSchema).max(32).optional(), moveFromBranchIds: branchIds.optional() }).strict(),
  z.object({ action: z.literal('hibernate'), branchIds }).strict(),
  z.object({ action: z.literal('checkpoint'), requestId: z.string().min(1).max(200), branchId: z.string().min(1).max(200).optional(),
    conclusions: z.string().max(6000), unresolved: z.array(z.string().max(1000)).max(20), next: z.array(z.string().max(1000)).max(20), sources: z.array(ResidentSourceSchema).max(32).optional() }).strict(),
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('prepare'), requestId: z.string().min(1).max(200), target: preparationTarget,
    continuationOf: z.string().min(1).max(200).optional().describe('Existing execution to continue under its original grant and invocation requirements; required for an inbox continuation.'),
    temporary: z.boolean().optional(), requirements: z.array(z.object({ branchId: z.string().min(1).max(200).optional().describe('Use an existing branch ID only. Omit for target=create or a single selected branch; the Host assigns the new ID. Never use placeholders such as new.'),
      scope: z.enum(['input', 'work']).describe('input is the default for this invocation, including now-authorized execution, output limits, current connection/model and today-only overrides. work requires explicit continuing applicability in the original source; do not infer permanence from a work label or from other rules staying unchanged.'), source: ResidentSourceSchema.optional(), supersedes: z.array(ResidentSourceSchema).max(32).optional(),
      workScopeQuote: z.string().min(1).max(1000).optional().describe('Required for scope=work: exact words WITHIN this source clause defining the work or establishing a lasting work-level change. Today/now/this once and other rules unchanged cannot justify making an invocation override permanent. 今天这一次，招呼语改成下午好 is input scope, even when the underlying work recurs.'),
    }).strict()).max(32).optional() }).strict(),
  z.object({ action: z.literal('preparation'), requestId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('recover'), requestId: z.string().min(1).max(200), expectedGeneration: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('receipt'), operationId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('reconcile'), operationId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('topics'), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal('resume'), topicId: z.string().min(1).max(200), anchors: z.array(ResidentSourceSchema).max(32).optional() }).strict(),
  z.object({ action: z.literal('anchors'), anchors: z.array(ResidentSourceSchema).max(32) }).strict(),
  z.object({ action: z.literal('focus'), label: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional(),
    anchors: z.array(ResidentSourceSchema).max(32) }).strict(),
])
export type ResidentContextCommand = z.infer<typeof ResidentContextSchema>
/** Legacy focus/topic commands remain UI/RPC adapters, never model policy.
 *
 * The model surface is material selection only. A separate preparation pass is
 * no longer a model responsibility: the Task record owns requirements, the Host
 * owns readiness, and the former `prepare` / `preparation` / `recover` /
 * `receipt` / `reconcile` generations are retired. The Host still builds its own
 * preparation internally for a user-initiated dispatch, which is not this
 * contract.
 */
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
  observedDependencies?: ResidentDependencies
  selectedInputs: string[]
  omittedItems: number
  eventIds: string[]
  branchIds?: string[]
  branchRevisions?: Record<string, number>
  materials?: Array<ResidentSource & { contentHash: string; characters: number }>
  reading?: { bytesRead: number; indexScanBytes: number; decodedRecords: number; selectedCharacters: number; rebuilds: number }
  warming?: { elapsedMs: number; bytesRead: number; indexScanBytes: number; decodedRecords: number; rebuilds: number }
  composition?: { currentInputCharacters: number; branchMaterialCharacters: number; mainlineCharacters: number; collaborationCharacters: number; serializedItemBytes: number }
  preparation?: WorkPreparationBinding
  diagnostic?: { code: string; message: string }
  requests: Array<{ providerRequestId: string; modelOperationId?: string; requestHash: string; dependencies: ResidentDependencies; branchRevisions?: Record<string, number>; preparation?: WorkPreparationBinding;
    calls?: Array<{ id: string; name: string }>; configRevision?: string; invalidation?: import('@phaneris/core/types').SessionDelegationInput['invalidation']; snapshot?: RequestContextSnapshot; disposition: 'entered' | 'committed' | 'stale' }>
}
export interface ResidentWorkPreparation {
  continuationOf?: string
  id: string; inputId: string; generation: number; state: 'recorded' | 'ready' | 'blocked' | 'superseded'; temporary: boolean;
  branchIds: string[]; branchRevisions: Record<string, number>;
  requirements: Array<{ branchId: string; scope: 'input' | 'work'; source: ResidentSource & { contentHash: string }; workScopeQuote?: string }>;
  requirementsHash: string; materialsHash?: string; error?: string; createdAt: number;
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
  preparation?: ResidentWorkPreparation
  recovery?: { operationId: string; verdict: string; localReceipt?: boolean; committedSeq?: number }
}
export interface ContextBranch { id: string; sessionId: string; label: string; projectId?: string; revision: number; state: 'active' | 'dormant'; createdAt: number; updatedAt: number; imported?: boolean;
  origin?: ResidentSource & { contentHash: string } }
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
