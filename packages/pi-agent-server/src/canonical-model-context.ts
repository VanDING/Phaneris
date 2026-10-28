import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { DurableCanonicalModelContext } from '@phaneris/shared/durable-runtime/types';

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
    const result = item.result && typeof item.result === 'object' ? item.result as { content?: unknown[]; structuredContent?: unknown; details?: unknown } : undefined;
    const blocks = result?.content;
    const modelBlocks = Array.isArray(blocks) && blocks.every(b => b && typeof b === 'object' && ['text', 'image'].includes((b as { type: string }).type))
      ? blocks as Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> : undefined;
    messages.push({
      role: 'toolResult',
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      content: modelBlocks ?? [{ type: 'text', text: resultText(item.result) }],
      ...(result?.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      ...(result?.details !== undefined ? { details: result.details as Extract<AgentMessage, { role: 'toolResult' }>['details'] } : {}),
      isError: item.isError,
      timestamp: item.seq,
    });
    lastAssistantOperationId = undefined;
  }
  return completeToolResultContext(messages);
}

/** A provider protocol view, never a synthetic business-outcome ledger entry.
 * Late real receipts replace this view naturally on canonical convergence. */
export function completeToolResultContext(messages: readonly AgentMessage[]): AgentMessage[] {
  const used = new Set<number>(), results = new Map<string, Array<{ index: number; message: Extract<AgentMessage, { role: 'toolResult' }> }>>();
  messages.forEach((message, index) => {
    if (message.role === 'toolResult') results.set(message.toolCallId, [...(results.get(message.toolCallId) ?? []), { index, message }]);
  });
  const output: AgentMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'toolResult') {
      if (!used.has(index)) output.push({ role: 'user', content: [
        { type: 'text', text: `Recovered output from ${message.toolName}; no matching call is present in this working view.` }, ...message.content,
      ], timestamp: message.timestamp });
      continue;
    }
    output.push(message);
    if (message.role !== 'assistant') continue;
    // The SDK discards these messages; completing their calls would leave orphan results.
    if (message.stopReason === 'aborted' || message.stopReason === 'error') continue;
    for (const call of message.content) {
      if (call.type !== 'toolCall') continue;
      const found = results.get(call.id)?.find(result => result.index > index && !used.has(result.index));
      if (found) { used.add(found.index); output.push(found.message); }
      else output.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: 'Runtime interruption: the tool result was not collected and its effect is unknown. This is not evidence of business success or failure. Inspect existing outputs or receipts; do not blindly repeat non-idempotent actions. Independent work may continue.' }],
        details: { phanerisRecovery: { status: 'outcome_unknown' } }, isError: true, timestamp: message.timestamp });
    }
  }
  return output;
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

const COMPACTION_COVERAGE = 'phaneris:canonical-compaction-coverage';
interface CompactionCoverage {
  compactionId: string;
  scope: string;
  canonicalThroughSeq: number;
  nativeThroughSeq: number;
}

/** Metadata on the SDK journal, never a second copy of its summary or context.
 * Only actually journaled main outputs advance native coverage. New user facts
 * above canonicalThroughSeq remain eligible even if admitted during generation:
 * an SDK queue receipt alone does not prove the model consumed that input. */
export function recordCanonicalCompaction(
  manager: SessionManager, compactionId: string, scope: string, canonicalThroughSeq: number,
): void {
  const nativeThroughSeq = manager.getBranch(compactionId).reduce((highest, entry) => {
    const message = entry.type === 'message' ? entry.message as { durableSeq?: number; durableContextScope?: string;
      details?: { phanerisDurableSeq?: number; phanerisDurableScope?: string } } : undefined;
    const seq = message?.durableContextScope === scope ? message.durableSeq
      : message?.details?.phanerisDurableScope === scope ? message.details.phanerisDurableSeq : undefined;
    return typeof seq === 'number' && Number.isSafeInteger(seq) ? Math.max(highest, seq) : highest;
  }, canonicalThroughSeq);
  manager.appendCustomEntry(COMPACTION_COVERAGE, { compactionId, scope, canonicalThroughSeq, nativeThroughSeq } satisfies CompactionCoverage);
}

function compactedBoundary(manager: SessionManager, scope: string | undefined) {
  if (!scope) return;
  const branch = manager.getBranch();
  const compaction = [...branch].reverse().find(entry => entry.type === 'compaction');
  if (!compaction) return;
  const checkpoint = [...branch].reverse().find(entry => entry.type === 'custom' && entry.customType === COMPACTION_COVERAGE
    && (entry.data as CompactionCoverage | undefined)?.compactionId === compaction.id);
  const coverage = checkpoint?.type === 'custom' ? checkpoint.data as CompactionCoverage | undefined : undefined;
  if (!coverage || coverage.scope !== scope || !Number.isSafeInteger(coverage.canonicalThroughSeq)
    || !Number.isSafeInteger(coverage.nativeThroughSeq) || coverage.canonicalThroughSeq < 0
    || coverage.nativeThroughSeq < coverage.canonicalThroughSeq) return;
  return { coverage, prefixIds: new Set(branch.slice(0, branch.indexOf(compaction) + 1).map(entry => entry.id)) };
}

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
  scope?: string,
): CanonicalConvergence {
  let boundary = compactedBoundary(sessionManager, scope);
  let items = context.items;
  let projection = sessionManager.buildSessionProjection();
  if (boundary) {
    const { canonicalThroughSeq, nativeThroughSeq } = boundary.coverage;
    items = context.items.filter(item => item.seq > canonicalThroughSeq && (item.kind === 'user' || item.seq > nativeThroughSeq));
    const prefixCalls = new Set(projection.entries.filter(entry => boundary!.prefixIds.has(entry.sourceEntry.id))
      .flatMap(entry => entry.messages).flatMap(message => message.role === 'assistant'
        ? message.content.filter(block => block.type === 'toolCall').map(block => block.id) : []));
    const suffixCalls = new Set(items.filter(item => item.kind === 'tool_call').map(item => item.toolCallId));
    // A late durable T2 may need a call that the summary no longer contains.
    // Restore the canonical pair once; never execute its effect again here.
    const brokenPair = items.some(item => item.kind === 'tool_outcome' && !suffixCalls.has(item.toolCallId) && !prefixCalls.has(item.toolCallId))
      || [...suffixCalls].some(id => prefixCalls.has(id));
    if (brokenPair) {
      boundary = undefined;
      items = context.items;
    }
  }
  const canonical = canonicalContextToPiMessages({ ...context, items }, model) as ModelMessage[];
  if (canonical.length === 0) return 'aligned';

  let recoveredBranch = false;
  if (!boundary && projection.entries.some(entry => entry.sourceEntry.type === 'compaction' || entry.sourceEntry.type === 'branch_summary')) {
    // Summary entries are not context-editable in the public SDK. Recovery
    // branches before the first summary, preserving every abandoned journal row.
    const previousLeaf = sessionManager.getLeafId();
    const firstSummary = sessionManager.getBranch().find(entry => entry.type === 'compaction' || entry.type === 'branch_summary')!;
    if (firstSummary.parentId) sessionManager.branch(firstSummary.parentId);
    else sessionManager.resetLeaf();
    sessionManager.appendCustomEntry('phaneris:canonical-recovery', { previousLeaf, scope });
    projection = sessionManager.buildSessionProjection();
    recoveredBranch = true;
  }

  // The native summary and retained prefix belong to Pi. Reconcile only the
  // tail after its checkpoint. Without a matching scope/anchor, use full facts.
  const entries = boundary ? projection.entries.filter(entry => !boundary.prefixIds.has(entry.sourceEntry.id)) : projection.entries;
  const projected = entries.flatMap(entry => entry.messages) as ModelMessage[];
  if (sameMessages(projected.slice(0, canonical.length), canonical)) return recoveredBranch ? 'replaced' : 'aligned';

  if (projected.length < canonical.length && sameMessages(projected, canonical.slice(0, projected.length))) {
    for (const message of canonical.slice(projected.length)) {
      sessionManager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
    }
    return recoveredBranch ? 'replaced' : 'appended';
  }

  for (const entry of entries) {
    const editable = entry.sourceEntry.type === 'custom_message' || (entry.sourceEntry.type === 'message'
      && ['user', 'assistant', 'toolResult'].includes(entry.sourceEntry.message.role));
    if (editable && entry.messages.length) sessionManager.appendContextEdit(entry.sourceEntry.id, null);
  }
  for (const message of canonical) {
    sessionManager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
  }
  return 'replaced';
}
