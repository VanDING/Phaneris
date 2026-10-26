import { DurableToolAccounting } from './durable-tool-accounting';
import { PiModelRuntimeOwner } from './model-runtime-owner';
import { createSessionEventAdapter } from './session-event-adapter';
import { protectBrowserJournal } from './browser-history-privacy.ts';
import type { PromptSnapshot, PiCredential, CustomEndpointApi, InitMessage, RuntimeConfigUpdateMessage, InboundMessage, ProxyToolDef, ToolExecutionMetadata, EnrichedToolExecutionStartEvent, TrajectoryEventAttachments, OutboundAgentEvent, OutboundReady, OutboundEvent, OutboundPreToolUseReq, OutboundToolExecReq, OutboundToolExecCancel, OutboundDurableToolPrepareReq, OutboundDurableToolOutcomeReq, OutboundDurableModelPrepareReq, OutboundDurableModelOutcomeReq, OutboundSessionToolCompleted, OutboundMiniResult, OutboundLlmQueryResult, OutboundEnsureSessionReadyResult, OutboundCompactResult, OutboundSetAutoCompactionResult, OutboundRuntimeConfigUpdateResult, OutboundSetModelResult, OutboundThinkingLevelState, OutboundSessionIdUpdate, OutboundError, OutboundMessage } from './messages.ts';
import { SessionLifecycle } from './session-lifecycle.ts';
import { PendingReplies } from './pending-replies.ts';
import { createJsonlTransport } from './jsonl-transport.ts';
import { composeToolCatalog, handsControlToUI } from './tool-composition.ts';
import { ToolExecutionScheduler, toolExecutionResources } from './tool-execution-scheduler.ts';
import { createContextPolicyStream, type HandoffSignal } from './context-policy-stream'
import { isContextPolicy, type ContextPolicy } from '@phaneris/shared/agent/context-policy'
import { prepareRequestDiagnostics } from './request-diagnostics.ts';
import { prepareToolResultView, readCapture, readFileWithEvidence } from './tool-result-view.ts';
import { requestCapacity, ResultBudget } from './request-capacity.ts';
import { access as accessReadFile } from 'node:fs/promises';
/**
 * Pi Agent Server
 *
 * Out-of-process Pi agent server communicating via JSONL over stdio.
 * Wraps @earendil-works/pi-coding-agent SDK and communicates with the main
 * Electron process using a line-delimited JSON protocol.
 *
 * The main process spawns this as a child process. All Pi SDK interactions
 * (session creation, prompting, tool execution, permissions) happen here,
 * with events forwarded back to the main process for UI rendering.
 *
 * This design isolates the Pi SDK's ESM + heavy dependencies into a
 * separate process, avoiding bundling issues in the Electron main process.
 */

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { Type } from '@sinclair/typebox';

// Pi SDK
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  ModelRegistry as PiModelRegistry,
  ModelRuntime,
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentToolResult,
  CreateAgentSessionOptions,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, CacheRetention, Context, Credential, Model, OAuthCredential } from '@earendil-works/pi-ai';
import { HostCredentialStore } from './host-credential-store.ts';
import { normalizePiProvider } from '@phaneris/shared/config/pi-provider-compat';

// Pi AI types
import type { TextContent as PiTextContent, ImageContent as PiImageContent } from '@earendil-works/pi-ai';
import { getCurrentTools } from '@earendil-works/pi-ai';

import { registerPiSdkRuntime } from './sdk-registration.ts';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { wrapDurableModelStream } from './durable-model-stream.ts';
import { installCacheWarmingAccounting } from './cache-warming-accounting.ts';
import { streamSimple } from '@earendil-works/pi-ai/compat';

/**
 * Default prompt-cache retention for Pi SDK requests in this subprocess.
 * Driven by the global extendedPromptCache setting and updated live via the
 * `set_cache_retention` message; explicit per-call values always win.
 */
let piCacheRetention: CacheRetention = 'short';

function withDurableAccounting(stream: StreamFn, purposeInput?: 'cache_warm' | (() => 'compaction' | undefined)): StreamFn {
  return wrapDurableModelStream(stream, async (model, context, requestObservation) => {
    const purpose = typeof purposeInput === 'function' ? purposeInput() : purposeInput;
    const contextScope = initConfig ? JSON.stringify([initConfig.workspaceRootPath, initConfig.sessionId]) : undefined;
    const requestSeq = ++promptSnapshotSeq;
    const main = sessionLifecycle.current;
    const mainContext = !purpose && currentDurableModelRun()?.runOperationId === currentDurableRunOperationId && !!currentDurableRunOperationId;
    const occupancy = main && mainContext ? readContextUsage(main) : undefined;
    const reserve = occupancy?.compactionSettings?.reserveTokens;
    const { canonicalRequestHash, contextSnapshot, systemPrompt } = prepareRequestDiagnostics(model, context, reserve, occupancy?.contextUsage?.tokens);
    const capacity = contextSnapshot.capacity;
    if (!purpose) rememberPromptSnapshot(requestSeq, systemPrompt, contextSnapshot);
    const providerRequestId = String(requestSeq);
    const durableRun = currentDurableModelRun();
    if (!initConfig || !durableRun) {
      if (purpose === 'cache_warm') throw new Error('Cache warming requires durable accounting');
      return async message => { Object.assign(message, { durableRequestSeq: requestSeq }); };
    }
    const prepared = await requestDurableModelPrepare(
      providerRequestId, model.provider, model.id, canonicalRequestHash, purpose, durableRun,
    );
    return async message => {
      const committedSeq = await requestDurableModelOutcome({
        prepared, providerRequestId, provider: model.provider, model: model.id,
        canonicalRequestHash, message, requestObservation, purpose, durableRun,
      });
      Object.assign(message, {
        durableOperationId: prepared.operationId,
        durableSeq: committedSeq,
        durableContextScope: contextScope,
        durableRequestSeq: requestSeq,
      });
      if (!purpose) rememberDurableToolBatch(message, prepared.operationId, capacity);
    };
  }, () => piCacheRetention);
}

registerPiSdkRuntime(withDurableAccounting(streamSimple));

// Model resolution (extracted for testability + custom-endpoint precedence)
import { resolvePiModel, isDeniedMiniModelId } from './model-resolution.ts';
import { pickProviderAppropriateMiniModel } from './pick-mini-model.ts';
import { queryMiniModel } from './mini-model-query.ts';
import {
  PHANERIS_PI_EPHEMERAL_QUERY_DEADLINE_MS,
  createPhanerisSettingsManager,
  createMutablePhanerisSettingsManager,
} from './session-settings.ts';
import {
  EphemeralQueryCancelledError,
  EphemeralQueryCoordinator,
  isEphemeralQueryCancellation,
  type EphemeralQueryContext,
  type EphemeralQueryResource,
} from './ephemeral-query-lifecycle.ts';
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
  type CustomEndpointModelEntry,
  type CustomEndpointModelConfig,
  type CustomEndpointModelOverrides,
} from './custom-endpoint-models.ts';
import {
  LENGTH_CONTINUATION_PROMPT,
  LengthContinuationTracker,
  MAX_AUTO_LENGTH_CONTINUATIONS,
} from './length-continuation.ts';

// Direct source imports from shared (bundled by bun build)
import { setLargeResultFilter } from '@phaneris/shared/utils/large-response';
import { getSessionPlansPath, getSessionPath } from '@phaneris/shared/sessions/paths';
import { buildCallLlmRequest } from '@phaneris/shared/agent/llm-tool';
import type { LLMQueryRequest, LLMQueryResult } from '@phaneris/shared/agent/llm-tool';
import { PI_TOOL_NAME_MAP, THINKING_TO_PI } from '@phaneris/shared/agent/backend/pi/constants';
import { getDefaultSummarizationModel } from '@phaneris/shared/config/models';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { modelMetering } from './model-metering.ts';
import { CompactionThresholdController } from './compaction-threshold.ts';
import { isCompactionThreshold } from '@phaneris/shared/agent/compaction-threshold';
import { resolveSearchProvider } from './tools/search/resolve-provider.ts';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { stripPhanerisMetadata } from './phaneris-metadata-schema.ts';
import { createPhanerisResourceLoader, getPhanerisSystemPrompt, setPhanerisSystemPrompt, setPhanerisTaskInstructions } from './phaneris-resource-loader.ts';
import { observeNativeSessionEvent } from './native-lifecycle-observation.ts';
import { readContextUsage, deferContextUsage } from './context-usage.ts';
import { waitForCompaction, MANUAL_COMPACT_WAIT_MS, PROMPT_COMPACT_WAIT_MS } from './compaction-wait.ts';
import { createLargeResultFilterClient } from './large-result-filter.ts';
import type { PiCompactResult, PiContextUsagePayload, PiLargeResultFilterRequest, PiLargeResultFilterResponse, PiLargeResultFilterCancel, PiInputReception, PiProxyToolDefinition, PiProxyToolResult } from '@phaneris/shared/agent/backend/pi/protocol';
import { createProxyMcpResultSchema } from './proxy-mcp-result-schema.ts';
import { guardCallbackToken } from './callback-auth.ts';
import { proxyToolDefinitionsChanged } from './proxy-tool-sync.ts';
import type { DurableCanonicalModelContext, DurableToolExecutionIdentity, ToolRecoveryMode } from '@phaneris/shared/durable-runtime/types';
import { attachDurableToolContext, durableToolFromContext } from './durable-tool-context.ts';
import { convergeCanonicalContext, recordCanonicalCompaction } from './canonical-model-context.ts';
import {
  hasSupportedBaseUrlScheme,
  isLocalhostUrl,
  resolveCustomEndpointApiKeyFor,
} from './custom-endpoint-auth.ts';


// ============================================================
// State
// ============================================================

const sessionLifecycle = new SessionLifecycle<AgentSession>();
const compactionControllers = new WeakMap<AgentSession, CompactionThresholdController>();
let contextPolicy: ContextPolicy = 'compact';
// Set by the host when a user retries a failed handoff: the next request
// generates the document regardless of the measured budget.
let forcedContextHandoff = false;
// A stop must also cancel a manual compact still waiting for auto-compaction.
let compactionEpoch = 0;
const modelOwner = new PiModelRuntimeOwner();
const pendingCredentialWrites = new PendingReplies<boolean>();
let credentialWriteId = 0;

async function persistOAuthCredential(provider: string, credential: OAuthCredential): Promise<void> {
  const requestId = `oauth-write-${++credentialWriteId}`;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCredentialWrites.delete(requestId);
      reject(new Error('Host did not confirm OAuth credential persistence within 30s'));
    }, 30_000);
    pendingCredentialWrites.register(requestId, ok => {
      clearTimeout(timer);
      pendingCredentialWrites.delete(requestId);
      if (ok) resolve(); else reject(new Error('Host could not persist OAuth credential'));
    });
    send({ type: 'oauth_credential_update_request', requestId, provider, credential });
  });
  if (initConfig?.piAuth?.provider === provider) initConfig.piAuth.credential = credential;
}
let unsubscribeEvents: (() => void) | null = null;
const lengthContinuationTracker = new LengthContinuationTracker();

const ephemeralQueries = new EphemeralQueryCoordinator();
let localEphemeralQueryCounter = 0;

function nextLocalEphemeralQueryId(source: string): string {
  localEphemeralQueryCounter += 1;
  return `${source}-${localEphemeralQueryCounter}`;
}

// Init config (set on 'init' message)
let initConfig: Extract<InboundMessage, { type: 'init' }> | null = null;

// Mutable state
let currentDurableRunOperationId: string | undefined;
let currentDurableTurnId: string | undefined;
let lastCanonicalContextCursor = 0;
let lastCanonicalCoveredSeq = 0;
const durableModelRunStorage = new AsyncLocalStorage<{ runOperationId: string; turnId: string }>();

function currentDurableModelRun(): { runOperationId: string; turnId: string } | undefined {
  return durableModelRunStorage.getStore()
    ?? (currentDurableRunOperationId && currentDurableTurnId
      ? { runOperationId: currentDurableRunOperationId, turnId: currentDurableTurnId }
      : undefined);
}

const sdkObservationEpoch = randomBytes(12).toString('hex');
let sdkObservationSeq = 0;
function observeSdkLifecycle(event: string, data: Record<string, unknown>, sdkSessionId?: string): void {
  const run = currentDurableModelRun();
  // Changes outside an active run are not attributed to an unrelated turn.
  if (!run || !initConfig) return;
  send({ type: 'sdk_observation', observation: {
    observationId: `${sdkObservationEpoch}:${++sdkObservationSeq}`,
    sessionId: initConfig.sessionId, runOperationId: run.runOperationId, turnId: run.turnId,
    sdkSessionId, event, capturedAt: Date.now(), data,
  } });
}

function sendThinkingLevelState(): void {
  if (!sessionLifecycle.current) return;
  send({
    type: 'thinking_level_state',
    effectiveLevel: sessionLifecycle.current.thinkingLevel,
    availableLevels: sessionLifecycle.current.getAvailableThinkingLevels(),
  });
}

// Pending promises for async handshakes
const pendingPreToolUse = new PendingReplies<{ action: string; input?: Record<string, unknown>; reason?: string }>();
const pendingToolExecutions = new PendingReplies<PiProxyToolResult>();
const pendingDurableToolPrepares = new PendingReplies<{ ok: boolean; prepared?: PreparedDurableTool & { created: boolean; status: string }; reason?: string }>();
const pendingDurableToolOutcomes = new PendingReplies<{ ok: boolean; committedSeq?: number; reason?: string }>();
const pendingDurableModelPrepares = new PendingReplies<{ ok: boolean; prepared?: { operationId: string; idempotencyKey: string; created: boolean; status: string; committedSeq: number }; reason?: string }>();
const pendingDurableModelOutcomes = new PendingReplies<{ ok: boolean; committedSeq?: number; reason?: string }>();
const durableToolAccounting = new DurableToolAccounting();
const toolExecutionScheduler = new ToolExecutionScheduler();
const toolResultBudgets = new Map<string, ResultBudget>();

function rememberDurableToolBatch(message: AssistantMessage, toolBatchId: string, capacity: ReturnType<typeof requestCapacity>): void {
  const calls = message.content.filter(part => part.type === 'toolCall');
  durableToolAccounting.rememberBatch(calls, toolBatchId);
  const output = message.usage.output || 0;
  // Native writes return an acknowledgement; reads/queries need content space.
  // These tool semantics are known, rather than inferred from task intent.
  const budget = new ResultBudget(calls.map(call => ({ id: call.id,
    weight: ['write', 'Write', 'edit', 'Edit', 'MultiEdit', 'report_progress'].includes(call.name) ? 1 : 16 })),
    Math.max(0, capacity.availableInputTokens - output));
  for (const call of calls) toolResultBudgets.set(call.id, budget);
}

// Pending session MCP tool calls for completion detection

// Proxy tool definitions from main process
let proxyToolDefs: ProxyToolDef[] = [];

// Speculative prefetch for read-only tools (enables parallel execution despite Pi SDK's sequential loop).
// When the LLM emits multiple call_llm tool calls in a single message, we fire all requests
// to the main process in parallel on message_end (before executeToolCalls iterates sequentially).
// Each proxy tool's execute() then hits the cache instead of sending a new request.
// Speculative dispatch used to send proxy requests before permission and before
// a durable T1 boundary. Keep it disabled until prefetch owns the same prepare
// protocol as ordinary execution; performance must not weaken effect safety.
const PREFETCHABLE_TOOLS = new Set<string>();
const prefetchCache = new Map<string, Promise<PiProxyToolResult>>();

// ============================================================
// Prompt snapshots (trajectory request-header / prompt-diff data)
// ============================================================

/** One captured request snapshot: the effective system prompt at request time. */


const PROMPT_SNAPSHOT_LIMIT = 50;
const promptSnapshots = new Map<number, PromptSnapshot>();

/**
 * Monotonic request ordinal. NEVER derived from `promptSnapshots.size`: once
 * the bounded ring evicts the oldest entry the size stops growing, so
 * `size + 1` would repeat seqs and collide prompt-diff keys (trajectory view
 * groups requests by seq and diffs against seq - 1).
 */
let promptSnapshotSeq = 0;

/**
 * Capture the current session's effective system prompt under the next
 * request ordinal. Returns the seq so the caller can attach it to the
 * forwarded message_end event.
 */
function rememberPromptSnapshot(seq: number, prompt: string, contextSnapshot?: PromptSnapshot['contextSnapshot']): void {
  promptSnapshots.set(seq, { seq, prompt, contextSnapshot });

  // Bounded ring: drop oldest once over the cap.
  if (promptSnapshots.size > PROMPT_SNAPSHOT_LIMIT) {
    const oldest = promptSnapshots.keys().next().value;
    if (oldest !== undefined) promptSnapshots.delete(oldest);
  }
}

/**
 * Capture the request-time system prompt under the next request ordinal.
 * Returns the seq so the caller can attach it to the forwarded message_end event.
 *
 * Reads the Phaneris prompt rather than `session.systemPrompt`: Pi 0.86.0 renders
 * that getter from the SDK's structured base prompt (which appends its own
 * `<cwd>` section), while the request carries the forced Phaneris prompt.
 */
function capturePromptSnapshot(): number {
  const seq = ++promptSnapshotSeq;
  rememberPromptSnapshot(seq, getPhanerisSystemPrompt());
  return seq;
}

/** Reset snapshot state (session teardown / init). */
function clearPromptSnapshots(): void {
  promptSnapshots.clear();
  promptSnapshotSeq = 0;
}

function isPrefetchableTool(toolName: string): boolean {
  const stripped = toolName.replace(/^(mcp__session__|session__)/, '');
  return PREFETCHABLE_TOOLS.has(stripped);
}

// Flag: proxy tools changed since last session creation — session needs recreation
let toolsChanged = false;

// Callback server for call_llm
let callbackServer: http.Server | null = null;
let callbackPort = 0;

// Per-process secret for the local callback server (audit M-2). Generated at
// startup so no other process can invoke call_llm/spawn-session without it —
// the server only listens on loopback, but any local process could otherwise
// burn the user's LLM quota.
const callbackToken = randomBytes(32).toString('hex');

// ============================================================
// JSONL I/O
// ============================================================

const transport = createJsonlTransport<OutboundMessage>();
const send = transport.send;
const debugLog = transport.debug;

// Retain the legacy filter transport for explicit compatibility callers.
// Main tool results use the deterministic evidence view, never this semantic gate.
const largeResultFilter = createLargeResultFilterClient(send);
setLargeResultFilter(largeResultFilter.filter);

/** Find the most recent .jsonl session file in a directory. */
function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue;
    const fullPath = join(sessionDir, entry);
    const mtime = statSync(fullPath).mtimeMs;
    if (!best || mtime > best.mtime) {
      best = { path: fullPath, mtime };
    }
  }
  return best?.path ?? null;
}

// ============================================================
// Callback Server (for call_llm from session MCP server)
// ============================================================

async function startCallbackServer(): Promise<void> {
  if (callbackServer) return;

  const server = http.createServer(async (req, res) => {
    // Audit M-2: every route on this server (call_llm, spawn-session) requires
    // the per-process callback token. The server is loopback-only, but any
    // local process could otherwise POST to it and burn the user's LLM quota.
    if (!guardCallbackToken(req, res, callbackToken)) return;

    if (req.method !== 'POST' || req.url !== '/call-llm') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

      debugLog('Received call_llm request via callback server');
      const result = await preExecuteCallLlm(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      debugLog(`call_llm via callback failed: ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      debugLog(`Callback server listening on 127.0.0.1:${callbackPort}`);
      resolve();
    });
    server.on('error', reject);
  });

  callbackServer = server;
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
    callbackPort = 0;
  }
}

// ============================================================
// Pi Session Management
// ============================================================

function resolvedCwd(): string {
  const wd = initConfig?.cwd || initConfig?.workingDirectory || process.cwd();
  if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
  if (wd === '~') return homedir();
  return wd;
}

/**
 * True when this session routes through a user-supplied endpoint protocol.
 *
 * `providerType === 'pi_compat'` is the routing decision (see
 * `resolveConnectionTransport` in server-core) — customEndpoint + baseUrl are
 * its *configuration*, not a second source of truth. A native Pi provider whose
 * endpoint is its own (`pi` + the provider's base URL) must route through that
 * provider, otherwise the SDK registers the provider's own URL as a custom
 * endpoint and the session runs on a text-only synthetic model while the UI
 * applies native capability rules. Undefined stays permissive for callers that
 * predate the field.
 */
function shouldPreferCustomEndpoint(config = initConfig): boolean {
  if (config?.providerType === 'pi') return false;
  return Boolean(config?.customEndpoint && config?.baseUrl?.trim());
}

/**
 * Expose the active Pi model API/provider/base URL to the interceptor process.
 * This gives the interceptor a robust routing hint (instead of brittle URL-only matching).
 */
function setInterceptorApiHints(model: { api?: string; provider?: string; baseUrl?: string } | undefined): void {
  if (!model) {
    delete process.env.PHANERIS_PI_MODEL_API;
    delete process.env.PHANERIS_PI_MODEL_PROVIDER;
    delete process.env.PHANERIS_PI_MODEL_BASE_URL;
    return;
  }

  process.env.PHANERIS_PI_MODEL_API = model.api || '';
  process.env.PHANERIS_PI_MODEL_PROVIDER = model.provider || '';
  process.env.PHANERIS_PI_MODEL_BASE_URL = model.baseUrl || '';

  debugLog(
    `[interceptor-hint] api=${process.env.PHANERIS_PI_MODEL_API || '-'} provider=${process.env.PHANERIS_PI_MODEL_PROVIDER || '-'} baseUrl=${process.env.PHANERIS_PI_MODEL_BASE_URL || '-'}`,
  );
}

/**
 * Resolve the API key for custom endpoint auth.
 * Loopback/link-local endpoints (Ollama, LM Studio) always get the
 * 'not-needed' placeholder — the real key must never be sent to a local
 * endpoint, even when a credential exists (audit M-4).
 */
function resolveCustomEndpointApiKey(): string {
  const key = resolveCustomEndpointApiKeyFor(initConfig);
  if (!key && initConfig?.baseUrl) {
    debugLog('[custom-endpoint] Warning: no API key found for non-localhost endpoint — requests will likely fail');
  }
  return key;
}

/** Model IDs currently registered under the custom-endpoint provider */
let customEndpointModelIds: Set<string> = new Set();

/**
 * Register (or re-register) the custom-endpoint provider with the given models.
 * Note: registerProvider replaces the entire provider, so we maintain a Set of all
 * known model IDs and always pass the full set.
 */
const customModelOverrides = new Map<string, CustomEndpointModelOverrides>();

function registerCustomEndpointModels(
  registry: PiModelRegistry,
  api: CustomEndpointApi,
  baseUrl: string,
  models: CustomEndpointModelEntry[],
): void {
  // Audit M-4: only http/https custom endpoint base URLs are supported.
  // Reject anything else with a clear error instead of letting the Pi SDK
  // attempt requests against an unsupported scheme (or worse, a file:/data:
  // URL with the user's real key attached).
  if (!hasSupportedBaseUrlScheme(baseUrl)) {
    throw new Error(
      `Custom endpoint baseUrl "${baseUrl}" uses an unsupported scheme — only http:// and https:// URLs are allowed.`,
    );
  }
  for (const m of models) {
    customEndpointModelIds.add(m.id);
    if (
      m.contextWindow !== undefined
      || m.maxTokens !== undefined
      || m.supportsImages !== undefined
      || m.supportsThinking !== undefined
      || m.thinkingLevelMap !== undefined
      || m.inputLimits !== undefined || m.promptCache !== undefined || m.cost !== undefined
    ) {
      customModelOverrides.set(m.id, {
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        ...(m.supportsImages !== undefined ? { supportsImages: m.supportsImages } : {}),
        ...(m.supportsThinking !== undefined ? { supportsThinking: m.supportsThinking } : {}),
        ...(m.thinkingLevelMap !== undefined ? { thinkingLevelMap: m.thinkingLevelMap } : {}),
        ...(m.inputLimits ? { inputLimits: m.inputLimits } : {}),
        ...(m.promptCache ? { promptCache: m.promptCache } : {}),
        ...(m.cost ? { cost: m.cost } : {}),
      });
    }
  }
  const allIds = [...customEndpointModelIds];
  registry.registerProvider('custom-endpoint', {
    baseUrl,
    apiKey: resolveCustomEndpointApiKey(),
    api,
    authHeader: true,
    models: allIds.map(id => buildCustomEndpointModelDef(
      id,
      { supportsImages: initConfig!.customEndpoint?.supportsImages === true, baseUrl },
      customModelOverrides.get(id),
      api,
    )),
  });
  debugLog(`Registered custom endpoint: ${baseUrl} with ${allIds.length} model(s) [${allIds.join(', ')}], api: ${api}`);
}

/**
 * Create an in-memory credential store pre-loaded with the user's credentials
 * and a ModelRuntime backed by it. Used by both the main session and
 * ephemeral queryLlm sessions.
 */
async function createAuthenticatedRuntime(): Promise<{
  credentialStore: HostCredentialStore;
  modelRuntime: ModelRuntime;
  modelRegistry: PiModelRegistry;
}> {
  const credentialStore = await modelOwner.credentialStoreFor(initConfig, persistOAuthCredential, debugLog);

  // Create ModelRuntime with our credential store
  const modelRuntime = await ModelRuntime.create({ credentials: credentialStore, allowModelNetwork: false });

  // ModelRegistry wraps ModelRuntime for backwards-compatible operations
  const modelRegistry = new PiModelRegistry(modelRuntime);

  // Register custom endpoint models dynamically via Pi SDK's registerProvider API.
  // Gated on the same routing decision as model resolution, so a native provider
  // whose own endpoint is stored as baseUrl never becomes a custom endpoint.
  const hasCustomEndpoint = shouldPreferCustomEndpoint();
  if (hasCustomEndpoint && initConfig?.customEndpoint) {
    const { api } = initConfig.customEndpoint;
    const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
      ? initConfig.customModels
      : [initConfig.model || 'default']
    ).map(normalizeCustomEndpointModelEntry);
    customEndpointModelIds = new Set();  // Reset on fresh registry creation
    customModelOverrides.clear();
    registerCustomEndpointModels(modelRegistry, api, initConfig.baseUrl!.trim(), modelEntries);
  } else if (initConfig?.baseUrl?.trim() && !initConfig?.customEndpoint) {
    debugLog('Custom endpoint without protocol config — models may not resolve. Set customEndpoint.api for proper routing.');
  }

  return { credentialStore, modelRuntime, modelRegistry };
}

/** Extension isolation: agent dir under the session path so no global Pi extensions from ~/.pi/agent load. */
function resolveIsolatedAgentDir(): string {
  const agentDir = initConfig!.agentDir || join(initConfig!.sessionPath, '.pi-agent');
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

async function ensureSession(): Promise<AgentSession> {
  return sessionLifecycle.getOrCreate(createSession, session => {
    send({ type: 'session_id_update', sessionId: session.sessionId });
    sendThinkingLevelState();
  });
}

async function createSession(): Promise<AgentSession> {
  if (sessionLifecycle.current) return sessionLifecycle.current;
  if (!initConfig) throw new Error('Cannot create session: init not received');

  const cwd = resolvedCwd();

  const { modelRuntime, modelRegistry } = await createAuthenticatedRuntime();
  // Store at module scope for set_model handler
  modelOwner.publish(modelRuntime, modelRegistry);

  // Build tools: coding tools + web tools wrapped with permission hooks + proxy tools.
  // Search provider is selected based on the user's LLM connection:
  //   - OpenAI/OpenRouter → Responses API built-in web_search
  //   - ChatGPT Plus (openai-codex) → ChatGPT backend responses endpoint
  //   - Google → Gemini API with googleSearch grounding
  //   - Others → DuckDuckGo fallback
  //
  // IMPORTANT: resolve dynamically on each search call so token_update refreshes
  // are used without recreating the session.
  const searchProvider = {
    get name() {
      return resolveSearchProvider({
        ...initConfig?.piAuth,
        apiBase: initConfig?.baseUrl,
      }).name;
    },
    async search(query: string, count: number) {
      return resolveSearchProvider({
        ...initConfig?.piAuth,
        apiBase: initConfig?.baseUrl,
      }).search(query, count);
    },
  };
  const searchTool = createSearchTool(searchProvider);
  const webFetchTool = createWebFetchTool(() =>
    initConfig ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId) : null
  );
  // Pi SDK exposes custom tools to the model under the `mcp__session__`
  // namespace and resolves executions by that exposed name. Register with the
  // prefix baked in (same contract as the proxy tools built below); otherwise
  // the tools appear in the model's list as mcp__session__web_search but the
  // registry lookup misses (registered bare) → "Tool … not found" on every call.
  // 0.85.0: ToolDefinition.renderCall takes contravariant `unknown` args, so
  // spreading typed tools yields anonymous types that fail that check.
  // Renaming doesn't alter structure — assert back to the contract type.
  const webTools: ToolDefinition<any, any>[] = [searchTool, webFetchTool].map((tool) => ({
    ...tool,
    name: `mcp__session__${tool.name}`,
  }) as ToolDefinition<any, any>);

  // Pi SDK 0.70.0 registration contract:
  //   - `customTools` accepts ToolDefinition[] — our hook-wrapped objects go here
  //   - `tools` is a string[] name allowlist — MUST include every tool we want active,
  //     otherwise Pi SDK defaults to the built-in [read, bash, edit, write] set and
  //     silently filters out everything else. Custom tool names with matching built-in
  //     names override the SDK's raw implementation inside _refreshToolRegistry, so
  //     our hooked versions take effect (permissions + large-response summarization).
  //   - Do NOT pass tool *objects* to `tools` — `allowedToolNames = new Set(options.tools)`
  //     then `.has(name)` returns false for every string lookup → zero tools active.
  const builtinDefs = [
    createReadToolDefinition(cwd, { operations: { readFile: readFileWithEvidence, access: accessReadFile, detectImageMimeType: async path => {
      const mime = await detectSupportedImageMimeTypeFromFile(path);
      const capture = readCapture.getStore();
      if (capture) capture.image = !!mime;
      return mime;
    } } }),
    process.platform === 'win32'
      ? createPowerShellToolDefinition(cwd)
      : createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
  const proxyTools = buildProxyTools();
  // report_progress is local, read-only and intentionally bypasses the
  // permission handshake: it is a presentation channel, not an external action.
  const wrappedAll = [
    ...wrapToolsWithHooks([...builtinDefs, ...webTools, ...proxyTools]),
    createReportProgressTool(),
  ];
  const catalog = composeToolCatalog([wrappedAll], ['tool_search', 'codemode']);
  debugLog(`Session tools: ${builtinDefs.length} builtin + ${webTools.length} web + ${proxyTools.length} proxy + 1 progress = ${wrappedAll.length} total`);

  // Build session options.
  // settingsManager: explicit in-memory settings (retry policy, compaction)
  // instead of the SDK default that merges `<cwd>/.pi/settings.json` from the
  // user's working directory and writes to `<agentDir>/settings.json`.
  const mutableSettings = createMutablePhanerisSettingsManager('main');
  const mainSettings = mutableSettings.settings;
  let ownedSession: AgentSession | undefined;
  const compactionController = new CompactionThresholdController(mainSettings, () => sessionLifecycle.current === ownedSession ? ownedSession : undefined, mutableSettings.writeCompactionReserve);
  const sessionOptions: CreateAgentSessionOptions = {
    cwd,
    modelRuntime,
    customTools: [...catalog.customTools],
    tools: [...catalog.allowlist],
    excludeTools: initConfig.browserToolEnabled === false ? ['mcp__session__browser_tool'] : undefined,
    resourceLoader: await createPhanerisResourceLoader({ cwd, agentDir: resolveIsolatedAgentDir(), settingsManager: mainSettings, observeLifecycle: observeSdkLifecycle,
      installCompaction: pi => {
        compactionController.install(pi);
        pi.on('session_compact', event => {
          if (ownedSession && initConfig) recordCanonicalCompaction(ownedSession.sessionManager, event.compactionEntry.id,
            JSON.stringify([initConfig.workspaceRootPath, initConfig.sessionId]), lastCanonicalCoveredSeq);
        });
      },
      wrapOrchestrationTool: wrapSingleTool,
      productTools: () => proxyToolDefs,
      gateToolCall: async (toolName, input, toolCallId) => { await requestPreToolUseApproval(PI_TOOL_NAME_MAP[toolName] || toolName, input, toolCallId, true); } }),
    settingsManager: mainSettings,
  };

  // Extension isolation: set agentDir to a temp directory under session path
  // to prevent loading global Pi extensions from ~/.pi/agent
  if (initConfig.sessionPath) {
    sessionOptions.agentDir = resolveIsolatedAgentDir();

    // Session resume: use a per-Phaneris-session directory so the Pi SDK can
    // persist and resume its own session across subprocess restarts.
    // continueRecent() loads the existing session if one exists, otherwise
    // creates a new one — so this handles both first-run and resume.
    const sessionDir = join(initConfig.sessionPath, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });

    if (initConfig.branchFromSessionPath) {
      // Branching: fork from the parent session's Pi session file.
      // Branches must not silently degrade to fresh sessions.
      const parentPiSessionDir = join(initConfig.branchFromSessionPath, '.pi-sessions');
      const parentPiSessionFile = findMostRecentSessionFile(parentPiSessionDir);
      if (!parentPiSessionFile) {
        throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentPiSessionDir}`);
      }

      debugLog(`Forking Pi session from parent: ${parentPiSessionFile}`);
      const forkedSessionManager = PiSessionManager.forkFrom(parentPiSessionFile, cwd, sessionDir);

      // Strict branch cutoff: move leaf to the selected parent entry if provided.
      // This is Pi's equivalent of Claude resumeSessionAt.
      if (initConfig.branchFromSdkTurnId) {
        const anchorId = initConfig.branchFromSdkTurnId;
        const anchorEntry = forkedSessionManager.getEntry(anchorId);
        if (!anchorEntry) {
          throw new Error(`Pi branch preflight failed: branch anchor not found: ${anchorId}`);
        }
        forkedSessionManager.branch(anchorId);
        debugLog(`Applied Pi branch cutoff at entry: ${anchorId}`);
      }

      sessionOptions.sessionManager = protectBrowserJournal(forkedSessionManager);
    } else {
      sessionOptions.sessionManager = protectBrowserJournal(PiSessionManager.continueRecent(cwd, sessionDir));
    }

  }

  // Set model if specified
  if (initConfig.model) {
    const piModel = resolvePiModel(modelRegistry, initConfig.model, initConfig.piAuth?.provider, shouldPreferCustomEndpoint());
    if (!piModel && initConfig.piAuth) throw new Error(`Configured model ${initConfig.model} is unavailable for provider ${initConfig.piAuth.provider}; select a model on this connection.`);
    if (piModel && initConfig.piAuth && piModel.provider !== initConfig.piAuth.provider && piModel.provider !== 'custom-endpoint') {
      throw new Error(`Configured model resolves to an incompatible provider: ${piModel.provider}`);
    }
    sessionOptions.model = piModel;
    setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string } | undefined);
  } else {
    setInterceptorApiHints(undefined);
  }

  // Set thinking level
  const piThinkingLevel = THINKING_TO_PI[initConfig.thinkingLevel as keyof typeof THINKING_TO_PI];
  if (piThinkingLevel) {
    sessionOptions.thinkingLevel = piThinkingLevel;
  }

  // Create the session — tools flow through customTools + allowlist (see comment above).
  const { session } = await createAgentSession(sessionOptions);
  ownedSession = session;
  compactionControllers.set(session, compactionController);
  await compactionController.update(initConfig.compactionThresholdTokens ?? null, session.model);
  if (sessionOptions.model && (session.agent.state.model.provider !== sessionOptions.model.provider || session.agent.state.model.id !== sessionOptions.model.id)) {
    session.dispose();
    throw new Error('Pi resumed a different model or provider than the configured connection; reselect the model before continuing.');
  }
  const availableNames = new Set([...catalog.customTools.filter(tool => tool.exposure !== 'hidden').map(tool => tool.name), ...catalog.activeNames]);
  const restoredToolNames = getCurrentTools(session.sessionManager.buildSessionContext().messages).map(tool => tool.name).filter(name => availableNames.has(name));
  session.setActiveToolsByName([...new Set([...catalog.activeNames, ...restoredToolNames])]);
  // Ordinary requests keep their existing boundary. SDK background refreshes
  // use a distinct boundary and never publish assistant/tool output.
  const sessionStream = installCacheWarmingAccounting(
    modelRuntime, session.agent.streamFunction,
    stream => withDurableAccounting(stream, 'cache_warm'),
  );
  contextPolicy = initConfig?.contextPolicy ?? 'compact';
  session.setAutoCompactionEnabled(contextPolicy === 'compact');
  session.agent.streamFunction = createContextPolicyStream(
    withDurableAccounting(sessionStream, () => session.isCompacting ? 'compaction' : undefined),
    () => contextPolicy,
    signal => send({ type: 'context_handoff', signal }),
    () => { const forced = forcedContextHandoff; forcedContextHandoff = false; return forced },
    () => session.settingsManager.getCompactionSettings(session.model).reserveTokens,
    () => readContextUsage(session).contextUsage?.tokens,
  );
  session.setCacheWarmingMode(initConfig?.promptCacheWarming === true ? 'streaming' : 'off');

  toolsChanged = false;
  debugLog(`Created Pi session: ${session.sessionId} (${wrappedAll.length} tools)`);


  return session;
}


// ============================================================
// Tool Wrapping (Permission Enforcement + Large Response Summarization)
// ============================================================

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
/**
 * Send pre_tool_use_request to main process and wait for response.
 * Returns the (potentially modified) input if approved, throws if blocked.
 * All permission checking, transforms, and source activation happen in the main process.
 */
async function requestPreToolUseApproval(
  sdkToolName: string,
  input: Record<string, unknown>,
  toolCallId?: string,
  policyOnly = false,
): Promise<Record<string, unknown>> {
  const requestId = `pi-ptu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  send({
    type: 'pre_tool_use_request',
    requestId,
    toolName: sdkToolName,
    ...(toolCallId ? { toolCallId } : {}),
    input,
    policyOnly,
  });

  const response = await new Promise<{ action: string; input?: Record<string, unknown>; reason?: string }>((resolve) => {
    pendingPreToolUse.register(requestId, resolve);
  });

  if (response.action === 'block') {
    throw new Error(response.reason || `Tool "${sdkToolName}" is not allowed`);
  }

  return response.action === 'modify' && response.input ? response.input : input;
}

interface PreparedDurableTool {
  operationId: string;
  idempotencyKey: string;
  canonicalArgsHash: string;
  recoveryMode: ToolRecoveryMode;
  toolBatchId?: string;
  toolBatchOrdinal?: number;
  committedSeq: number;
}

async function requestDurableToolPrepare(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId: string,
): Promise<PreparedDurableTool> {
  if (!initConfig || !currentDurableRunOperationId || !currentDurableTurnId) {
    throw new Error(`Durable tool boundary is unavailable for "${toolName}"`);
  }
  const requestId = `pi-durable-t1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const batch = durableToolAccounting.readBatch(toolCallId);
  const responsePromise = new Promise<{ ok: boolean; prepared?: PreparedDurableTool & { created: boolean; status: string }; reason?: string }>((resolve) => {
    pendingDurableToolPrepares.register(requestId, resolve);
  });
  send({
    type: 'durable_tool_prepare_request',
    requestId,
    sessionId: initConfig.sessionId,
    turnId: currentDurableTurnId,
    runOperationId: currentDurableRunOperationId,
    providerToolCallId: toolCallId,
    ...batch,
    toolName,
    args: input,
  });
  const response = await responsePromise;
  if (!response.ok || !response.prepared) {
    throw new Error(response.reason || `Durable T1 failed for "${toolName}"`);
  }
  if (!response.prepared.created) {
    throw new Error(`Tool operation ${response.prepared.operationId} already crossed T1 and requires recovery`);
  }
  durableToolAccounting.rememberCommit(toolCallId, {
    operationId: response.prepared.operationId,
    startSeq: response.prepared.committedSeq,
  });
  return response.prepared;
}

async function requestDurableToolOutcome(
  prepared: PreparedDurableTool,
  toolName: string,
  toolCallId: string,
  result: unknown,
  isError: boolean,
): Promise<number> {
  if (!initConfig || !currentDurableRunOperationId || !currentDurableTurnId) {
    throw new Error(`Durable tool outcome boundary is unavailable for "${toolName}"`);
  }
  const requestId = `pi-durable-t2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responsePromise = new Promise<{ ok: boolean; committedSeq?: number; reason?: string }>((resolve) => {
    pendingDurableToolOutcomes.register(requestId, resolve);
  });
  send({
    type: 'durable_tool_outcome_request',
    requestId,
    sessionId: initConfig.sessionId,
    turnId: currentDurableTurnId,
    runOperationId: currentDurableRunOperationId,
    operationId: prepared.operationId,
    providerToolCallId: toolCallId,
    toolBatchId: prepared.toolBatchId,
    toolBatchOrdinal: prepared.toolBatchOrdinal,
    toolName,
    canonicalArgsHash: prepared.canonicalArgsHash,
    result,
    isError,
  });
  const response = await responsePromise;
  if (!response.ok) throw new Error(response.reason || `Durable T2 failed for "${toolName}"`);
  if (response.committedSeq === undefined) throw new Error(`Durable T2 returned no commit sequence for "${toolName}"`);
  durableToolAccounting.rememberCommit(toolCallId, {
    operationId: prepared.operationId,
    startSeq: prepared.committedSeq,
    outcomeSeq: response.committedSeq,
  });
  return response.committedSeq;
}

interface PreparedDurableModel {
  operationId: string;
  idempotencyKey: string;
  committedSeq: number;
}

async function requestDurableModelPrepare(
  providerRequestId: string,
  provider: string,
  model: string,
  canonicalRequestHash: string,
  purpose?: 'cache_warm' | 'compaction',
  durableRun = currentDurableModelRun(),
): Promise<PreparedDurableModel> {
  if (!initConfig || !durableRun) {
    throw new Error('Durable model boundary is unavailable');
  }
  const requestId = `pi-model-t1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responsePromise = new Promise<{ ok: boolean; prepared?: PreparedDurableModel & { created: boolean; status: string }; reason?: string }>((resolve) => {
    pendingDurableModelPrepares.register(requestId, resolve);
  });
  send({
    type: 'durable_model_prepare_request',
    purpose,
    requestId,
    sessionId: initConfig.sessionId,
    turnId: durableRun.turnId,
    runOperationId: durableRun.runOperationId,
    providerRequestId,
    provider,
    model,
    canonicalRequestHash,
  });
  const response = await responsePromise;
  if (!response.ok || !response.prepared) throw new Error(response.reason || 'Durable model T1 failed');
  if (!response.prepared.created) {
    throw new Error(`Model operation ${response.prepared.operationId} already crossed T1 and requires recovery`);
  }
  return response.prepared;
}

async function requestDurableModelOutcome(input: {
  prepared: PreparedDurableModel;
  purpose?: 'cache_warm' | 'compaction';
  durableRun?: { runOperationId: string; turnId: string };
  providerRequestId: string;
  provider: string;
  model: string;
  canonicalRequestHash: string;
  message: AssistantMessage;
  requestObservation?: import('@phaneris/shared/durable-runtime/types').NativeRequestObservation;
}): Promise<number> {
  const metering = modelMetering(input.message, input.requestObservation);
  const completeMetering = metering.inputKnown && metering.outputKnown;
  const durableRun = input.durableRun ?? currentDurableModelRun();
  if (!initConfig || !durableRun) {
    throw new Error('Durable model outcome boundary is unavailable');
  }
  const requestId = `pi-model-t2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const responsePromise = new Promise<{ ok: boolean; committedSeq?: number; reason?: string }>((resolve) => {
    pendingDurableModelOutcomes.register(requestId, resolve);
  });
  send({
    type: 'durable_model_outcome_request',
    purpose: input.purpose,
    requestId,
    sessionId: initConfig.sessionId,
    turnId: durableRun.turnId,
    runOperationId: durableRun.runOperationId,
    operationId: input.prepared.operationId,
    providerRequestId: input.providerRequestId,
    provider: input.provider,
    model: input.model,
    canonicalRequestHash: input.canonicalRequestHash,
    stopReason: input.message.stopReason,
    responseId: input.message.responseId,
    requestObservation: input.requestObservation,
    content: input.purpose ? [] : input.message.content,
    text: input.purpose ? '' : input.message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join(''),
    usage: {
      inputTokens: metering.inputKnown ? input.message.usage.input : undefined,
      outputTokens: metering.outputKnown ? input.message.usage.output : undefined,
      costUsd: completeMetering ? input.message.usage.cost.total : undefined,
      payload: {
        kind: input.purpose ?? 'model_attempt', requestSeq: Number(input.providerRequestId),
        usage: metering.status === 'unavailable' ? undefined : input.message.usage,
        metering,
        assistantMetrics: (input.message as AssistantMessage & { assistantMetrics?: import('@phaneris/core/types').AssistantMetrics }).assistantMetrics,
        costSource: completeMetering ? 'pi_sdk_estimate' : 'unknown', responseModel: input.message.responseModel,
        providerThinkingLevel: input.message.providerThinkingLevel,
      },
    },
  });
  const response = await responsePromise;
  if (!response.ok || response.committedSeq === undefined) {
    throw new Error(response.reason || 'Durable model T2 failed');
  }
  return response.committedSeq;
}

function wrapToolsWithHooks(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
  return tools.map(tool => wrapSingleTool(tool));
}

function wrapSingleTool(tool: ToolDefinition<any, any>): ToolDefinition<any, any> {
  const originalExecute = tool.execute;
  const parameters = tool.parameters;

  const wrappedExecute: ToolDefinition<any, any>['execute'] = async (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => {
    const sdkToolName = PI_TOOL_NAME_MAP[tool.name] || tool.name;
    let inputObj: Record<string, unknown> = { ...(params as Record<string, unknown>) };
    const resources = toolExecutionResources(tool.name, params as Record<string, unknown>,
      initConfig?.workingDirectory || initConfig?.workspaceRootPath || process.cwd(),
      tool.name.startsWith('mcp__session__') && proxyToolDefs.some(def => def.name === tool.name && def.readOnly === true));
    const preflight = async () => {
      // Normalize Pi SDK parameter names: path → file_path
      if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
          && typeof inputObj.path === 'string' && !inputObj.file_path) {
        inputObj = { ...inputObj, file_path: inputObj.path };
      }

      // Send to main process for permission checking + transforms
      // Orchestration has no ambient effects. Its nested tools take the ordinary
      // permission path individually; author-supplied annotations cannot skip it.
      if (sdkToolName !== 'codemode' && sdkToolName !== 'tool_search') {
        inputObj = await requestPreToolUseApproval(sdkToolName, inputObj, toolCallId);
      }

      // Metadata is for the Phaneris UI only. Keep a final defensive strip here so the
      // upstream Pi tool implementation always receives clean executable args,
      // even if a future pre-tool-use path returns `allow` without modification.
      inputObj = stripPhanerisMetadata(inputObj);
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(sdkToolName) && typeof inputObj.file_path === 'string') {
        inputObj.path = inputObj.file_path;
      }
      const approvedResources = toolExecutionResources(tool.name, inputObj,
        initConfig?.workingDirectory || initConfig?.workspaceRootPath || process.cwd(),
        tool.name.startsWith('mcp__session__') && proxyToolDefs.some(def => def.name === tool.name && def.readOnly === true));
      if (JSON.stringify(approvedResources) !== JSON.stringify(resources)) {
        throw new Error(`Execution target changed during preflight; operation not dispatched. Retry using the approved target ${String(inputObj.path ?? inputObj.file_path ?? '')}.`);
      }
      signal?.throwIfAborted();
    };
    return toolExecutionScheduler.run(resources, signal, async () => {
      signal?.throwIfAborted();
      if (toolResultBudgets.get(toolCallId)?.canDispatch === false) throw new Error('Insufficient context for this tool batch; operation not dispatched. Compact or reduce the batch before retrying.');

      // T1 must commit after preflight and before the implementation is allowed to run.
      if (sdkToolName === 'Read') for (const key of ['offset', 'limit']) {
        if (inputObj[key] !== undefined && (!Number.isSafeInteger(inputObj[key]) || Number(inputObj[key]) < 1)) {
          throw new Error(`Read ${key} must be a positive integer; operation not dispatched.`);
        }
      }
      const durable = await requestDurableToolPrepare(sdkToolName, inputObj, toolCallId);

      // Execute original tool with (potentially modified) input. T2 commits before
      // the result is returned to Pi, so the next model request cannot outrun durability.
      let result: AgentToolResult<any>;
      const capturedRead: { path?: string; buffer?: Buffer } = {};
      try {
        const durableTool: DurableToolExecutionIdentity = {
          operationId: durable.operationId,
          runOperationId: currentDurableRunOperationId!,
          idempotencyKey: durable.idempotencyKey,
          canonicalArgsHash: durable.canonicalArgsHash,
          recoveryMode: durable.recoveryMode,
          toolBatchId: durable.toolBatchId,
          toolBatchOrdinal: durable.toolBatchOrdinal,
        };
        const executionContext = attachDurableToolContext(ctx, durableTool) as typeof ctx;
        signal?.throwIfAborted();
        result = await readCapture.run(capturedRead, () => originalExecute(toolCallId, inputObj, signal, onUpdate, executionContext));
      } catch (error) {
        // An aborted proxy may still be executing in the host/provider. Leave T1
        // pending for reconciliation rather than assert an unobserved T2 failure.
        if (signal?.aborted) throw error;
        await requestDurableToolOutcome(
          durable,
          sdkToolName,
          toolCallId,
          { error: error instanceof Error ? error.message : String(error) },
          true,
        );
        throw error;
      }
      // --- Post-execute: deterministic model view and original evidence ---

      const resultText = result.content
        .filter((c): c is PiTextContent => c.type === 'text')
        .map(c => c.text)
        .join('');

      // Compatibility guard for legacy/custom tools that encode failure in
      // details instead of throwing. Pi only sets toolResult.isError for thrown
      // executions, so commit the durable outcome and convert it here.
      if (result.details?.isError === true) {
        await requestDurableToolOutcome(
          durable,
          sdkToolName,
          toolCallId,
          result,
          true,
        );
        throw new Error(resultText || `${sdkToolName} failed`);
      }

      const prepareView = async (budgetChars: number) => initConfig ? await prepareToolResultView({ result,
        toolName: sdkToolName, input: inputObj, sessionPath: getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId),
        budgetChars, capture: capturedRead, supportsImages: sessionLifecycle.current?.model?.input.includes('image') }) as AgentToolResult<any> : result;
      result = await (toolResultBudgets.get(toolCallId)?.project(toolCallId, prepareView) ?? prepareView(48_000));

      // Commit exactly the representation Pi will append to model context.
      const outcomeSeq = await requestDurableToolOutcome(
        durable,
        sdkToolName,
        toolCallId,
        result,
        false,
      );
      // Public result details survive the SDK's tool-message journal adapter.
      // This receipt describes the represented outcome, never input delivery.
      result = { ...result, details: { ...result.details, phanerisDurableSeq: outcomeSeq,
        phanerisDurableScope: JSON.stringify([initConfig!.workspaceRootPath, initConfig!.sessionId]) } };
      // Handoff is a successful tool boundary. Keep T2 before SDK abort, and
      // abort synchronously so no follow-up model request outruns the UI pause.
      if (handsControlToUI(sdkToolName) && result.details?.continuation === 'await_user') sessionLifecycle.current?.agent.abort();
      return result;
    }, preflight).finally(() => { toolResultBudgets.get(toolCallId)?.finish(toolCallId); toolResultBudgets.delete(toolCallId); });
  };

  return {
    ...tool,
    parameters,
    // Accept legacy UI-only keys without advertising them in new model schemas.
    prepareArguments: args => stripPhanerisMetadata(tool.prepareArguments ? tool.prepareArguments(args) : args),
    // The SDK makes a batch containing a potential UI handoff sequential. Its
    // loop stops after a confirmed wait, before later calls acquire T1.
    executionMode: handsControlToUI(tool.name) ? 'sequential' : tool.executionMode,
    execute: wrappedExecute,
  };
}

// ============================================================
// Proxy Tools (tools executed in main process)
// ============================================================

function buildProxyTools(): ToolDefinition<any, any>[] {
  debugLog(`Building proxy tools from ${proxyToolDefs.length} definitions: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  return proxyToolDefs.map<ToolDefinition<any, any>>(def => ({
    name: def.name,
    label: def.name
      .replace(/^mcp__.*?__/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: def.description,
    // SDK prompt metadata; model-call schemas carry the full tool definition.
    // Phaneris independently owns the system prompt through its resource loader.
    promptSnippet: def.description.length > 200
      ? def.description.slice(0, 197) + '...'
      : def.description,
    parameters: def.inputSchema,
    exposure: def.exposure,
    namespace: def.namespace,
    annotations: def.annotations,
    ...(def.namespace ? { outputSchema: createProxyMcpResultSchema(def.outputSchema) } : def.outputSchema ? { outputSchema: def.outputSchema } : {}),
    execute: async (
      toolCallId: string,
      params: any,
      signal,
      _onUpdate,
      ctx,
    ): Promise<AgentToolResult<any>> => {
      // Check speculative prefetch cache first (parallel call_llm optimization).
      // If this tool was prefetched on message_end, the request is already in-flight —
      // just await the result instead of sending a duplicate request.
      const prefetched = prefetchCache.get(toolCallId);
      if (prefetched) {
        prefetchCache.delete(toolCallId);
        debugLog(`Prefetch cache hit for ${def.name} (toolCallId: ${toolCallId})`);
        const result = await prefetched;
        if (result.isError) throw new Error(result.content);
        return proxyResultToSdk(def, result);
      }

      const inputObj = params as Record<string, unknown>;

      // wrapSingleTool already confirmed and transformed these exact arguments.
      const approvedInput = inputObj;

      // Execute via main process
      const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      signal?.throwIfAborted();
      send({
        type: 'tool_execute_request',
        requestId,
        toolCallId,
        toolName: def.name,
        args: approvedInput,
        durableTool: durableToolFromContext(ctx),
      });

      const result = await new Promise<PiProxyToolResult>((resolve, reject) => {
        const abort = () => {
          pendingToolExecutions.delete(requestId);
          send({ type: 'tool_execute_cancel', requestId });
          reject(new DOMException('Tool execution aborted; external outcome is unknown', 'AbortError'));
        };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        pendingToolExecutions.register(requestId, result => {
          signal?.removeEventListener('abort', abort);
          resolve(result);
        });
      });

      if (result.isError) throw new Error(result.content);

      return proxyResultToSdk(def, result);
    },
  }));
}

function proxyResultToSdk(def: ProxyToolDef, result: PiProxyToolResult): AgentToolResult<any> {
  const structured = def.namespace ? {
    content: result.contentBlocks ?? [{ type: 'text', text: result.content }],
    isError: result.isError,
    ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
  } : result.structuredContent;
  return {
    content: result.contentBlocks?.length ? result.contentBlocks.map(block => block.type === 'text' || block.type === 'image'
      ? block as unknown as PiTextContent | PiImageContent : { type: 'text' as const, text: JSON.stringify(block) }) : [{ type: 'text', text: result.content }],
    details: result.continuation ? { continuation: result.continuation } : undefined,
    // The JSONL transport has already validated JSON serializability.
    ...(structured !== undefined ? { structuredContent: structured as AgentToolResult<any>['structuredContent'] } : {}),
  };
}

/**
 * A first-class progress channel for agentic runs.
 *
 * Pi treats a prose-only assistant message as the end of an agent loop. Models
 * should use this tool when they need to surface an update and then keep
 * working: the tool call keeps the native Pi loop alive, while the main-process
 * event adapter renders `message` as intermediate assistant text.
 */
function createReportProgressTool(): ToolDefinition<any, any> {
  return {
    name: 'report_progress',
    label: 'Report progress',
    description: 'Show a brief progress update to the user without ending the current task. Call this only when work remains, then continue immediately with the next tool or action.',
    promptSnippet: 'Report visible progress without ending the active task.',
    parameters: Type.Object({
      message: Type.String({ description: 'A concise, user-facing progress update.' }),
    }),
    execute: async () => ({
      content: [{
        type: 'text',
        text: 'Progress delivered. Continue the task immediately; do not wait for a user reply.',
      }],
      details: undefined,
    }),
  };
}

// ============================================================
// LLM Query (ephemeral session for call_llm + mini completions)
// ============================================================

async function queryLlm(
  request: LLMQueryRequest,
  lifecycle: EphemeralQueryContext,
): Promise<LLMQueryResult> {
  lifecycle.throwIfCancelled();
  if (!initConfig) throw new Error('Cannot run queryLlm: init not received');

  debugLog('[queryLlm] Starting');

  // Pick mini model. If the configured miniModel uses a different provider than
  // what the user authenticated with (e.g. gemini-2.5-pro when only anthropic
  // credentials exist), fall back to the default summarization model which uses
  // the same provider family.
  let model = request.model ?? initConfig.miniModel ?? getDefaultSummarizationModel();
  // Create authenticated runtime — used by both the provider guard and the ephemeral session.
  const { modelRuntime, modelRegistry } = await createAuthenticatedRuntime();
  lifecycle.throwIfCancelled();

  const piAuthProvider = initConfig.piAuth?.provider;

  // If piAuth is set, ensure the mini model uses the same provider.
  // Pi SDK will fail with "No API key found" if the model requires a different provider.
  // Exception: 'custom-endpoint' provider is always compatible because it has its own
  // API key configured via resolveCustomEndpointApiKey() and doesn't use authStorage.
  if (initConfig.piAuth) {
    const authProvider = initConfig.piAuth.provider;
    const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
    const resolved = resolvePiModel(modelRegistry, bareModel, authProvider, shouldPreferCustomEndpoint());
    const resolvedProvider = (resolved as any)?.provider;
    const isCompatible = resolvedProvider === authProvider || resolvedProvider === 'custom-endpoint';
    if (!resolved || !isCompatible || isDeniedMiniModelId(model, piAuthProvider)) {
      // Anthropic: keep Haiku (the cheap/fast mini). For every other provider
      // Haiku is unresolvable, so walk PI_PREFERRED_DEFAULTS for a model that
      // actually works under the user's auth.
      const providerDefault = authProvider === 'anthropic'
        ? undefined
        : pickProviderAppropriateMiniModel(authProvider, modelRegistry, shouldPreferCustomEndpoint());
      const fallback = providerDefault ?? getDefaultSummarizationModel();
      debugLog(`[queryLlm] Model ${bareModel} incompatible with ${authProvider} (resolved: ${resolvedProvider}), falling back to ${fallback}`);
      model = fallback;
    }
  }

  const runQueryWithModel = async (modelId: string): Promise<string> => {
    lifecycle.throwIfCancelled();
    debugLog(`[queryLlm] Using model: ${modelId}`);

    // Resolve model — fail fast if unresolvable so we don't let the Pi SDK
    // fall back to its own internal default (which may require a provider
    // the user hasn't authenticated with, surfacing as a misleading
    // "No API key found for <provider>" error).
    const piModel = resolvePiModel(modelRegistry, modelId, initConfig!.piAuth?.provider, shouldPreferCustomEndpoint());
    if (!piModel) {
      throw new Error(
        `Could not resolve mini model "${modelId}" for provider "${initConfig!.piAuth?.provider ?? '(unknown)'}"`,
      );
    }

    // Prompt for this ephemeral session, captured before loader creation so the
    // loader's getPrompt closure reads it (TDZ-safe) and never touches the
    // module-level prompt used by the main session.
    const promptForSession =
      request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.';

    // Create minimal ephemeral session
    const ephemeralSettings = createPhanerisSettingsManager('ephemeral');
    const ephemeralOptions: CreateAgentSessionOptions = {
      cwd: resolvedCwd(),
      agentDir: resolveIsolatedAgentDir(),
      modelRuntime,
      tools: [],
      sessionManager: PiSessionManager.inMemory(),
      settingsManager: ephemeralSettings,
      model: piModel,
      resourceLoader: await createPhanerisResourceLoader({
        cwd: resolvedCwd(),
        agentDir: resolveIsolatedAgentDir(),
        settingsManager: ephemeralSettings,
        getPrompt: () => promptForSession,
        observeLifecycle: observeSdkLifecycle,
      }),
    };

    const { session: ephemeralSession } = await createAgentSession(ephemeralOptions);
    ephemeralSession.agent.streamFunction = withDurableAccounting(ephemeralSession.agent.streamFunction, () => ephemeralSession.isCompacting ? 'compaction' : undefined);
    const resource: EphemeralQueryResource = {
      abort: () => ephemeralSession.abort(),
      dispose: () => ephemeralSession.dispose(),
    };
    lifecycle.setResource(resource);

    let unsub: (() => void) | undefined;
    try {
      // Pi SDK ignores options.model for ephemeral sessions (same issue as options.tools).
      // Explicitly set the model after creation to ensure the mini model is used.
      // A failed selection must never execute the SDK's unrelated default model.
      await ephemeralSession.setModel(piModel);
      lifecycle.throwIfCancelled();

      debugLog(`[queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

      // The session prompt comes from the loader's `getPrompt` and the inline
      // `before_agent_start` hook (see phaneris-resource-loader.ts): Pi 0.86.0
      // keeps the prompt in the transcript's system messages and projects a
      // handler-returned prompt as the leading system message.
      const promptForSession =
        request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.';

      // Collect response text and errors from events. `prompt()` resolves only
      // after SDK retries/continuations settle, so the request-level coordinator
      // owns the one actual deadline around this call.
      let result = '';
      let lastError = '';

      unsub = ephemeralSession.subscribe((event: AgentSessionEvent) => {
        observeNativeSessionEvent(event, ephemeralSession, observeSdkLifecycle);
        if (event.type !== 'message_end') return;

        // Only capture assistant messages — Pi SDK emits message_end for user messages too.
        const msg = event.message as {
          role?: string;
          content?: string | Array<{ type: string; text?: string }>;
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role !== 'assistant') return;

        // Capture API errors from message_end (e.g. auth failures, model errors).
        if (msg.stopReason === 'error' && msg.errorMessage) {
          lastError = msg.errorMessage;
          debugLog(`[queryLlm] API error in message_end: ${msg.errorMessage}`);
        }

        if (typeof msg.content === 'string') {
          result = msg.content;
        } else if (Array.isArray(msg.content)) {
          result = msg.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
            .join('');
        }
      });

      lifecycle.throwIfCancelled();
      await ephemeralSession.prompt(request.prompt);
      lifecycle.throwIfCancelled();
      debugLog(`[queryLlm] Result length: ${result.trim().length}`);

      // If we got no text but captured an error, throw so callers see the real issue.
      if (!result.trim() && lastError) {
        throw new Error(lastError);
      }

      return result.trim();
    } finally {
      unsub?.();
      lifecycle.clearResource(resource);
      ephemeralSession.dispose();
    }
  };

  // Rejection-only retry chain (cheap fallbacks → selected session model → provider
  // defaults) lives in mini-model-query.ts. `modelRegistry` is shared with the provider
  // guard above, and the surrounding EphemeralQueryCoordinator keeps the single
  // deadline/cancellation scope for every attempt.
  return queryMiniModel({
    model,
    miniModel: initConfig.miniModel,
    sessionModel: initConfig.model,
    authProvider: piAuthProvider,
    modelRegistry,
    preferCustomEndpoint: shouldPreferCustomEndpoint(),
    onFallback: (rejectedModel, retryModel) => {
      debugLog(`[queryLlm] Model ${rejectedModel} unavailable, retrying with ${retryModel}`);
    },
  }, runQueryWithModel);
}

function runEphemeralLlmQuery(
  id: string,
  request: LLMQueryRequest,
): Promise<LLMQueryResult> {
  return ephemeralQueries.run(
    id,
    PHANERIS_PI_EPHEMERAL_QUERY_DEADLINE_MS,
    lifecycle => queryLlm(request, lifecycle),
  );
}

async function preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
  const sessionPath = initConfig
    ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId)
    : undefined;
  const request = await buildCallLlmRequest(input, { backendName: 'Pi', sessionPath });
  return runEphemeralLlmQuery(nextLocalEphemeralQueryId('callback'), request);
}

async function runMiniCompletion(prompt: string): Promise<string | null> {
  try {
    const result = await runEphemeralLlmQuery(
      nextLocalEphemeralQueryId('summary'),
      { prompt },
    );
    const text = result.text || null;
    debugLog(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  } catch (error) {
    debugLog(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================================
// Event Handling
// ============================================================

const adaptSessionEvent = createSessionEventAdapter({
  currentSession: () => sessionLifecycle.current, send, debugLog, observeSdkLifecycle,
  clearCompactionFailure: () => {
    const controller = sessionLifecycle.current && compactionControllers.get(sessionLifecycle.current);
    if (controller) controller.failure = undefined;
  },
  compactionFailure: () => sessionLifecycle.current ? compactionControllers.get(sessionLifecycle.current)?.failure : undefined,
  lengthContinuationTracker, accounting: durableToolAccounting,
  diagnostics: { capturePromptSnapshot, rememberPromptSnapshot, getPhanerisSystemPrompt, promptSnapshots },
  prefetch(content) {
    const calls = content.filter(c => c.type === 'toolCall' && c.name && isPrefetchableTool(c.name));
    if (calls.length < 2) return;
    debugLog(`Prefetching ${calls.length} parallel ${calls[0].name} calls`);
    for (const tc of calls) {
      const requestId = `prefetch-${tc.id}`;
      const promise = new Promise<PiProxyToolResult>(resolve => pendingToolExecutions.register(requestId, resolve));
      send({ type: 'tool_execute_request', requestId, toolCallId: tc.id, toolName: tc.name!, args: (tc.arguments ?? {}) as Record<string, unknown> });
      prefetchCache.set(tc.id!, promise);
    }
  },
  settled() { currentDurableRunOperationId = undefined; currentDurableTurnId = undefined; },
});

function handleSessionEvent(event: AgentSessionEvent): void {
  if (event.type === 'tool_execution_end') {
    toolResultBudgets.get(event.toolCallId)?.finish(event.toolCallId);
    toolResultBudgets.delete(event.toolCallId);
  }
  adaptSessionEvent(event);
}

// ============================================================
// Command Handlers
// ============================================================

async function handleInit(msg: Extract<InboundMessage, { type: 'init' }>): Promise<void> {
  // A re-init invalidates every utility query created under the old credentials.
  ephemeralQueries.cancelAll(new EphemeralQueryCancelledError('Pi server reinitialized'));

  // Invalidate an in-flight factory before accepting another config.
  await sessionLifecycle.reset();
  if (unsubscribeEvents) { unsubscribeEvents(); unsubscribeEvents = null; }
  modelOwner.reset();

  initConfig = msg;
  if (initConfig.piAuth) initConfig.piAuth.provider = normalizePiProvider(initConfig.piAuth.provider);
  piCacheRetention = msg.cacheRetention === 'long' ? 'long' : 'short';
  process.env.PI_CACHE_RETENTION = piCacheRetention;
  clearPromptSnapshots();
  lastCanonicalContextCursor = 0;
  lastCanonicalCoveredSeq = 0;

  // Audit M-4: custom endpoint base URLs must use http/https. Reject other
  // schemes early and neutralize the config so the invalid URL is never
  // registered (and never receives a real API key). The parent is also told
  // via an error message; registerCustomEndpointModels() re-checks as a
  // second line of defense.
  if (initConfig.baseUrl && !hasSupportedBaseUrlScheme(initConfig.baseUrl)) {
    const errorMsg = `Custom endpoint baseUrl "${initConfig.baseUrl}" uses an unsupported scheme — only http:// and https:// URLs are allowed.`;
    debugLog(`[init] ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'invalid_base_url' });
    initConfig.baseUrl = undefined;
  }

  // Azure OpenAI requires a tenant-specific endpoint URL.
  // The Pi SDK (via Vercel AI SDK) reads AZURE_OPENAI_BASE_URL from env.
  if (initConfig.piAuth?.provider === 'azure') {
    if (initConfig.baseUrl) process.env.AZURE_OPENAI_BASE_URL = initConfig.baseUrl;
    else delete process.env.AZURE_OPENAI_BASE_URL;
  }

  // Start callback server for call_llm (idempotent — skips if already running)
  await startCallbackServer();

  send({
    type: 'ready',
    sessionId: null,
    callbackPort,
    callbackToken,
  });
}

async function handlePrompt(msg: Extract<InboundMessage, { type: 'prompt' }>): Promise<void> {
  let received = false;
  lengthContinuationTracker.reset();
  durableToolAccounting.resetBatches();
  toolResultBudgets.clear();
  currentDurableRunOperationId = msg.durableRunOperationId;
  currentDurableTurnId = msg.durableTurnId ?? msg.id;

  try {
    // If proxy tools changed since last session creation, dispose and recreate.
    // This avoids calling _buildRuntime() for dynamic tool updates — instead
    // we create a fresh session via continueRecent() with all tools known upfront.
    if (toolsChanged && sessionLifecycle.current) {
      debugLog('Recreating session due to tool changes');
      if (unsubscribeEvents) {
        unsubscribeEvents();
        unsubscribeEvents = null;
      }
      await sessionLifecycle.reset();
    }

    const session = await ensureSession();

    if (msg.canonicalContext) {
      if (!session.isIdle) {
        debugLog('[canonical-context] session is active; retaining current Pi transcript');
      } else if (msg.canonicalContext.cursor < lastCanonicalContextCursor) {
        debugLog(`[canonical-context] stale cursor ${msg.canonicalContext.cursor} < ${lastCanonicalContextCursor}; retaining Pi transcript`);
      } else {
        // Pi 0.87.0 made SessionManager authoritative for provider context, so the
        // durable facts are installed as append-only context edits rather than by
        // replacing agent state — see convergeCanonicalContext for why the three
        // cases matter and when nothing is written.
        const outcome = convergeCanonicalContext(session.sessionManager, msg.canonicalContext, session.agent.state.model,
          JSON.stringify([initConfig!.workspaceRootPath, initConfig!.sessionId]));
        if (outcome !== 'aligned') session.refreshContext();
        lastCanonicalContextCursor = msg.canonicalContext.cursor;
        lastCanonicalCoveredSeq = Math.max(0, ...msg.canonicalContext.items.map(item => item.seq));
        debugLog(`[canonical-context] ${outcome} ${msg.canonicalContext.items.length} committed facts at cursor ${msg.canonicalContext.cursor}`);
      }
    }

    // Supply the Phaneris-built system prompt via the loader's before_agent_start
    // hook — re-applied every turn, surviving the SDK's per-turn reset and
    // tool-change rebuilds (see phaneris-resource-loader.ts).
    if (msg.systemPrompt) {
      setPhanerisSystemPrompt(msg.systemPrompt);
    }
    setPhanerisTaskInstructions([msg.taskPreparation?.instructions ?? '', msg.taskPreparation?.sourceContext ?? '']);
    const selectedFamilies = new Set(msg.taskPreparation?.capabilityFamilies ?? []);
    const selectedSources = new Set(msg.taskPreparation?.sourceSlugs ?? []);
    const prepared = proxyToolDefs.filter(tool => {
      if (tool.exposure === 'hidden' || tool.availability?.status === 'unsupported') return false;
      if (tool.name.startsWith('mcp__session__')) return selectedFamilies.has(tool.namespace?.name.replace('phaneris:', '') ?? '');
      const slug = tool.name.split('__')[1];
      return selectedSources.has(slug ?? '') && proxyToolDefs.filter(candidate => candidate.name.startsWith(`mcp__${slug}__`)).length <= 24;
    });
    if (prepared.length) session.setActiveToolsByName([...new Set([...session.getActiveToolNames(), ...prepared.map(tool => tool.name)])]);

    // Wire up event handler
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }
    unsubscribeEvents = session.subscribe(handleSessionEvent);

    // Wait for any in-flight auto-compaction to avoid race (craft-agents-oss#464)
    const compactionWait = await waitForCompaction(session, { timeoutMs: PROMPT_COMPACT_WAIT_MS, log: debugLog });
    if (compactionWait.timedOut) {
      debugLog('Proceeding with prompt while the compaction flag is still set');
    }

    // Fire prompt — use followUp when session is already streaming so the
    // message is queued instead of throwing "Agent is already processing".
    const invokePrompt = () => session.prompt(msg.message, {
      images: msg.images && msg.images.length > 0 ? msg.images : undefined,
      streamingBehavior: 'followUp',
      preflightResult: (disposition) => {
        received = true;
        send({ type: 'input_received', id: msg.id, disposition });
      },
    });
    if (msg.durableRunOperationId) {
      await durableModelRunStorage.run({
        runOperationId: msg.durableRunOperationId,
        turnId: msg.durableTurnId ?? msg.id,
      }, invokePrompt);
    } else {
      await invokePrompt();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // No wrapper-side overflow recovery here. The Pi SDK's _checkCompaction
    // already runs `_runAutoCompaction("overflow", true)` on overflow and
    // calls agent.continue() to retry once. Running our own session.compact()
    // in parallel raced against the SDK and is the documented cause of the
    // AbortController crash in `_runAutoCompaction` (see
    // plans/fix-pi-gpt-compaction.md). PiEventAdapter holds the Phaneris event
    // queue open across the SDK's recovery flow so the recovered turn
    // reaches the UI.

    debugLog(`Prompt failed: ${errorMsg}`);
    if (!received) send({ type: 'input_received', id: msg.id, disposition: 'rejected', reason: errorMsg });
    send({ type: 'error', message: errorMsg, code: 'prompt_error' });
    // Prompt failed before Pi could establish a normal run, so synthesize the
    // same terminal boundary the SDK guarantees for started runs.
    if (!received) send({ type: 'event', event: { type: 'agent_settled', aborted: error instanceof Error && error.name === 'AbortError' } });
  }
}

function handleSyncTools(msg: Extract<InboundMessage, { type: 'sync_tools' }>): void {
  if (!proxyToolDefinitionsChanged(proxyToolDefs, msg.tools)) {
    debugLog(`Proxy tool sync unchanged (${msg.tools.length} tools)`);
    return;
  }

  // Replace the full proxy set so removed/disabled source tools cannot remain
  // visible in a resumed Pi session.
  proxyToolDefs = msg.tools;
  debugLog(`Synced ${proxyToolDefs.length} proxy tools: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  // Pi registers custom tool definitions at construction time. Recreate only
  // after a real definition change, never for an identical per-turn sync.
  if (sessionLifecycle.current) {
    toolsChanged = true;
    debugLog('Proxy tool definitions changed — session will be recreated on next prompt');
  }
}

function handleSetBrowserToolEnabled(
  msg: Extract<InboundMessage, { type: 'set_browser_tool_enabled' }>,
): void {
  if (!initConfig || initConfig.browserToolEnabled === msg.enabled) return;
  initConfig.browserToolEnabled = msg.enabled;
  // Built-in denylisting is fixed at AgentSession construction. Defer the
  // rebuild to the next prompt so an in-flight turn is never interrupted.
  if (sessionLifecycle.current) toolsChanged = true;
  debugLog(`Browser tool ${msg.enabled ? 'enabled' : 'disabled'}; session refresh queued`);
}

function handleSetCacheRetention(
  msg: Extract<InboundMessage, { type: 'set_cache_retention' }>,
): void {
  piCacheRetention = msg.cacheRetention === 'long' ? 'long' : 'short';
  process.env.PI_CACHE_RETENTION = piCacheRetention;
  debugLog(`Prompt cache retention set to '${piCacheRetention}'`);
  // The saved candidate belongs to the previous retention tier. Cancel it;
  // the next real request schedules a candidate with the new tier's TTL.
  if (sessionLifecycle.current) {
    sessionLifecycle.current.setCacheWarmingMode('off');
    sessionLifecycle.current.setCacheWarmingMode(initConfig?.promptCacheWarming === true ? 'streaming' : 'off');
  }
}

function handleToolExecuteResponse(msg: Extract<InboundMessage, { type: 'tool_execute_response' }>): void {
  if (!pendingToolExecutions.settle(msg.requestId, msg.result)) debugLog('Ignoring late or duplicate handleToolExecuteResponse');
}

function handlePreToolUseResponse(msg: Extract<InboundMessage, { type: 'pre_tool_use_response' }>): void {
  if (!pendingPreToolUse.settle(msg.requestId, { action: msg.action, input: msg.input, reason: msg.reason })) debugLog('Ignoring late or duplicate handlePreToolUseResponse');
}

function handleDurableToolPrepareResponse(
  msg: Extract<InboundMessage, { type: 'durable_tool_prepare_response' }>,
): void {
  if (!pendingDurableToolPrepares.settle(msg.requestId, { ok: msg.ok, prepared: msg.prepared, reason: msg.reason })) debugLog('Ignoring late or duplicate handleDurableToolPrepareResponse');
}

function handleDurableToolOutcomeResponse(
  msg: Extract<InboundMessage, { type: 'durable_tool_outcome_response' }>,
): void {
  if (!pendingDurableToolOutcomes.settle(msg.requestId, { ok: msg.ok, committedSeq: msg.committedSeq, reason: msg.reason })) debugLog('Ignoring late or duplicate handleDurableToolOutcomeResponse');
}

function handleDurableModelPrepareResponse(
  msg: Extract<InboundMessage, { type: 'durable_model_prepare_response' }>,
): void {
  if (!pendingDurableModelPrepares.settle(msg.requestId, { ok: msg.ok, prepared: msg.prepared, reason: msg.reason })) debugLog('Ignoring late or duplicate handleDurableModelPrepareResponse');
}

function handleDurableModelOutcomeResponse(
  msg: Extract<InboundMessage, { type: 'durable_model_outcome_response' }>,
): void {
  if (!pendingDurableModelOutcomes.settle(msg.requestId, { ok: msg.ok, committedSeq: msg.committedSeq, reason: msg.reason })) debugLog('Ignoring late or duplicate handleDurableModelOutcomeResponse');
}

function handleCancelEphemeralQuery(
  msg: Extract<InboundMessage, { type: 'cancel_ephemeral_query' }>,
): void {
  const cancelled = ephemeralQueries.cancel(
    msg.id,
    new EphemeralQueryCancelledError(`Ephemeral query cancelled by host: ${msg.id}`),
  );
  debugLog(`${cancelled ? 'Cancelled' : 'No active'} ephemeral query: ${msg.id}`);
}

async function handleAbort(): Promise<void> {
  largeResultFilter.cancelAll();
  compactionEpoch++;
  // Release permission waits before awaiting the SDK, which drains active tools.
  pendingPreToolUse.cancelAll({ action: 'block', reason: 'Aborted' });
  try {
    if (sessionLifecycle.current) await sessionLifecycle.current.abort();
  } finally {
    // Clear speculative prefetch even when the SDK could not confirm its stop.
    prefetchCache.clear();
  }
}

function runWithDurableUtilityContext<T>(
  msg: { id: string; durableRunOperationId?: string; durableTurnId?: string },
  operation: () => Promise<T>,
): Promise<T> {
  return msg.durableRunOperationId
    ? durableModelRunStorage.run({
        runOperationId: msg.durableRunOperationId,
        turnId: msg.durableTurnId ?? msg.id,
      }, operation)
    : operation();
}

async function handleMiniCompletion(msg: Extract<InboundMessage, { type: 'mini_completion' }>): Promise<void> {
  // Call queryLlm directly (not runMiniCompletion) so auth errors propagate
  // as 'error' messages instead of being swallowed and returned as null.
  // runMiniCompletion is kept for the summarize callback where null is acceptable.
  try {
    const result = await runWithDurableUtilityContext(msg, () => runEphemeralLlmQuery(msg.id, { prompt: msg.prompt }));
    send({ type: 'mini_completion_result', id: msg.id, text: result.text || null });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleMiniCompletion] Error: ${errorMsg}`);
    if (isEphemeralQueryCancellation(error)) {
      // Mini completions are best-effort; preserve their null-on-timeout contract.
      send({ type: 'mini_completion_result', id: msg.id, text: null });
    } else {
      send({ type: 'error', id: msg.id, message: errorMsg, code: 'mini_completion_error' });
    }
  }
}

// INVARIANT: the full LLMQueryRequest shape must pass through this RPC unchanged.
// Adding a field to LLMQueryRequest? Nothing to do here — we pass `msg.request`
// to queryLlm() verbatim. But verify queryLlm() actually honors the new field;
// request-propagation + request-honoring are independent (see #596).
async function handleLlmQuery(msg: Extract<InboundMessage, { type: 'llm_query' }>): Promise<void> {
  try {
    const result = await runWithDurableUtilityContext(msg, () => runEphemeralLlmQuery(msg.id, msg.request));
    send({ type: 'llm_query_result', id: msg.id, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleLlmQuery] Error: ${errorMsg}`);
    // Dual-emit: the generic `error` channel drives main-process OAuth
    // auth-refresh detection (centralized in PiAgent), while the targeted
    // `llm_query_result` rejects only this pending call.
    send({ type: 'error', id: msg.id, message: errorMsg, code: 'llm_query_error' });
    send({ type: 'llm_query_result', id: msg.id, result: null, errorMessage: errorMsg, errorCode: 'llm_query_error' });
  }
}

async function handleEnsureSessionReady(msg: Extract<InboundMessage, { type: 'ensure_session_ready' }>): Promise<void> {
  const session = await ensureSession();
  send({
    type: 'ensure_session_ready_result',
    id: msg.id,
    sessionId: session.sessionId || null,
  });
}

async function handleCompact(msg: Extract<InboundMessage, { type: 'compact' }>): Promise<void> {
  const epoch = compactionEpoch;
  const startedAt = Date.now();
  try {
    const session = await ensureSession();
    // Serialize manual /compact behind an in-flight auto-compaction. Public
    // session.compact() calls agent.abort() and uses its own controller; if
    // it runs while _runAutoCompaction is suspended, agent state churns and
    // the SDK's race surface widens. The wait is capped well under the host's
    // 300 s RPC deadline: a stuck compaction used to eat the whole budget
    // before compact() even started (craft-agents-oss#1060). Proceeding after
    // the cap is deliberate, since compact() begins with abort() and thereby
    // cancels the stale compaction.
    const wait = await waitForCompaction(session, { timeoutMs: MANUAL_COMPACT_WAIT_MS, log: debugLog });
    if (sessionLifecycle.current !== session || epoch !== compactionEpoch) throw new Error('Compaction aborted or session replaced');
    debugLog(
      `[compact] Starting manual compaction after ${wait.waitedMs}ms wait` +
        (wait.timedOut ? ' (prior compaction still flagged; compact() aborts it)' : ''),
    );
    const result = await runWithDurableUtilityContext(msg, () => session.compact(msg.customInstructions));
    if (sessionLifecycle.current !== session || epoch !== compactionEpoch) throw new Error('Compaction aborted or session replaced');
    debugLog(`[compact] Done in ${Date.now() - startedAt}ms: ${result.tokensBefore} -> ~${result.estimatedTokensAfter} tokens`);
    send({
      type: 'compact_result',
      id: msg.id,
      success: true,
      result: {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter: result.estimatedTokensAfter,
        ...readContextUsage(session),
      },
    });
  } catch (error) {
    const current = sessionLifecycle.current;
    const errorMsg = (current && compactionControllers.get(current)?.failure) || (error instanceof Error ? error.message : String(error));
    debugLog(`[compact] Failed after ${Date.now() - startedAt}ms: ${errorMsg}`);
    send({
      type: 'compact_result',
      id: msg.id,
      success: false,
      errorMessage: errorMsg,
    });
  }
}

async function handleSetAutoCompaction(msg: Extract<InboundMessage, { type: 'set_auto_compaction' }>): Promise<void> {
  try {
    const session = await ensureSession();
    const policy = msg.policy ?? (msg.enabled ? 'compact' : 'manual');
    if (!isContextPolicy(policy) || msg.enabled !== (policy === 'compact')) throw new Error('Invalid context policy');
    if (!isCompactionThreshold(msg.compactionThresholdTokens ?? null)) throw new Error('Invalid compaction threshold');
    session.setAutoCompactionEnabled(msg.enabled);
    await compactionControllers.get(session)?.update(msg.compactionThresholdTokens ?? null, session.model);
    send({ type: 'event', event: { type: 'context_usage', ...readContextUsage(session) } });
    if (initConfig) initConfig.compactionThresholdTokens = msg.compactionThresholdTokens ?? null;
    contextPolicy = policy;
    if (initConfig) initConfig.contextPolicy = policy;
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: true,
      enabled: session.autoCompactionEnabled,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_auto_compaction] Failed: ${errorMsg}`);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: false,
      enabled: msg.enabled,
      errorMessage: errorMsg,
    });
  }
}

async function handleUpdateRuntimeConfig(msg: RuntimeConfigUpdateMessage): Promise<void> {
  try {
    if (!initConfig) {
      throw new Error('Runtime config update received before init');
    }

    initConfig = {
      ...initConfig,
      model: msg.model,
      providerType: msg.providerType ?? initConfig.providerType,
      authType: msg.authType ?? initConfig.authType,
      baseUrl: msg.baseUrl,
      customEndpoint: msg.customEndpoint,
      customModels: msg.customModels,
    };

    if (initConfig.piAuth?.provider === 'azure') {
      if (initConfig.baseUrl) process.env.AZURE_OPENAI_BASE_URL = initConfig.baseUrl;
      else delete process.env.AZURE_OPENAI_BASE_URL;
    }

    if (modelOwner.activeRegistry && shouldPreferCustomEndpoint()) {
      const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
        ? initConfig.customModels
        : [initConfig.model || 'default']
      ).map(normalizeCustomEndpointModelEntry);

      customEndpointModelIds = new Set();
      customModelOverrides.clear();
      registerCustomEndpointModels(modelOwner.activeRegistry, initConfig.customEndpoint!.api, initConfig.baseUrl!.trim(), modelEntries);
    }

    if (sessionLifecycle.current && modelOwner.activeRegistry) {
      let piModel = resolvePiModel(modelOwner.activeRegistry, msg.model, initConfig.piAuth?.provider, shouldPreferCustomEndpoint());
      if (!piModel && shouldPreferCustomEndpoint()) {
        const bareId = stripPiPrefix(msg.model);
        registerCustomEndpointModels(modelOwner.activeRegistry, initConfig.customEndpoint!.api, initConfig.baseUrl!.trim(), [{ id: bareId }]);
        piModel = modelOwner.activeRegistry.find('custom-endpoint', bareId) ?? undefined;
        debugLog(`[runtime_config] Dynamically registered custom endpoint model: ${bareId}`);
      }

      if (!piModel) {
        throw new Error(`Could not resolve model after runtime update: ${msg.model}`);
      }

      await sessionLifecycle.current.setModel(piModel);
      await compactionControllers.get(sessionLifecycle.current)?.refreshModel(piModel);
      send({ type: 'event', event: { type: 'context_usage', ...readContextUsage(sessionLifecycle.current) } });
      setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
      sendThinkingLevelState();
      debugLog(`[runtime_config] Updated runtime config and active model: ${piModel.provider}/${piModel.id}`);
    } else {
      debugLog('[runtime_config] Stored update; no active session/model registry yet');
    }

    const contextWindow = sessionLifecycle.current?.agent.state.model?.contextWindow;
    send({ type: 'update_runtime_config_result', id: msg.id, success: true, updated: true, contextWindow });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[runtime_config] Failed: ${errorMsg}`);
    send({ type: 'update_runtime_config_result', id: msg.id, success: false, updated: false, errorMessage: errorMsg });
  }
}

async function handleSetModel(msg: Extract<InboundMessage, { type: 'set_model' }>): Promise<void> {
  debugLog(`[set_model] Received: ${msg.model}`);
  if (initConfig) initConfig.model = msg.model;
  if (!sessionLifecycle.current || !modelOwner.activeRegistry) {
    debugLog(`[set_model] No active session or model registry, stored for session creation`);
    return;
  }
  let piModel = resolvePiModel(modelOwner.activeRegistry, msg.model, initConfig?.piAuth?.provider, shouldPreferCustomEndpoint());

  // For custom endpoints, dynamically register unknown models so mid-session switching works.
  // Uses registerCustomEndpointModels which accumulates into the existing model set
  // (registerProvider replaces, so we track all IDs and re-register the full set).
  if (!piModel && initConfig && shouldPreferCustomEndpoint(initConfig)) {
    const bareId = stripPiPrefix(msg.model);
    registerCustomEndpointModels(modelOwner.activeRegistry, initConfig.customEndpoint!.api, initConfig.baseUrl!.trim(), [{ id: bareId }]);
    piModel = modelOwner.activeRegistry.find('custom-endpoint', bareId) ?? undefined;
    debugLog(`[set_model] Dynamically registered custom endpoint model: ${bareId}`);
  }

  if (!piModel) {
    debugLog(`[set_model] Could not resolve model: ${msg.model}`);
    setInterceptorApiHints(undefined);
    return;
  }
  try {
    await sessionLifecycle.current.setModel(piModel);
    await compactionControllers.get(sessionLifecycle.current)?.refreshModel(piModel);
    send({ type: 'event', event: { type: 'context_usage', ...readContextUsage(sessionLifecycle.current) } });
    setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
    const contextWindow = sessionLifecycle.current.agent.state.model?.contextWindow;
    send({ type: 'set_model_result', model: msg.model, contextWindow });
    sendThinkingLevelState();
    debugLog(`[set_model] Model changed to: ${msg.model} (resolved: ${piModel.provider}/${piModel.id})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_model] Failed to set model: ${errorMsg}`);
  }
}

async function handleSetThinkingLevel(msg: Extract<InboundMessage, { type: 'set_thinking_level' }>): Promise<void> {
  debugLog(`[set_thinking_level] Received: ${msg.level}`);

  if (initConfig) initConfig.thinkingLevel = msg.level;

  if (!sessionLifecycle.current) {
    debugLog('[set_thinking_level] No active session, stored for session creation');
    return;
  }

  const piLevel = THINKING_TO_PI[msg.level as keyof typeof THINKING_TO_PI];
  if (!piLevel) {
    debugLog(`[set_thinking_level] No Pi mapping for level: ${msg.level}`);
    return;
  }

  try {
    sessionLifecycle.current.setThinkingLevel(piLevel);
    sendThinkingLevelState();
    debugLog(`[set_thinking_level] Thinking level changed to: ${msg.level} (mapped: ${piLevel})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_thinking_level] Failed to set thinking level: ${errorMsg}`);
  }
}

async function handleShutdown(): Promise<void> {
  debugLog('Shutdown requested');

  // Abort utility sessions independently from the main chat session.
  ephemeralQueries.cancelAll(new EphemeralQueryCancelledError('Pi server shutting down'));

  // Unsubscribe events
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }

  // Dispose session
  await sessionLifecycle.reset();

  // Stop callback server
  stopCallbackServer();

  // Reject pending promises
  pendingPreToolUse.cancelAll({ action: 'block', reason: 'Server shutting down' });

  pendingToolExecutions.cancelAll({ content: 'Server shutting down', isError: true });
  pendingCredentialWrites.cancelAll(false);

  process.exit(0);
}

// ============================================================
// Main JSONL Reader Loop
// ============================================================

let initialization: Promise<void> | null = null;

async function processMessage(msg: InboundMessage): Promise<void> {
  if (msg.type === 'init') {
    const previous = initialization;
    const pending = (async () => {
      if (previous) await previous;
      await handleInit(msg);
    })().finally(() => { if (initialization === pending) initialization = null; });
    initialization = pending;
    await pending;
    return;
  }
  // Preserve stdin ordering across asynchronous initialization without
  // serializing a whole prompt: permission replies and abort must stay live.
  if (initialization) await initialization;
  switch (msg.type) {
    case 'prompt':
      await handlePrompt(msg);
      break;

    case 'sync_tools':
      handleSyncTools(msg);
      break;

    case 'tool_execute_response':
      handleToolExecuteResponse(msg);
      break;

    case 'pre_tool_use_response':
      handlePreToolUseResponse(msg);
      break;

    case 'durable_tool_prepare_response':
      handleDurableToolPrepareResponse(msg);
      break;

    case 'durable_tool_outcome_response':
      handleDurableToolOutcomeResponse(msg);
      break;

    case 'durable_model_prepare_response':
      handleDurableModelPrepareResponse(msg);
      break;

    case 'durable_model_outcome_response':
      handleDurableModelOutcomeResponse(msg);
      break;

    case 'large_result_filter_response':
      largeResultFilter.handleResponse(msg.requestId, msg.excerpt);
      break;

    case 'abort':
      try {
        // session.abort() drains the SDK, including each durable T2/ACK, before
        // resolving. A restart must await this boundary, not a host queue close.
        await handleAbort();
        if (msg.id) send({ type: 'abort_result', id: msg.id, success: true });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        debugLog(`Abort failed: ${errorMessage}`);
        if (msg.id) send({ type: 'abort_result', id: msg.id, success: false, errorMessage });
      }
      break;

    case 'mini_completion':
      await handleMiniCompletion(msg);
      break;

    case 'llm_query':
      await handleLlmQuery(msg);
      break;

    case 'cancel_ephemeral_query':
      handleCancelEphemeralQuery(msg);
      break;

    case 'ensure_session_ready':
      await handleEnsureSessionReady(msg);
      break;

    case 'set_model':
      await handleSetModel(msg);
      break;

    case 'set_thinking_level':
      await handleSetThinkingLevel(msg);
      break;

    case 'compact':
      await handleCompact(msg);
      break;

    case 'set_auto_compaction':
      await handleSetAutoCompaction(msg);
      break;

    case 'set_browser_tool_enabled':
      handleSetBrowserToolEnabled(msg);
      break;

    case 'force_context_handoff':
      forcedContextHandoff = true;
      break;

    case 'set_cache_warming':
      if (initConfig) initConfig.promptCacheWarming = msg.enabled === true;
      sessionLifecycle.current?.setCacheWarmingMode(msg.enabled === true ? 'streaming' : 'off');
      break;

    case 'set_cache_retention':
      handleSetCacheRetention(msg);
      break;

    case 'update_runtime_config':
      await handleUpdateRuntimeConfig(msg);
      break;

    case 'steer':
      if (sessionLifecycle.current) {
        debugLog(`Steering with: "${msg.message.slice(0, 100)}"`);
        try {
          const disposition = await sessionLifecycle.current.steer(msg.message);
          if (msg.id) send({ type: 'input_received', id: msg.id, disposition });
        } catch (error) {
          if (msg.id) send({ type: 'input_received', id: msg.id, disposition: 'rejected', reason: String(error) });
        }
      } else {
        debugLog('Steer ignored — no active session');
        if (msg.id) send({ type: 'input_received', id: msg.id, disposition: 'rejected', reason: 'No active SDK session' });
      }
      break;

    case 'token_update':
      if (modelOwner.credentialStore) {
        const provider = normalizePiProvider(msg.piAuth.provider);
        const { credential } = msg.piAuth;
        await modelOwner.credentialStore.inject(provider, credential as unknown as Credential);
        if (initConfig) {
          initConfig.piAuth = { provider, credential };
        }
        debugLog(`Updated credential for provider: ${provider}`);
      } else {
        debugLog('token_update received but no credential store initialized');
      }
      break;

    case 'oauth_credential_update_response':
      pendingCredentialWrites.settle(msg.requestId, msg.ok);
      break;

    case 'shutdown':
      await handleShutdown();
      break;

    default:
      debugLog(`Unknown message type: ${(msg as any).type}`);
  }
}

function main(): void {
  debugLog('Pi agent server starting');

  transport.listen(async value => {
    if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('JSONL message requires a type');
    await processMessage(value as InboundMessage);
  }, () => {
    debugLog('stdin closed, shutting down');
    void handleShutdown().catch(error => { debugLog(String(error)); process.exit(1); });
  }, error => {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`Error processing message: ${message}`);
    send({ type: 'error', message });
  });

  // Handle unexpected errors — process state is unreliable after these,
  // so we attempt to report and then exit immediately.
  // send() is wrapped in try/catch because stdout itself may be broken
  // (e.g. EFAULT from a closed pipe), and we must not let the error
  // report trigger another uncaughtException (which would loop).
  process.on('uncaughtException', (error) => {
    debugLog(`Uncaught exception: ${error.message}`);
    try {
      send({ type: 'error', message: `Uncaught exception: ${error.message}`, code: 'uncaught' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    try {
      send({ type: 'error', message: `Unhandled rejection: ${msg}`, code: 'unhandled_rejection' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });
}

main();
