/** Current model-context occupancy, separate from cumulative/billable token usage. */
export interface ContextUsageSnapshot {
  /** null means the context changed and no fresh count is available yet. */
  usedTokens: number | null;
  /** Complete model window from the SDK, before subtracting compaction reserves. */
  contextWindow?: number;
  /** Resolved backend window, not necessarily the model's advertised capacity. */
  limitTokens?: number;
  limitKind: 'compaction' | 'context';
  isEstimate: boolean;
  isStale: boolean;
  canCompact: boolean;
}
