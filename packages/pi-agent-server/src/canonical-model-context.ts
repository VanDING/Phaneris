import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai/compat';
import type { DurableCanonicalModelContext } from '../../shared/src/durable-runtime/types.ts';

const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result); } catch { return String(result); }
}

/** Convert canonical committed facts into the exact transcript consumed by Pi. */
export function canonicalContextToPiMessages(
  context: DurableCanonicalModelContext,
  model: Model<any>,
): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let lastAssistantOperationId: string | undefined;
  for (const item of context.items) {
    if (item.kind === 'user') {
      messages.push({ role: 'user', content: item.content, timestamp: item.seq });
      lastAssistantOperationId = undefined;
      continue;
    }
    if (item.kind === 'assistant') {
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: item.content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: zeroUsage(),
        stopReason: 'stop',
        timestamp: item.seq,
      });
      lastAssistantOperationId = item.operationId;
      continue;
    }
    if (item.kind === 'tool_call') {
      const last = messages.at(-1);
      if (last?.role === 'assistant' && lastAssistantOperationId === item.operationId) {
        last.content.push({ type: 'toolCall', id: item.toolCallId, name: item.toolName, arguments: item.args });
        last.stopReason = 'toolUse';
      } else {
        messages.push({
          role: 'assistant',
          content: [{ type: 'toolCall', id: item.toolCallId, name: item.toolName, arguments: item.args }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: zeroUsage(),
          stopReason: 'toolUse',
          timestamp: item.seq,
        });
        lastAssistantOperationId = item.operationId;
      }
      continue;
    }
    messages.push({
      role: 'toolResult',
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      content: [{ type: 'text', text: resultText(item.result) }],
      isError: item.isError,
      timestamp: item.seq,
    });
    lastAssistantOperationId = undefined;
  }
  return messages;
}

/** Model-visible messages only; the converted facts never produce custom messages. */
type ModelMessage = ReturnType<typeof canonicalContextToPiMessages>[number];

/** Structural digest; JSON.stringify preserves key order, and both sides of every
 *  comparison come from the same converter on the same code path. */
function digest(message: ModelMessage): string {
  return JSON.stringify(message);
}

function sameMessages(left: readonly ModelMessage[], right: readonly ModelMessage[]): boolean {
  return left.length === right.length && left.every((message, index) => digest(message) === digest(right[index]!));
}

/** Which case applied, so callers log a fact instead of inferring one. */
export type CanonicalConvergence = 'aligned' | 'appended' | 'replaced'

/**
 * Converge a Pi session onto the durable canonical facts with **append-only**
 * context edits, preserving original message content in the transcript.
 *
 * Pi 0.87.0 made `SessionManager` authoritative for provider context: assigning
 * `agent.state.messages` no longer reaches the provider, so the only supported
 * primitive is a `ContextEditEntry` — an append-only record that rewrites an
 * earlier entry's contribution to model context without touching raw history,
 * usage, or UI history.
 *
 * Three cases, cheapest first. The steady state writes nothing:
 *
 * - `aligned` — the projection already *starts with* the canonical messages.
 *   The Pi transcript holds canonical facts plus input the user added after the
 *   last commit, so it is both canonical-prefixed and a superset. Leaving it
 *   untouched is what keeps queued and in-flight input alive.
 * - `appended` — the projection is a strict prefix of the canonical facts
 *   (earlier turns were omitted, or the session was restored from a snapshot).
 *   Appending the remainder is enough.
 * - `replaced` — the projection diverged: an abandoned provider attempt, or a
 *   previous convergence, left rows the canonical facts do not own. Mask every
 *   contributing entry with `replacement: null`, then append the facts.
 *
 * Re-running never needs to restore masked content, because `replaced` masks
 * every entry that still contributes and re-appends the full canonical
 * transcript. Masking an already-masked entry cannot occur: such an entry no
 * longer contributes and is skipped.
 */
export function convergeCanonicalContext(
  sessionManager: SessionManager,
  context: DurableCanonicalModelContext,
  model: Model<any>,
): CanonicalConvergence {
  const canonical = canonicalContextToPiMessages(context, model) as ModelMessage[];
  if (canonical.length === 0) return 'aligned';

  const projected = sessionManager.buildSessionProjection().messages as ModelMessage[];
  if (sameMessages(projected.slice(0, canonical.length), canonical)) return 'aligned';

  if (projected.length < canonical.length && sameMessages(projected, canonical.slice(0, projected.length))) {
    for (const message of canonical.slice(projected.length)) {
      sessionManager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
    }
    return 'appended';
  }

  for (const entry of sessionManager.buildSessionProjection().entries) {
    const contributes = entry.messages.some(message =>
      message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult');
    if (contributes) sessionManager.appendContextEdit(entry.sourceEntry.id, null);
  }
  for (const message of canonical) {
    sessionManager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
  }
  return 'replaced';
}
