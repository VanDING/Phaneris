/** Numeric values are legacy token limits; new settings use a model-relative percentage. */
export type CompactionThreshold = number | { percent: number } | null;

export function isCompactionThreshold(value: unknown): value is CompactionThreshold {
  if (value === null) return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 4096;
  if (!value || typeof value !== 'object' || !('percent' in value)) return false;
  return typeof value.percent === 'number' && Number.isInteger(value.percent) && value.percent >= 1 && value.percent <= 99;
}

export function effectiveCompactionReserve(contextWindow: number, sdkReserve: number, threshold?: CompactionThreshold): number {
  if (threshold == null) return sdkReserve;
  const tokens = typeof threshold === 'number' ? threshold : Math.floor(contextWindow * threshold.percent / 100);
  return Math.max(sdkReserve, contextWindow - tokens);
}
