/**
 * Run → Decision.
 *
 * Three blocks in one visual language with Overview: what the auxiliary layer
 * actually did (result card), which feature used it (feature table), and the
 * records themselves (ledger). Filters live in the ledger they filter; the two
 * statistic cards stay read-only and describe the whole recorded scope, never
 * the current page.
 *
 * Evidence expands under its own record. Nothing is inferred from a
 * recommendation: "actual handling" is only claimed when the caller recorded it.
 */

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronRight, RefreshCw, ArrowRight } from 'lucide-react'
import {
  decisionOutcome,
  type SessionDecisionItem,
  type SessionDecisionQuery as SharedDecisionQuery,
  type SessionDecisionReport,
  type SessionDecisionStatus,
  type SessionDecisionTotals,
} from '@phaneris/shared/decisions/session'
import type { DecisionLayerFeature } from '@phaneris/shared/decisions/settings'
import { DECISION_OUTCOMES, decisionOutcomeColor, decisionOutcomeLabelKey, formatCost } from './run-model'
import css from './run-view.module.css'

export type RunDecisionFilter = Pick<SharedDecisionQuery, 'feature' | 'status' | 'turnId'>

export interface RunDecisionState {
  state: 'loading' | 'ready' | 'error' | 'unsupported'
  report?: SessionDecisionReport
  paging?: boolean
}

export interface RunDecisionViewProps {
  /** Unfiltered report: the statistic cards describe its whole scope. */
  scope?: SessionDecisionReport
  /** Current filtered page used by the ledger. */
  view: RunDecisionState
  query: RunDecisionFilter
  onQueryChange: (patch: Partial<RunDecisionFilter>) => void
  onLoadMore: () => void
  onRetry: () => void
  onConfigure: () => void
  onOpenChat: (messageId: string) => void
  onOpenContext?: (messageId: string) => void
  locale: string
}

const FEATURE_LABEL_KEYS: Record<DecisionLayerFeature, string> = {
  decideTool: 'featureDecideTool', suggestions: 'featureSuggestions', adaptiveThinking: 'featureAdaptiveThinking',
  largeResults: 'featureLargeResults', midTurnMessages: 'featureMidTurnMessages', turnOutcome: 'featureTurnOutcome',
  smartTitles: 'featureSmartTitles', guardedMode: 'featureGuardedMode', riskBadges: 'featureRiskBadges',
  semanticLabels: 'featureSemanticLabels', automationConditions: 'featureAutomationConditions',
  taskVerdicts: 'featureTaskVerdicts', taskRepairs: 'featureTaskRepairs',
}

function featureLabelKey(feature: DecisionLayerFeature): string {
  return `settings.ai.decisions.${FEATURE_LABEL_KEYS[feature]}`
}

function actionText(action: string | undefined, translate: (key: string, options?: Record<string, unknown>) => string): string {
  const value = action ?? 'none'
  const [head, tail] = [value.split(':')[0] ?? value, value.split(':').slice(1).join(':')]
  return translate(`trajectory.decisions.action.${head}`, { defaultValue: value, value: tail })
}

function reasonText(reason: string | undefined, translate: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (!reason) return null
  return translate(`trajectory.decisions.reason.${reason}`, { defaultValue: reason })
}

function attemptCost(item: SessionDecisionItem): number | undefined {
  return item.attempts.reduce<number | undefined>(
    (sum, attempt) => attempt.costUsd === undefined ? sum : (sum ?? 0) + attempt.costUsd,
    undefined,
  )
}

function formatDecisionTime(startedAt: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(startedAt))
}

function rowStatus(item: SessionDecisionItem): SessionDecisionStatus | 'historical' | 'pending' {
  if (item.legacy) return 'historical'
  const outcome = decisionOutcome(item)
  if (outcome === 'unconfirmed') {
    if (item.attempts.some(attempt => attempt.status === 'pending')) return 'pending'
    if (item.attempts.some(attempt => attempt.status === 'failed' || attempt.status === 'timeout')) return 'failed'
    if (item.attempts.some(attempt => attempt.status === 'cancelled')) return 'cancelled'
  }
  return outcome
}

const TAG_TONE: Record<ReturnType<typeof rowStatus>, string | undefined> = {
  changed: css.tagAccent,
  unchanged: css.tagNeutral,
  fallback: css.tagWarning,
  discarded: css.tagNeutral,
  unconfirmed: css.tagNeutral,
  failed: css.tagDanger,
  cancelled: css.tagNeutral,
  pending: css.tagAccent,
  historical: css.tagNeutral,
}

function DecisionTag({ status }: { status: ReturnType<typeof rowStatus> }) {
  const { t } = useTranslation()
  return (
    <span className={`${css.decisionTag} ${TAG_TONE[status]}`}>
      <span className={css.decisionTagDot} aria-hidden />
      {t(`trajectory.decisions.status.${status}`)}
    </span>
  )
}

function sourceText(item: SessionDecisionItem, t: (key: string) => string): string {
  const source = item.source
  if (source?.turnId) return source.turnId
  if (source?.toolCallId) return `${t('trajectory.decisions.sourceToolCall')} ${source.toolCallId}`
  if (source?.messageId) return `${t('trajectory.decisions.sourceMessage')} ${source.messageId}`
  if (source?.taskRunId) return `${t('trajectory.decisions.sourceTaskRun')} ${source.taskRunId}`
  if (source?.automationId) return `${t('trajectory.decisions.sourceAutomation')} ${source.automationId}`
  return t('trajectory.decisions.sessionLevel')
}

export function RunDecisionView({
  scope, view, query, onQueryChange, onLoadMore, onRetry, onConfigure, onOpenChat, onOpenContext, locale,
}: RunDecisionViewProps) {
  const { t } = useTranslation()
  const [openId, setOpenId] = useState<string | undefined>()
  const report = view.report
  const filtered = Boolean(query.feature || query.status || query.turnId)

  const scopedTotals: SessionDecisionTotals | undefined = useMemo(() => {
    if (!scope) return undefined
    return query.feature
      ? scope.features.find(entry => entry.feature === query.feature)?.totals ?? emptyTotals()
      : scope.totals
  }, [query.feature, scope])

  const outcomeCounts = useMemo(() => {
    const totals = scopedTotals
    return {
      changed: totals?.changed ?? 0,
      unchanged: totals?.unchanged ?? 0,
      fallback: totals?.fallback ?? 0,
      discarded: totals?.discarded ?? 0,
      unconfirmed: totals?.unconfirmed ?? 0,
    } satisfies Record<(typeof DECISION_OUTCOMES)[number], number>
  }, [scopedTotals])
  const outcomeTotal = DECISION_OUTCOMES.reduce((sum, outcome) => sum + outcomeCounts[outcome], 0)
  const knownCost = scopedTotals?.knownCostRequests ? formatCost(scopedTotals.knownCostUsd) : null
  const unknownCosts = scopedTotals?.unknownCostRequests ?? 0
  const featureLabel = query.feature ? t(featureLabelKey(query.feature)) : t('run.decision.allFeatures')

  const items = report?.items ?? []
  const statusOptions: Array<{ value: SessionDecisionStatus | 'all'; label: string }> = [
    { value: 'all', label: t('run.decision.allOutcomes') },
    ...DECISION_OUTCOMES.map(outcome => ({ value: outcome, label: t(decisionOutcomeLabelKey(outcome)) })),
    { value: 'failed', label: t(decisionOutcomeLabelKey('failed')) },
    { value: 'cancelled', label: t(decisionOutcomeLabelKey('cancelled')) },
  ]

  if (!scope) {
    if (view.state === 'error') {
      return (
        <div className={css.view}><div className={css.viewInner}>
          <div className={css.emptyState}>
            <AlertTriangle />
            <h2>{t('trajectory.decisions.loadFailed')}</h2>
            <p>{t('trajectory.decisions.retryHint')}</p>
            <button type="button" className={`${css.outlineButton} craft-control`} onClick={onRetry}><RefreshCw />{t('common.retry')}</button>
          </div>
        </div></div>
      )
    }
    if (view.state === 'unsupported') {
      return (
        <div className={css.view}><div className={css.viewInner}>
          <div className={css.emptyState}>
            <AlertTriangle />
            <h2>{t('trajectory.decisions.unsupported')}</h2>
            <button type="button" className={`${css.outlineButton} craft-control`} onClick={onConfigure}>{t('trajectory.decisions.configure')}</button>
          </div>
        </div></div>
      )
    }
    return <div className={css.view} role="status" aria-label={t('common.loading')}><div className={css.viewInner}><DecisionSkeleton /></div></div>
  }

  const ledgerLoading = view.state === 'loading' && !report
  const ledgerError = view.state === 'error'
  const ledgerUnsupported = view.state === 'unsupported'

  return (
    <div className={css.view}>
      <div className={css.viewInner} data-run-decisions>
        {(scope.coverage === 'partial' || scope.totals.legacyCalls > 0 || !scope.enabled) && (
          <p className={css.noticeInline}>
            {[
              scope.coverage === 'partial' ? t('trajectory.decisions.partial') : null,
              scope.totals.legacyCalls > 0 ? t('trajectory.decisions.legacyCalls', { count: scope.totals.legacyCalls }) : null,
              !scope.enabled ? t('trajectory.decisions.disabled') : null,
            ].filter(Boolean).map((text, index) => <span key={index}>{text}</span>)}
          </p>
        )}

        <div className={css.decisionOverviewGrid}>
          <section className={css.paper} data-decision-results>
            <div className={css.paperHead}>
              <h3>{t('run.decision.results')}</h3>
              <span className={css.paperMeta}>{featureLabel}</span>
            </div>
            <div className={css.decisionResultsBody}>
              <div className={css.decisionNumbers}>
                <strong>{(scopedTotals?.points ?? 0).toLocaleString(locale)}</strong>
                <span>{t('run.decision.points', { count: scopedTotals?.points ?? 0 })}</span>
                <span className={css.muted}>{t('run.decision.requests', { count: scopedTotals?.requests ?? 0 })}</span>
              </div>
              <div className={css.decisionImpact} aria-label={t('run.decision.distribution')}>
                {outcomeTotal > 0 && DECISION_OUTCOMES.map(outcome => outcomeCounts[outcome] > 0 && (
                  <i
                    key={outcome}
                    style={{ '--cat': decisionOutcomeColor(outcome), width: `${outcomeCounts[outcome] / outcomeTotal * 100}%` } as CSSProperties}
                  />
                ))}
              </div>
              <div className={css.decisionResultLegend}>
                {DECISION_OUTCOMES.map(outcome => (
                  <span key={outcome} className={css.resultLegendEntry} data-outcome={outcome}>
                    <i className={css.categoryDot} style={{ '--cat': decisionOutcomeColor(outcome) } as CSSProperties} />
                    <span>{t(decisionOutcomeLabelKey(outcome))}</span>
                    <strong>{outcomeCounts[outcome].toLocaleString(locale)}</strong>
                  </span>
                ))}
              </div>
              <div className={css.decisionResultCost}>
                <span>{t('run.decision.knownCost')}</span>
                <span>
                  <strong>{knownCost ?? t('run.unknown')}</strong>
                  {unknownCosts > 0 && <span className={css.muted}> + {t('run.decision.costUnknown', { count: unknownCosts })}</span>}
                </span>
              </div>
              <p className={css.miniNote}>{t('run.decision.resultNote')}</p>
            </div>
          </section>

          <section className={css.paper} data-decision-features>
            <div className={css.paperHead}>
              <h3>{t('run.decision.featureDistribution')}</h3>
              <span className={css.paperMeta}>{t('run.decision.currentSession')}</span>
            </div>
            <div className={css.decisionFeatureTable}>
              <div className={css.decisionFeatureColumns}>
                <span>{t('trajectory.decisions.feature')}</span>
                <span>{t('run.decision.pointsShort')}</span>
                <span>{t('trajectory.decisions.changed')}</span>
                <span>{t('run.decision.knownCostShort')}</span>
              </div>
              {scope.features.map(entry => {
                const cost = entry.totals.knownCostRequests > 0 ? formatCost(entry.totals.knownCostUsd) : null
                const unknown = entry.totals.unknownCostRequests > 0 || (!entry.totals.knownCostRequests && entry.totals.legacyCalls > 0)
                return (
                  <div key={entry.feature} className={css.decisionFeatureRow} data-feature={entry.feature}>
                    <span>{t(featureLabelKey(entry.feature))}</span>
                    <span>{entry.totals.points.toLocaleString(locale)}</span>
                    <span>{entry.totals.changed.toLocaleString(locale)}</span>
                    <span title={unknown ? t('run.decision.costUnknown', { count: entry.totals.unknownCostRequests }) : undefined}>{cost ?? t('run.unknown')}{cost && unknown ? ' +?' : ''}</span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <section className={`${css.paper} ${css.decisionLedger}`} data-decision-ledger>
          <div className={css.paperHead}>
            <h3>{t('run.decision.records')} <span className={css.paperMeta}>{t('run.decision.recordCount', { count: items.length })}</span></h3>
            <div className={css.decisionLedgerActions}>
              <select
                aria-label={t('run.decision.filterFeature')}
                value={query.feature ?? 'all'}
                onChange={event => onQueryChange({ feature: event.target.value === 'all' ? undefined : event.target.value as DecisionLayerFeature })} className="craft-field-input"
              >
                <option value="all">{t('run.decision.allFeatures')}</option>
                {scope.features.map(entry => (
                  <option key={entry.feature} value={entry.feature}>{t(featureLabelKey(entry.feature))}</option>
                ))}
              </select>
              <select
                aria-label={t('run.decision.filterOutcome')}
                value={query.status ?? 'all'}
                onChange={event => onQueryChange({ status: event.target.value === 'all' ? undefined : event.target.value as SessionDecisionStatus })} className="craft-field-input"
              >
                {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className={css.decisionLedgerColumns} aria-hidden>
            <span>{t('run.decision.subject')}</span>
            <span>{t('trajectory.decisions.feature')}</span>
            <span>{t('trajectory.decisions.application')}</span>
            <span>{t('run.decision.attemptsShort')}</span>
            <span>{t('run.decision.knownCostShort')}</span>
            <span>{t('trajectory.decisions.time')}</span>
            <span />
          </div>
          <div className={css.decisionLedgerRows}>
            {ledgerLoading ? <LedgerSkeleton />
              : ledgerError ? (
                <div className={css.ledgerEmpty}>
                  {t('trajectory.decisions.loadFailed')}
                  <div className={css.loadMoreRow}>
                    <button type="button" className={`${css.outlineButton} craft-control`} onClick={onRetry}><RefreshCw />{t('common.retry')}</button>
                  </div>
                </div>
              )
              : ledgerUnsupported ? <div className={css.ledgerEmpty}>{t('trajectory.decisions.unsupported')}</div>
              : items.length === 0 ? (
              <div className={css.ledgerEmpty}>
                {filtered ? t('trajectory.decisions.noMatches') : t('trajectory.decisions.empty')}
                {!filtered && <><br />{t('trajectory.decisions.emptyHint')}</>}
              </div>
            ) : items.map(item => {
              const open = openId === item.id
              const status = rowStatus(item)
              const cost = attemptCost(item)
              const action = item.application?.action ?? item.recommendation?.action
              return (
                <div key={item.id} className={css.decisionLedgerItem} data-open={open} data-decision-id={item.id} data-outcome={status}>
                  <button
                    type="button"
                    className={`${css.decisionLedgerRow} craft-control`}
                    aria-expanded={open}
                    aria-controls={`run-decision-detail-${item.id}`}
                    onClick={() => setOpenId(open ? undefined : item.id)}
                  >
                    <span className={css.ledgerSubject}>
                      <strong>{actionText(action, t)}</strong>
                      <span>{sourceText(item, t)}</span>
                    </span>
                    <span className={css.ledgerFeature}>{t(featureLabelKey(item.feature))}</span>
                    <span className={css.ledgerOutcome}><DecisionTag status={status} /></span>
                    <span className={css.ledgerAttempts}>{item.attempts.length}</span>
                    <span className={css.ledgerCost}>{cost === undefined ? t('run.unknown') : formatCost(cost)}</span>
                    <span className={css.ledgerTime}>{formatDecisionTime(item.startedAt, locale)}</span>
                    <ChevronRight />
                  </button>
                  {open && (
                    <div className={css.decisionDetail} id={`run-decision-detail-${item.id}`} role="region" aria-label={t('trajectory.decisions.recordDetail')}>
                      <DecisionDetail item={item} onOpenChat={onOpenChat} onOpenContext={onOpenContext} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {report?.nextCursor && (
            <div className={css.loadMoreRow}>
              <button type="button" className={`${css.outlineButton} craft-control`} disabled={view.paging} onClick={onLoadMore}>
                {view.paging ? t('common.loading') : t('trajectory.decisions.loadMore')}
              </button>
            </div>
          )}
        </section>

        <p className={css.coverageNote}>
          {t('run.decision.coverage', { scope: query.feature ? t(featureLabelKey(query.feature)) : t('run.decision.allFeatures') })}
        </p>
      </div>
    </div>
  )
}

function DecisionDetail({ item, onOpenChat, onOpenContext }: {
  item: SessionDecisionItem
  onOpenChat: (messageId: string) => void
  onOpenContext?: (messageId: string) => void
}) {
    const { t } = useTranslation()
    const recommendation = item.recommendation
    const application = item.application
    const status = rowStatus(item)
    return (
      <>
        <div className={css.decisionDetailHead}>
          <h4>{t('run.decision.evidence')}</h4>
          <span className={`${css.muted} ${css.tabular}`}>{item.id}</span>
        </div>
        <div className={css.detailBody}>
          <section className={css.evidenceStep} data-evidence-step>
            <div className={css.evidenceLabel}><ArrowRight />{t('run.decision.trigger')}</div>
            <p>{sourceText(item, t)}</p>
            <p className={css.detailNote}>
              {item.source?.turnId ? t('run.decision.sourceTurn', { turn: item.source.turnId }) : t('trajectory.decisions.triggerUnknown')}
            </p>
          </section>
          <section className={css.evidenceStep} data-evidence-step>
            <div className={css.evidenceLabel}><ArrowRight />{t('trajectory.decisions.recommendation')}</div>
            <p>{recommendation ? actionText(recommendation.action, t) : t('trajectory.decisions.noRecommendation')}</p>
            <EvidenceValues detail={recommendation?.detail} />
            <p className={css.detailNote}>
              {item.unavailableReason
                ? t('trajectory.decisions.unavailableReason', { reason: reasonText(item.unavailableReason, t) ?? item.unavailableReason })
                : t('run.decision.recommendationNote')}
            </p>
          </section>
          <section className={css.evidenceStep} data-evidence-step>
            <div className={css.evidenceLabel}><ArrowRight />{t('trajectory.decisions.application')}</div>
            <p className={css.handling}>{application ? actionText(application.action, t) : t('run.decision.noHandling')}</p>
            <EvidenceValues detail={application?.detail} />
            <p className={css.detailNote}>
              {application
                ? [reasonText(application.reason, t), t('run.decision.applicationNote')].filter(Boolean).join(' · ')
                : status === 'failed'
                  ? t('trajectory.decisions.applicationFailed')
                  : t('trajectory.decisions.applicationUnknown')}
            </p>
          </section>
          <section className={css.followupEvidence}>
            <h5>{t('trajectory.decisions.observations')}</h5>
            {item.observations.length > 0 ? item.observations.map((observation, index) => (
              <div key={`${observation.result}-${index}`}>
                <p>{t(`trajectory.decisions.observation.${observation.result}`, { defaultValue: observation.result })}</p>
                <EvidenceValues detail={observation.detail} />
              </div>
            )) : <p className={css.detailNote}>{t('trajectory.decisions.noObservations')}</p>}
          </section>
          <details className={css.requestDetails}>
            <summary>{t('run.decision.requestDetails')}</summary>
            {item.attempts.map(attempt => {
              const cost = formatCost(attempt.costUsd)
              const deadline = attempt.deadlineMs ?? attempt.record?.meta?.deadlineMs
              const costSource = attempt.costSource ?? (cost === null ? 'unknown' : 'not_recorded')
              return (
                <dl key={attempt.id} className={css.requestDiagnostic}>
                  <dt>{t('trajectory.decisions.provider')}</dt>
                  <dd>{[attempt.provider, attempt.model].filter(Boolean).join(' / ')}</dd>
                  <dt>{t('run.decision.requestResult')}</dt>
                  <dd>{t(`trajectory.decisions.attempt.${attempt.status}`)}</dd>
                  <dt>{t('run.decision.clientLatency')}</dt>
                  <dd>{attempt.latencyMs === undefined ? t('run.unknown') : `${attempt.latencyMs} ms`}</dd>
                  {typeof deadline === 'number' && (
                    <>
                      <dt>{t('trajectory.decisions.deadline')}</dt>
                      <dd>{deadline} ms</dd>
                    </>
                  )}
                  <dt>{t('run.decision.tokensInOut')}</dt>
                  <dd>{attempt.inputTokens ?? '—'} / {attempt.outputTokens ?? '—'}</dd>
                  {attempt.responseId && <>
                    <dt>{t('trajectory.decisions.responseId')}</dt>
                    <dd>{attempt.responseId}</dd>
                  </>}
                  <dt>{t('run.decision.knownCost')}</dt>
                  <dd>{cost ?? (attempt.costUnavailableReason
                    ? t(`trajectory.decisions.costReason.${attempt.costUnavailableReason}`, { defaultValue: t('run.unknown') })
                    : t('run.unknown'))}</dd>
                  <dt>{t('trajectory.decisions.costOrigin')}</dt>
                  <dd>{t(`trajectory.decisions.costSource.${costSource}`)}</dd>
                  <dt>{t('run.decision.billedWithin')}</dt>
                  <dd>{t('run.decision.includedCost')}</dd>
                </dl>
              )
            })}
            <details className={css.rawRecord} data-decision-raw>
              <summary>{t('trajectory.decisions.rawRecord')}</summary>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </details>
          </details>
          <div className={css.detailBottom}>
            {item.source?.messageId && onOpenContext && (
              <button type="button" className={`${css.textButton} craft-control`} onClick={() => onOpenContext(item.source!.messageId!)}>
                {t('run.decision.openContext')}<ArrowRight />
              </button>
            )}
            {item.source?.messageId && onOpenChat && (
              <button type="button" className={`${css.textButton} craft-control`} onClick={() => onOpenChat(item.source!.messageId!)}>
                {t('trajectory.decisions.openChat')}<ArrowRight />
              </button>
            )}
          </div>
        </div>
      </>
    )
}

function EvidenceValues({ detail }: { detail?: Record<string, unknown> }) {
  const { t } = useTranslation()
  if (!detail || Object.keys(detail).length === 0) return null
  return (
    <dl className={css.evidenceValues} aria-label={t('trajectory.decisions.structuredEvidence')}>
      {Object.entries(detail).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function emptyTotals(): SessionDecisionTotals {
  return {
    legacyCalls: 0, points: 0, requests: 0, changed: 0, unchanged: 0, fallback: 0, discarded: 0,
    unconfirmed: 0, failures: 0, cancelled: 0, knownCostUsd: 0, knownCostRequests: 0,
    unknownCostRequests: 0, inputTokens: 0, outputTokens: 0,
  }
}

function DecisionSkeleton() {
  return (
    <div aria-hidden>
      <div className={css.decisionOverviewGrid}>
        <span className={css.paper} style={{ height: 190 }} />
        <span className={css.paper} style={{ height: 190 }} />
      </div>
      <div className={css.paper} style={{ height: 280 }} />
    </div>
  )
}

function LedgerSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2, 3].map(row => (
        <div key={row} className={css.ledgerSkeletonRow}>
          <span className={css.ledgerSkeletonBar} style={{ width: `${72 - row * 6}%` }} />
          <span className={css.ledgerSkeletonBar} style={{ width: '18%' }} />
        </div>
      ))}
    </div>
  )
}
