import { z } from 'zod'
import type { SessionDelegationInput, SessionExecutionConfig, ResolvedSessionExecutionConfig } from '@phaneris/core/types'
import { EXECUTION_PROMPT_PRESETS } from '@phaneris/core/types'
import { ResidentSourceSchema } from './resident-context-contracts'

const id = z.string().min(1).max(200).regex(/^\S(?:[\s\S]*\S)?$/)
const slugs = z.array(id).max(64)
/** Portable wire/tool contract. Configuration belongs to the executing Host. */
export const WorkerConfigSchema = z.object({
  llmConnection: id.optional(), model: id.optional(),
  systemPromptPreset: z.enum(EXECUTION_PROMPT_PRESETS).optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  permissionMode: z.enum(['safe', 'ask', 'guarded', 'allow-all']).optional(),
  enabledSourceSlugs: slugs.optional(), skillSlugs: slugs.optional(), activePlugin: id.nullable().optional(),
  projectId: id.optional(), workingDirectory: z.string().min(1).max(4096).optional(),
  contextPolicy: z.enum(['compact', 'handoff', 'manual']).optional(), labels: slugs.optional(),
}).strict()
export const AssistantDispatchSchema = z.object({
  continuationOf: id.optional().describe('Continue an already reviewed result within its unchanged original user grant. Required for inbox-driven follow-up. The Host verifies the original source, review and task scope; internal events grant no new authority.'),
  startPaused: z.boolean().optional().describe('Create and plan this ordinary Session without starting it. Resume it explicitly when ready.'),
  dependencySessionIds: z.array(id).max(64).optional().describe('Simple prerequisites in this workspace. Host starts only after each Session is done; failed, cancelled, missing or pending review prerequisites remain explained waits.'),
  fileScope: z.object({
    read: z.array(z.string().min(1).max(4096).refine(path => !/[\x00*?{}\[\]]/.test(path), 'Use literal paths, not globs')).max(64),
    write: z.array(z.string().min(1).max(4096).refine(path => !/[\x00*?{}\[\]]/.test(path), 'Use literal paths, not globs')).max(64),
  }).strict().optional().describe('Declare literal file/directory read and write scopes relative to workingDirectory for parallel scheduling. Omitted writable work conservatively shares its entire directory. This is a scheduling contract, not a sandbox.'),
  context: z.object({ branchIds: z.array(z.string().min(1).max(200)).max(8), sources: z.array(ResidentSourceSchema).max(32).optional(),
    memories: z.array(z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive(), offset: z.number().int().nonnegative().optional(), maxChars: z.number().int().min(1).max(4000).optional() }).strict()).max(16).optional() }).strict().optional()
    .describe('Task-specific material selection. Select only the branches required by this assignment, plus exact optional source ranges. Omitted uses the single selected branch, never the whole assistant view; ambiguous multi-branch delegation requires an explicit selection.'),
  requestId: id.describe('Stable identity for this work intent. Reuse on retry; changed content requires a new identity.'),
  title: z.string().min(1).max(200), instructions: z.string().min(1).max(24000).refine(text => text.trim().length > 0),
  goalQuote: z.string().trim().min(1).max(6000).optional().describe('Exact original user quote defining the whole authorized goal for this work, including any already authorized later stages. Keep unrelated goals out. Put the narrower current stage in instructions/acceptanceCriteria. For a staged goal, a first-stage-only quote permanently excludes later stages: prose in instructions cannot widen it. continuationOf must reuse this pinned quote or a substring; it cannot borrow a newer user message.'),
  acceptanceCriteria: z.array(z.string().min(1).max(2000)).max(32).optional(), config: WorkerConfigSchema,
  completionPolicy: z.enum(['assistant_review', 'user_review']).optional()
    .describe('Use user_review when the user requires personal acceptance. The Host will keep this Session pending review and refuse assistant closure. Omitted permits assistant review within the original authorization.'),
  attachmentIds: z.array(id).max(16).optional().describe('Select files from the original current user input. Omitted forwards those input files; [] forwards none. The Host copies the selected bytes into the Worker Session.'),
  artifacts: z.array(z.object({ artifactId: id, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(16).optional()
    .describe('Exact Artifact revisions for feedback. Requires targetSessionId of their original owner; the Host rejects changed baselines before starting.'),
  targetSessionId: id.optional().describe('Continue an idle ordinary Session in this workspace. Its existing configuration and task metadata are preserved; incompatible settings are rejected.'),
}).strict().refine(input => !input.artifacts || !!input.targetSessionId, 'Artifact baselines require targetSessionId of the original owner')
  .refine(input => !input.artifacts || new Set(input.artifacts.map(item => item.artifactId)).size === input.artifacts.length, 'Duplicate Artifact baselines')
  .refine(input => !input.attachmentIds || new Set(input.attachmentIds).size === input.attachmentIds.length, 'Duplicate input attachments')
export const AssistantWorkQuerySchema = z.object({
  id: id.optional(), after: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(20).optional(),
  attemptsBefore: z.number().int().nonnegative().optional(), attemptLimit: z.number().int().min(1).max(20).optional(),
  view: z.enum(['current', 'history', 'deliverables']).optional(), search: z.string().trim().max(500).optional(),
  state: z.enum(['result_ready', 'failed', 'cancelled']).optional(),
  cursor: z.object({ createdAt: z.number().int().nonnegative(), id }).strict().optional(),
}).strict().refine(input => input.attemptsBefore === undefined || input.id !== undefined, 'Attempt pagination requires an explicit delegation id')
  .refine(input => !input.state || input.view === 'history', 'Outcome filtering requires the history view')
  .refine(input => (!input.cursor && !input.search) || !!input.view, 'View pagination/search requires a view')
  .refine(input => !input.view || (!input.id && input.after === undefined), 'View queries cannot mix legacy sequence or detail selection')
export const WorkerOptionsQuerySchema = z.object({
  kind: z.enum(['connections', 'models', 'sources', 'skills', 'plugins', 'projects', 'presets']),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  connectionSlug: id.optional(), projectId: id.optional(),
  offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(20).optional(),
}).strict()
export type WorkerOptionsQuery = z.infer<typeof WorkerOptionsQuerySchema>
export interface WorkerOptionsPage { items: Array<Record<string, unknown>>; nextOffset: number | null; catalogRevision: string; permissionCeiling: NonNullable<WorkerConfig['permissionMode']> }
export type WorkerConfig = SessionExecutionConfig
/** Host-only correlation, deliberately absent from the model input schema. */
export type AssistantDispatch = z.infer<typeof AssistantDispatchSchema> & { workAdmissionId?: string; directUserPreparationId?: string }
export type AssistantWorkQuery = z.infer<typeof AssistantWorkQuerySchema>
export type EffectiveWorkerConfig = ResolvedSessionExecutionConfig
/** Delivery facts only. The referenced Session owns instructions, settings and result text. */
export interface AssistantDelegationReceipt {
  branchIds?: string[]
  projectId?: string
  formatVersion: 2
  id: string; workspaceId: string; assistantSessionId: string; originMessageId: string
  requestId: string; fingerprint: string; targetSessionId?: string
  continuationOf?: string
  state: 'accepted' | 'preparing' | 'submitting' | 'submitted' | 'result_ready' | 'needs_attention' | 'failed' | 'cancel_requested' | 'cancelled' | 'pause_requested' | 'paused'
  priority?: number
  pendingControlId?: string
  sessionId?: string; inputMessageId?: string; createdAt: number; updatedAt: number; seq: number; error?: string
  result?: { messageId: string; sessionId: string }
  /** Scheduler-owned resource decision; no duplicate Runtime execution state. */
  waitingFor?: { delegationId?: string; sessionId?: string; reason: 'session' | 'source' | 'directory' | 'configuration' | 'capacity' | 'file_scope' | 'dependency'; detail?: string }
}
/** Read-time projection of the ordinary Session's input snapshot. Never persisted in the inbox. */
export interface AssistantWork extends AssistantDelegationReceipt {
  /** Full pinned authorization quote. The model overview may clip its preview. */
  goal?: string
  sessionStatus?: string
  runtime?: { source: 'runtime'; isProcessing: boolean; activity: NonNullable<AssistantWorkExecution['activity']>; acceptedAt?: number; updatedAt?: number; elapsedMs?: number; laterUserInput?: boolean }
  invalidation?: SessionDelegationInput['invalidation']
  review?: NonNullable<SessionDelegationInput['statusControl']>['review']
  controlAvailability?: { actions: import('./worker-control-contracts').WorkerControl['action'][]; reason?: string }
  controls?: import('./worker-control-contracts').WorkerControlReceipt[]
  outputManifest?: import('./task-result-contracts').TaskOutputManifest
  title?: string
  artifactBaselines?: import('@phaneris/core/types').SessionArtifactBaseline[]
  effectiveConfig?: EffectiveWorkerConfig; adjustments?: string[]
  configRevision?: string; capabilityRevision?: string; acceptedConfigRevision?: string; acceptedPermissionMode?: NonNullable<WorkerConfig['permissionMode']>
  execution?: AssistantWorkExecution
}
export interface AssistantWorkExecution {
  activity?: 'queued' | 'requesting' | 'thinking' | 'responding' | 'tool' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  toolName?: string
  error?: { messageId: string; summary: string; code?: string }
  /** Subsequent direct user input is distinct from the original assignment. */
  followUp?: { inputMessageId: string; at: number; isProcessing: boolean; result?: { sessionId: string; messageId: string } }
  source: 'runtime'; inputMessageId: string; sourceAvailable: boolean
  coverage: 'original_input' | 'original_input_with_continuation' | 'not_started' | 'unknown'
  attempts: import('@phaneris/core/types').SessionExecutionAttempt[]; nextBefore: number | null; totalAttempts: number
  continuationSessionId?: string
}
export interface AssistantWorkPage {
  observedAt?: number
  /** `capacity: null` means the workspace sets no ceiling on concurrent work. */
  scheduling?: { capacity: number | null; occupied: number; queued: number; paused: number }
  items: AssistantWork[]; nextAfter: number | null; lastSeq: number
  nextCursor?: { createdAt: number; id: string } | null
  total?: number
  searchCoverage?: { indexed: number; total: number }
  deliverables?: import('./task-result-contracts').TaskDeliverable[]
}
export interface AssistantTaskOverview {
  observedAt: number
  scheduling: NonNullable<AssistantWorkPage['scheduling']>
  items: Array<Pick<AssistantWork, 'id' | 'seq' | 'sessionId' | 'inputMessageId' | 'originMessageId' | 'branchIds' | 'title' | 'state' | 'waitingFor' | 'result' | 'error' | 'sessionStatus' | 'runtime'> & { goal?: string; ageMs: number; waitingMs?: number }>
  total: number; omitted: number; lastSeq: number
}
