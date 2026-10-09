import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import type { SessionDecisionItem, SessionDecisionQuery, SessionDecisionTotals } from '@phaneris/shared/decisions/session'
import type { DecisionLayerFeature } from '@phaneris/shared/decisions/settings'
import { useSessionDecisions } from '@/hooks/useSessionDecisions'
import { Button } from '@/components/ui/button'

type Data = ReturnType<typeof useSessionDecisions>
const featureKeys: Record<DecisionLayerFeature, string> = {
  decideTool: 'featureDecideTool', suggestions: 'featureSuggestions', adaptiveThinking: 'featureAdaptiveThinking', largeResults: 'featureLargeResults',
  midTurnMessages: 'featureMidTurnMessages', turnOutcome: 'featureTurnOutcome', smartTitles: 'featureSmartTitles', guardedMode: 'featureGuardedMode',
  riskBadges: 'featureRiskBadges', semanticLabels: 'featureSemanticLabels', automationConditions: 'featureAutomationConditions', taskVerdicts: 'featureTaskVerdicts', taskRepairs: 'featureTaskRepairs',
}
const cost = (totals: SessionDecisionTotals) => `$${totals.knownCostUsd.toFixed(totals.knownCostUsd < 0.01 ? 4 : 2)}`
function status(item: SessionDecisionItem): string {
  if (item.legacy) return 'historical'
  if (item.application?.status === 'applied' && item.application.changed) return 'changed'
  if (item.application) return item.application.status === 'unknown' ? 'unconfirmed' : item.application.status
  if (item.attempts.some(attempt => attempt.status === 'pending')) return 'pending'
  return 'unconfirmed'
}
export function DecisionSummary({ data, onOpen }: { data: Data; onOpen: () => void }) {
  const { t } = useTranslation()
  return <section className="border-y border-border/50 py-3" data-decision-summary>
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <h3 className="font-semibold">{t('trajectory.views.decisions')}</h3>
      <button type="button" onClick={onOpen} className="flex items-center gap-1 text-accent hover:underline focus-visible:outline focus-visible:outline-ring">
        {t('trajectory.decisions.viewRecords')}<ArrowRight className="size-3" />
      </button>
    </div>
    {data.report ? <><DecisionMetrics totals={data.report.totals} compact /><p className="mt-2 text-[11px] text-muted-foreground">{t('trajectory.decisions.includedCost')}</p></>
      : <p className="mt-2 text-[12px] text-muted-foreground">{t(data.state === 'error' ? 'trajectory.decisions.loadFailed' : data.state === 'unsupported' ? 'trajectory.decisions.unsupported' : 'common.loading')}</p>}
  </section>
}
function DecisionMetrics({ totals, compact = false }: { totals: SessionDecisionTotals; compact?: boolean }) {
  const { t } = useTranslation()
  return <dl className={`grid grid-cols-2 gap-x-5 gap-y-3 @min-[620px]/trajectory:grid-cols-4 ${compact ? 'mt-3' : 'border-y border-border/50 py-4'}`}>
    {(['points', 'changed', 'fallback', 'cost'] as const).map(key => <div key={key}>
      <dt className="text-[11px] text-muted-foreground">{t(`trajectory.decisions.${key}`)}</dt>
      <dd className="mt-1 text-[17px] font-semibold tabular-nums">{key === 'cost' ? !totals.knownCostRequests && (totals.unknownCostRequests || totals.legacyCalls) ? t('common.unknown') : cost(totals) : totals[key].toLocaleString()}
        {key === 'cost' && totals.unknownCostRequests > 0 && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{totals.knownCostRequests > 0 ? '+ ' : ''}{t('common.unknown')} × {totals.unknownCostRequests}</span>}
      </dd>
    </div>)}
  </dl>
}
export function SessionDecisions({ sessionId, workspaceId, serverScope, data, onOpenChat, onConfigure }: {
  sessionId: string; workspaceId?: string; serverScope?: string; data: Data; onOpenChat: (id: string) => void; onConfigure: () => void;
}) {
  const { t, i18n } = useTranslation()
  const [feature, setFeature] = useState<DecisionLayerFeature | ''>('')
  const [filter, setFilter] = useState<SessionDecisionQuery['status']>()
  const [turn, setTurn] = useState('')
  const [expanded, setExpanded] = useState<string>()
  const id = useId()
  const filtered = useSessionDecisions(sessionId, workspaceId, { feature: feature || undefined, status: filter, turnId: turn || undefined }, !!feature || !!filter || !!turn, serverScope)
  const view = feature || filter || turn ? filtered : data
  const report = view.report
  const base = data.report
  const featureName = (value: DecisionLayerFeature) => t(`settings.ai.decisions.${featureKeys[value]}`)
  const knownTurns = base?.turnIds ?? []
  return <div className="h-full overflow-y-auto px-3 py-4 pb-8" data-session-decisions={sessionId}>
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-[13px] font-semibold">{t('trajectory.decisions.title')}</h2><p className="mt-1 text-[12px] text-muted-foreground">{t('trajectory.decisions.scope')}</p></div>
        <Button size="sm" variant="ghost" onClick={onConfigure}>{t('trajectory.decisions.configure')}</Button>
      </div>
      {base?.coverage === 'partial' && <p className="text-[12px] text-muted-foreground" role="note">{t('trajectory.decisions.partial')}</p>}
      {!!report?.totals.legacyCalls && <p className="text-[12px] text-muted-foreground">{t('trajectory.decisions.legacyCalls', { count: report.totals.legacyCalls })}</p>}
      {base && !base.enabled && <p className="text-[12px] text-muted-foreground" role="note">{t('trajectory.decisions.disabled')}</p>}
      {report && <><DecisionMetrics totals={report.totals} /><p className="text-[11px] text-muted-foreground">{t('trajectory.decisions.accounting', { requests: report.totals.requests, unconfirmed: report.totals.unconfirmed,
        failures: report.totals.failures, cancelled: report.totals.cancelled, input: report.totals.inputTokens.toLocaleString(), output: report.totals.outputTokens.toLocaleString() })} {t('trajectory.decisions.includedCost')}</p></>}
      {!!report?.features.length && <section aria-label={t('trajectory.decisions.features')}>
        <h3 className="mb-2 text-[12px] font-semibold">{t('trajectory.decisions.features')}</h3>
        <div className="divide-y divide-border/40 border-y border-border/50">
          {report.features.map(entry => <button key={entry.feature} type="button" aria-pressed={feature === entry.feature} onClick={() => { setFeature(feature === entry.feature ? '' : entry.feature); setExpanded(undefined) }}
            className={`flex w-full items-center gap-3 px-2 py-2 text-left text-[12px] hover:bg-foreground/5 focus-visible:outline focus-visible:outline-ring ${feature === entry.feature ? 'bg-foreground/5' : ''}`}>
            <span className="min-w-0 flex-1">{featureName(entry.feature)}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{t('trajectory.decisions.featureCounts', { points: entry.totals.points, changed: entry.totals.changed })}</span>
            <span className="shrink-0 text-[11px] tabular-nums">{!entry.totals.knownCostRequests && (entry.totals.unknownCostRequests || entry.totals.legacyCalls) ? t('common.unknown') : cost(entry.totals)}{entry.totals.knownCostRequests > 0 && entry.totals.unknownCostRequests ? ' + ?' : ''}</span>
          </button>)}
        </div>
      </section>}
      <section aria-label={t('trajectory.decisions.records')}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-[12px] font-semibold">{t('trajectory.decisions.records')}</h3>
          <label className="sr-only" htmlFor={`${id}-feature`}>{t('trajectory.decisions.features')}</label>
          <select id={`${id}-feature`} value={feature} onChange={event => { setFeature(event.target.value as DecisionLayerFeature | ''); setExpanded(undefined) }} className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px]">
            <option value="">{t('trajectory.decisions.allFeatures')}</option>{base?.features.map(entry => <option key={entry.feature} value={entry.feature}>{featureName(entry.feature)}</option>)}
          </select>
          <label className="sr-only" htmlFor={`${id}-status`}>{t('trajectory.decisions.status')}</label>
          <select id={`${id}-status`} value={filter ?? ''} onChange={event => { setFilter((event.target.value || undefined) as SessionDecisionQuery['status']); setExpanded(undefined) }} className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px]">
            <option value="">{t('trajectory.decisions.allStatuses')}</option>{['changed', 'fallback', 'unconfirmed', 'failed', 'cancelled'].map(value => <option key={value} value={value}>{t(`trajectory.decisions.status.${value}`)}</option>)}
          </select>
          {knownTurns.length > 0 && <><label className="sr-only" htmlFor={`${id}-turn`}>{t('trajectory.decisions.turn')}</label><select id={`${id}-turn`} value={turn} onChange={event => setTurn(event.target.value)} className="max-w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px]">
            <option value="">{t('trajectory.decisions.allTurns')}</option>{knownTurns.map(value => <option key={value} value={value}>{value}</option>)}
          </select></>}
        </div>
        {view.state !== 'ready' ? <div className="py-8 text-center text-[12px] text-muted-foreground" role="status">
          <p>{t(view.state === 'error' ? 'trajectory.decisions.loadFailed' : view.state === 'unsupported' ? 'trajectory.decisions.unsupported' : 'common.loading')}</p>
          {view.state === 'error' && <Button size="sm" variant="ghost" onClick={view.retry}>{t('common.retry')}</Button>}
        </div> : !report?.items.length ? <div className="py-8 text-center text-[12px] text-muted-foreground" role="status">
          <p className="font-medium">{t(feature || filter || turn ? 'trajectory.decisions.noMatches' : 'trajectory.decisions.empty')}</p>
          <p className="mt-2">{t('trajectory.decisions.emptyHint')}</p>
        </div> : <div className="divide-y divide-border/40 border-y border-border/50">
          {report.items.map(item => <div key={item.id} data-decision-id={item.id}>
            <button type="button" aria-expanded={expanded === item.id} aria-controls={`${id}-${item.id}`} onClick={() => setExpanded(expanded === item.id ? undefined : item.id)} className="flex w-full items-start gap-2 px-1 py-3 text-left hover:bg-foreground/[0.025] focus-visible:outline focus-visible:outline-ring">
              {expanded === item.id ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1"><span className="text-[12px] font-medium">{featureName(item.feature)}</span><span className="mt-1 block text-[11px] text-muted-foreground">{new Date(item.startedAt).toLocaleString(i18n.language)} · {t('trajectory.decisions.attemptCount', { count: item.attempts.length })}</span></span>
              <span className={`shrink-0 text-[11px] ${status(item) === 'changed' ? 'text-accent' : 'text-muted-foreground'}`}>{t(`trajectory.decisions.status.${status(item)}`)}</span>
            </button>
            {expanded === item.id && <DecisionDetail item={item} id={`${id}-${item.id}`} onOpenChat={onOpenChat} />}
          </div>)}
        </div>}
        {report?.nextCursor && <div className="mt-3 flex justify-center"><Button variant="ghost" size="sm" disabled={view.paging} onClick={view.loadMore}>{t(view.paging ? 'common.loading' : 'trajectory.decisions.loadMore')}</Button></div>}
      </section>
    </div>
  </div>
}
function DecisionDetail({ item, id, onOpenChat }: { item: SessionDecisionItem; id: string; onOpenChat: (id: string) => void }) {
  const { t } = useTranslation()
  const blocks = [
    ['trigger', item.source ?? null], ['recommendation', item.recommendation ?? null], ['application', item.application ?? null],
    ['observations', item.observations.length ? item.observations : null],
  ] as const
  return <div id={id} className="space-y-3 bg-foreground/[0.025] px-4 py-4 text-[12px]">
    {item.source?.messageId && <Button size="sm" variant="ghost" onClick={() => onOpenChat(item.source!.messageId!)}>{t('trajectory.decisions.openChat')}</Button>}
    <div className="grid gap-4 @min-[640px]/trajectory:grid-cols-2">
    {blocks.map(([key, value]) => <section key={key} className="min-w-0"><h4 className="mb-1 font-medium">{t(`trajectory.decisions.${key}`)}</h4>
      {value ? key === 'recommendation' || key === 'application' ? <>
        <p className="font-medium">{t(`trajectory.decisions.action.${value.action.split(':')[0]}`, { defaultValue: value.action, value: value.action.split(':').slice(1).join(':') })}</p>
        {key === 'application' && <p className="mt-1 text-muted-foreground">{t(`trajectory.decisions.status.${status(item)}`)}</p>}
        <details className="mt-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">{t('trajectory.decisions.structuredEvidence')}</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre></details>
      </> : <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 text-[11px]">{JSON.stringify(value, null, 2)}</pre>
        : <p className="text-muted-foreground">{t(`trajectory.decisions.${key === 'application' ? 'applicationUnknown' : key === 'trigger' ? 'triggerUnknown' : key === 'observations' ? 'noObservations' : 'noRecommendation'}`)}</p>}
    </section>)}
    </div>
    <section><h4 className="mb-2 font-medium">{t('trajectory.decisions.requests')}</h4>
      {item.unavailableReason && <p className="mb-2 text-muted-foreground">{t('trajectory.decisions.unavailableReason', { reason: item.unavailableReason })}</p>}
      {item.attempts.map((attempt, index) => <details key={attempt.id} className="mb-2 rounded border border-border/50 bg-background/40 px-2 py-2">
        <summary className="cursor-pointer break-words text-[11px]">{index + 1}. {attempt.model} · {t(`trajectory.decisions.attempt.${attempt.status}`)} · {attempt.record?.latencyMs === undefined ? '—' : `${attempt.record.latencyMs} ms`} · {attempt.costUsd === undefined ? t('common.unknown') : `$${attempt.costUsd.toFixed(6)}`}</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify({ id: attempt.id, accountingOperationId: attempt.accountingOperationId,
          sent: attempt.sent, inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens, record: attempt.record }, null, 2)}</pre>
      </details>)}
      <p className="mt-2 text-[11px] text-muted-foreground">{t('trajectory.decisions.privacy')}</p>
    </section>
  </div>
}
