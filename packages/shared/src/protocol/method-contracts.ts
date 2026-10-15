/** Typed response ports reuse the authoritative DTOs. Dynamic extension channels return unknown. */
import { RPC_CHANNELS as c } from './channels'
import type { Session, RemoteSessionTransferPayload, TestAutomationResult } from './dto'
import type { SessionReadChunk } from './session-read'
import type { ResolvedArtifact, AcceptArtifactResult } from '../artifacts/types'
import type { WorkItem } from '../work-items/types'
import type { AuthState, SetupNeeds } from '../auth/types'
import type { Workspace } from '@phaneris/core/types'
import type { LlmConnection, LlmConnectionWithStatus } from '../config/llm-connections'
import type { CredentialHealthStatus } from '../credentials/types'
import type { SessionDecisionReport } from '../decisions/session'
import type { DecisionUsageReport } from '../decisions/usage'
import type { DecisionLayerSettings } from '../decisions/settings'
import type { LoadedSource, FolderSourceConfig } from '../sources/types'
import type { LabelConfig } from '../labels/types'
import type { LoadedSkill } from '../skills/types'

export interface RpcMethodResults {
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
  [c.server.GET_WORKSPACES]: Workspace[]
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
  [c.workItems.DELETE]: boolean
}
export type RpcResult<Channel extends string> = Channel extends keyof RpcMethodResults ? RpcMethodResults[Channel] : unknown
