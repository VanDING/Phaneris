/** JSONL wire types. No runtime or host storage imports. */
import type { HandoffSignal } from './context-policy-stream';
import type { ContextPolicy } from '@phaneris/shared/agent/context-policy';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { CacheRetention, OAuthCredential } from '@earendil-works/pi-ai';
import type { CustomEndpointModelConfig } from './custom-endpoint-models.ts';
import type { LLMQueryRequest, LLMQueryResult } from '@phaneris/shared/agent/llm-tool';
import type { PiCompactResult, PiContextUsagePayload, PiLargeResultFilterRequest, PiLargeResultFilterResponse, PiLargeResultFilterCancel, PiInputReception, PiProxyToolDefinition, PiProxyToolResult } from '@phaneris/shared/agent/backend/pi/protocol';
import type { DurableCanonicalModelContext, DurableToolExecutionIdentity, ToolRecoveryMode } from '@phaneris/shared/durable-runtime/types';
export type PiCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: 'iam'; accessKeyId: string; secretAccessKey: string; region?: string; sessionToken?: string };

export type CustomEndpointApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface InitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  workspaceRootPath: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
  plansFolderPath: string;
  miniModel?: string;
  agentDir?: string;
  providerType?: string;
  authType?: string;
  workspaceId?: string;
  baseUrl?: string;
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkTurnId?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: CustomEndpointModelConfig[];
  piAuth?: { provider: string; credential: PiCredential };
  /** Whether the browser session tool is enabled (false = exclude via SDK denylist) */
  browserToolEnabled?: boolean;
  /** Pi SDK native prompt-cache retention ('long' = extended TTL where supported) */
  cacheRetention?: CacheRetention;
  promptCacheWarming?: boolean;
  contextPolicy?: ContextPolicy;
}

export interface RuntimeConfigUpdateMessage {
  type: 'update_runtime_config';
  id: string;
  model: string;
  providerType?: string;
  authType?: string;
  baseUrl?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: CustomEndpointModelConfig[];
}

export type InboundMessage =
  | InitMessage
  | { type: 'prompt'; id: string; message: string; systemPrompt: string; durableRunOperationId?: string; durableTurnId?: string; canonicalContext?: DurableCanonicalModelContext; images?: Array<{ type: 'image'; data: string; mimeType: string }> }
  | { type: 'sync_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: PiProxyToolResult }
  | { type: 'pre_tool_use_response'; requestId: string; action: 'allow' | 'block' | 'modify'; input?: Record<string, unknown>; reason?: string }
  | { type: 'durable_tool_prepare_response'; requestId: string; ok: boolean; prepared?: { operationId: string; idempotencyKey: string; canonicalArgsHash: string; recoveryMode: ToolRecoveryMode; created: boolean; status: string; committedSeq: number }; reason?: string }
  | { type: 'durable_tool_outcome_response'; requestId: string; ok: boolean; committedSeq?: number; reason?: string }
  | { type: 'durable_model_prepare_response'; requestId: string; ok: boolean; prepared?: { operationId: string; idempotencyKey: string; created: boolean; status: string; committedSeq: number }; reason?: string }
  | { type: 'durable_model_outcome_response'; requestId: string; ok: boolean; committedSeq?: number; reason?: string }
  | PiLargeResultFilterResponse
  | { type: 'abort' }
  | { type: 'mini_completion'; id: string; prompt: string; durableRunOperationId?: string; durableTurnId?: string }
  | { type: 'llm_query'; id: string; request: LLMQueryRequest; durableRunOperationId?: string; durableTurnId?: string }
  | { type: 'cancel_ephemeral_query'; id: string }
  | { type: 'ensure_session_ready'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_thinking_level'; level: string }
  | { type: 'compact'; id: string; customInstructions?: string; durableRunOperationId?: string; durableTurnId?: string }
  | { type: 'set_auto_compaction'; id: string; enabled: boolean; policy?: ContextPolicy }
  | { type: 'force_context_handoff' }
  | { type: 'set_browser_tool_enabled'; enabled: boolean }
  | { type: 'set_cache_retention'; cacheRetention: CacheRetention }
  | { type: 'set_cache_warming'; enabled: boolean }
  | RuntimeConfigUpdateMessage
  | { type: 'steer'; id?: string; message: string }
  | { type: 'token_update'; piAuth: { provider: string; credential: PiCredential } }
  | { type: 'oauth_credential_update_response'; requestId: string; ok: boolean }
  | { type: 'shutdown' };

export interface ProxyToolDef extends PiProxyToolDefinition {}

export interface ToolExecutionMetadata {
  intent?: string;
  displayName?: string;
  source: 'interceptor';
}

export type EnrichedToolExecutionStartEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }> & {
  toolMetadata?: ToolExecutionMetadata;
  /** Wall-clock stamp (epoch ms) added at forward time for trajectory timing. */
  ts?: number;
};

export interface TrajectoryEventAttachments {
  /** Wall-clock stamp (epoch ms) added at forward time for trajectory timing. */
  ts?: number;
  /** Server-assigned per-session request ordinal (matches prompt snapshots). */
  requestSeq?: number;
  /** Effective system prompt captured for this request. */
  promptSnapshot?: string;
  /** Content-addressed manifest of the actual request-time context. */
  contextSnapshot?: PromptSnapshot['contextSnapshot'];
}

export type OutboundAgentEvent = (AgentSessionEvent | (EnrichedToolExecutionStartEvent & TrajectoryEventAttachments) | { type: 'context_usage' }) & PiContextUsagePayload;

export interface OutboundReady { type: 'ready'; sessionId: string | null; callbackPort: number; callbackToken: string }

export interface OutboundEvent { type: 'event'; event: OutboundAgentEvent }

export interface OutboundPreToolUseReq {
  type: 'pre_tool_use_request';
  requestId: string;
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
  policyOnly?: boolean;
}

export interface OutboundToolExecReq { type: 'tool_execute_request'; requestId: string; toolCallId?: string; toolName: string; args: Record<string, unknown>; durableTool?: DurableToolExecutionIdentity }

export interface OutboundToolExecCancel { type: 'tool_execute_cancel'; requestId: string }

export interface OutboundDurableToolPrepareReq {
  type: 'durable_tool_prepare_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  providerToolCallId: string;
  toolBatchId?: string;
  toolBatchOrdinal?: number;
  toolName: string;
  args: Record<string, unknown>;
}

export interface OutboundDurableToolOutcomeReq {
  type: 'durable_tool_outcome_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  operationId: string;
  providerToolCallId: string;
  toolBatchId?: string;
  toolBatchOrdinal?: number;
  toolName: string;
  canonicalArgsHash: string;
  result: unknown;
  isError: boolean;
}

export interface OutboundDurableModelPrepareReq {
  purpose?: 'cache_warm';
  type: 'durable_model_prepare_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  providerRequestId: string;
  provider: string;
  model: string;
  canonicalRequestHash: string;
}

export interface OutboundDurableModelOutcomeReq {
  purpose?: 'cache_warm';
  type: 'durable_model_outcome_request';
  requestId: string;
  sessionId: string;
  turnId: string;
  runOperationId: string;
  operationId: string;
  providerRequestId: string;
  provider: string;
  model: string;
  canonicalRequestHash: string;
  stopReason: string;
  responseId?: string;
  requestObservation?: import('@phaneris/shared/durable-runtime/types').NativeRequestObservation;
  content: unknown;
  text?: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number; payload?: unknown };
}

export interface OutboundSessionToolCompleted { type: 'session_tool_completed'; toolName: string; args: Record<string, unknown>; isError: boolean }

export interface OutboundMiniResult { type: 'mini_completion_result'; id: string; text: string | null }

export interface OutboundLlmQueryResult {
  type: 'llm_query_result';
  id: string;
  result: LLMQueryResult | null;
  errorMessage?: string;
  /**
   * When set, signals the main process that a generic `error` with the same code
   * was also emitted on the error channel (for centralized auth-refresh detection).
   */
  errorCode?: string;
}

export interface OutboundEnsureSessionReadyResult { type: 'ensure_session_ready_result'; id: string; sessionId: string | null }

export interface OutboundCompactResult {
  type: 'compact_result';
  id: string;
  success: boolean;
  result?: PiCompactResult;
  errorMessage?: string;
}

export interface OutboundSetAutoCompactionResult {
  type: 'set_auto_compaction_result';
  id: string;
  success: boolean;
  enabled: boolean;
  errorMessage?: string;
}

export interface OutboundRuntimeConfigUpdateResult {
  type: 'update_runtime_config_result';
  id: string;
  success: boolean;
  updated: boolean;
  contextWindow?: number;
  errorMessage?: string;
}

export interface OutboundSetModelResult {
  type: 'set_model_result';
  model: string;
  contextWindow?: number;
}

export interface OutboundThinkingLevelState {
  type: 'thinking_level_state';
  effectiveLevel: string;
  availableLevels: string[];
}

export interface OutboundSessionIdUpdate { type: 'session_id_update'; sessionId: string }

export interface OutboundError { type: 'error'; message: string; code?: string; id?: string }

export type OutboundMessage =
  | { type: 'oauth_credential_update_request'; requestId: string; provider: string; credential: OAuthCredential }
  | PiInputReception
  | { type: 'context_handoff'; signal: HandoffSignal }
  | OutboundReady
  | OutboundEvent
  | OutboundPreToolUseReq
  | OutboundToolExecReq
  | OutboundDurableToolPrepareReq
  | OutboundDurableToolOutcomeReq
  | OutboundDurableModelPrepareReq
  | OutboundDurableModelOutcomeReq
  | { type: 'sdk_observation'; observation: import('@phaneris/shared/durable-runtime/types').DurableSdkObservation }
  | OutboundSessionToolCompleted
  | OutboundMiniResult
  | OutboundLlmQueryResult
  | OutboundEnsureSessionReadyResult
  | OutboundCompactResult
  | OutboundSetAutoCompactionResult
  | OutboundRuntimeConfigUpdateResult
  | OutboundSetModelResult
  | OutboundThinkingLevelState
  | OutboundSessionIdUpdate
  | PiLargeResultFilterRequest
  | PiLargeResultFilterCancel
  | OutboundToolExecCancel
  | OutboundError;

export interface PromptSnapshot {
  seq: number;
  prompt: string;
  contextSnapshot?: {
    version: 1;
    capturedAt: number;
    provider: string;
    model: string;
    system: { hash: string; chars: number };
    messages: Array<{ role: string; hash: string; chars: number }>;
    tools: Array<{ name: string; description?: string; hash: string; schemaChars: number }>;
  };
}
