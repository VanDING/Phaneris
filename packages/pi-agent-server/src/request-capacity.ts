import { calculateContextTokens, estimateTokens } from '@earendil-works/pi-coding-agent';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import type { Model, TranscriptContext } from '@earendil-works/pi-ai';

/** One SDK-based occupancy estimate, shared by diagnostics, policies and results. */
export function requestCapacity(model: Model<any>, context: TranscriptContext, reserveTokens?: number, nativeTokens?: number | null) {
  let lastUsage = -1, used = 0;
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index]!;
    if (message.role !== 'assistant' || message.stopReason === 'error' || message.stopReason === 'aborted') continue;
    const tokens = calculateContextTokens(message.usage);
    if (tokens > 0) { used = tokens; lastUsage = index; break; }
  }
  if (lastUsage < 0) {
    used = estimateTokens({ role: 'system', content: getCurrentSystemPrompt(context.messages),
      toolsAdded: getCurrentTools(context.messages), timestamp: 0 });
  }
  for (let index = lastUsage + 1; index < context.messages.length; index++) {
    const message = context.messages[index]!;
    if (lastUsage < 0 && message.role === 'system') continue;
    used += estimateTokens(message);
  }
  if (nativeTokens !== undefined && nativeTokens !== null && Number.isFinite(nativeTokens)) {
    // The public SDK invalidates old billed usage after compression/context edits.
    // Include the current provider-view estimate for host-added sections and tools.
    const current = estimateTokens({ role: 'system', content: getCurrentSystemPrompt(context.messages),
      toolsAdded: getCurrentTools(context.messages), timestamp: 0 })
      + context.messages.filter(message => message.role !== 'system').reduce((sum, message) => sum + estimateTokens(message), 0);
    used = Math.max(nativeTokens, current);
  }
  const reserve = Math.max(0, reserveTokens ?? Math.min(model.maxTokens, 8192));
  return { usedTokens: used, windowTokens: model.contextWindow, reserveTokens: reserve,
    availableInputTokens: Math.max(0, model.contextWindow - used - reserve),
    basis: nativeTokens != null ? 'sdk-occupancy-with-request-estimate' : lastUsage < 0 ? 'sdk-estimate' : 'usage-plus-sdk-estimate' };
}

interface TextResult { content: Array<{ type: string; text?: string }> }

/** Immutable reservations never wait while an effect owns a resource lock. */
export class ResultBudget {
  private readonly reservations = new Map<string, number>();
  readonly canDispatch: boolean;
  constructor(calls: Array<string | { id: string; weight?: number }>, availableChars: number) {
    const entries = calls.map(call => typeof call === 'string' ? { id: call, weight: 1 } : { id: call.id, weight: Math.max(1, call.weight ?? 1) });
    this.canDispatch = availableChars >= entries.length * 1000;
    const extra = Math.max(0, availableChars - entries.length * 1000);
    const weights = entries.reduce((total, entry) => total + entry.weight, 0);
    for (const entry of entries) this.reservations.set(entry.id, Math.min(256_000, 1000 + Math.floor(extra * entry.weight / weights)));
  }
  project<T extends TextResult>(id: string, prepare: (characters: number) => Promise<T>): Promise<T> { return prepare(this.reservations.get(id) ?? 48_000); }
  finish(id: string): void { this.reservations.delete(id); }
}
