import { z } from 'zod'
import type { SessionExecutionConfig, ResolvedSessionExecutionConfig } from '@phaneris/core/types'
import { EXECUTION_PROMPT_PRESETS } from '@phaneris/core/types'

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
  requestId: id.describe('Stable identity for this work intent. Reuse on retry; changed content requires a new identity.'),
  title: z.string().min(1).max(200), instructions: z.string().min(1).max(24000).refine(text => text.trim().length > 0),
  acceptanceCriteria: z.array(z.string().min(1).max(2000)).max(32).optional(), config: WorkerConfigSchema,
  artifacts: z.array(z.object({ artifactId: id, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(16).optional()
    .describe('Exact Artifact revisions for feedback. Requires targetSessionId of their original owner; the Host rejects changed baselines before starting.'),
  targetSessionId: id.optional().describe('Continue an idle ordinary Session in this workspace. Its existing configuration and task metadata are preserved; incompatible settings are rejected.'),
}).strict().refine(input => !input.artifacts || !!input.targetSessionId, 'Artifact baselines require targetSessionId of the original owner')
  .refine(input => !input.artifacts || new Set(input.artifacts.map(item => item.artifactId)).size === input.artifacts.length, 'Duplicate Artifact baselines')
export const AssistantWorkQuerySchema = z.object({
  id: id.optional(), after: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(20).optional(),
  attemptsBefore: z.number().int().nonnegative().optional(), attemptLimit: z.number().int().min(1).max(20).optional(),
}).strict().refine(input => input.attemptsBefore === undefined || input.id !== undefined, 'Attempt pagination requires an explicit delegation id')
export const WorkerOptionsQuerySchema = z.object({
  kind: z.enum(['connections', 'models', 'sources', 'skills', 'plugins', 'projects', 'presets']),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  connectionSlug: id.optional(), projectId: id.optional(),
  offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(20).optional(),
}).strict()
export type WorkerOptionsQuery = z.infer<typeof WorkerOptionsQuerySchema>
export interface WorkerOptionsPage { items: Array<Record<string, unknown>>; nextOffset: number | null; catalogRevision: string; permissionCeiling: NonNullable<WorkerConfig['permissionMode']> }
export type WorkerConfig = SessionExecutionConfig
export type AssistantDispatch = z.infer<typeof AssistantDispatchSchema>
export type AssistantWorkQuery = z.infer<typeof AssistantWorkQuerySchema>
export type EffectiveWorkerConfig = ResolvedSessionExecutionConfig
/** Delivery facts only. The referenced Session owns instructions, settings and result text. */
export interface AssistantDelegationReceipt {
  formatVersion: 2
  id: string; workspaceId: string; assistantSessionId: string; originMessageId: string
  requestId: string; fingerprint: string; targetSessionId?: string
  state: 'accepted' | 'preparing' | 'submitting' | 'submitted' | 'result_ready' | 'needs_attention' | 'failed' | 'cancel_requested' | 'cancelled'
  sessionId?: string; inputMessageId?: string; createdAt: number; updatedAt: number; seq: number; error?: string
  result?: { messageId: string; sessionId: string }
}
/** Read-time projection of the ordinary Session's input snapshot. Never persisted in the inbox. */
export interface AssistantWork extends AssistantDelegationReceipt {
  artifactBaselines?: import('@phaneris/core/types').SessionArtifactBaseline[]
  effectiveConfig?: EffectiveWorkerConfig; adjustments?: string[]
  configRevision?: string; capabilityRevision?: string; acceptedConfigRevision?: string; acceptedPermissionMode?: NonNullable<WorkerConfig['permissionMode']>
  execution?: AssistantWorkExecution
}
export interface AssistantWorkExecution {
  source: 'runtime'; inputMessageId: string; sourceAvailable: boolean
  coverage: 'original_input' | 'original_input_with_continuation' | 'not_started' | 'unknown'
  attempts: import('@phaneris/core/types').SessionExecutionAttempt[]; nextBefore: number | null; totalAttempts: number
  continuationSessionId?: string
}
export interface AssistantWorkPage { items: AssistantWork[]; nextAfter: number | null; lastSeq: number }
