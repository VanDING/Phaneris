/** Typed response ports reuse the authoritative DTOs. Dynamic extension channels return unknown. */
import { RPC_CHANNELS as c } from './channels'
import type { Session, RemoteSessionTransferPayload, TestAutomationResult, WorkspaceSettings, SendMessageOptions, FileAttachment, SessionCommand, CreateSessionOptions } from './dto'
import type { SessionReadChunk } from './session-read'
import type { ResolvedArtifact, AcceptArtifactResult } from '../artifacts/types'
import type { WorkItem, CreateWorkItemInput, UpdateWorkItemInput } from '../work-items/types'
import type { PageConfig, PageActionGrant, PageDataSnapshot, PageRenderLease, PageActionRequest, PageActionResult } from '@phaneris/core'
import type { CreatePageInput, LoadedPage, UpdatePagePatch, AddPageGrantInput, PageShareDataScan, PublishPageOptions, UnpublishResult } from '../pages'
import type { RPC_INPUT_CONTRACTS, RpcSchemaArguments } from './input-contracts'
import type { AuthState, SetupNeeds } from '../auth/types'
import type { Workspace, WorkspaceInfo, StoredAttachment } from '@phaneris/core/types'
import type { LlmConnection, LlmConnectionWithStatus } from '../config/llm-connections'
import type { CredentialHealthStatus } from '../credentials/types'
import type { SessionDecisionReport } from '../decisions/session'
import type { DecisionUsageReport } from '../decisions/usage'
import type { DecisionLayerSettings } from '../decisions/settings'
import type { LoadedSource, FolderSourceConfig } from '../sources/types'
import type { LabelConfig } from '../labels/types'
import type { LoadedSkill } from '../skills/types'

/** Ports whose domain already owns runtime validation do not gain a second schema. */
export interface RpcMethodArguments {
  [c.projects.DELETE]: [workspaceId: string, slug: string]
  // Normal calls use the DTO; the tasks wire also retains legacy null fields.
  [c.tasks.CREATE]: [workspaceId: string, request: import('./dto').TaskCreateRequest]
  // Coarse object schemas retain their runtime compatibility rules. These
  // normal-call types come from the owning DTO/domain, not a second validator.
  [c.sessions.CREATE]: [workspaceId: string, options?: CreateSessionOptions]
  [c.sessions.READ_MESSAGES]: [sessionId: string, cursor?: import('./session-read').SessionReadCursor]
  [c.sessions.GET_RECOVERY_EVIDENCE]: [sessionId: string, toolOperationId: string]
  [c.sessions.RECONCILE_TOOL]: [sessionId: string, request: Omit<import('../durable-runtime').ToolReconciliationRequest, 'sessionId' | 'actor'>]
  [c.sessions.RECONCILE_MODEL]: [sessionId: string, request: Omit<import('../durable-runtime').ModelReconciliationRequest, 'sessionId' | 'actor'>]
  [c.sessions.SEND_MESSAGE]: [sessionId: string, text: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions]
  [c.sessions.RESPOND_TO_ASK_USER]: [sessionId: string, requestId: string, response: import('@phaneris/core').AskUserResponse]
  [c.sessions.COMMAND]: [sessionId: string, command: SessionCommand]
  [c.sessions.IMPORT_REMOTE_TRANSFER]: [workspaceId: string, payload: RemoteSessionTransferPayload]
  [c.llmConnections.SAVE]: [connection: LlmConnection]

  [c.workItems.LIST]: [workspaceId: string]
  [c.workItems.CREATE]: [workspaceId: string, input: CreateWorkItemInput]
  [c.workItems.UPDATE]: [workspaceId: string, id: string, patch: UpdateWorkItemInput]
  [c.workItems.DELETE]: [workspaceId: string, id: string]
  [c.pages.GET]: [workspaceId: string]
  [c.pages.GET_ONE]: [workspaceId: string, pageIdOrSlug: string]
  [c.pages.CREATE]: [workspaceId: string, input: CreatePageInput]
  [c.pages.UPDATE]: [workspaceId: string, slug: string, patch: UpdatePagePatch]
  [c.pages.DELETE]: [workspaceId: string, slug: string]
  [c.pages.GET_CONTENT]: [workspaceId: string, slug: string]
  [c.pages.SET_CONTENT]: [workspaceId: string, slug: string, content: string]
  [c.pages.GET_DATA]: [workspaceId: string, slug: string]
  [c.pages.LIST_GRANTS]: [workspaceId: string, slug: string]
  [c.pages.ISSUE_GRANT]: [workspaceId: string, slug: string, input: AddPageGrantInput]
  [c.pages.REVOKE_GRANT]: [workspaceId: string, slug: string, grantId: string]
  [c.pages.CREATE_LEASE]: [workspaceId: string, slug: string]
  [c.pages.RELEASE_LEASE]: [workspaceId: string, leaseId: string]
  [c.pages.EXECUTE_ACTION]: [workspaceId: string, request: PageActionRequest]
  [c.pages.CANCEL_ACTION]: [workspaceId: string, requestId: string]
  [c.pages.GET_SHARE_CAPABILITIES]: []
  [c.pages.GET_SHARE_DATA_SCAN]: [workspaceId: string, slug: string]
  [c.pages.PUBLISH]: [workspaceId: string, slug: string, options: PublishPageOptions]
  [c.pages.SET_PUBLICATION_PASSWORD]: [workspaceId: string, slug: string, password: string | null]
  [c.pages.UNPUBLISH]: [workspaceId: string, slug: string]
  [c.pages.GET_THUMBNAIL]: [workspaceId: string, slug: string]
  [c.pages.REGENERATE_THUMBNAIL]: [workspaceId: string, slug: string]
}
export type RpcArguments<Channel extends string> = Channel extends keyof RpcMethodArguments
  ? RpcMethodArguments[Channel] : Channel extends keyof typeof RPC_INPUT_CONTRACTS ? RpcSchemaArguments<Channel> : unknown[]

export interface RpcMethodResults {
  [c.projects.DELETE]: void
  [c.tasks.CREATE]: import('./dto').TaskCreateResult
  [c.pages.GET]: LoadedPage[]
  [c.pages.GET_ONE]: LoadedPage | null
  [c.pages.CREATE]: PageConfig
  [c.pages.UPDATE]: PageConfig
  [c.pages.DELETE]: { publicCopyMayRemain: boolean }
  [c.pages.GET_CONTENT]: { content: string | null; contentDigest?: string }
  [c.pages.SET_CONTENT]: PageConfig
  [c.pages.GET_DATA]: PageDataSnapshot | null
  [c.pages.LIST_GRANTS]: PageActionGrant[]
  [c.pages.ISSUE_GRANT]: PageActionGrant
  [c.pages.REVOKE_GRANT]: boolean
  [c.pages.CREATE_LEASE]: { lease: PageRenderLease; content: string }
  [c.pages.RELEASE_LEASE]: void
  [c.pages.EXECUTE_ACTION]: PageActionResult
  [c.pages.CANCEL_ACTION]: boolean
  [c.pages.GET_SHARE_CAPABILITIES]: { sharingEnabled: boolean }
  [c.pages.GET_SHARE_DATA_SCAN]: PageShareDataScan
  [c.pages.PUBLISH]: PageConfig
  [c.pages.SET_PUBLICATION_PASSWORD]: PageConfig
  [c.pages.UNPUBLISH]: UnpublishResult
  [c.pages.GET_THUMBNAIL]: { dataUrl: string; digest: string } | null
  [c.pages.REGENERATE_THUMBNAIL]: boolean

  [c.workspace.SETTINGS_GET]: WorkspaceSettings | null
  [c.residentAssistant.GET]: Session
  [c.residentAssistant.CONTEXT]: import('@phaneris/session-tools-core/resident-context-contracts').ResidentContextState
  [c.residentAssistant.EVENTS]: import('@phaneris/session-tools-core/resident-context-contracts').ResidentEventsPage
  [c.residentAssistant.DISPATCH]: import('@phaneris/session-tools-core/delegation-contracts').AssistantWork
  [c.residentAssistant.WORK]: import('@phaneris/session-tools-core/delegation-contracts').AssistantWorkPage
  [c.residentAssistant.CONTROL]: import('@phaneris/session-tools-core/worker-control-contracts').WorkerControlResult
  [c.residentAssistant.ORIGINALS]: import('@phaneris/session-tools-core/session-history-contracts').SessionHistoryPage
  [c.residentAssistant.EXECUTION_MODE]: Session
  [c.residentAssistant.CANCEL_WORK]: import('@phaneris/session-tools-core/delegation-contracts').AssistantWork
  [c.residentAssistant.OUTPUT_VISIBILITY]: import('@phaneris/session-tools-core/task-result-contracts').TaskOutputManifest
  [c.residentAssistant.TASKS]: import('@phaneris/session-tools-core/task-delegation-contracts').TaskPageView
  [c.residentAssistant.TASKS_CONTROL]: import('@phaneris/session-tools-core/task-delegation-contracts').TaskControlResult
  [c.residentAssistant.TASKS_VERIFY]: import('@phaneris/session-tools-core/task-delegation-contracts').TaskProjectionView
  [c.residentAssistant.TASKS_DISPATCH]: { assignment: import('@phaneris/session-tools-core/task-delegation-contracts').AssignmentView; receipt: import('@phaneris/session-tools-core/delegation-contracts').AssistantDelegationReceipt }
  [c.assistantMemory.QUERY]: import('./assistant-memory').MemoryQueryResult
  [c.assistantMemory.SUPPRESSION_EXPORT]: import('./assistant-memory').MemorySuppressionPage
  [c.assistantMemory.SUPPRESSION_MERGE]: import('./assistant-memory').MemorySuppressionMergeResult
  [c.assistantMemory.HISTORY]: import('./assistant-memory').HistoryPage
  [c.assistantMemory.MUTATE]: import('./assistant-memory').MemoryMutationResult
  [c.assistantMemory.READ_SOURCE]: import('./assistant-memory').MemorySourcePage
  [c.sources.GET]: LoadedSource[]
  [c.sources.CREATE]: FolderSourceConfig
  [c.automations.TEST]: TestAutomationResult
  [c.labels.CREATE]: LabelConfig
  [c.skills.GET]: LoadedSkill[]
  [c.system.VERSIONS]: { node: string; chrome?: string; electron?: string }
  [c.decisions.GET_SESSION]: SessionDecisionReport
  [c.decisions.GET_USAGE]: DecisionUsageReport
  [c.decisions.GET_SETTINGS]: DecisionLayerSettings
  [c.oauth.START]:
    | { joined: true; flowId: string; expiresInMs?: number }
    | { joined?: undefined; flowId: string; state: string; authUrl: string; expiresInMs?: number }
  [c.oauth.STATUS]: import('../auth/oauth-flow-store').OAuthFlowStatus
  [c.oauth.COMPLETE]: { success: boolean; error?: string; email?: string }
  [c.chatgpt.START_OAUTH]: { flowId: string; state: string; authUrl: string }
  [c.chatgpt.COMPLETE_OAUTH]: { success: boolean; error?: string }
  [c.onboarding.START_CLAUDE_OAUTH]: { success: boolean; authUrl?: string; error?: string }
  [c.sessions.GET]: Session[]
  [c.sessions.GET_MESSAGES]: Session | null
  [c.sessions.READ_MESSAGES]: SessionReadChunk | null
  [c.sessions.SEND_MESSAGE]: { accepted: true; messageId: string }
  [c.sessions.CREATE]: Session
  [c.sessions.EXPORT_REMOTE_TRANSFER]: RemoteSessionTransferPayload | null
  [c.workspaces.GET]: Workspace[]
  [c.server.GET_WORKSPACES]: WorkspaceInfo[]
  [c.llmConnections.LIST]: LlmConnection[]
  [c.llmConnections.LIST_WITH_STATUS]: LlmConnectionWithStatus[]
  [c.llmConnections.GET]: LlmConnection | null
  [c.llmConnections.GET_API_KEY]: string | null
  [c.credentials.HEALTH_CHECK]: CredentialHealthStatus
  [c.onboarding.GET_AUTH_STATE]: { authState: AuthState; setupNeeds: SetupNeeds }
  [c.onboarding.DEFER_SETUP]: { success: boolean }
  [c.artifacts.CREATE]: ResolvedArtifact
  [c.artifacts.REGISTER_CURRENT]: ResolvedArtifact
  [c.artifacts.APPLY]: ResolvedArtifact
  [c.artifacts.SUBMIT]: ResolvedArtifact
  [c.artifacts.DISCARD]: ResolvedArtifact
  [c.artifacts.ACCEPT]: AcceptArtifactResult
  [c.artifacts.GET]: ResolvedArtifact | null
  [c.artifacts.LIST]: ResolvedArtifact[]
  [c.workItems.LIST]: WorkItem[]
  [c.workItems.CREATE]: WorkItem
  [c.workItems.UPDATE]: WorkItem | null
  [c.workItems.DELETE]: void
}
export type RpcResult<Channel extends string> = Channel extends keyof RpcMethodResults ? RpcMethodResults[Channel] : unknown
