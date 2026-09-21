import type { Session } from '../../shared/types'

/**
 * Context occupancy projected into the shape the context badge consumes.
 *
 * Occupancy is its own axis: `tokenUsage.contextTokens` is derived from the last
 * assistant message, so right after a compaction it still carries the
 * pre-compaction number until the next turn lands. The SDK's authoritative
 * snapshot wins whenever one exists; `usedTokens: null` means the context changed
 * and no fresh count is available yet, which the badge renders as unknown instead
 * of a stale number (never a percentage derived from one).
 */
export interface ContextBadgeUsage {
  /** Tokens currently occupying the context; undefined when there is no fresh count. */
  inputTokens?: number
  /** Badge denominator (the model's context window) when known. */
  contextWindow?: number
  /** A snapshot exists but reports no fresh count (stale/unknown occupancy). */
  isUsageUnknown: boolean
}

export function contextBadgeUsage(tokenUsage: Session['tokenUsage'] | undefined): ContextBadgeUsage {
  const snapshot = tokenUsage?.contextUsage
  return {
    // No snapshot at all (older backend / session not yet counted) keeps the
    // derived ledger count; a snapshot is authoritative, including its null.
    inputTokens: snapshot ? snapshot.usedTokens ?? undefined : tokenUsage?.contextTokens,
    // `limitKind: 'compaction'` makes `limitTokens` the compaction threshold rather
    // than the model window, so it is only usable as a denominator when it *is* the
    // window. The ledger's contextWindow stays the primary source.
    contextWindow:
      tokenUsage?.contextWindow ?? (snapshot?.limitKind === 'context' ? snapshot.limitTokens : undefined),
    isUsageUnknown: snapshot != null && snapshot.usedTokens == null,
  }
}
