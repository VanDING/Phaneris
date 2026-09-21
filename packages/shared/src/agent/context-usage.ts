/**
 * Occupancy normalization shared by every backend adapter.
 *
 * The raw counts come from the backend SDK (context window, compaction reserve,
 * post-compaction estimate). Keeping the arithmetic here means the host and the
 * renderer never re-derive the same "window minus reserve" limit — and never
 * fall back to billable API usage, which is a different quantity.
 */

import type { ContextUsageSnapshot } from '@phaneris/core/types';

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.ceil(value)
    : undefined;
}

/** A compaction boundary invalidates the old count even when no new estimate is supplied. */
export function contextAfterCompaction(
  postTokens: unknown,
  previous?: ContextUsageSnapshot,
): ContextUsageSnapshot {
  const count = tokenCount(postTokens);
  return {
    ...(previous?.limitTokens && { limitTokens: previous.limitTokens }),
    usedTokens: count ?? null,
    limitKind: previous?.limitKind ?? 'compaction',
    isEstimate: true,
    isStale: count === undefined,
    canCompact: previous?.canCompact ?? true,
  };
}

/** Pass the SDK's own snapshot/settings; do not duplicate its default reserve in the host/UI. */
export function contextFromPi(
  value: { tokens: number | null; contextWindow: number } | undefined,
  settings?: { enabled: boolean; reserveTokens: number },
  postCompactionEstimate?: number,
): ContextUsageSnapshot | undefined {
  if (!value) return undefined;
  const usedTokens = tokenCount(postCompactionEstimate) ?? tokenCount(value.tokens);
  const window = tokenCount(value.contextWindow);
  const reserve = settings?.enabled ? tokenCount(settings.reserveTokens) : undefined;
  const limit = window !== undefined && reserve !== undefined ? window - reserve : window;
  return {
    usedTokens: usedTokens ?? null,
    ...(limit !== undefined && limit > 0 && { limitTokens: limit }),
    limitKind: reserve !== undefined ? 'compaction' : 'context',
    isEstimate: true,
    isStale: usedTokens === undefined,
    canCompact: true,
  };
}
