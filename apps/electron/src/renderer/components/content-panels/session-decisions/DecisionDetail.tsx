/**
 * One decision record, in full.
 *
 * Section order follows the design plan (§4.2): trigger → recommendation →
 * actual handling → later observations → request detail. Everything that is
 * diagnostic — model, provider, tokens, latency, cost, raw record — is folded
 * away, so the readable answer comes first.
 *
 * Structured evidence is rendered as key/value rows instead of a JSON dump;
 * the previous version pasted `JSON.stringify` into a <pre> for the trigger
 * block, which buried the one readable fact (which message it came from) under
 * punctuation.
 */
import { useTranslation } from 'react-i18next'
import { CornerDownRight, ExternalLink } from 'lucide-react'
import type { SessionDecisionAttempt, SessionDecisionItem } from '@phaneris/shared/decisions/session'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DecisionKv, DecisionNotice, DecisionTag,
  decisionStatus, formatDecisionCost, hasFailedAttempt,
  type DecisionKvRow,
} from './decision-view'

const ATTEMPT_TONE: Record<SessionDecisionAttempt['status'], string> = {
  succeeded: 'bg-foreground/5 text-muted-foreground',
  pending: 'bg-accent/[0.14] text-accent',
  failed: 'bg-destructive/[0.12] text-destructive',
  timeout: 'bg-destructive/[0.12] text-destructive',
  cancelled: 'bg-foreground/5 text-muted-foreground',
  unknown: 'bg-foreground/5 text-muted-foreground',
}

/** Actions carry an optional `:value` payload (e.g. `status:needs-review`). */
function actionLabel(
  action: string | undefined,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!action) return null
  const [head, tail] = [action.split(':')[0] ?? action, action.split(':').slice(1).join(':')]
  return translate(`trajectory.decisions.action.${head}`, { defaultValue: action, value: tail })
}

/** Reason codes are free-form on the wire; an unknown code renders itself. */
function reasonLabel(reason: string | undefined, translate: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (!reason) return null
  return translate(`trajectory.decisions.reason.${reason}`, { defaultValue: reason })
}

/** Follow-up result tags are free-form too. */
function observationLabel(result: string, translate: (key: string, options?: Record<string, unknown>) => string): string {
  return translate(`trajectory.decisions.observation.${result}`, { defaultValue: result })
}

export function DecisionDetail({ item, onOpenChat, className }: {
  item: SessionDecisionItem
  onOpenChat?: (messageId: string) => void
  className?: string
}) {
  const { t } = useTranslation()
  const status = decisionStatus(item)
  const recommendation = item.recommendation
  const application = item.application

  const evidenceRows = (detail: Record<string, unknown> | undefined): DecisionKvRow[] =>
    Object.entries(detail ?? {}).map(([key, value]) => [
      key,
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
      typeof value !== 'object',
    ] as DecisionKvRow)

  const sourceRows: DecisionKvRow[] = []
  const source = item.source
  if (source?.turnId) sourceRows.push([t('trajectory.decisions.turn'), source.turnId, true])
  if (source?.messageId) sourceRows.push([t('trajectory.decisions.sourceMessage'), source.messageId, true])
  if (source?.toolCallId) sourceRows.push([t('trajectory.decisions.sourceToolCall'), source.toolCallId, true])
  if (source?.taskRunId) sourceRows.push([t('trajectory.decisions.sourceTaskRun'), source.taskRunId, true])
  if (source?.automationId) sourceRows.push([t('trajectory.decisions.sourceAutomation'), source.automationId, true])

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <section className="flex min-w-0 flex-col">
        <h4 className="mb-2 text-[12px] font-semibold">{t('trajectory.decisions.trigger')}</h4>
        {sourceRows.length > 0
          ? <DecisionKv rows={sourceRows} />
          : <p className="text-[11.5px] leading-5 text-muted-foreground">{t('trajectory.decisions.triggerUnknown')}</p>}
        {item.unavailableReason && (
          <div className="mt-2">
            <DecisionNotice tone="info">
              {t('trajectory.decisions.unavailableReason', {
                reason: reasonLabel(item.unavailableReason, t) ?? item.unavailableReason,
              })}
            </DecisionNotice>
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col">
        <h4 className="mb-2 text-[12px] font-semibold">{t('trajectory.decisions.recommendation')}</h4>
        {recommendation
          ? (
            <>
              <p className="text-[12px] font-medium">
                {actionLabel(recommendation.action, t) ?? recommendation.action}
              </p>
              {Object.keys(recommendation.detail ?? {}).length > 0 && (
                <details className="mt-1.5">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                    <span aria-hidden className="size-0 border-y-[3.5px] border-l-4 border-y-transparent border-l-current" />
                    {t('trajectory.decisions.structuredEvidence')}
                  </summary>
                  <div className="mt-1.5 rounded-lg bg-foreground/5 p-2">
                    <DecisionKv rows={evidenceRows(recommendation.detail)} />
                  </div>
                </details>
              )}
            </>
          )
          : <p className="text-[12px] text-muted-foreground">{t('trajectory.decisions.noRecommendation')}</p>}
      </section>

      <section className="flex min-w-0 flex-col">
        <h4 className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
          {t('trajectory.decisions.application')}
          <DecisionTag status={status} />
        </h4>
        {application
          ? (
            <>
              <p className="text-[12px] font-medium">
                {actionLabel(application.action, t) ?? application.action}
              </p>
              <div className="mt-2">
                <DecisionKv rows={[
                  // The contract carries no baseline field: the host's action and
                  // its reason are the whole record of what it did.
                  application.reason
                    ? [t('trajectory.decisions.reason'), reasonLabel(application.reason, t) ?? application.reason]
                    : null,
                ]} />
              </div>
            </>
          )
          : (
            <DecisionNotice>
              {hasFailedAttempt(item)
                ? t('trajectory.decisions.applicationFailed')
                : t('trajectory.decisions.applicationUnknown')}
            </DecisionNotice>
          )}
      </section>

      <section className="flex min-w-0 flex-col">
        <h4 className="mb-2 text-[12px] font-semibold">{t('trajectory.decisions.observations')}</h4>
        {item.observations.length > 0
          ? (
            <div className="overflow-hidden rounded-lg border border-border/55 bg-background/70">
              {item.observations.map((observation, index) => (
                <div
                  key={`${observation.result}-${index}`}
                  className="flex min-h-8 items-center gap-2 border-b border-border/45 px-3 text-[11.5px] last:border-b-0"
                >
                  <CornerDownRight aria-hidden className="size-3 flex-none text-muted-foreground" />
                  <span className="min-w-0">{observationLabel(observation.result, t)}</span>
                </div>
              ))}
            </div>
          )
          : <p className="text-[11.5px] leading-5 text-muted-foreground">{t('trajectory.decisions.noObservations')}</p>}
      </section>

      <section className="flex min-w-0 flex-col">
        <h4 className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
          {t('trajectory.decisions.requests')}
          <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
            {t('trajectory.decisions.attemptCount', { count: item.attempts.length })}
          </span>
        </h4>
        <div className="flex flex-col gap-2">
          {item.attempts.map(attempt => {
            const cost = formatDecisionCost(attempt.costUsd)
            return (
              <div key={attempt.id} className="rounded-xl border border-border/55 bg-background/70 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn(
                    'inline-flex h-[18px] flex-none items-center rounded-[4px] px-[5px] text-[10px] font-semibold tracking-[0.035em]',
                    ATTEMPT_TONE[attempt.status],
                  )}>
                    {t(`trajectory.decisions.attempt.${attempt.status}`)}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{attempt.model}</span>
                  <span className="ml-auto flex flex-none items-center gap-2.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {attempt.record?.latencyMs !== undefined && <span>{attempt.record.latencyMs} ms</span>}
                    <span className={cn(cost === null && 'text-[color:var(--info-text)]')}>{cost ?? t('common.unknown')}</span>
                  </span>
                </div>
                <div className="mt-2">
                  <DecisionKv rows={[
                    [t('trajectory.decisions.tokens'), `${attempt.inputTokens ?? '—'} / ${attempt.outputTokens ?? '—'}`],
                    [t('trajectory.decisions.provider'), attempt.provider, true],
                  ]} />
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{t('trajectory.decisions.privacy')}</p>
        <details className="mt-1.5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
            <span aria-hidden className="size-0 border-y-[3.5px] border-l-4 border-y-transparent border-l-current" />
            {t('trajectory.decisions.rawRecord')}
          </summary>
          <div className="mt-1.5 rounded-lg bg-foreground/5 p-2">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-5 text-muted-foreground">
              {JSON.stringify({
                id: item.id,
                feature: item.feature,
                startedAt: new Date(item.startedAt).toISOString(),
                legacy: item.legacy ?? false,
                source: item.source ?? null,
                unavailableReason: item.unavailableReason ?? null,
              }, null, 2)}
            </pre>
          </div>
        </details>
      </section>

      {onOpenChat && item.source?.messageId && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onOpenChat(item.source!.messageId!)}>
            <ExternalLink className="size-3.5" />{t('trajectory.decisions.openChat')}
          </Button>
        </div>
      )}
    </div>
  )
}
