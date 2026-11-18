import { z } from 'zod'

/**
 * Portable delegation-task contract shared by the Host and the model tools.
 *
 * The Assistant states business meaning here: what the user wants, what changed,
 * what remains authorized, what to verify. Identity, version numbering,
 * authorization resolution, idempotency and receipts belong to the Host. No field
 * in this contract asks the model to restate a goal verbatim, carry a message
 * hash, or hand-manage an execution sequence.
 */
const id = z.string().min(1).max(200)
const statement = z.string().min(1).max(24000)

/** How long a requirement statement keeps applying. */
export const REQUIREMENT_SCOPES = ['invocation', 'task', 'goal', 'standing'] as const
export type RequirementScope = (typeof REQUIREMENT_SCOPES)[number]

export const RequirementInputSchema = z.object({
  /** Existing requirement id this statement corrects; omit for a new one. */
  supersedes: id.optional(),
  statement,
  scope: z.enum(REQUIREMENT_SCOPES),
  /** Verbatim user clause this statement was read from, when one exists. */
  quote: z.string().min(1).max(6000).optional(),
}).strict()
export type RequirementInput = z.infer<typeof RequirementInputSchema>

export const DelegationTaskCreateSchema = z.object({
  requestId: id.describe('Stable identity for this delegation intent. Reuse unchanged on retry.'),
  goalTitle: z.string().min(1).max(300).describe('What the user ultimately wants. A simple request still gets one Goal.'),
  title: z.string().min(1).max(300).describe('This independently acceptable result.'),
  scopeIn: z.array(z.string().min(1).max(2000)).max(32).optional().describe('Explicitly included content.'),
  scopeOut: z.array(z.string().min(1).max(2000)).max(32).optional().describe('Content the user excluded or must not be touched.'),
  requirements: z.array(RequirementInputSchema).max(64).optional().describe('What must hold for this result, each with its own scope.'),
  acceptance: z.array(z.string().min(1).max(2000)).max(32).optional().describe('Inspectable conditions for acceptance.'),
  deliverable: z.string().max(2000).optional().describe('Required form of the result, e.g. a self-contained HTML file.'),
  dependsOn: z.array(id).max(32).optional().describe('Tasks whose accepted result this one consumes.'),
}).strict()
export type DelegationTaskCreate = z.infer<typeof DelegationTaskCreateSchema>

export const DelegationTaskAmendSchema = z.object({
  requestId: id.describe('Stable identity for this change. Reuse unchanged on retry.'),
  taskId: id,
  requirements: z.array(RequirementInputSchema).max(64).optional().describe('Statements to add, or corrections via supersedes.'),
  withdraw: z.array(id).max(64).optional().describe('Existing requirement ids this input withdraws.'),
  keep: z.array(id).max(64).optional().describe('Existing requirement ids this input explicitly leaves in force.'),
  reason: z.string().max(4000).optional(),
}).strict()
export type DelegationTaskAmend = z.infer<typeof DelegationTaskAmendSchema>

export const DelegationTaskQuerySchema = z.object({
  taskId: id.optional(),
  goalId: id.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  checkReady: z.boolean().optional().describe('Also check execution preconditions for the named task. This never dispatches.'),
}).strict()
export type DelegationTaskQuery = z.infer<typeof DelegationTaskQuerySchema>

export const DelegationTaskControlSchema = z.object({
  requestId: id.describe('Stable identity for this control intent. Reuse unchanged on retry.'),
  taskIds: z.array(id).min(1).max(64),
  action: z.enum(['pause', 'resume', 'terminate']).describe('pause freezes new admission and is resumable; terminate closes admission and retries permanently.'),
  reason: z.string().max(2000).optional(),
}).strict()
export type DelegationTaskControl = z.infer<typeof DelegationTaskControlSchema>

export const DelegationTaskVerifySchema = z.object({
  requestId: id.describe('Stable identity for this review. Reuse unchanged on retry.'),
  taskId: id,
  results: z.array(z.object({ criterionId: id, outcome: z.enum(['met', 'gap', 'undecided']),
    evidence: z.string().max(4000).optional() }).strict()).max(32).optional(),
  verdict: z.enum(['accepted', 'rework', 'needs_user']).describe('needs_user preserves the decision for the user instead of closing it.'),
  reason: z.string().max(4000).optional(),
}).strict()
export type DelegationTaskVerify = z.infer<typeof DelegationTaskVerifySchema>

/** Only an explicit control changes this record; execution and readiness never do. */
export type TaskControlAction = 'pause' | 'resume' | 'terminate'

export interface GoalView {
  id: string
  title: string
  successCriteria: string[]
  createdAt: number
  updatedAt: number
}

export interface AcceptanceCriterionView { id: string; statement: string }

export interface RequirementView {
  id: string
  taskId: string
  /** Per-requirement citation version; corrections append, never overwrite. */
  version: number
  statement: string
  scope: RequirementScope
  state: 'active' | 'superseded' | 'withdrawn'
  supersedes?: string
  supersededBy?: string
  quote?: string
  /** Trusted input that produced this version. */
  inputMessageId?: string
  createdAt: number
}

/** One trusted input's effect on a task definition. */
export interface ChangeView {
  id: string
  taskId: string
  requestId: string
  inputMessageId?: string
  reason?: string
  items: Array<{ requirementId: string; action: 'added' | 'replaced' | 'withdrawn' | 'kept'; version: number }>
  /** Definition version this change produced. */
  producedVersion: number
  createdAt: number
}

export type AssignmentState = 'admitted' | 'queued' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'cancelled'

export interface AssignmentView {
  id: string
  taskId: string
  /** Definition version this assignment was admitted under. */
  definitionVersion: number
  /** Requirements admitted with it; later versions never apply silently. */
  requirementIds: string[]
  state: AssignmentState
  sessionId?: string
  inputMessageId?: string
  /** Host delegation receipt id once execution was handed to a Session. */
  delegationId?: string
  /** Latest delivery/consumption fact for a newer definition version. */
  definitionDelivery?: { version: number; phase: 'staged' | 'queued' | 'delivered' | 'consumed'; at: number }
  error?: string
  createdAt: number
  updatedAt: number
}

export interface ReadyView {
  taskId: string
  definitionVersion: number
  ready: boolean
  /** Concrete missing preconditions when `ready` is false. */
  missing: string[]
  /** Authority facts the check relied on. */
  authority: string[]
  checkedAt: number
}

export interface VerificationView {
  id: string
  taskId: string
  definitionVersion: number
  assignmentId?: string
  verdict: 'accepted' | 'rework' | 'needs_user'
  results: Array<{ criterionId: string; outcome: 'met' | 'gap' | 'undecided'; evidence?: string }>
  reason?: string
  createdAt: number
}

export interface TaskRecordView {
  id: string
  goalId: string
  title: string
  scopeIn: string[]
  scopeOut: string[]
  acceptance: AcceptanceCriterionView[]
  deliverable?: string
  dependsOn: string[]
  /** Monotonic per-task counter bumped only by a committed Change. */
  definitionVersion: number
  createdAt: number
  updatedAt: number
}

/**
 * Derived from persisted facts, never stored. Definition, execution and
 * acceptance progress are separate axes: "version 3 recorded while version 2 is
 * still executing" is a legal state and must not collapse into one label.
 */
export const TASK_STAGES = ['intake', 'ready', 'queued', 'running', 'stopping', 'paused', 'candidate_result', 'needs_user', 'accepted', 'rework', 'failed', 'cancelled'] as const
export type TaskStage = (typeof TASK_STAGES)[number]

export interface TaskProjectionView {
  task: TaskRecordView
  goal: GoalView
  requirements: RequirementView[]
  activeRequirements: RequirementView[]
  changes: ChangeView[]
  assignments: AssignmentView[]
  ready?: ReadyView
  control?: { taskId: string; action: TaskControlAction; at: number; reason?: string }
  verification?: VerificationView
  stage: TaskStage
  /** Newest recorded definition version. */
  definitionVersion: number
  /** Newest definition version an assignment actually consumed. */
  executedVersion?: number
  /** True when a newer definition exists that no assignment consumed yet. */
  definitionAheadOfExecution: boolean
}

export interface TaskPageView {
  observedAt: number
  items: TaskProjectionView[]
  counts: Partial<Record<TaskStage, number>>
  total: number
}

export interface TaskControlReceipt {
  taskId: string
  action: TaskControlAction
  previousAction?: TaskControlAction
}
export interface TaskControlResult { receipts: TaskControlReceipt[] }

/**
 * Dispatch request for one ready definition.
 *
 * The execution settings and any target Session are execution choices, not
 * requirements; the pinned goal quote can only come from a recorded
 * requirement, so a dispatch can never widen what the user authorized.
 */
export const DelegationTaskDispatchSchema = z.object({
  requestId: id.describe('Stable identity for this dispatch. Reuse unchanged on retry.'),
  /** Present when continuing an already reviewed result within its own grant. */
  continuationOf: id.optional(),
  config: z.object({
    llmConnection: id.optional(), model: id.optional(),
    thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
    permissionMode: z.enum(['safe', 'ask', 'guarded', 'allow-all']).optional(),
    projectId: id.optional(), workingDirectory: z.string().min(1).max(4096).optional(),
  }).strict().default({}),
  targetSessionId: id.optional().describe('Continue an idle ordinary Session instead of creating one.'),
  goalQuote: z.string().min(1).max(6000).optional()
    .describe('Only used when it already exists as a recorded requirement quote.'),
}).strict()
export type DelegationTaskDispatch = z.infer<typeof DelegationTaskDispatchSchema>
