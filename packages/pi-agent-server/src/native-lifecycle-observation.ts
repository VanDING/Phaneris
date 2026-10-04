import { createHash } from 'node:crypto';
import type { ExtensionAPI, AgentSessionEvent, AgentSession } from '@earendil-works/pi-coding-agent';

export type ObserveLifecycle = (event: string, data: Record<string, unknown>, sdkSessionId?: string) => void;
const identity = (value: unknown): string | null => typeof value === 'string'
  && /^[a-zA-Z0-9_.:/@+\-]{1,256}$/.test(value) ? value : null;

/** Only observes; never returns block/transform or changes a message after T2. */
export function registerNativeLifecycle(pi: ExtensionAPI, observe: ObserveLifecycle): void {
  let streamObserved = false;
  pi.on('before_provider_request', () => { streamObserved = false; });
  pi.on('provider_stream_event', (event, ctx) => {
    if (streamObserved) return;
    streamObserved = true;
    // Parsed chunks can contain credentials, message text and tool arguments.
    // Keep only a known envelope kind, once per request; never serialize data.
    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown> : undefined;
    const kind = data?.type ?? data?.object;
    const safeKinds = new Set(['chat.completion.chunk', 'message_start', 'response.created', 'start']);
    observe('provider_stream_observation', {
      provider: identity(event.provider), api: identity(event.api), model: identity(event.model),
      eventKind: typeof kind === 'string' && safeKinds.has(kind) ? kind : 'other',
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('message_end', (event, ctx) => {
    if (event.message.role !== 'assistant') return;
    const message = event.message;
    observe('assistant_response_observation', {
      provider: identity(message.provider), api: identity(message.api), model: identity(message.model),
      responseModel: identity(message.responseModel),
      requestedThinkingLevel: message.thinkingLevel ?? null,
      providerThinkingLevel: identity(message.providerThinkingLevel),
      stopReason: message.stopReason,
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('cache_warming_decision', (event, ctx) => {
    observe(event.type, {
      action: event.action, warmCost: event.warmCost, missCost: event.missCost,
      continuationProbability: event.continuationProbability,
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('tool_call', (event, ctx) => {
    observe(event.type, {
      toolCallId: event.toolCallId, toolName: event.toolName,
      proposedArgsHash: createHash('sha256').update(JSON.stringify(event.input)).digest('hex'),
      stage: 'sdk_proposal_before_phaneris_preflight',
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('tool_result', (event, ctx) => {
    observe(event.type, {
      toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError,
      stage: 'sdk_result_after_tool_return',
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('session_before_compact', (event, ctx) => {
    observe(event.type, { reason: event.reason, willRetry: event.willRetry }, ctx.sessionManager.getSessionId());
  });
  pi.on('session_compact', (event, ctx) => {
    observe(event.type, {
      reason: event.reason, willRetry: event.willRetry, fromExtension: event.fromExtension,
      entryId: event.compactionEntry.id,
      firstKeptEntryId: event.compactionEntry.firstKeptEntryId,
      tokensBefore: event.compactionEntry.tokensBefore,
      usage: event.compactionEntry.usage,
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('session_compact_failed', (event, ctx) => {
    // Error text can contain provider payloads; preserve the failure state only.
    observe(event.type, {
      reason: event.reason, willRetry: event.willRetry, aborted: event.aborted,
      fromExtension: event.fromExtension, hasError: !!event.errorMessage,
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('model_select', (event, ctx) => {
    observe(event.type, {
      provider: event.model.provider, model: event.model.id, source: event.source,
      previousProvider: event.previousModel?.provider, previousModel: event.previousModel?.id,
    }, ctx.sessionManager.getSessionId());
  });
  pi.on('thinking_level_select', (event, ctx) => {
    observe(event.type, { level: event.level, previousLevel: event.previousLevel }, ctx.sessionManager.getSessionId());
  });
}

export function observeNativeSessionEvent(
  event: AgentSessionEvent, session: AgentSession, observe: ObserveLifecycle,
): void {
  const id = session.sessionManager.getSessionId();
  if (event.type === 'auto_retry_start') {
    observe(event.type, { attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs }, id);
  } else if (event.type === 'auto_retry_end') {
    observe(event.type, { attempt: event.attempt, success: event.success }, id);
  } else if (event.type === 'agent_settled') {
    const stats = session.getSessionStats();
    observe('agent_settled', {
      scope: 'all_sdk_session_entries', costSource: 'pi_sdk_estimate',
      // A reference snapshot, NOT another usage row. Includes inherited entries.
      tokens: stats.tokens, cost: stats.cost,
      userMessages: stats.userMessages, assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls, toolResults: stats.toolResults,
      contextUsage: session.getContextUsage(),
    }, id);
  }
}
