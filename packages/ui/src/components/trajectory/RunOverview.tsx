/**
 * Run → Overview.
 *
 * Reading order follows the reviewed prototype: run facts first, then what
 * needs attention (failed records, the slowest tool), then context evolution and
 * current occupancy, then output performance and decision impact, and finally
 * the always-present diagnostics and environment cards.
 *
 * Every number names its scope. Category values are estimates; provider usage
 * is a separate measurement. Missing samples stay empty instead of becoming
 * zero, and legacy records state what was not captured rather than guessing.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, Clock3, Coins, Layers, Wrench, ArrowRight, RefreshCw } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { TrajectorySnapshot } from './trajectory-contract'
import type { TrajectoryContextSummary } from './TrajectoryView'
import type { TrajectoryRenderRecord, TrajectoryTurnModel } from './trajectory-layout'
import { formatDurationMillis } from './trajectory-layout'
import { recordDisplayText } from './trajectory-search-index'
import { categoryRows, decisionOutcomeColor, formatClock, formatCost, formatDuration, formatTokens, buildTrendBars, trendAxisMaximum, type RunDecisionSummary, type RunReliabilityFacts, type SessionDecisionOutcome, DECISION_OUTCOMES } from './run-model'
import { deriveRequestContextEvents, deriveRequestContexts, contextTotal, type TrajectoryContextCategory } from './trajectory-context'
import { deriveTrajectoryPerformance } from './trajectory-performance'
import { RunPerformanceChart, RunTrendChart, trendValueLabel } from './RunCharts'
import { RunRequestUsage } from './RunRequestUsage'
import css from './run-view.module.css'

export interface RunOverviewProps {
  snapshot: TrajectorySnapshot
  turns: readonly TrajectoryTurnModel[]
  records: readonly TrajectoryRenderRecord[]
  isProcessing?: boolean
  contextSummary?: TrajectoryContextSummary
  decisionSummary?: RunDecisionSummary
  reliability?: RunReliabilityFacts
  onOpenTrajectory: (index?: number) => void
  onOpenContext: (requestSeq?: number, category?: string) => void
  onOpenDecisions: () => void
  onOpenDecisionIssues: (status: 'failed' | 'fallback') => void
}

const MAX_TREND_BARS = 72

function formatTimestamp(value: number | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function RunOverview({
  snapshot, turns, records, isProcessing, contextSummary, decisionSummary, reliability,
  onOpenTrajectory, onOpenContext, onOpenDecisions, onOpenDecisionIssues,
}: RunOverviewProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const contentRecords = useMemo(() => records.filter(record => record.collapsedSummary === undefined), [records])
  const toolRecords = useMemo(() => contentRecords.filter(record => record.cell.kind === 'tool' || record.cell.kind === 'subtool'), [contentRecords])
  const errorRecords = useMemo(() => contentRecords.filter(record => record.cell.isError), [contentRecords])
  const contexts = useMemo(() => deriveRequestContexts(snapshot), [snapshot])
  const contextEvents = useMemo(() => deriveRequestContextEvents(snapshot, contexts), [snapshot, contexts])
  const performance = useMemo(() => deriveTrajectoryPerformance(snapshot, records), [snapshot, records])
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const latestSeq = contexts.at(-1)?.requestSeq
  const activeSeq = selectedSeq !== null && contexts.some(context => context.requestSeq === selectedSeq)
    ? selectedSeq
    : latestSeq
  const activeContext = contexts.find(context => context.requestSeq === activeSeq)
  const activeIndex = contexts.findIndex(context => context.requestSeq === activeSeq)

  const durationMs = snapshot.timeRange ? Math.max(0, snapshot.timeRange.end - snapshot.timeRange.start) : null
  const turnCount = turns.filter(turn => turn.turn !== null).length
  const failedTools = toolRecords.filter(record => record.cell.isError)
  const cost = contextSummary?.costUsd ?? snapshot.totalUsage?.cost.total
  const costLabel = formatCost(cost)
  const unknownCosts = contextSummary?.unknownCostRequests ?? 0
  const inputTokens = snapshot.totalUsage
    ? snapshot.totalUsage.input + snapshot.totalUsage.cacheRead + snapshot.totalUsage.cacheWrite
    : undefined
  const outputTokens = snapshot.totalUsage?.output
  const totalTokens = snapshot.totalUsage?.totalTokens
  const promptChanges = [...snapshot.prompts.values()].reduce((count, prompt, index, prompts) => (
    index > 0 && prompt !== prompts[index - 1] ? count + 1 : count
  ), 0)
  const compactions = contextEvents.filter(event => event.kind === 'compaction').length
  const legacySamples = performance.legacyCount > 0 && performance.rateCount === 0
  const slowestTool = toolRecords.reduce<TrajectoryRenderRecord | null>((slowest, record) => {
    if (record.cell.timeSeconds === null) return slowest
    if (!slowest || slowest.cell.timeSeconds === null || record.cell.timeSeconds > slowest.cell.timeSeconds) return record
    return slowest
  }, null)
  const latestUserGoal = [...snapshot.messages].reverse()
    .find(message => message.role === 'user' && message.content.trim())?.content.replace(/\s+/g, ' ').trim()
  const toolNames = [...new Set(toolRecords.map(record => record.cell.sourceMessage?.toolDisplayName ?? record.cell.sourceMessage?.toolName).filter(Boolean))] as string[]
  const slowestToolLabel = slowestTool
    ? toolRecordLabel(slowestTool)
    : undefined
  const model = contextSummary?.model ?? activeContext?.model
  const provider = activeContext?.provider
  const contextWindow = contextSummary?.contextWindow
  const latestContext = contexts.at(-1)
  const estimatedInput = latestContext?.inputTokens === undefined
  const latestTotal = latestContext ? contextTotal(latestContext) : undefined
  const contextPercent = contextWindow && contextWindow > 0 && latestTotal !== undefined ? (latestTotal / contextWindow) * 100 : undefined
  const occupancyRows = categoryRows(latestContext)
  // Attribution and the visible remainder sum to the same metered capacity.
  const occupancyFill = contextWindow && latestTotal !== undefined ? Math.min(1, latestTotal / contextWindow) : 1
  const compactionSeqs = new Set(contextEvents.filter(event => event.kind === 'compaction').map(event => event.requestSeq))

  const bars = useMemo(() => buildTrendBars(contexts, MAX_TREND_BARS, 'total'), [contexts])
  const axisMaximum = trendAxisMaximum(bars, 'total')
  const performanceLabel = t('run.performance.chartLabel')

  const shapeBuckets = useMemo(() => {
    const count = Math.min(18, contentRecords.length)
    return Array.from({ length: count }, (_, index) => {
      const entries = contentRecords.slice(Math.floor(index * contentRecords.length / count), Math.floor((index + 1) * contentRecords.length / count))
      const errors = entries.filter(record => record.cell.isError)
      const tools = entries.filter(record => record.cell.kind === 'tool' || record.cell.kind === 'subtool')
      return {
        first: entries[0]!.cell.index,
        last: entries.at(-1)!.cell.index,
        kind: errors.length ? 'error' as const : tools.length > entries.length / 2 ? 'tool' as const : 'model' as const,
      }
    })
  }, [contentRecords])

  const decisionTotals: Record<SessionDecisionOutcome, number> = {
    changed: decisionSummary?.changed ?? 0,
    unchanged: decisionSummary?.unchanged ?? 0,
    fallback: decisionSummary?.fallback ?? 0,
    discarded: decisionSummary?.discarded ?? 0,
    unconfirmed: decisionSummary?.unconfirmed ?? 0,
  }
  const decisionPoints = decisionSummary?.points ?? 0
  const decisionTotal = DECISION_OUTCOMES.reduce((sum, outcome) => sum + decisionTotals[outcome], 0)
  const fallbackDecision = decisionTotals.fallback + (decisionSummary?.failures ?? 0)
  const decisionCost = decisionSummary?.knownCostRequests ? formatCost(decisionSummary.knownCostUsd) : null
  const decisionReady = decisionSummary?.state === 'ready'

  const terminalTotal = reliability?.terminalCounts
    ? Object.values(reliability.terminalCounts).reduce((sum, count) => sum + count, 0)
    : undefined
  const budgetCount = reliability?.taskBudgets?.length ?? 0
  const signalCount = reliability?.signals?.length ?? 0

  return (
    <div className={css.view}>
      <div className={css.viewInner}>
        <div className={css.summaryMetrics}>
          <Metric
            icon={<Clock3 />}
            label={t('run.metric.duration')}
            value={formatDuration(durationMs)}
            note={t('run.metric.durationNote', { turns: turnCount, records: contentRecords.length })}
          />
          <Metric
            icon={<Activity />}
            label={t('run.metric.ttftP50')}
            value={performance.p50 === null ? '—' : (
              <>{Math.round(performance.p50)} <small>ms</small></>
            )}
            note={performance.p50 === null
              ? t('run.metric.ttftMissing')
              : t('run.metric.ttftNote', { p95: formatDurationMillis(performance.p95), valid: performance.ttftCount, total: performance.requests.length })}
          />
          <Metric
            icon={<Layers />}
            label={t('run.metric.tokens')}
            value={formatTokens(totalTokens)}
            note={t('run.metric.tokensNote', { input: formatTokens(inputTokens), output: formatTokens(outputTokens) })}
          />
          <Metric
            icon={<Wrench />}
            label={t('run.metric.toolCalls')}
            value={<>{toolRecords.length} <small>{t('run.metric.toolCallsUnit', { count: toolRecords.length })}</small></>}
            note={failedTools.length > 0
              ? t('run.metric.toolCallsFailed', { count: failedTools.length })
              : t('run.metric.toolCallsOk')}
          />
          <Metric
            icon={<Coins />}
            label={t('run.metric.cost')}
            value={costLabel ?? t('run.unknown')}
            note={unknownCosts > 0 ? t('run.metric.costUnknown', { count: unknownCosts }) : t('run.metric.costIncluded')}
          />
        </div>

        <div className={css.overviewGrid}>
          <section className={css.paper} data-run-context-trend>
            <div className={css.paperHead}>
              <h3>{t('run.overview.contextEvolution')} <span className={css.paperMeta}>{t('run.overview.requestCount', { count: contexts.length })}</span></h3>
              <button type="button" className={`${css.textButton} craft-control`} onClick={() => onOpenContext(latestSeq)}>
                {t('run.overview.inspectContext')}<ArrowRight />
              </button>
            </div>
            {bars.length > 0 ? (
              <>
                <RunTrendChart
                  bars={bars}
                  mode="total"
                  axisMaximum={axisMaximum}
                  selectedSeq={activeSeq ?? 1}
                  markerSeqs={compactionSeqs}
                  markerLabel={t('run.overview.compactedMarker')}
                  label={t('run.overview.contextEvolution')}
                  onSelect={setSelectedSeq}
                  valueLabel={bar => trendValueLabel(bar, 'total', t('run.request'))}
                />
                <div className={css.trendSelection}>
                  <span>
                    <strong>{t('run.requestNumber', { seq: activeContext?.requestSeq ?? 0 })}</strong>
                    <span className={css.tabular}>{activeContext?.inputTokens === undefined ? '≈' : ''}{formatTokens(activeContext ? contextTotal(activeContext) : undefined)} tokens</span>
                    <span className={css.muted}>{t('run.overview.turnOf', { turn: turnOf(snapshot, activeSeq) })}</span>
                  </span>
                  <div className={css.trendActions}>
                    <RunRequestUsage context={activeContext} />
                    <button type="button" className={`${css.textButton} craft-control`} onClick={() => onOpenContext(activeSeq)}>
                      {t('run.overview.viewRequest')}<ArrowRight />
                    </button>
                  </div>
                </div>
                <p className={css.chartFootnote}>
                  {t('run.overview.estimateFootnote')}
                  {compactions > 0 && activeIndex > 0 ? ` ${t('run.overview.compactionFootnote', { count: compactions })}` : ''}
                </p>
              </>
            ) : <p className={css.chartFootnote}>{t('run.overview.noContext')}</p>}
          </section>

          <section className={css.paper} data-run-occupancy data-context-total={latestTotal}>
            <div className={css.paperHead}>
              <h3>{t('run.overview.occupancy')}</h3>
              <span className={css.paperMeta}>{contextWindow
                ? t('run.overview.window', { used: latestSeq ?? '—', window: formatTokens(contextWindow) })
                : t('run.overview.windowUnknown')}</span>
            </div>
            <div className={css.compositionBody}>
              <div className={css.capacityLine}>
                <strong>{estimatedInput ? '≈' : ''}{formatTokens(latestTotal)}</strong>
                <span>{contextWindow ? `/ ${formatTokens(contextWindow)} tokens` : 'tokens'}</span>
                {contextPercent !== undefined && <span className={css.capacityPercent}>{contextPercent.toFixed(1)}%</span>}
              </div>
              <div className={css.compositionBar} aria-label={t('run.overview.occupancyBar', { percent: contextPercent === undefined ? '—' : contextPercent.toFixed(1) })}>
                {occupancyRows.map(row => (
                  <button
                    key={row.category}
                    type="button"
                    data-context-segment={row.category}
                    data-context-occupancy-fill
                    style={{ '--cat': row.color, width: `${Math.max(0, row.share * occupancyFill * 100)}%` } as CSSProperties}
                    title={`${t(row.labelKey)} · ${row.tokens === undefined ? '—' : `≈${formatTokens(row.tokens)}`}`}
                    aria-label={t('run.overview.jumpCategory', { category: t(row.labelKey) })}
                    onClick={() => onOpenContext(latestSeq, row.category)} className="craft-control"
                  />
                ))}
                {contextWindow && <i className={css.freeSpace} />}
              </div>
              <div className={css.capacityAxis}>
                <span>{t('run.overview.used', { tokens: formatTokens(latestTotal) })}</span>
                <span>{contextWindow ? t('run.overview.free', { tokens: formatTokens(Math.max(0, contextWindow - (latestTotal ?? 0))) }) : t('run.overview.windowUnknown')}</span>
              </div>
              <div className={css.compositionLegend}>
                {occupancyRows.map(row => (
                  <button key={row.category} type="button" className={`${css.legendItem} craft-control`} data-category-legend={row.category} data-context-tokens={row.tokens} onClick={() => onOpenContext(latestSeq, row.category)}>
                    <i className={css.categoryDot} style={{ '--cat': row.color } as CSSProperties} />
                    <span>{t(row.labelKey)}</span>
                    <span>{row.tokens === undefined ? '—' : `${row.category === 'unknown' ? '' : '≈'}${formatTokens(row.tokens)}`}</span>
                  </button>
                ))}
              </div>
              <p className={css.miniNote}>{estimatedInput ? `${t('run.context.providerInputMissing')} · ` : ''}{t('run.overview.occupancyNote')}</p>
            </div>
          </section>
        </div>

        <div className={css.overviewBottom}>
          <section className={css.paper} data-run-performance>
            <div className={css.paperHead}>
              <h3>{t('run.overview.outputPerformance')}</h3>
              <span className={css.paperMeta}>{legacySamples
                ? t('run.overview.legacySamples')
                : t('run.overview.rateSamples', { valid: performance.rateCount, total: performance.requests.length })}</span>
            </div>
            <div className={css.performanceBody}>
              <div className={css.performanceTopline}>
                <strong>{performance.averageRate === null ? '—' : performance.averageRate.toFixed(1)}</strong>
                <span>{t('run.overview.rateUnit')}</span>
              </div>
              {performance.averageRate === null
                ? <p className={css.miniNote}>{t('run.overview.rateMissing')}</p>
                : <RunPerformanceChart summary={performance} label={performanceLabel} />}
              <p className={css.miniNote}>{t('run.overview.rateNote')}</p>
            </div>
          </section>

          <section className={css.paper} data-run-decision-impact>
            <div className={css.paperHead}>
              <h3>{t('run.overview.decisionImpact')}</h3>
              <button type="button" className={`${css.textButton} craft-control`} onClick={onOpenDecisions}>
                {t('run.overview.decisionAll')}<ArrowRight />
              </button>
            </div>
            <div className={css.decisionOverview}>
              {decisionReady && (decisionPoints > 0 || (decisionSummary?.legacyCalls ?? 0) > 0) ? (
                <>
                  <div className={css.decisionNumbers}>
                    <strong>{decisionPoints > 0 ? decisionPoints.toLocaleString(locale) : (decisionSummary?.legacyCalls ?? 0).toLocaleString(locale)}</strong>
                    <span>{decisionPoints > 0
                      ? t('run.overview.decisionPoints', { count: decisionPoints })
                      : t('trajectory.decisions.historicalCalls')}</span>
                    <span className={css.muted}>{t('run.overview.decisionRequests', { count: decisionSummary?.requests ?? 0 })}</span>
                    <span style={{ flex: 1 }} />
                    <span className={css.tabular}>{decisionCost ?? t('run.unknown')}</span>
                  </div>
                  {decisionTotal > 0 && (
                    <>
                      <div className={css.decisionImpact} aria-hidden>
                        {DECISION_OUTCOMES.map(outcome => decisionTotals[outcome] > 0 && (
                          <i key={outcome} style={{ '--cat': decisionOutcomeColor(outcome), width: `${decisionTotals[outcome] / decisionTotal * 100}%` } as CSSProperties} />
                        ))}
                      </div>
                      <div className={css.decisionSummaryRow}>
                        {DECISION_OUTCOMES.filter(outcome => decisionTotals[outcome] > 0).map(outcome => (
                          <span key={outcome}>
                            <i className={css.categoryDot} style={{ '--cat': decisionOutcomeColor(outcome) } as CSSProperties} />
                            {t(`run.decision.outcome.${outcome}`)} {decisionTotals[outcome]}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  <div className={css.decisionHighlight}>
                    <AlertTriangle />
                    <p>
                      {decisionTotal === 0
                        // Historical calls have no recorded application: neither a
                        // fallback nor "unchanged" may be inferred for them.
                        ? t('trajectory.decisions.historicalSummary', { count: decisionSummary?.legacyCalls ?? 0 })
                        : fallbackDecision > 0
                          ? (decisionSummary?.failures ?? 0) > 0
                            ? t('run.overview.decisionFailures', { count: decisionSummary?.failures })
                            : t('run.overview.decisionFallback', { count: decisionTotals.fallback })
                          : t('run.overview.decisionStable')}
                      <small>{(decisionSummary?.unknownCostRequests ?? 0) > 0
                        ? t('run.overview.decisionCostUnknown', { count: decisionSummary?.unknownCostRequests })
                        : t('run.overview.decisionCostIncluded')}</small>
                    </p>
                    {fallbackDecision > 0 && (
                      <button type="button" className={`${css.textButton} craft-control`} onClick={() => onOpenDecisionIssues((decisionSummary?.failures ?? 0) > 0 ? 'failed' : 'fallback')}>
                        {t('run.overview.decisionInspect')}<ArrowRight />
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className={css.miniNote}>{decisionSummary?.state === 'loading'
                  ? t('run.overview.decisionLoading')
                  : decisionSummary?.state === 'unsupported'
                    ? t('run.overview.decisionUnsupported')
                    : decisionSummary?.state === 'error'
                      ? t('trajectory.decisions.loadFailed')
                      : t('run.overview.decisionEmpty')}</p>
              )}
            </div>
          </section>
        </div>

        <div className={css.overviewInfoGrid}>
          <section className={`${css.paper} ${css.diagnosticCard}`} data-run-diagnostics>
            <div className={css.paperHead}>
              <h3>{t('run.overview.diagnostics')}</h3>
              <button type="button" className={`${css.textButton} craft-control`} onClick={() => onOpenTrajectory()}>
                {t('run.overview.openTrajectory')}<ArrowRight />
              </button>
            </div>
            <div className={css.infoCardBody}>
              <dl className={css.environmentGrid}>
                <div>
                  <dt>{t('run.overview.goal')}</dt>
                  <dd>{latestUserGoal ?? t('run.overview.notRecorded')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.toolsUsed')}</dt>
                  <dd>{toolNames.length ? toolNames.slice(0, 5).join(', ') : t('run.overview.toolsNone')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.attention')}</dt>
                  <dd>{attentionText(t, errorRecords.length, failedTools.length, slowestTool, slowestToolLabel)}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.modelRequests')}</dt>
                  <dd>{reliability?.state === 'available'
                    ? `${terminalTotal ?? t('run.unknown')} / ${reliability.unsettled ?? t('run.unknown')}`
                    : t('run.overview.notRecorded')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.contextEvents')}</dt>
                  <dd>{t('run.overview.contextEventsValue', { compactions, prompts: promptChanges })}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.budgetSignals')}</dt>
                  <dd>{reliability?.state === 'available'
                    ? budgetCount || signalCount
                      ? t('run.overview.budgetSignalsValue', { budgets: budgetCount, signals: signalCount })
                      : t('run.overview.noBudgetSignals')
                    : t('run.overview.notRecorded')}</dd>
                </div>
              </dl>
              <div className={css.activityLabel}>
                <span>{t('run.overview.activity', { count: contentRecords.length })}</span>
                <span>{t('run.overview.activityLegend')}</span>
              </div>
              <button
                type="button"
                className={`${css.activityShape} craft-control`}
                onClick={() => onOpenTrajectory()}
                aria-label={t('run.overview.openTrajectory')}
                title={t('run.overview.activityTitle', { records: contentRecords.length, buckets: shapeBuckets.length })}
              >
                {shapeBuckets.map((bucket, index) => (
                  <span
                    key={`${bucket.first}-${index}`}
                    style={{ background: bucket.kind === 'error' ? 'var(--run-danger)' : bucket.kind === 'tool' ? 'var(--run-cat-tool)' : 'var(--run-cat-assistant)' }}
                  />
                ))}
              </button>
              <p className={css.miniNote}>{t('run.overview.activityNote')}</p>
            </div>
          </section>

          <section className={`${css.paper} ${css.environmentCard}`} data-run-environment>
            <div className={css.paperHead}>
              <h3>{t('run.overview.environmentAndScope')}</h3>
              <span className={css.paperMeta}>{contextSummary?.remote ? t('run.overview.remote') : t('run.overview.local')}</span>
            </div>
            <div className={css.infoCardBody}>
              <dl className={css.environmentGrid}>
                <div>
                  <dt>{t('run.overview.modelService')}</dt>
                  <dd>{[model ?? t('run.unknown'), provider].filter(Boolean).join(' / ')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.permissionMode')}</dt>
                  <dd>{contextSummary?.permissionMode
                    ? t(`mode.${contextSummary.permissionMode}`, { defaultValue: contextSummary.permissionMode })
                    : t('run.overview.notRecorded')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.workingDirectory')}</dt>
                  <dd className={css.mono}>{contextSummary?.workingDirectory ?? t('run.overview.notRecorded')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.sessionSpan')}</dt>
                  <dd>{snapshot.timeRange
                    ? `${formatClock(snapshot.timeRange.start)} – ${formatClock(snapshot.timeRange.end)}`
                    : contextSummary?.createdAt ? formatTimestamp(contextSummary.createdAt) : t('run.overview.notRecorded')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.meteringScope')}</dt>
                  <dd>{t('run.overview.meteringNote')}</dd>
                </div>
                <div>
                  <dt>{t('run.overview.costCoverage')}</dt>
                  <dd>{unknownCosts > 0
                    ? t('run.overview.costCoverageUnknown', { count: unknownCosts })
                    : t('run.overview.costCoverageKnown')}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: ReactNode; note: string }) {
  return (
    <div className={css.metric} data-run-metric>
      <div className={css.metricLabel}>{icon}{label}</div>
      <div className={css.metricValue}>{value}</div>
      <div className={css.metricNote}>{note}</div>
    </div>
  )
}

/** The turn a request belongs to, from the ledger's own grouping. */
function turnOf(snapshot: TrajectorySnapshot, requestSeq: number | undefined): string {
  if (requestSeq === undefined) return '—'
  let ordinal = 0
  for (const contribution of snapshot.contributions) {
    if (contribution.kind === 'request-header') ordinal += 1
    if (ordinal === requestSeq && contribution.kind === 'request-header') return String(contribution.turn ?? '—')
  }
  return '—'
}

function attentionText(
  t: (key: string, options?: Record<string, unknown>) => string,
  errors: number,
  failedTools: number,
  slowest: TrajectoryRenderRecord | null,
  slowestLabel: string | undefined,
): string {
  const parts: string[] = []
  if (errors > 0) parts.push(t('run.overview.attentionErrors', { count: errors }))
  if (failedTools > 0) parts.push(t('run.overview.attentionToolFailures', { count: failedTools }))
  if (slowest?.cell.timeSeconds != null && slowestLabel) {
    parts.push(t('run.overview.attentionSlowest', { name: slowestLabel, seconds: slowest.cell.timeSeconds }))
  }
  return parts.length ? parts.join(' · ') : t('run.overview.attentionNone')
}

/** A tool record's short identity: tool name plus the file or command it touched. */
function toolRecordLabel(record: TrajectoryRenderRecord): string {
  const message = record.cell.sourceMessage
  const name = message?.toolDisplayName ?? message?.toolName ?? recordDisplayText(record.cell)
  const input = message?.toolInput
  const target = input && typeof input.path === 'string'
    ? input.path
    : input && typeof input.command === 'string' ? input.command : undefined
  if (!target) return name
  const base = target.split(/[\\/]/).filter(Boolean).at(-1) ?? target
  return `${name} · ${base.slice(0, 48)}`
}

export type { TrajectoryContextCategory }
