/**
 * Match navigation policy for transcript search.
 *
 * The behaviour that is easy to get wrong and impossible to see in a screenshot:
 * navigation does **not** wrap. `next` at the last match stays on the last match,
 * `prev` at the first stays on the first, and an empty result never moves the
 * index. Two pure functions instead of two inline closures, so the contract can be
 * asserted without a transcript.
 */

/** Next match index. Stops at the last match; an empty result keeps the current one. */
export function nextMatchIndex(current: number, count: number): number {
  if (count <= 0) return current
  return current >= count - 1 ? current : current + 1
}

/** Previous match index. Stops at the first match; an empty result keeps the current one. */
export function previousMatchIndex(current: number, count: number): number {
  if (count <= 0) return current
  return current <= 0 ? current : current - 1
}

/**
 * Clamp an index onto a result set that changed size (a new query, a session
 * switch). Callers reset to 0 instead when the query changes; this exists for
 * the case where the count shrinks under a still-valid query.
 */
export function clampMatchIndex(current: number, count: number): number {
  if (count <= 0) return 0
  return current > count - 1 ? count - 1 : current
}
