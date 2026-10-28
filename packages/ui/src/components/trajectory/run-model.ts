/**
 * Shared model for the Run views.
 *
 * Everything here is presentation-neutral: category identity, number and time
 * formatting, and the bounded chart projections the Overview and Context views
 * share. Keeping one implementation means the trend chart, the composition bar
 * and the fold list can never disagree about what a category is or how a total
 * is counted.
 */

import type { SessionDecisionOutcome, SessionDecisionTotals } from '@phaneris/shared/decisions/session'
import type { TrajectoryRequestContext } from './trajectory-context'
import { contextTotal, contextGroupTokens, requestContextDelta, CONTEXT_CATEGORY_ORDER } from './trajectory-context'

export type { SessionDecisionOutcome }

/** Decision facts the Overview's impact card needs, independent of the report transport. */
export interface RunDecisionSummary {
  state: 'loading' | 'ready' | 'error' | 'unsupported'
  enabled: boolean
  points: number
  requests: number
  changed: number
  unchanged: number
  fallback: number
  discarded: number
  unconfirmed: number
  failures: number
  knownCostUsd: number
  knownCostRequests: number
  unknownCostRequests: number
  legacyCalls: number
}

/** Reliability facts flattened from the retained runtime ledger; numbers stay unknown when absent. */
export interface RunReliabilityFacts {
  state: 'available' | 'unavailable' | 'loading'
  terminalCounts?: Readonly<Record<string, number>>
  unsettled?: number
  unsettledOldestMs?: number | null
  taskBudgets?: ReadonlyArray<{ limit: number | null; used: number | null }>
  signals?: ReadonlyArray<{ kind: 'repeated-action' | 'repeated-error'; toolName: string; count: number }>
  sdkRetries?: number
}

/** One bar of the shared trend chart. */
export interface RunTrendBar {
  key: string
  requestSeq: number
  /** Display label for bucketed ranges (both endpoints differ). */
  range?: { start: number; end: number }
  /** Content attribution plus an explicit remainder of measured input. */
  parts: ReadonlyArray<{ category: string; tokens: number }>
  total: number
  /** Net change for the delta mode; undefined in the cumulative mode. */
  change?: number
}

const compactDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** 86400 → 86.4K, 12_800_000 → 12.8M. */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${compactDecimal.format(value / 1_000_000)}M`
  if (magnitude >= 1_000) return `${compactDecimal.format(value / 1_000)}K`
  return Math.round(value).toLocaleString()
}

export function formatExactTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString()
}

/** Signed compact delta: +51.4K / −3.2K. Uses a real minus sign, not a hyphen. */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${formatTokens(Math.abs(value))}`
}

/** Known cost only. Unknown is rendered by the caller, never as $0.00. */
export function formatCost(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return `$${value.toFixed(value < 0.01 ? 4 : 3)}`
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) return '—'
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatClock(timestamp: number | undefined): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp))
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  return `${seconds < 10 ? seconds.toFixed(2) : Math.round(seconds).toLocaleString()}s`
}

export const CATEGORY_ORDER = CONTEXT_CATEGORY_ORDER

export function categoryColor(category: string): string {
  return `var(--run-cat-${category})`
}

/** Category label key; the view resolves it through `t`. */
export function categoryLabelKey(category: string): string {
  return `run.category.${category}`
}

/** Per-request cache reads / all input. A missing or zero denominator is unknown. */
export function cacheHitRate(context: TrajectoryRequestContext | undefined): number | undefined {
  const input = context?.inputTokens, read = context?.cacheReadTokens
  if (input === undefined || read === undefined || !Number.isFinite(input) || !Number.isFinite(read)
    || input <= 0 || read < 0 || read > input) return undefined
  return read / input
}

/**
 * Build bounded trend bars. A run with at most `maximumBars` requests keeps one
 * bar per request; a longer run covers the entire range and retains the total
 * peak or the largest absolute signed change in each bucket.
 */
export function buildTrendBars(
  contexts: readonly TrajectoryRequestContext[],
  maximumBars: number,
  mode: 'total' | 'delta',
): readonly RunTrendBar[] {
  if (contexts.length === 0) return []
  const count = Math.min(contexts.length, Math.max(1, Math.floor(maximumBars)))
  const totals = contexts.map(contextTotal)
  const changes = contexts.map((context, index) => requestContextDelta(context, index > 0 ? contexts[index - 1] : undefined))
  const bars: RunTrendBar[] = []
  for (let index = 0; index < count; index += 1) {
    const startIndex = Math.floor((index * contexts.length) / count)
    const endIndex = Math.max(startIndex + 1, Math.floor(((index + 1) * contexts.length) / count))
    const entries = contexts.slice(startIndex, endIndex)
    let selectedIndex = startIndex
    const magnitude = (entryIndex: number) => mode === 'total' ? totals[entryIndex]!
      : changes[entryIndex] !== undefined ? Math.abs(changes[entryIndex]!) : -1
    for (let entryIndex = startIndex + 1; entryIndex < endIndex; entryIndex += 1) {
      if (magnitude(entryIndex) >= magnitude(selectedIndex)) selectedIndex = entryIndex
    }
    const peak = contexts[selectedIndex]!
    const change = mode === 'delta' ? changes[selectedIndex] : undefined
    bars.push({
      key: `${peak.id}:${index}`,
      requestSeq: peak.requestSeq,
      range: entries.length > 1 ? { start: entries[0]!.requestSeq, end: entries.at(-1)!.requestSeq } : undefined,
      parts: peak.groups.map(group => ({ category: group.category, tokens: contextGroupTokens(group) ?? 0 })),
      total: contextTotal(peak),
      change,
    })
  }
  return bars
}

/** Data-driven scale with headroom and readable quarter ticks, independent of capacity. */
export function trendAxisMaximum(bars: readonly RunTrendBar[], mode: 'total' | 'delta'): number {
  const values = bars.map(bar => mode === 'delta' ? Math.abs(bar.change ?? 0) : bar.total)
  const peak = Math.max(0, ...values.filter(value => Number.isFinite(value) && value > 0))
  if (peak === 0) return 4
  const interval = peak * 1.1 / 4
  const unit = 10 ** Math.floor(Math.log10(interval))
  const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(value => value * unit >= interval) ?? 10
  return Math.max(4, Math.ceil(step * unit * 4))
}

export function formatAxisTick(value: number): string {
  if (value === 0) return '0'
  return formatTokens(value)
}

export interface RunCategoryRow {
  category: string
  labelKey: string
  color: string
  tokens: number | undefined
  share: number
  count: number
}

/** One row per category present in a context, in the shared category order. */
export function categoryRows(context: TrajectoryRequestContext | undefined): readonly RunCategoryRow[] {
  if (!context) return []
  return CATEGORY_ORDER.flatMap(category => {
    const group = context.groups.find(entry => entry.category === category)
    if (!group) return []
    return [{
      category,
      labelKey: categoryLabelKey(category),
      color: categoryColor(category),
      tokens: contextGroupTokens(group),
      share: group.share,
      count: group.items.length,
    }]
  })
}

export function decisionOutcomeColor(outcome: SessionDecisionOutcome): string {
  return {
    changed: 'var(--run-accent)',
    unchanged: 'var(--run-strong-line)',
    fallback: 'var(--run-cat-schemas)',
    discarded: 'var(--run-line)',
    unconfirmed: 'var(--run-muted)',
  }[outcome]
}

export function decisionOutcomeLabelKey(outcome: SessionDecisionOutcome | 'failed' | 'cancelled'): string {
  return `run.decision.outcome.${outcome}`
}

export const DECISION_OUTCOMES: readonly SessionDecisionOutcome[] = ['changed', 'unchanged', 'fallback', 'discarded', 'unconfirmed']

/** Totals for one feature row; `changed` and cost are the columns the design shows. */
export function featureTotalsOf(totals: SessionDecisionTotals): Pick<SessionDecisionTotals, 'points' | 'changed' | 'knownCostUsd' | 'knownCostRequests' | 'unknownCostRequests'> {
  return {
    points: totals.points,
    changed: totals.changed,
    knownCostUsd: totals.knownCostUsd,
    knownCostRequests: totals.knownCostRequests,
    unknownCostRequests: totals.unknownCostRequests,
  }
}
