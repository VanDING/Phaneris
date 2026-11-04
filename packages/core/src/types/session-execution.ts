/** Session execution settings shared by ordinary creation and attributed inputs. */
export const EXECUTION_PROMPT_PRESETS = ['default', 'mini'] as const
export type ExecutionPromptPreset = typeof EXECUTION_PROMPT_PRESETS[number]
export interface SessionArtifactBaseline { artifactId: string; expectedRevision: string }
export interface SessionExecutionConfig {
  llmConnection?: string; model?: string
  systemPromptPreset?: ExecutionPromptPreset
  /** Session override, ahead of workspace/global defaults. Normal SDKs may ignore
   * unsupported reasoning; attributed delegation validates model support first. */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode?: 'safe' | 'ask' | 'guarded' | 'allow-all'
  enabledSourceSlugs?: string[]; skillSlugs?: string[]; activePlugin?: string | null
  /** Workspace-scoped project; new Sessions can inherit its working directory. */
  projectId?: string
  /** user_default/undefined: workspace directory; none: Session storage only;
   * otherwise an absolute directory on the executing Host. */
  workingDirectory?: string
  contextPolicy?: 'compact' | 'handoff' | 'manual'; labels?: string[]
}
export interface ResolvedSessionExecutionConfig extends SessionExecutionConfig {
  llmConnection: string; model: string; thinkingLevel: NonNullable<SessionExecutionConfig['thinkingLevel']>
  permissionMode: NonNullable<SessionExecutionConfig['permissionMode']>; enabledSourceSlugs: string[]; skillSlugs: string[]
  activePlugin: string | null; contextPolicy: NonNullable<SessionExecutionConfig['contextPolicy']>
  workingDirectory: string; labels: string[]
}
export type MemoryLifecycleState = 'candidate' | 'active' | 'scheduled' | 'dormant' | 'superseded' | 'expired' | 'invalidated' | 'forgotten'
export interface MemoryMaterialReference { id: string; revision: number; observedState?: MemoryLifecycleState; observedDispute?: boolean }
/** Read-only facts projected from the existing Runtime for one ordinary input. */
export interface SessionExecutionAttempt {
  operationId: string; sessionId: string; inputMessageId: string; acceptedSeq: number; acceptedAt: number; updatedAt: number
  phase: 'accepted' | 'model_effect_pending' | 'tool_planned' | 'tool_effect_pending' | 'checkpoint' | 'recovery_parked' | 'terminal' | 'unknown'
  terminal?: { eventId: string; sequence: number; reason?: string; at: number }
  unsettledToolCount: number
}
export interface SessionInputExecutionsPage { items: SessionExecutionAttempt[]; nextBefore: number | null; total: number }
/** Immutable assignment evidence on an ordinary Session input, not another task. */
export interface SessionDelegationInput {
  artifactBaselines?: SessionArtifactBaseline[]
  materialDependencies?: { sources: Array<{ sessionId: string; messageId: string; contentHash: string }>; memories: MemoryMaterialReference[] }
  requestId: string; fingerprint: string; title: string; acceptanceCriteria?: string[]
  requestedConfig: SessionExecutionConfig; effectiveConfig: ResolvedSessionExecutionConfig; adjustments: string[]
  configRevision?: string; capabilityRevision?: string
  acceptedConfigRevision?: string; acceptedPermissionMode?: NonNullable<SessionExecutionConfig['permissionMode']>
  baseMessageId?: string; submittedAt?: number
}
