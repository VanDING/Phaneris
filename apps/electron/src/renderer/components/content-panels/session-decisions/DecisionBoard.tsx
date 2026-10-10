/**
 * Run → Decisions.
 *
 * Read the same way as the four tabs beside it: status row → metric tiles →
 * sections (feature comparison, then decision records). There is deliberately
 * no second tab strip inside the tab — Run already has one, and nesting them
 * leaves the user unsure which level they are on.
 *
 * Two scopes are in play and must not be confused:
 *   · `report.totals` / `report.features` describe the WHOLE filtered scope
 *     (the server summarises the full projection, not the page), so the tiles
 *     and the matrix are scope-level numbers.
 *   · `report.items` is one page, so it may only drive the list and its count.
 *
 * Layout is driven by the measured panel width, never by an outer prop: the
 * Run panel is resizable, and a table rendered from a stale width overflows the
 * moment the panel shrinks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { SessionDecisionItem, SessionDecisionQuery, SessionDecisionReport } from '@phaneris/shared/decisions/session'
import type { DecisionLayerFeature } from '@phaneris/shared/decisions/settings'
import { Button } from '@/components/ui/button'
import { useSessionDecisions } from '@/hooks/useSessionDecisions'
import { useContainerWidth } from '@/hooks/useContainerWidth'
import { cn } from '@/lib/utils'
import { DecisionDetail } from './DecisionDetail'
import {
  DECISION_SPLIT_PX, DECISION_WIDE_PX,
  DecisionClearFilters, DecisionEmpty, DecisionSkeleton, DecisionStatusRow, DecisionTag, DecisionTiles, DecisionToolbar,
  decisionStatus, featureLabelKey, formatDecisionCost, formatDecisionTime, formatDecisionTimestamp, hasFailedAttempt,
} from './decision-view'

type Data = ReturnType<typeof useSessionDecisions>
type FeatureTotals = SessionDecisionReport['features']

const hasQuery = (query: SessionDecisionQuery): boolean => !!query.status || !!query.feature || !!query.turnId

/** `status:needs-review` renders as the localised action plus its payload. */
function actionText(
  action: string | undefined,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  const value = action ?? 'none'
  const [head, tail] = [value.split(':')[0] ?? value, value.split(':').slice(1).join(':')]
  return translate(`trajectory.decisions.action.${head}`, { defaultValue: value, value: tail })
}

/* ── feature comparison ───────────────────────────────────────────────────── */

/** TrajectoryTable's row metrics: 30px rows, `border-l1` rules, a right-aligned
 *  numeric column, and the share bar the design uses instead of a rate. */
function FeatureMatrix({ features, totals, query, onChange }: {
  features: FeatureTotals
  totals: SessionDecisionReport['totals']
  query: SessionDecisionQuery
  onChange: (patch: Partial<SessionDecisionQuery>) => void
}) {
  const { t } = useTranslation()
  const maxPoints = Math.max(1, ...features.map(entry => entry.totals.points))
  const columns = [
    ['points', t('trajectory.decisions.points'), 'points'],
    ['changed', t('trajectory.decisions.changed'), 'changed'],
    ['fallback', t('trajectory.decisions.fallback'), 'fallback'],
    ['failed', t('trajectory.decisions.status.failed'), 'failures'],
  ] as const
  const toggle = (feature: DecisionLayerFeature) => onChange({ feature: query.feature === feature ? undefined : feature })
  return (
    <table data-decision-matrix="table" className="w-full table-fixed border-collapse bg-background text-[12px] leading-[18px]">
      <thead>
        <tr>
          <th scope="col" className="h-[26px] border-b border-border/55 px-2 text-left text-[11px] font-medium text-muted-foreground">
            {t('trajectory.decisions.feature')}
          </th>
          {columns.map(([key, label]) => (
            <th key={key} scope="col" className="h-[26px] border-b border-border/55 px-2 text-right text-[11px] font-medium text-muted-foreground">
              {label}
            </th>
          ))}
          <th scope="col" className="h-[26px] w-24 border-b border-border/55 px-2 text-left text-[11px] font-medium text-muted-foreground">
            {t('trajectory.decisions.share')}
          </th>
          <th scope="col" className="h-[26px] border-b border-border/55 px-2 text-right text-[11px] font-medium text-muted-foreground">
            {t('trajectory.decisions.cost')}
          </th>
        </tr>
      </thead>
      <tbody>
        {features.map(entry => {
          const selected = query.feature === entry.feature
          const cost = formatDecisionCost(entry.totals.knownCostUsd)
          const costUnknown = !entry.totals.knownCostRequests
            && (entry.totals.unknownCostRequests > 0 || entry.totals.legacyCalls > 0)
          return (
            <tr
              key={entry.feature}
              data-decision-feature={entry.feature}
              aria-selected={selected}
              tabIndex={0}
              onClick={() => toggle(entry.feature)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                toggle(entry.feature)
              }}
              title={t('trajectory.decisions.featureCounts', { count: entry.totals.points, changed: entry.totals.changed })}
              className={cn(
                'cursor-pointer outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected && 'bg-accent/10',
              )}
            >
              <th scope="row" className={cn('h-[30px] min-w-0 truncate border-b border-border/55 px-2 text-left text-[12px] font-normal', selected && 'text-accent')}>
                {t(featureLabelKey(entry.feature))}
              </th>
              {columns.map(([key, , field]) => (
                <td
                  key={key}
                  className={cn(
                    'h-[30px] border-b border-border/55 px-2 text-right tabular-nums',
                    !entry.totals[field] && 'text-muted-foreground/60',
                  )}
                >
                  {entry.totals[field].toLocaleString()}
                </td>
              ))}
              <td className="h-[30px] border-b border-border/55 px-2">
                <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-foreground/10">
                  <span
                    className={cn('block h-full rounded-full', entry.totals.changed ? 'bg-accent/70' : 'bg-foreground/20')}
                    style={{ width: `${Math.max(3, (entry.totals.points / maxPoints) * 100)}%` }}
                  />
                </span>
              </td>
              <td className={cn(
                'h-[30px] border-b border-border/55 px-2 text-right font-mono text-[10px] tabular-nums',
                costUnknown && 'text-[color:var(--info-text)]',
              )}>
                {costUnknown ? t('common.unknown') : cost}
                {!costUnknown && entry.totals.unknownCostRequests > 0 && (
                  <span
                    className="ml-1 text-[color:var(--info-text)]"
                    title={t('trajectory.decisions.unknownCostNote', { count: entry.totals.unknownCostRequests })}
                  >
                    +{entry.totals.unknownCostRequests}?
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr className="text-[11px] text-muted-foreground">
          <th scope="row" className="h-[30px] border-t border-border/55 px-2 text-left font-normal">{t('trajectory.decisions.total')}</th>
          <td className="h-[30px] border-t border-border/55 px-2 text-right tabular-nums">{totals.points.toLocaleString()}</td>
          <td className="h-[30px] border-t border-border/55 px-2 text-right tabular-nums">{totals.changed.toLocaleString()}</td>
          <td className="h-[30px] border-t border-border/55 px-2 text-right tabular-nums">{totals.fallback.toLocaleString()}</td>
          <td className="h-[30px] border-t border-border/55 px-2 text-right tabular-nums">{totals.failures.toLocaleString()}</td>
          <td className="h-[30px] border-t border-border/55 px-2" />
          <td className="h-[30px] border-t border-border/55 px-2 text-right font-mono text-[10px] tabular-nums">
            {formatDecisionCost(totals.knownCostUsd) ?? t('common.unknown')}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

/** Narrow panels get the record list's row shape instead of a 7-column table. */
function FeatureList({ features, query, onChange }: {
  features: FeatureTotals
  query: SessionDecisionQuery
  onChange: (patch: Partial<SessionDecisionQuery>) => void
}) {
  const { t } = useTranslation()
  return (
    <div data-decision-matrix="list" className="overflow-hidden rounded-lg border border-border/55 bg-background/70">
      {features.map(entry => {
        const selected = query.feature === entry.feature
        const cost = formatDecisionCost(entry.totals.knownCostUsd)
        const costUnknown = !entry.totals.knownCostRequests
          && (entry.totals.unknownCostRequests > 0 || entry.totals.legacyCalls > 0)
        return (
          <button
            key={entry.feature}
            type="button"
            data-decision-feature={entry.feature}
            aria-pressed={selected}
            onClick={() => onChange({ feature: selected ? undefined : entry.feature })}
            className={cn(
              'flex w-full items-center gap-2 border-b border-border/45 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-foreground/[0.025]',
              selected && 'bg-accent/10',
            )}
          >
            <span className={cn('min-w-0 flex-1 truncate text-[12px]', selected && 'text-accent')}>
              {t(featureLabelKey(entry.feature))}
            </span>
            <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
              {t('trajectory.decisions.featureCounts', { count: entry.totals.points, changed: entry.totals.changed })}
            </span>
            <span className={cn(
              'flex-none font-mono text-[10px] tabular-nums text-muted-foreground',
              costUnknown && 'text-[color:var(--info-text)]',
            )}>
              {costUnknown ? t('common.unknown') : cost}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── record rows ──────────────────────────────────────────────────────────── */

function attemptCost(item: SessionDecisionItem): number | undefined {
  return item.attempts.reduce<number | undefined>(
    (sum, attempt) => attempt.costUsd === undefined ? sum : (sum ?? 0) + attempt.costUsd,
    undefined,
  )
}

/** The Run table's row metrics: 30px, a 3px rail, a 9px mono turn chip and a
 *  mono cost column. The rail is red when a request failed even if the outcome
 *  was a fallback — otherwise filtering for failures would return rows with no
 *  visible reason for matching. */
function RecordTable({ items, selectedId, locale, onSelect }: {
  items: readonly SessionDecisionItem[]
  selectedId?: string
  locale: string
  onSelect: (item: SessionDecisionItem) => void
}) {
  const { t } = useTranslation()
  const columns = [
    ['time', t('trajectory.decisions.time'), 'w-[90px]', 'text-left'],
    ['feature', t('trajectory.decisions.feature'), 'w-[176px]', 'text-left'],
    ['action', t('trajectory.decisions.action'), undefined, 'text-left'],
    ['status', t('trajectory.decisions.status'), 'w-[112px]', 'text-left'],
    ['cost', t('trajectory.decisions.cost'), 'w-[88px]', 'text-right'],
  ] as const
  return (
    <table data-decision-records="table" className="w-full table-fixed border-collapse bg-background text-[12px] leading-[18px]">
      <thead>
        <tr>
          {columns.map(([key, label, width, align]) => (
            <th
              key={key}
              scope="col"
              className={cn(
                'sticky top-9 z-10 h-[26px] overflow-hidden border-b border-border/55 bg-background/95 px-2 text-[11px] font-medium whitespace-nowrap text-ellipsis text-muted-foreground backdrop-blur',
                width, align,
              )}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const status = decisionStatus(item)
          const selected = item.id === selectedId
          const failed = hasFailedAttempt(item)
          const cost = attemptCost(item)
          const action = item.application?.action ?? item.recommendation?.action
          return (
            <tr
              key={item.id}
              data-decision-id={item.id}
              aria-selected={selected}
              tabIndex={0}
              onClick={() => onSelect(item)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelect(item)
              }}
              className={cn(
                'cursor-pointer outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected && 'bg-accent/10',
              )}
            >
              <th scope="row" className="relative h-[30px] truncate border-b border-border/55 px-2 text-left font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
                {(selected || failed) && (
                  <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', failed ? 'bg-destructive' : 'bg-accent')} />
                )}
                {formatDecisionTime(item.startedAt, locale)}
              </th>
              <td className="h-[30px] border-b border-border/55 px-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="max-w-[64px] flex-none truncate rounded-[3px] bg-foreground/5 px-1 font-mono text-[9px] tabular-nums text-muted-foreground">
                    {item.source?.turnId ?? t('trajectory.decisions.sessionLevel')}
                  </span>
                  <span className="min-w-0 truncate">{t(featureLabelKey(item.feature))}</span>
                </span>
              </td>
              <td className="h-[30px] truncate border-b border-border/55 px-2">{actionText(action, t)}</td>
              <td className="h-[30px] border-b border-border/55 px-2"><DecisionTag status={status} /></td>
              <td className={cn(
                'h-[30px] border-b border-border/55 px-2 text-right font-mono text-[10px] tabular-nums',
                cost === undefined && 'text-[color:var(--info-text)]',
              )}>
                {cost === undefined ? t('common.unknown') : formatDecisionCost(cost)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RecordRow({ item, selected, locale, onSelect }: {
  item: SessionDecisionItem
  selected: boolean
  locale: string
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const status = decisionStatus(item)
  const failed = hasFailedAttempt(item)
  const cost = attemptCost(item)
  const action = item.application?.action ?? item.recommendation?.action
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      data-decision-id={item.id}
      data-decision-status={status}
      data-decision-failed={failed || undefined}
      className={cn(
        'relative flex w-full items-center gap-2.5 border-b border-border/45 px-3 py-2 text-left transition-colors last:border-b-0',
        'hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-accent/10',
      )}
    >
      {(selected || failed) && (
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', failed ? 'bg-destructive' : 'bg-accent')} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] leading-[18px]">{actionText(action, t)}</span>
        <span className="mt-px flex items-center gap-1.5 overflow-hidden text-[11px] leading-4 text-muted-foreground">
          {item.source?.turnId
            ? <span className="max-w-[64px] flex-none truncate rounded-[3px] bg-foreground/5 px-1 font-mono text-[9px] tabular-nums">{item.source.turnId}</span>
            : <span className="flex-none">{t('trajectory.decisions.sessionLevel')}</span>}
          <span aria-hidden className="text-border">·</span>
          <span className="min-w-0 flex-none truncate">{t(featureLabelKey(item.feature))}</span>
          <span aria-hidden className="text-border">·</span>
          <span className="flex-none tabular-nums">{formatDecisionTime(item.startedAt, locale)}</span>
        </span>
      </span>
      <DecisionTag status={status} />
      <span className={cn(
        'flex-none font-mono text-[10px] tabular-nums text-muted-foreground',
        cost === undefined && 'text-[color:var(--info-text)]',
      )}>
        {cost === undefined ? t('common.unknown') : formatDecisionCost(cost)}
      </span>
    </button>
  )
}

/* ── detail drawer ────────────────────────────────────────────────────────── */

/** Inside the panel, never portalled: the Run panel is a bounded region and a
 *  modal portal would cover the whole app. Wide panels keep the list usable
 *  (non-modal, no scrim); narrow panels get a real modal bottom sheet. */
function DecisionDrawer({ item, modal, locale, onClose, onOpenChat }: {
  item: SessionDecisionItem
  modal: boolean
  locale: string
  onClose: () => void
  onOpenChat: (messageId: string) => void
}) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement>(null)
  const action = item.application?.action ?? item.recommendation?.action
  useEffect(() => { closeRef.current?.focus() }, [item.id])
  return (
    <>
      {modal && <div className="absolute inset-0 z-20 bg-black/20" onClick={onClose} aria-hidden />}
      <aside
        role="dialog"
        aria-modal={modal}
        aria-label={t('trajectory.decisions.recordDetail')}
        data-decision-detail={item.id}
        className={cn(
          'absolute z-30 flex flex-col overflow-hidden bg-background',
          modal
            ? 'inset-x-0 bottom-0 max-h-[88%] rounded-t-xl border-t border-border/55'
            : 'inset-y-0 right-0 w-[min(420px,62%)] border-l border-border/55',
        )}
      >
        {modal && <span aria-hidden className="mx-auto mt-1.5 h-1 w-8 flex-none rounded-full bg-border" />}
        <header className="flex flex-none items-center gap-2 border-b border-border/55 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold">{actionText(action, t)}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {t(featureLabelKey(item.feature))} · {formatDecisionTimestamp(item.startedAt, locale)}
            </span>
          </span>
          <DecisionTag status={decisionStatus(item)} />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-6 flex-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-8">
          <DecisionDetail item={item} onOpenChat={onOpenChat} />
        </div>
      </aside>
    </>
  )
}

/* ── board ────────────────────────────────────────────────────────────────── */

export function DecisionBoard({ sessionId, workspaceId, serverScope, data, onOpenChat, onConfigure }: {
  sessionId: string
  workspaceId?: string
  serverScope?: string
  data: Data
  onOpenChat: (messageId: string) => void
  onConfigure: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useContainerWidth(rootRef)
  // 0 means "not measured yet" — treat it as narrow so a table can never
  // overflow before the first measurement lands.
  const wide = width >= DECISION_WIDE_PX
  const split = width >= DECISION_SPLIT_PX

  const [query, setQuery] = useState<SessionDecisionQuery>({})
  const [selectedId, setSelectedId] = useState<string>()
  const [matrixOpen, setMatrixOpen] = useState<boolean>()

  const scoped = hasQuery(query)
  // The unfiltered view reuses the report TrajectoryPanel already loads, so the
  // panel never issues the same query twice.
  const filtered = useSessionDecisions(sessionId, workspaceId, query, scoped, serverScope)
  const view: Data = scoped || filtered.report ? filtered : data
  const report = view.report
  const base = data.report
  const open = matrixOpen ?? wide
  const selected = useMemo(
    () => report?.items.find(item => item.id === selectedId),
    [report, selectedId],
  )

  const patchQuery = useCallback((patch: Partial<SessionDecisionQuery>) => {
    setQuery(current => ({ ...current, ...patch }))
    setSelectedId(undefined)
  }, [])
  const clearQuery = useCallback(
    () => patchQuery({ status: undefined, feature: undefined, turnId: undefined }),
    [patchQuery],
  )

  useEffect(() => {
    if (!selectedId) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(undefined) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  const meta = t('trajectory.decisions.scopeMeta', {
    features: report?.features.length ?? 0,
    requests: report?.totals.requests ?? 0,
  })

  return (
    <div ref={rootRef} data-session-decisions={sessionId} className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-foreground/[0.012] px-3 py-3 pb-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <DecisionStatusRow
            meta={meta}
            action={(
              <button
                type="button"
                onClick={onConfigure}
                className="flex-none rounded-sm text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('trajectory.decisions.configure')}
              </button>
            )}
          />

          {view.state === 'loading' && !report
            ? <DecisionSkeleton />
            : view.state === 'error'
              ? (
                <DecisionEmpty
                  title={t('trajectory.decisions.loadFailed')}
                  hint={t('trajectory.decisions.retryHint')}
                  action={<Button size="sm" variant="secondary" onClick={view.retry}>{t('common.retry')}</Button>}
                />
              )
              : view.state === 'unsupported'
                ? <DecisionEmpty title={t('trajectory.decisions.unsupported')} />
                : !report
                  ? <DecisionSkeleton />
                  : (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <DecisionTiles totals={report.totals} />
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          {t('trajectory.decisions.accounting', {
                            requests: report.totals.requests.toLocaleString(),
                            unconfirmed: report.totals.unconfirmed.toLocaleString(),
                            failures: report.totals.failures.toLocaleString(),
                            cancelled: report.totals.cancelled.toLocaleString(),
                            input: report.totals.inputTokens.toLocaleString(),
                            output: report.totals.outputTokens.toLocaleString(),
                          })}{' '}
                          {t('trajectory.decisions.includedCost')}
                          <br />{t('trajectory.decisions.scope')}
                        </p>
                        {/* Caveats share one line so four sentences do not become four rows. */}
                        {(report.coverage === 'partial' || report.totals.legacyCalls > 0 || (base && !base.enabled)) && (
                          <p className="text-[11px] leading-5 text-muted-foreground">
                            {[
                              report.coverage === 'partial' ? t('trajectory.decisions.partial') : null,
                              report.totals.legacyCalls > 0
                                ? t('trajectory.decisions.legacyCalls', { count: report.totals.legacyCalls })
                                : null,
                              base && !base.enabled ? t('trajectory.decisions.disabled') : null,
                            ].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>

                      {report.features.length > 0 && (
                        <section className="flex min-w-0 flex-col">
                          <div className="mb-2 flex min-w-0 items-center gap-2">
                            <h3 className="text-[12px] font-semibold">{t('trajectory.decisions.features')}</h3>
                            <span className="text-[11px] tabular-nums text-muted-foreground">{report.features.length}</span>
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setMatrixOpen(!open)}
                              className="ml-auto inline-flex flex-none items-center gap-1 rounded-sm text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {open ? t('trajectory.decisions.matrixCollapse') : t('trajectory.decisions.matrixExpand')}
                              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            </button>
                          </div>
                          {open && (wide
                            ? (
                              <>
                                <FeatureMatrix features={report.features} totals={report.totals} query={query} onChange={patchQuery} />
                                <p className="pt-1.5 text-[10px] leading-4 text-muted-foreground/70">
                                  {t('trajectory.decisions.costLegend')}
                                </p>
                              </>
                            )
                            : <FeatureList features={report.features} query={query} onChange={patchQuery} />)}
                        </section>
                      )}

                      <section className="flex min-w-0 flex-col">
                        <div className="mb-2 flex min-w-0 items-center gap-2">
                          <h3 className="text-[12px] font-semibold">{t('trajectory.decisions.records')}</h3>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {report.items.length.toLocaleString()}
                          </span>
                          {scoped && <span className="ml-auto"><DecisionClearFilters onClick={clearQuery} /></span>}
                        </div>
                        <DecisionToolbar
                          query={query}
                          onChange={patchQuery}
                          count={report.items.length}
                          total={report.totals.points + report.totals.legacyCalls}
                          turns={base?.turnIds ?? report.turnIds}
                        />
                        {report.items.length === 0
                          ? (
                            <DecisionEmpty
                              title={scoped ? t('trajectory.decisions.noMatches') : t('trajectory.decisions.empty')}
                              hint={scoped ? undefined : t('trajectory.decisions.emptyHint')}
                              action={scoped ? <DecisionClearFilters onClick={clearQuery} /> : undefined}
                            />
                          )
                          : wide
                            ? <RecordTable items={report.items} selectedId={selectedId} locale={locale} onSelect={item => setSelectedId(item.id)} />
                            : (
                              <div data-decision-records="list" className="overflow-hidden rounded-lg border border-border/55 bg-background/70">
                                {report.items.map(item => (
                                  <RecordRow
                                    key={item.id}
                                    item={item}
                                    selected={item.id === selectedId}
                                    locale={locale}
                                    onSelect={() => setSelectedId(item.id)}
                                  />
                                ))}
                              </div>
                            )}
                        {report.nextCursor && (
                          <div className="mt-3 flex justify-center">
                            <Button size="sm" variant="secondary" disabled={view.paging} onClick={view.loadMore}>
                              {view.paging ? t('common.loading') : t('trajectory.decisions.loadMore')}
                            </Button>
                          </div>
                        )}
                      </section>
                    </>
                  )}
        </div>
      </div>

      {selected && (
        <DecisionDrawer
          item={selected}
          modal={!split}
          locale={locale}
          onClose={() => setSelectedId(undefined)}
          onOpenChat={onOpenChat}
        />
      )}
    </div>
  )
}
