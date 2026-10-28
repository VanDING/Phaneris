/**
 * Chart primitives shared by Run → Overview and Run → Context.
 *
 * Both charts are plain CSS/SVG: category attribution and its visible remainder
 * fill the measured input. The performance line leaves a hole where a request has no
 * comparable rate. Neither interpolates a missing sample.
 */

import type { CSSProperties } from 'react'
import type { RunTrendBar } from './run-model'
import { categoryColor, formatDelta, formatTokens } from './run-model'
import { bucketTrajectoryPerformance, type TrajectoryPerformanceSummary } from './trajectory-performance'
import css from './run-view.module.css'

const categoryVar = (category: string): CSSProperties => ({ '--cat': categoryColor(category) } as CSSProperties)

export interface RunTrendChartProps {
  bars: readonly RunTrendBar[]
  mode: 'total' | 'delta'
  axisMaximum: number
  selectedSeq: number
  markerSeqs: ReadonlySet<number>
  markerLabel: string
  label: string
  onSelect: (requestSeq: number) => void
  valueLabel: (bar: RunTrendBar) => string
}

export function RunTrendChart({
  bars, mode, axisMaximum, selectedSeq, markerSeqs, markerLabel, label, onSelect, valueLabel,
}: RunTrendChartProps) {
  const ticks = mode === 'delta'
    ? [axisMaximum, axisMaximum / 2, 0, -axisMaximum / 2, -axisMaximum]
    : [axisMaximum, axisMaximum * 0.75, axisMaximum * 0.5, axisMaximum * 0.25, 0]
  const tickLabel = (tick: number) => mode === 'delta'
    ? tick === 0 ? '0' : `${tick > 0 ? '+' : '−'}${formatTokens(Math.abs(tick))}`
    : formatTokens(tick)
  const stride = Math.max(1, Math.ceil(bars.length / 7))
  return (
    <div className={css.trendChart} role="group" aria-label={label} data-short-history={bars.length <= 12}>
      <div className={css.chartY} aria-hidden>
        {ticks.map(tick => <span key={tick}>{tickLabel(tick)}</span>)}
      </div>
      <div className={css.plot}>
        <div className={css.gridLines} aria-hidden>{ticks.map(tick => <i key={tick} />)}</div>
        <div className={css.chartBars}>
          {bars.map(bar => {
            const selected = bar.range ? selectedSeq >= bar.range.start && selectedSeq <= bar.range.end : bar.requestSeq === selectedSeq
            const hasMarker = mode === 'total' && (bar.range
              ? [...markerSeqs].some(seq => seq >= bar.range!.start && seq <= bar.range!.end)
              : markerSeqs.has(bar.requestSeq))
            const heightPercent = mode === 'delta' ? 0 : Math.min(100, (bar.total / axisMaximum) * 100)
            const change = bar.change ?? 0
            const deltaRatio = Math.min(1, Math.abs(change) / axisMaximum) / 2
            return (
              <button
                key={bar.key}
                type="button"
                className={`${css.chartCol} craft-control`}
                data-selected={selected}
                data-trend-bar={bar.requestSeq}
                aria-pressed={selected}
                aria-label={`${valueLabel(bar)}${hasMarker ? ` · ${markerLabel}` : ''}`}
                title={`${valueLabel(bar)}${hasMarker ? ` · ${markerLabel}` : ''}`}
                onClick={() => onSelect(bar.requestSeq)}
              >
                {mode === 'total' ? (
                  <span className={css.barStack} style={{ height: `${heightPercent}%` }} aria-hidden>
                    {bar.parts.filter(part => part.tokens > 0).map(part => (
                      <i key={part.category} data-trend-category={part.category} style={{ ...categoryVar(part.category), height: `${bar.total > 0 ? (part.tokens / bar.total) * 100 : 0}%` }} />
                    ))}
                  </span>
                ) : (
                  <span
                    className={css.deltaBar}
                    aria-hidden
                    style={{
                      ...categoryVar(change >= 0 ? 'assistant' : 'tool'),
                      top: change < 0 ? 'calc(50% - 11px)' : undefined,
                      bottom: change >= 0 ? 'calc(50% + 11px)' : undefined,
                      height: `calc((100% - 22px) * ${deltaRatio})`,
                    }}
                  />
                )}
                {hasMarker && <span className={css.eventMarker}>{markerLabel}</span>}
              </button>
            )
          })}
        </div>
        <div className={css.chartX} data-trend-axis aria-hidden style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
          {bars.map((bar, index) => (bars.length <= 8 || index === 0 || index === bars.length - 1 || index % stride === 0) && (
            <span key={bar.key} className={css.xLabel} style={{ gridColumn: index + 1 }}>
              {index === 0 ? bar.range?.start ?? bar.requestSeq : bar.range?.end ?? bar.requestSeq}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export interface RunPerformanceChartProps {
  summary: TrajectoryPerformanceSummary
  label: string
}

/** Output rate by request. A missing sample breaks the line, it is not zero. */
export function RunPerformanceChart({ summary, label }: RunPerformanceChartProps) {
  const buckets = bucketTrajectoryPerformance(summary.requests, 'rate', 48)
  const values = buckets.flatMap(bucket => bucket.value === null ? [] : [bucket.value])
  if (values.length === 0) return null
  const maximum = Math.max(10, Math.ceil(Math.max(...values) / 10) * 10)
  const minimum = Math.max(0, Math.floor(Math.min(...values) / 10) * 10 - 10)
  const span = Math.max(1, maximum - minimum)
  const width = 480, height = 92
  const left = 28, right = 473, top = 12, bottom = 74
  const x = (index: number) => left + (buckets.length <= 1 ? 0 : (index / (buckets.length - 1)) * (right - left))
  const y = (value: number) => bottom - ((value - minimum) / span) * (bottom - top)
  const segments: string[][] = []
  let line: string[] = []
  buckets.forEach((bucket, index) => {
    if (bucket.value === null) {
      if (line.length) segments.push(line)
      line = []
      return
    }
    line.push(`${x(index).toFixed(1)},${y(bucket.value).toFixed(1)}`)
  })
  if (line.length) segments.push(line)
  const rules = [maximum, (maximum + minimum) / 2, minimum]
  const firstSeq = buckets[0]?.startSeq
  const middleSeq = buckets[Math.floor((buckets.length - 1) / 2)]?.startSeq
  const lastSeq = buckets.at(-1)?.endSeq
  return (
    <svg className={css.lineChart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {rules.map(rule => <path key={rule} className={css.chartRule} d={`M${left} ${y(rule).toFixed(1)}H${right}`} />)}
      {rules.map(rule => <text key={`label-${rule}`} x="0" y={y(rule) + 3}>{Math.round(rule)}</text>)}
      {segments.map((points, index) => <polyline key={index} className={css.rateLine} points={points.join(' ')} />)}
      {firstSeq !== undefined && <text x={left - 2} y={height - 1}>#{firstSeq}</text>}
      {middleSeq !== undefined && <text x={(left + right) / 2} y={height - 1} textAnchor="middle">#{middleSeq}</text>}
      {lastSeq !== undefined && <text x={right} y={height - 1} textAnchor="end">#{lastSeq}</text>}
    </svg>
  )
}

/** Accessible value text shared by both chart call sites. */
export function trendValueLabel(bar: RunTrendBar, mode: 'total' | 'delta', requestLabel: string): string {
  const range = bar.range ? `${bar.range.start}–${bar.range.end} · #${bar.requestSeq}` : String(bar.requestSeq)
  return mode === 'delta'
    ? `${requestLabel} ${range}: ${formatDelta(bar.change)}`
    : `${requestLabel} ${range}: ${formatTokens(bar.total)}`
}
