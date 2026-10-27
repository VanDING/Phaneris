/** Plain request usage facts, shared by the Context and Overview chart footers. */
import { useTranslation } from 'react-i18next'
import type { TrajectoryRequestContext } from './trajectory-context'
import { cacheHitRate, formatExactTokens } from './run-model'
import css from './run-view.module.css'

export function RunRequestUsage({ context }: { context: TrajectoryRequestContext | undefined }) {
  const { t } = useTranslation()
  const rate = cacheHitRate(context)
  return (
    <span className={css.requestUsage}>
      <span>{context?.inputTokens !== undefined
        ? t('run.context.providerInput', { input: formatExactTokens(context.inputTokens) })
        : t('run.context.providerInputMissing')}</span>
      <span data-run-cache-hit title={t('run.context.cacheHitNote')}>
        {t('run.context.cacheHitRate', { rate: rate === undefined ? '—' : `${(rate * 100).toFixed(1)}%` })}
      </span>
    </span>
  )
}
