import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDurationMillis } from './trajectory-layout'
import { bucketTrajectoryPerformance, type TrajectoryPerformanceSummary } from './trajectory-performance'

export function TrajectoryPerformance({ summary, isProcessing, onOpenTrajectory, onOpenContext }: {
  summary: TrajectoryPerformanceSummary
  isProcessing?: boolean
  onOpenTrajectory: (index?: number) => void
  onOpenContext: (requestSeq?: number) => void
}) {
  const { t, i18n } = useTranslation()
  const requestSelectId = useId()
  const [metric, setMetric] = useState<'rate' | 'ttft'>('rate')
  const [selectedId, setSelectedId] = useState<string>()
  const [width, setWidth] = useState(600)
  const plotRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = plotRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.max(240, Math.floor(element.clientWidth))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const locale = i18n.resolvedLanguage ?? i18n.language
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])
  const axisNumber = useMemo(() => new Intl.NumberFormat(locale, metric === 'ttft'
    ? { maximumFractionDigits: 3 } : { notation: 'compact', maximumFractionDigits: 1 }), [locale, metric])
  const buckets = useMemo(() => bucketTrajectoryPerformance(summary.requests, metric), [summary.requests, metric])
  const selected = summary.requests.find(request => request.id === selectedId) ?? summary.requests.at(-1)
  if (!selected) return null
  const maximum = Math.max(metric === 'ttft' ? .001 : 1, ...buckets.map(bucket => metric === 'ttft' ? (bucket.maximum ?? 0) / 1000 : bucket.maximum ?? 0))
  const scale = Math.pow(10, Math.floor(Math.log10(maximum)))
  const upper = Math.ceil(maximum / scale) * scale
  const W = width, H = 100, left = 35, right = 9, top = 17, bottom = 21
  const x = (index: number) => left + index * (W - left - right) / Math.max(1, buckets.length - 1)
  const y = (value: number) => H - bottom - (metric === 'ttft' ? value / 1000 : value) / upper * (H - bottom - top)
  const paths: string[] = [], segment: string[] = []
  buckets.forEach((bucket, index) => {
    if (bucket.value === null) { if (segment.length) paths.push(segment.join(' ')); segment.length = 0; return }
    segment.push(`${segment.length ? 'L' : 'M'}${x(index)},${y(bucket.value)}`)
  })
  if (segment.length) paths.push(segment.join(' '))
  const selectedBucket = buckets.findIndex(bucket => selected.requestSeq >= bucket.startSeq && selected.requestSeq <= bucket.endSeq)
  const selectedValue = metric === 'rate' ? selected.timing.tokensPerSecond : selected.timing.ttftMs
  const validCount = metric === 'rate' ? summary.rateCount : summary.ttftCount
  const stride = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(width / 75))))
  const rate = (value: number | null) => value === null ? '—' : `${number.format(value)} tok/s`
  const reason = metric === 'rate' ? selected.timing.rateUnavailableReason : selected.timing.unavailableReason
  return (
    <section data-run-performance>
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="craft-text-label font-semibold">{t('trajectory.performance.title')}</h3>
        <span className="craft-text-caption tabular-nums text-text-secondary" data-performance-average>
          {metric === 'rate' ? t('trajectory.performance.average', { value: rate(summary.averageRate) }) : `P50 ${formatDurationMillis(summary.p50)}`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {(['rate', 'ttft'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value}
            onClick={() => setMetric(value)} data-performance-metric={value}
            className={`craft-control craft-text-caption rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${metric === value ? 'font-medium text-foreground underline decoration-accent underline-offset-4' : 'text-text-secondary hover:text-foreground'}`}>
            {t(value === 'rate' ? 'trajectory.performance.rate' : 'trajectory.overview.ttft')}
          </button>)}
        </div>
      </div>
      <div className="rounded-xl border border-border/55 bg-background/70 px-3 py-2" data-performance-chart>
        <div ref={plotRef}>
          {validCount > 0 ? <svg viewBox={`0 0 ${W} ${H}`} className="block h-[100px] w-full cursor-crosshair" role="img"
            aria-label={t('trajectory.performance.chartLabel', { metric: t(metric === 'rate' ? 'trajectory.performance.rate' : 'trajectory.overview.ttft') })}
            onClick={event => {
              const bounds = event.currentTarget.getBoundingClientRect()
              const position = (event.clientX - bounds.left) / bounds.width * W
              const index = Math.max(0, Math.min(buckets.length - 1, Math.round((position - left) / (W - left - right) * Math.max(1, buckets.length - 1))))
              setSelectedId(buckets[index]!.request.id)
            }}>
            <text x="0" y="10" className="craft-text-caption fill-current text-text-secondary">{metric === 'rate' ? 'tok/s' : 's'}</text>
            {[0, .5, 1].map(part => <g key={part}>
              <line x1={left} x2={W - right} y1={H - bottom - part * (H - bottom - top)} y2={H - bottom - part * (H - bottom - top)} stroke="var(--border)" strokeDasharray="3 5" />
              <text x={left - 8} y={H - bottom - part * (H - bottom - top) + 4} textAnchor="end" className="craft-text-caption fill-current text-text-secondary">{axisNumber.format(upper * part)}</text>
            </g>)}
            {buckets.map((bucket, index) => <g key={`${bucket.startSeq}-${bucket.endSeq}`}>
              <title>{t('trajectory.performance.bucketTitle', { start: bucket.startSeq, end: bucket.endSeq,
                min: bucket.minimum === null ? '—' : axisNumber.format(metric === 'ttft' ? bucket.minimum / 1000 : bucket.minimum),
                max: bucket.maximum === null ? '—' : axisNumber.format(metric === 'ttft' ? bucket.maximum / 1000 : bucket.maximum), unit: metric === 'rate' ? 'tok/s' : 's' })}</title>
              {bucket.value !== null && bucket.minimum !== null && bucket.maximum !== null && bucket.minimum !== bucket.maximum
                && <line data-performance-range x1={x(index)} x2={x(index)} y1={y(bucket.minimum)} y2={y(bucket.maximum)} stroke="var(--accent)" opacity=".35" />}
              {bucket.value !== null && buckets[index - 1]?.value == null && buckets[index + 1]?.value == null
                && <circle data-performance-isolated cx={x(index)} cy={y(bucket.value)} r="2" fill="var(--accent)" />}
              {(index === 0 || index === buckets.length - 1 || (index % stride === 0 && index < buckets.length - Math.ceil(stride / 2)))
                && <text x={x(index)} y={H - 2} textAnchor="middle" className="craft-text-caption fill-current text-text-secondary">{bucket.endSeq}</text>}
            </g>)}
            {paths.map((path, index) => <path key={index} data-performance-line d={path} fill="none" stroke="var(--accent)" opacity=".72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />)}
            {selectedValue !== null && selectedBucket >= 0 && <circle cx={x(selectedBucket)} cy={y(selectedValue)} r="3" fill="var(--accent)" stroke="var(--background)" />}
          </svg> : <div className="flex min-h-[100px] items-center craft-text-caption text-text-secondary" data-performance-empty>
            {summary.legacyCount ? t('trajectory.performance.legacyEmpty', { count: summary.legacyCount }) : t('trajectory.performance.empty')}
          </div>}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 craft-text-caption tabular-nums text-text-secondary">
          <label className="sr-only" htmlFor={requestSelectId}>{t('trajectory.performance.selectRequest')}</label>
          <select id={requestSelectId} data-performance-select aria-label={t('trajectory.performance.selectRequest')} value={selected.id}
            onChange={event => setSelectedId(event.target.value)} className="craft-field-input h-6 max-w-24 rounded border-0 bg-transparent pr-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {summary.requests.map(request => <option key={request.id} value={request.id}>R{request.requestSeq}</option>)}
          </select>
          <span>{rate(selected.timing.tokensPerSecond)}</span><span>TTFT {formatDurationMillis(selected.timing.ttftMs)}</span>
          {reason && <span>{t(`trajectory.timing.reason.${reason}`)}</span>}
          <div className="ml-auto flex items-center gap-3">
            <button type="button" data-performance-open-request onClick={() => onOpenTrajectory(selected.recordIndex)}
              className="craft-control rounded-sm font-medium text-accent-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('trajectory.performance.openRequest')}</button>
            <button type="button" onClick={() => onOpenContext(selected.requestSeq)}
              className="craft-control rounded-sm font-medium text-accent-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('trajectory.overview.openContext')}</button>
          </div>
        </div>
      </div>
      <p className="mt-1.5 craft-text-caption tabular-nums text-text-secondary" data-performance-coverage>
        {t('trajectory.performance.coverage', { rate: summary.rateCount, ttft: summary.ttftCount, total: summary.requests.length })}
        {metric === 'rate' && <span title={t('trajectory.performance.observedRateHint')}> · {t('trajectory.performance.clientObserved')}</span>}
        {metric === 'ttft' && summary.p95 !== null ? ` · P95 ${formatDurationMillis(summary.p95)}` : ''}
        {buckets.length < summary.requests.length ? ` · ${t('trajectory.performance.bucketed', { count: buckets.length })}` : ''}
        {isProcessing ? ` · ${t('trajectory.performance.completedOnly')}` : ''}
      </p>
    </section>
  )
}
