/** Optional app threshold in tokens; the active model supplies the upper bound. */
export function isCompactionThreshold(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 4096);
}

export function effectiveCompactionReserve(contextWindow: number, sdkReserve: number, threshold?: number | null): number {
  if (threshold == null) return sdkReserve;
  return Math.max(sdkReserve, contextWindow - threshold);
}
