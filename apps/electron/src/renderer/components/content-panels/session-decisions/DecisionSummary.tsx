/**
 * Run → Overview · the decision summary strip.
 *
 * One line of scope, four numbers, and a link into the Decisions tab. It
 * borrows the Overview's own section and card shapes (`h3` label tier,
 * font-semibold` + `mb-2` header, `rounded-xl border border-border/55
 * bg-background/70` card) so it reads as one more Overview block rather than a
 * widget bolted onto it.
 *
 * Cost is presented exactly as the Decisions tab presents it: known cost, with
 * the unknown request count as its own tag. "Unknown" is never folded into the
 * dollar amount.
 */
import { useTranslation } from 'react-i18next'
import { ArrowRight, Ban, Clock3, CornerDownRight } from 'lucide-react'
import type { SessionDecisionTotals } from '@phaneris/shared/decisions/session'
import { useSessionDecisions } from '@/hooks/useSessionDecisions'
import { formatDecisionCost } from './decision-view'

type Data = ReturnType<typeof useSessionDecisions>

function SummaryCells({ totals }: { totals: SessionDecisionTotals }) {
  const { t } = useTranslation()
  const cost = formatDecisionCost(totals.knownCostUsd)
  const costIsUnknown = !totals.knownCostRequests && (totals.unknownCostRequests > 0 || totals.legacyCalls > 0)
  const historicalOnly = totals.points === 0 && totals.legacyCalls > 0
  const cells = [
    { key: historicalOnly ? 'historicalCalls' : 'points', icon: <CornerDownRight className="size-3.5" />, value: (historicalOnly ? totals.legacyCalls : totals.points).toLocaleString() },
    { key: 'changed', icon: <ArrowRight className="size-3.5" />, value: historicalOnly ? '—' : totals.changed.toLocaleString() },
    { key: 'fallback', icon: <Ban className="size-3.5" />, value: historicalOnly ? '—' : totals.fallback.toLocaleString() },
    { key: 'cost', icon: <Clock3 className="size-3.5" />, value: costIsUnknown ? t('common.unknown') : cost ?? t('common.unknown') },
  ]
  return (
    <>
      {cells.map(cell => (
        <span key={cell.key} className="flex min-w-0 flex-none items-baseline gap-1.5">
          <span className="text-text-secondary">{cell.icon}</span>
          <span className="text-meta text-text-secondary">{t(`trajectory.decisions.${cell.key}`)}</span>
          <span className="text-body font-semibold tabular-nums">{cell.value}</span>
        </span>
      ))}
      {totals.unknownCostRequests > 0 && (
        <span
          title={t('trajectory.decisions.unknownCostNote', { count: totals.unknownCostRequests })}
          className="inline-flex h-control-2xs flex-none items-center rounded-shape-sm bg-[color:var(--info)]/[0.16] px-[5px] text-micro font-semibold tracking-[0.035em] text-[color:var(--info-text)]"
        >
          {t('trajectory.decisions.unknownCost', { count: totals.unknownCostRequests })}
        </span>
      )}
    </>
  )
}

export function DecisionSummary({ data, onOpen }: { data: Data; onOpen: () => void }) {
  const { t } = useTranslation()
  const report = data.report
  return (
    <div className="space-y-4">
    {report?.reliability && <details data-runtime-reliability className="rounded-xl border border-border/55 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('trajectory.reliability.title')}</summary>
      {report.reliability.state === 'unavailable' ? <p className="mt-2 text-text-secondary">{t('trajectory.reliability.unavailable')}</p> : <div className="mt-2 space-y-2">
        <p className="text-text-secondary">{t('trajectory.reliability.scope')}</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
          <dt>{t('trajectory.reliability.terminals')}</dt><dd>{Object.entries(report.reliability.terminal).map(([reason, count]) => `${reason}: ${count}`).join(' · ') || '0'}</dd>
          <dt>{t('trajectory.reliability.unsettled')}</dt><dd>{report.reliability.unsettled.count}</dd>
          <dt>{t('trajectory.reliability.oldestSeconds')}</dt><dd>{report.reliability.unsettled.oldestAgeMs === null ? '—' : Math.floor(report.reliability.unsettled.oldestAgeMs / 1000).toLocaleString()}</dd>
        </dl>
        {report.reliability.taskBudgets.map(budget => <p key={`${budget.taskSlug}:${budget.runId}`} className="tabular-nums">{t('trajectory.reliability.tokenBudget')}: {budget.taskSlug}/{budget.runId} · {budget.used ?? t('common.unknown')} / {budget.limit ?? t('common.unknown')}</p>)}
        {report.reliability.signals.length > 0 && <ul className="list-disc space-y-1 pl-4">{report.reliability.signals.map(signal => <li key={`${signal.kind}:${signal.firstSeq}`} title={signal.operationIds.join('\n')}>{t(signal.kind === 'repeated-action' ? 'trajectory.reliability.repeatedAction' : 'trajectory.reliability.repeatedError')}: {signal.toolName} × {signal.count} · seq {signal.firstSeq}–{signal.lastSeq}</li>)}</ul>}
        <p className="text-text-secondary">{t('trajectory.reliability.interpretation')}</p>
        <button type="button" className="craft-control rounded-sm text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(report.reliability, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a'); link.href = url; link.download = `run-reliability-${report.sessionId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>{t('trajectory.reliability.export')}</button>
      </div>}
    </details>}
    <section data-decision-summary>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <h3 className="text-label font-semibold">{t('trajectory.decisions.title')}</h3>
        {report && (
          <span className="text-meta tabular-nums text-text-secondary">
            {t(report.totals.legacyCalls > 0 ? report.totals.points === 0 ? 'trajectory.decisions.scopeHistoricalMeta' : 'trajectory.decisions.scopeLegacyMeta' : 'trajectory.decisions.scopeMeta', {
              features: report.features.length,
              requests: report.totals.requests,
              legacy: report.totals.legacyCalls,
            })}
          </span>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="craft-control ml-auto flex-none rounded-sm text-meta font-medium text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('trajectory.decisions.viewRecords')}
        </button>
      </div>
      {report
        ? (
          <button
            type="button"
            onClick={onOpen}
            className="craft-control flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/55 bg-background/70 px-3 py-3 text-left transition-colors hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SummaryCells totals={report.totals} />
            <span className="craft-text-caption w-full min-w-0 text-text-secondary">
              {report.totals.legacyCalls > 0 && <>{t('trajectory.decisions.historicalSummary', { count: report.totals.legacyCalls })} </>}
              {t('trajectory.decisions.includedCost')}
            </span>
          </button>
        )
        : (
          <p className="text-label text-text-secondary">
            {t(data.state === 'error'
              ? 'trajectory.decisions.loadFailed'
              : data.state === 'unsupported' ? 'trajectory.decisions.unsupported' : 'common.loading')}
          </p>
        )}
    </section>
    </div>
  )
}
