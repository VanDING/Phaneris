import type { ToolEventAccounting } from './durable-tool-accounting';
/** SDK event adaptation. Finite transport, diagnostic and tool-tracking ports; no host storage. */
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { OutboundMessage, OutboundAgentEvent, PromptSnapshot, ToolExecutionMetadata } from './messages';
import { compactTextUpdate } from './transport-delta';
import { observeNativeSessionEvent } from './native-lifecycle-observation';
import { readContextUsage, deferContextUsage } from './context-usage';
import { LengthContinuationTracker, LENGTH_CONTINUATION_PROMPT, MAX_AUTO_LENGTH_CONTINUATIONS } from './length-continuation';
export interface SessionEventPorts {
  currentSession(): AgentSession | null;
  compactionFailure?(): string | undefined;
  clearCompactionFailure?(): void;
  send(message: OutboundMessage): void;
  debugLog(message: string): void;
  observeSdkLifecycle: Parameters<typeof observeNativeSessionEvent>[2];
  lengthContinuationTracker: LengthContinuationTracker;
  accounting: ToolEventAccounting;
  diagnostics: { capturePromptSnapshot(): number; rememberPromptSnapshot(seq: number, prompt: string): void;
    getPhanerisSystemPrompt(): string; promptSnapshots: ReadonlyMap<number, PromptSnapshot> };
  prefetch(content: Array<{ type: string; id?: string; name?: string; arguments?: unknown }>): void;
  settled(): void;
}
function extractToolExecutionMetadata(args: Record<string, unknown> | undefined): ToolExecutionMetadata | undefined {
  if (!args) return undefined;

  const intent = typeof args._intent === 'string' ? args._intent : undefined;
  const displayName = typeof args._displayName === 'string' ? args._displayName : undefined;

  if (!intent && !displayName) return undefined;

  return {
    intent,
    displayName,
    source: 'interceptor',
  };
}

export function createSessionEventAdapter(ports: SessionEventPorts): (event: AgentSessionEvent) => void {
  const { send, debugLog, observeSdkLifecycle, lengthContinuationTracker, accounting } = ports;
  const pendingSessionToolCalls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();
  const { capturePromptSnapshot, rememberPromptSnapshot, getPhanerisSystemPrompt, promptSnapshots } = ports.diagnostics;
  return function handleSessionEvent(event: AgentSessionEvent): void {
  const session = ports.currentSession();
  if (session) observeNativeSessionEvent(event, session, observeSdkLifecycle);
  // SDK partials contain the accumulated response (and sometimes image data).
  // Re-sending them on every token creates quadratic serialization and pipe
  // traffic. The host uses only delta + timestamp until message_end.
  if (event.type === 'message_update') {
    const compact = compactTextUpdate(event);
    if (compact) send({ type: 'event', event: compact as unknown as OutboundAgentEvent });
    return;
  }
  if (event.type === 'compaction_start') ports.clearCompactionFailure?.();
  let forwardedEvent: OutboundAgentEvent = event;
  if (event.type === 'compaction_end' && !event.result) {
    const errorMessage = ports.compactionFailure?.();
    if (errorMessage) forwardedEvent = { ...event, errorMessage, aborted: false };
  }
  let lengthContinuationAttempt: number | undefined;

  // Log API errors for debugging and attach provider-native turn anchor for branch cutoffs.
  if (event.type === 'message_end') {
    const msg = event.message as {
      role?: string;
      stopReason?: string;
      errorMessage?: string;
      usage?: { output?: number };
      durableOperationId?: string;
      durableSeq?: number;
      durableRequestSeq?: number;
    } | undefined;
    if (msg?.stopReason === 'error') {
      debugLog(`API error in message_end: ${msg.errorMessage || 'unknown'}`);
    }

    if (msg?.role === 'assistant' && session) {
      // The SDK's post-compaction usage gate reads the journal, which is only
      // appended after this callback returns. Defer rather than report an old count.
      deferContextUsage(session, ports.currentSession, (payload) => {
        send({ type: 'event', event: { type: 'context_usage', ...payload } });
      });
      const modelMaxTokens = session.agent.state.model?.maxTokens;
      lengthContinuationAttempt = lengthContinuationTracker.nextAttempt(msg, modelMaxTokens);

      // CRITICAL: do NOT read `getLeafId()` here.
      //
      // The Pi SDK fires `message_end` synchronously BEFORE calling
      // `appendMessage(event.message)` (see `agent-session.js:_processAgentEvent`).
      // At this moment the assistant entry does not yet exist in the
      // SessionManager — `leafId` still points at the *previous* leaf, which for
      // a plain text turn is the user message that triggered the response.
      // Recording that wrong anchor and using it for `branch()` makes the next
      // turn a sibling of the assistant message, dropping the assistant reply
      // from the LLM's view of history (craft-agents-oss#782).
      //
      // Instead, attach a correlation id to the forwarded event so the main
      // process can correlate this turn, then queue a microtask to read the
      // correct leaf AFTER `appendMessage` has run. The microtask drains before
      // any subsequent SDK event is dispatched, so the follow-up
      // `pi_turn_anchor` event is delivered to the main process in the right
      // order (after this `message_end`, before the next event).
      //
      // SDK 0.84 assistant messages carry no `id` at message_end — only the
      // provider `responseId` (unique per assistant message, verified against
      // persisted SDK sessions). Fall back to it for correlation.
      const sdkMessageId = (msg as { id?: string }).id ?? (msg as { responseId?: string }).responseId;

      // Per-session request ordinal + system-prompt snapshot for the
      // trajectory view's request-header grouping and prompt diff. The
      // snapshot is captured here because the SDK's `systemPrompt` getter is
      // only meaningful while a session exists, and message_end is the
      // earliest point after the request completed.
      // Deliberately NOT gated on sdkMessageId: the enrichment is independent
      // of the anchor correlation and must survive providers that omit ids.
      const requestSeq = typeof msg.durableRequestSeq === 'number'
        ? msg.durableRequestSeq
        : capturePromptSnapshot();
      if (!promptSnapshots.has(requestSeq)) rememberPromptSnapshot(requestSeq, getPhanerisSystemPrompt());
      const snapshot = promptSnapshots.get(requestSeq);
      forwardedEvent = {
        ...(event as Record<string, unknown>),
        ...(sdkMessageId ? { sdkMessageId } : {}),
        requestSeq,
        ...(msg.durableOperationId ? { durableOperationId: msg.durableOperationId } : {}),
        ...(typeof msg.durableSeq === 'number' ? { durableSeq: msg.durableSeq } : {}),
        ...(snapshot ? { promptSnapshot: snapshot.prompt } : {}),
        ...(snapshot?.contextSnapshot ? { contextSnapshot: snapshot.contextSnapshot } : {}),
      } as unknown as OutboundAgentEvent;

      if (sdkMessageId) {
        const sessionManagerSnapshot = session.sessionManager;
        queueMicrotask(() => {
          // Defensive: session may have been disposed between the message_end
          // emit and the microtask drain.
          if (ports.currentSession()?.sessionManager !== sessionManagerSnapshot) {
            return;
          }
          const sdkTurnAnchor = sessionManagerSnapshot.getLeafId();
          if (!sdkTurnAnchor) return;
          send({
            type: 'event',
            event: {
              type: 'pi_turn_anchor',
              sdkMessageId,
              sdkTurnAnchor,
            } as unknown as OutboundAgentEvent,
          });
        });
      }

      const content = (msg as { content?: Array<{ type: string; id?: string; name?: string; arguments?: unknown }> }).content;
      if (Array.isArray(content)) ports.prefetch(content);

    }
  }

  // Detect session MCP tool completions + enrich tool starts with canonical metadata
  if (event.type === 'tool_execution_start') {
    if (event.parentToolCallId) {
      accounting.rememberNestedBatch(event.toolCallId, event.parentToolCallId);
    }
    const toolName = event.toolName;
    if (toolName.startsWith('session__') || toolName.startsWith('mcp__session__')) {
      const mcpToolName = toolName.replace(/^(mcp__session__|session__)/, '');
      pendingSessionToolCalls.set(event.toolCallId, {
        toolName: mcpToolName,
        arguments: (event.args ?? {}) as Record<string, unknown>,
      });
    }

    const toolMetadata = extractToolExecutionMetadata((event.args ?? {}) as Record<string, unknown>);
    // Wall-clock stamp for trajectory timing (authoritative over adapter-local time).
    const durable = accounting.readCommit(event.toolCallId);
    forwardedEvent = {
      ...event,
      ...(toolMetadata ? { toolMetadata } : {}),
      ...(durable ? { durableOperationId: durable.operationId, durableSeq: durable.startSeq } : {}),
      ts: Date.now(),
    } as unknown as OutboundAgentEvent;
  }

  if (event.type === 'tool_execution_end') {
    const durable = accounting.readCommit(event.toolCallId);
    const pending = pendingSessionToolCalls.get(event.toolCallId);
    if (pending) {
      pendingSessionToolCalls.delete(event.toolCallId);
      send({
        type: 'session_tool_completed',
        toolName: pending.toolName,
        args: pending.arguments,
        isError: !!event.isError,
      });
    }

    // Wall-clock stamp for trajectory duration (start → end delta).
    forwardedEvent = {
      ...event,
      ...(durable?.outcomeSeq !== undefined
        ? { durableOperationId: durable.operationId, durableSeq: durable.outcomeSeq }
        : {}),
      ts: Date.now(),
    } as unknown as OutboundAgentEvent;
    accounting.finishTool(event.toolCallId);
  }

  // These boundaries already have committed SDK history; keep metadata inline
  // so agent_end cannot close the host queue before occupancy reaches it. A
  // settled session is the last chance to publish the run's final count, and it
  // carries the same reserve as every other boundary.
  if (session && (
    event.type === 'turn_end' ||
    event.type === 'agent_end' ||
    event.type === 'compaction_end' ||
    event.type === 'agent_settled'
  )) {
    forwardedEvent = { ...forwardedEvent, ...readContextUsage(session) } as OutboundAgentEvent;
  }

  // Forward all events to main process
  send({ type: 'event', event: forwardedEvent });
  if (lengthContinuationAttempt !== undefined && session) {
    const activeSession = session;
    debugLog(`Output limit reached; queuing automatic continuation ${lengthContinuationAttempt}/${MAX_AUTO_LENGTH_CONTINUATIONS}`);
    void activeSession.followUp(LENGTH_CONTINUATION_PROMPT).catch(error => {
      debugLog(`Could not queue automatic length continuation: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  if (event.type === 'agent_settled') {
    accounting.resetBatches();
    ports.settled();
  }
}

}
