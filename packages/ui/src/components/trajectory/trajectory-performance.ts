import { readAssistantTiming, type AssistantTimingValues } from '@phaneris/core/utils'
import type { TrajectorySnapshot } from './trajectory-contract'
import type { TrajectoryRenderRecord } from './trajectory-layout'

export interface TrajectoryPerformanceRequest {
  id: string
  requestSeq: number
  recordIndex?: number
  timing: AssistantTimingValues
  outputTokens: number | null
}

export interface TrajectoryPerformanceSummary {
  requests: readonly TrajectoryPerformanceRequest[]
  ttftCount: number
  rateCount: number
  legacyCount: number
  p50: number | null
  p95: number | null
  averageRate: number | null
}

/** Request-header identities and display ordinals match the existing ledger. */
export function deriveTrajectoryPerformance(snapshot: TrajectorySnapshot, records: readonly TrajectoryRenderRecord[]): TrajectoryPerformanceSummary {
  const messages = new Map(snapshot.messages.map(message => [message.id, message]))
  const indexes = new Map(records.filter(record => record.cell.kind === 'message')
    .map(record => [record.cell.sourceMessage?.id, record.cell.index]))
  const seen = new Set<string>()
  const requests: TrajectoryPerformanceRequest[] = []
  for (const contribution of snapshot.contributions) {
    if (contribution.kind !== 'request-header' || seen.has(contribution.requestId)) continue
    seen.add(contribution.requestId)
    const metrics = messages.get(contribution.requestId)?.assistantMetrics
    requests.push({ id: contribution.requestId, requestSeq: contribution.requestSeq,
      recordIndex: indexes.get(contribution.requestId), timing: readAssistantTiming(metrics), outputTokens: metrics?.outputTokens ?? null })
  }
  const latencies = requests.flatMap(request => request.timing.ttftMs === null ? [] : [request.timing.ttftMs]).sort((a, b) => a - b)
  const rated = requests.filter(request => request.timing.tokensPerSecond !== null)
  const seconds = rated.reduce((sum, request) => sum + request.timing.generationMs! / 1000, 0)
  const tokens = rated.reduce((sum, request) => sum + request.outputTokens!, 0)
  const percentile = (fraction: number) => latencies.length ? latencies[Math.ceil(latencies.length * fraction) - 1]! : null
  return { requests, ttftCount: latencies.length, rateCount: rated.length,
    legacyCount: requests.filter(request => request.timing.unavailableReason === 'legacy').length,
    p50: percentile(.5), p95: percentile(.95), averageRate: seconds > 0 ? tokens / seconds : null }
}

export interface TrajectoryPerformanceBucket {
  request: TrajectoryPerformanceRequest
  startSeq: number
  endSeq: number
  value: number | null
  minimum: number | null
  maximum: number | null
}

/** Bound SVG work without hiding gaps or the slowest/longest request. */
export function bucketTrajectoryPerformance(requests: readonly TrajectoryPerformanceRequest[], metric: 'rate' | 'ttft', maximumBuckets = 200): readonly TrajectoryPerformanceBucket[] {
  if (!requests.length || maximumBuckets < 1) return []
  const count = Math.min(requests.length, Math.floor(maximumBuckets))
  const value = (request: TrajectoryPerformanceRequest) => metric === 'rate' ? request.timing.tokensPerSecond : request.timing.ttftMs
  return Array.from({ length: count }, (_, index) => {
    const entries = requests.slice(Math.floor(index * requests.length / count), Math.floor((index + 1) * requests.length / count))
    const missing = entries.find(request => value(request) === null)
    const valid = entries.filter(request => value(request) !== null)
    const representative = missing ?? valid.reduce((selected, request) => (
      metric === 'rate' ? value(request)! < value(selected)! : value(request)! > value(selected)!
    ) ? request : selected, valid[0]!)
    return { request: representative, startSeq: entries[0]!.requestSeq, endSeq: entries.at(-1)!.requestSeq,
      value: missing ? null : value(representative),
      minimum: valid.length ? Math.min(...valid.map(request => value(request)!)) : null,
      maximum: valid.length ? Math.max(...valid.map(request => value(request)!)) : null }
  })
}
