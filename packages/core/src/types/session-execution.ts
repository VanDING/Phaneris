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
export interface ScenarioMaterialReference { id: string; revision: number; derivedVersion: string }
/** Read-only facts projected from the existing Runtime for one ordinary input. */
export interface SessionExecutionAttempt {
  operationId: string; sessionId: string; inputMessageId: string; acceptedSeq: number; acceptedAt: number; updatedAt: number
  phase: 'accepted' | 'model_effect_pending' | 'tool_planned' | 'tool_effect_pending' | 'checkpoint' | 'recovery_parked' | 'terminal' | 'unknown'
  terminal?: { eventId: string; sequence: number; reason?: string; at: number }
  unsettledToolCount: number
}
export interface SessionInputExecutionsPage { items: SessionExecutionAttempt[]; nextBefore: number | null; total: number }
/** Immutable assignment evidence on an ordinary Session input, not another task. */
export interface ToolObservationReference { operationId: string; runOperationId: string }
export interface SourceMaterialReference { sessionId: string; messageId: string; contentHash: string; projectId?: string | null; materialMode?: 'reference' | 'content'; observation?: ToolObservationReference; readPurpose?: 'historical' }
export interface KnowledgeMaterialReference { sourceSlug: string; version: string }
export interface ContextReadMetrics { bytesRead: number; indexScanBytes: number; decodedRecords: number; selectedCharacters: number; rebuilds: number }

export interface SessionDelegationInput {
  invalidation?: { code: 'task_requirements_changed' | 'attachments_changed' | 'materials_withdrawn' | 'permission_ceiling_tightened' | 'configuration_changed' | 'capability_changed' | 'management_pending'; detail: string; action: 'configure' | 'refresh_materials' | 'inspect_effects'; at: number; boundary: 'prepare' | 'tool' | 'response'; providerRequestId?: string; runOperationId?: string }
  /** Literal paths relative to the effective working directory. Scheduling
   * contract shared with Tasks, not an operating-system sandbox. */
  fileScope?: { read: string[]; write: string[] }
  completionPolicy?: 'assistant_review' | 'user_review'
  /** Optimistic ownership of automatic Session status changes, not a task state.
   * A manual status edit withdraws this guard. Review is bound to one result. */
  statusControl?: { expectedStatus: string; withdrawn?: true; review?: { result: { sessionId: string; messageId: string }; outcome: 'accepted' | 'rework' | 'needs_user_review'; reason: string } }
  contextBinding?: { assistantSessionId: string; branchRevisions: Record<string, number>; reading?: ContextReadMetrics }
  executionPermissionCeiling?: NonNullable<SessionExecutionConfig['permissionMode']>
  originGrant?: SourceMaterialReference & { quote: string }
  attachmentMaterials?: Array<{ attachmentId: string; originSessionId: string; originMessageId: string; path: string; contentHash: string }>
  artifactBaselines?: SessionArtifactBaseline[]
  materialDependencies?: { sources: SourceMaterialReference[]; memories: MemoryMaterialReference[]; scenarios?: ScenarioMaterialReference[]; knowledge?: KnowledgeMaterialReference[] }
  requestId: string; fingerprint: string; title: string; acceptanceCriteria?: string[]
  requestedConfig: SessionExecutionConfig; effectiveConfig: ResolvedSessionExecutionConfig; adjustments: string[]
  configRevision?: string; capabilityRevision?: string
  acceptedConfigRevision?: string; acceptedPermissionMode?: NonNullable<SessionExecutionConfig['permissionMode']>
  baseMessageId?: string; submittedAt?: number
}
