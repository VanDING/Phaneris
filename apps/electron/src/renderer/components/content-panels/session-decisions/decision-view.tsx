/**
 * Shared primitives for the Run → Decisions surface.
 *
 * The fifth Run tab must not invent a sixth visual language, so every spec here
 * is copied from the tab it sits beside:
 *
 *   · page shell, status row, metric tiles, sections, KV grid, list boxes, cards
 *       ← TrajectoryOverview.tsx
 *   · 36px toolbar, 24px filter buttons, 16px divider, 26px select
 *       ← TrajectoryToolbar.module.css
 *   · 30px table rows, 3px selection rail, mono 10px time column, 9px turn chip
 *       ← TrajectoryTable.module.css
 *
 * The status tag reproduces that table's `kindTag` (18px / 4px radius / 10px
 * 600 / tracking .035em). The original is a CSS module inside `packages/ui` and
 * cannot be imported from the renderer, so the six utility classes are restated
 * here rather than re-deriving the look.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Ban, ChevronDown, Clock3, CornerDownRight, Info, Search, X } from 'lucide-react'
import type { SessionDecisionItem, SessionDecisionQuery, SessionDecisionTotals } from '@phaneris/shared/decisions/session'
import type { DecisionLayerFeature } from '@phaneris/shared/decisions/settings'
import { cn } from '@/lib/utils'

/** The Run panel switches to two columns at 720px and to full tables at 760px. */
export const DECISION_SPLIT_PX = 720
export const DECISION_WIDE_PX = 760

/* ── status vocabulary ──────────────────────────────────────────────────────
 * Three evidence layers, three answers. The host's handling wins when it
 * exists; otherwise the request layer decides. `failed` and `cancelled` are
 * reachable here on purpose — the previous derivation read them off
 * `application.status`, whose union (`applied | unchanged | fallback |
 * discarded | unknown`) cannot express either, so a record whose only evidence
 * was a failed request was shown as "unconfirmed" even when the user had
 * filtered for failures.
 */
export type DecisionStatus =
  | 'changed' | 'applied' | 'unchanged' | 'fallback' | 'discarded'
  | 'failed' | 'cancelled' | 'pending' | 'unconfirmed' | 'historical'

export function decisionStatus(item: SessionDecisionItem): DecisionStatus {
  if (item.legacy) return 'historical'
  const application = item.application
  if (application) {
    if (application.status === 'unknown') return 'unconfirmed'
    if (application.status === 'applied') return application.changed ? 'changed' : 'applied'
    return application.status
  }
  if (item.attempts.length > 0) {
    const attemptStatuses = new Set(item.attempts.map(attempt => attempt.status))
    if (attemptStatuses.has('pending')) return 'pending'
    if (attemptStatuses.has('failed') || attemptStatuses.has('timeout')) return 'failed'
    if (attemptStatuses.has('cancelled')) return 'cancelled'
    return 'unconfirmed'
  }
  // Entered the decision point but never issued a request: the configured
  // fallback path ran, which is a fallback rather than an unconfirmed answer.
  if (item.unavailableReason) return 'fallback'
  return 'unconfirmed'
}

/** Request-level failures stay visible on rows whose outcome is a fallback. */
export function hasFailedAttempt(item: SessionDecisionItem): boolean {
  return item.attempts.some(attempt => attempt.status === 'failed' || attempt.status === 'timeout')
}

type TagTone = 'business' | 'businessQuiet' | 'neutral' | 'warn' | 'error' | 'dim'

const STATUS_TONE: Record<DecisionStatus, TagTone> = {
  changed: 'business',
  applied: 'businessQuiet',
  unchanged: 'neutral',
  fallback: 'warn',
  discarded: 'dim',
  failed: 'error',
  cancelled: 'neutral',
  pending: 'business',
  unconfirmed: 'neutral',
  historical: 'dim',
}

/** `changed` is filled, `applied` keeps the brand hue on a neutral fill. Green
 *  is deliberately unused: a risk badge is informational, and a green pill
 *  reads as "approved" (design plan §3.3). */
const TAG_TONE_CLASS: Record<TagTone, string> = {
  business: 'bg-accent/[0.14] text-accent',
  businessQuiet: 'bg-foreground/5 text-accent',
  neutral: 'bg-foreground/5 text-muted-foreground',
  warn: 'bg-[color:var(--info)]/[0.16] text-[color:var(--info-text)]',
  error: 'bg-destructive/[0.12] text-destructive',
  dim: 'bg-foreground/5 text-muted-foreground/70',
}

const TAG_SHAPE: Record<DecisionStatus, 'filled' | 'ring'> = {
  changed: 'filled',
  applied: 'filled',
  unchanged: 'ring',
  fallback: 'filled',
  discarded: 'filled',
  failed: 'filled',
  cancelled: 'ring',
  pending: 'filled',
  unconfirmed: 'ring',
  historical: 'ring',
}

export function DecisionTag({ status, className }: { status: DecisionStatus; className?: string }) {
  const { t } = useTranslation()
  const label = t(`trajectory.decisions.status.${status}`)
  return (
    <span
      data-decision-status={status}
      className={cn(
        'inline-flex h-[18px] flex-none items-center gap-1 rounded-[4px] border border-transparent px-[5px] text-[10px] font-semibold leading-4 tracking-[0.035em] whitespace-nowrap select-none',
        TAG_TONE_CLASS[STATUS_TONE[status]],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-[5px] flex-none rounded-full bg-current',
          TAG_SHAPE[status] === 'ring' && 'bg-transparent ring-[1.5px] ring-current ring-inset',
        )}
      />
      {label}
    </span>
  )
}

/* ── formatting ───────────────────────────────────────────────────────────── */

/** Known cost only. An unknown request count is never rendered as $0.00. */
export function formatDecisionCost(value: number | undefined): string | null {
  if (value === undefined) return null
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}

export function formatDecisionTime(startedAt: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(startedAt))
}

export function formatDecisionTimestamp(startedAt: number, locale: string): string {
  return new Date(startedAt).toLocaleString(locale)
}

const FEATURE_LABEL_KEYS: Record<DecisionLayerFeature, string> = {
  decideTool: 'featureDecideTool', suggestions: 'featureSuggestions', adaptiveThinking: 'featureAdaptiveThinking',
  largeResults: 'featureLargeResults', midTurnMessages: 'featureMidTurnMessages', turnOutcome: 'featureTurnOutcome',
  smartTitles: 'featureSmartTitles', guardedMode: 'featureGuardedMode', riskBadges: 'featureRiskBadges',
  semanticLabels: 'featureSemanticLabels', automationConditions: 'featureAutomationConditions',
  taskVerdicts: 'featureTaskVerdicts', taskRepairs: 'featureTaskRepairs',
}

export function featureLabelKey(feature: DecisionLayerFeature): string {
  return `settings.ai.decisions.${FEATURE_LABEL_KEYS[feature]}`
}

/* ── status row ───────────────────────────────────────────────────────────── */

export function DecisionStatusRow({ meta, action }: {
  meta: string
  action?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border/50 pb-3">
      <span aria-hidden className="size-2 flex-none rounded-full bg-success" />
      <span className="text-[13px] font-semibold">{t('trajectory.decisions.title')}</span>
      <span className="ml-auto hidden min-w-0 truncate text-[11px] tabular-nums text-muted-foreground @min-[640px]/trajectory:block">{meta}</span>
      {action && <span className="hidden h-4 w-px flex-none bg-border @min-[640px]/trajectory:block" />}
      {action}
    </div>
  )
}

/* ── metric tiles ─────────────────────────────────────────────────────────── */

/** TrajectoryOverview: `grid-cols-2 gap-2 @min-[760px]/trajectory:grid-cols-4`
 *  + `rounded-lg bg-foreground/[0.025] px-3 py-2.5`. All four carry the same
 *  weight; decision cost is last, not a hero.
 *
 *  No tile carries a derived sub-count: the report summarises the whole scope,
 *  and "applied but unchanged" is not derivable from `SessionDecisionTotals`
 *  (`applied | unchanged | discarded` collapse into one remainder), so a note
 *  like "N unchanged" would silently include discarded records. */
export function DecisionTiles({ totals }: { totals: SessionDecisionTotals }) {
  const { t } = useTranslation()
  const cost = formatDecisionCost(totals.knownCostUsd)
  const costIsUnknown = !totals.knownCostRequests && (totals.unknownCostRequests > 0 || totals.legacyCalls > 0)
  const cells: Array<{ key: string; icon: ReactNode; value: string; note?: ReactNode }> = [
    { key: 'points', icon: <CornerDownRight className="size-3.5" />, value: totals.points.toLocaleString() },
    { key: 'changed', icon: <ArrowRight className="size-3.5" />, value: totals.changed.toLocaleString() },
    { key: 'fallback', icon: <Ban className="size-3.5" />, value: totals.fallback.toLocaleString() },
    {
      key: 'cost',
      icon: <Clock3 className="size-3.5" />,
      value: costIsUnknown ? t('common.unknown') : cost ?? t('common.unknown'),
      note: totals.unknownCostRequests > 0
        ? (
          <span
            title={t('trajectory.decisions.unknownCostNote', { count: totals.unknownCostRequests })}
            className="inline-flex h-[18px] flex-none items-center rounded-[4px] bg-[color:var(--info)]/[0.16] px-[5px] text-[10px] font-semibold tracking-[0.035em] text-[color:var(--info-text)]"
          >
            {t('trajectory.decisions.unknownCost', { count: totals.unknownCostRequests })}
          </span>
        )
        : undefined,
    },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 @min-[760px]/trajectory:grid-cols-4">
      {cells.map(cell => (
        <div key={cell.key} className="min-w-0 rounded-lg bg-foreground/[0.025] px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            {cell.icon}{t(`trajectory.decisions.${cell.key}`)}
          </dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-1.5">
            <span className="text-[16px] font-semibold tabular-nums">{cell.value}</span>
            {cell.note ?? null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ── toolbar ──────────────────────────────────────────────────────────────── */

/** The status filter is exactly the server's query contract
 *  (`changed | fallback | unconfirmed | failed | cancelled`), so the chips can
 *  never offer a bucket the server cannot answer. */
export const DECISION_STATUS_FILTERS: ReadonlyArray<NonNullable<SessionDecisionQuery['status']>> =
  ['changed', 'fallback', 'unconfirmed', 'failed', 'cancelled']

export function DecisionToolbar({ query, onChange, count, total, turns }: {
  query: SessionDecisionQuery
  onChange: (patch: Partial<SessionDecisionQuery>) => void
  count: number
  total: number
  turns: readonly string[]
}) {
  const { t } = useTranslation()
  return (
    <div className="sticky top-0 z-10 flex min-h-9 min-w-0 items-center gap-1 border-b border-border/55 bg-background/88 px-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          aria-pressed={!query.status}
          onClick={() => onChange({ status: undefined })}
          className={cn(
            'inline-flex h-6 flex-none items-center gap-1 rounded-lg px-1.5 text-[11px] leading-4 transition-colors',
            !query.status ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
          )}
        >
          {t('trajectory.decisions.allStatuses')}
        </button>
        {DECISION_STATUS_FILTERS.map(status => (
          <button
            key={status}
            type="button"
            aria-pressed={query.status === status}
            onClick={() => onChange({ status: query.status === status ? undefined : status })}
            className={cn(
              'inline-flex h-6 flex-none items-center gap-1 rounded-lg px-1.5 text-[11px] leading-4 transition-colors',
              query.status === status ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
            )}
          >
            {t(`trajectory.decisions.status.${status}`)}
          </button>
        ))}
      </div>
      {turns.length > 0 && (
        <>
          <span aria-hidden className="mx-1 h-4 w-px flex-none bg-border" />
          <span className="relative inline-flex flex-none items-center">
            <select
              aria-label={t('trajectory.decisions.turn')}
              value={query.turnId ?? ''}
              onChange={event => onChange({ turnId: event.target.value || undefined })}
              className="h-6 max-w-[140px] appearance-none rounded-lg bg-transparent px-1.5 pr-4 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              <option value="">{t('trajectory.decisions.allTurns')}</option>
              {turns.map(turn => <option key={turn} value={turn}>{turn}</option>)}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-1 size-3 text-muted-foreground" />
          </span>
        </>
      )}
      <span className="ml-auto flex-none px-1 text-[11px] tabular-nums text-muted-foreground">
        {t('trajectory.decisions.recordCount', { shown: count.toLocaleString(), total: total.toLocaleString() })}
      </span>
    </div>
  )
}

/* ── key/value grid ───────────────────────────────────────────────────────── */

export type DecisionKvRow = readonly [label: string, value: ReactNode, mono?: boolean]

/** TrajectoryOverview's environment list: label left, value right.
 *
 *  One column, always: the only consumer is the detail drawer, whose widest
 *  form is 420px. A two-column variant keyed off the *panel* width would put a
 *  pair of long ids side by side in a 420px pane. */
export function DecisionKv({ rows }: { rows: ReadonlyArray<DecisionKvRow | null> }) {
  const visible = rows.filter((row): row is DecisionKvRow => !!row)
  if (visible.length === 0) return null
  return (
    <dl className="grid gap-y-2 border-y border-border/50 py-3 text-[12px]">
      {visible.map(([label, value, mono]) => (
        <div key={label} className="flex min-w-0 items-center gap-3">
          <dt className="flex-none text-muted-foreground">{label}</dt>
          <dd className={cn('ml-auto min-w-0 truncate text-right font-medium', mono && 'font-mono text-[11px]')}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ── states ───────────────────────────────────────────────────────────────── */

export function DecisionNotice({ tone = 'neutral', icon, children }: {
  tone?: 'neutral' | 'info'
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11.5px] leading-5',
      tone === 'info' ? 'bg-[color:var(--info)]/[0.12] text-[color:var(--info-text)]' : 'bg-foreground/[0.025] text-muted-foreground',
    )}>
      <span className="mt-0.5 flex-none">{icon ?? <Info className="size-3.5" />}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function DecisionEmpty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-foreground/5 text-muted-foreground">
        <Search className="size-4" />
      </span>
      <p className="text-[12px] font-semibold">{title}</p>
      {hint && <p className="max-w-[42ch] text-[11.5px] leading-6 text-muted-foreground">{hint}</p>}
      {action}
    </div>
  )
}

export function DecisionSkeleton() {
  const row = (width: number, key: number) => (
    <div key={key} className="flex items-center gap-2 border-b border-border/45 px-3 py-2.5">
      <span className="size-5 shrink-0 animate-pulse rounded-md bg-foreground/10" />
      <span className="min-w-0 flex-1">
        <span className="block h-2.5 animate-pulse rounded bg-foreground/10" style={{ width: `${width}%` }} />
        <span className="mt-1.5 block h-2 animate-pulse rounded bg-foreground/10" style={{ width: `${Math.max(18, width - 24)}%` }} />
      </span>
      <span className="h-4 w-11 shrink-0 animate-pulse rounded-full bg-foreground/10" />
    </div>
  )
  return (
    <div aria-hidden>
      <div className="px-3 pt-3">
        <span className="block h-3.5 w-2/5 animate-pulse rounded bg-foreground/10" />
        <span className="mt-2 block h-2.5 w-3/5 animate-pulse rounded bg-foreground/10" />
        <div className="mt-3.5 grid grid-cols-2 gap-2 @min-[760px]/trajectory:grid-cols-4">
          {[0, 1, 2, 3].map(cell => <span key={cell} className="h-13 animate-pulse rounded-lg bg-foreground/[0.025]" />)}
        </div>
      </div>
      <div className="mt-3.5">{[86, 71, 78, 64, 80, 69].map((width, index) => row(width, index))}</div>
    </div>
  )
}

export function DecisionClearFilters({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded-lg bg-foreground/5 px-2 text-[11.5px] text-foreground transition-colors hover:bg-foreground/10"
    >
      <X className="size-3" />{t('trajectory.decisions.clearFilters')}
    </button>
  )
}
