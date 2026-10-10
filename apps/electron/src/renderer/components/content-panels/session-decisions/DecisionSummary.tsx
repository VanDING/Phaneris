/**
 * Run → Overview · the decision summary strip.
 *
 * One line of scope, four numbers, and a link into the Decisions tab. It
 * borrows the Overview's own section and card shapes (`h3 text-[12px]
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
  const cells = [
    { key: 'points', icon: <CornerDownRight className="size-3.5" />, value: totals.points.toLocaleString() },
    { key: 'changed', icon: <ArrowRight className="size-3.5" />, value: totals.changed.toLocaleString() },
    { key: 'fallback', icon: <Ban className="size-3.5" />, value: totals.fallback.toLocaleString() },
    { key: 'cost', icon: <Clock3 className="size-3.5" />, value: costIsUnknown ? t('common.unknown') : cost ?? t('common.unknown') },
  ]
  return (
    <>
      {cells.map(cell => (
        <span key={cell.key} className="flex min-w-0 flex-none items-baseline gap-1.5">
          <span className="text-muted-foreground">{cell.icon}</span>
          <span className="text-[11px] text-muted-foreground">{t(`trajectory.decisions.${cell.key}`)}</span>
          <span className="text-[13px] font-semibold tabular-nums">{cell.value}</span>
        </span>
      ))}
      {totals.unknownCostRequests > 0 && (
        <span
          title={t('trajectory.decisions.unknownCostNote', { count: totals.unknownCostRequests })}
          className="inline-flex h-[18px] flex-none items-center rounded-[4px] bg-[color:var(--info)]/[0.16] px-[5px] text-[10px] font-semibold tracking-[0.035em] text-[color:var(--info-text)]"
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
    <section data-decision-summary>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <h3 className="text-[12px] font-semibold">{t('trajectory.decisions.title')}</h3>
        {report && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t('trajectory.decisions.scopeMeta', {
              features: report.features.length,
              requests: report.totals.requests,
            })}
          </span>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto flex-none rounded-sm text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('trajectory.decisions.viewRecords')}
        </button>
      </div>
      {report
        ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/55 bg-background/70 px-3 py-3 text-left transition-colors hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SummaryCells totals={report.totals} />
            <span className="ml-auto flex-none text-[11px] text-muted-foreground">
              {t('trajectory.decisions.includedCost')}
            </span>
          </button>
        )
        : (
          <p className="text-[12px] text-muted-foreground">
            {t(data.state === 'error'
              ? 'trajectory.decisions.loadFailed'
              : data.state === 'unsupported' ? 'trajectory.decisions.unsupported' : 'common.loading')}
          </p>
        )}
    </section>
  )
}
