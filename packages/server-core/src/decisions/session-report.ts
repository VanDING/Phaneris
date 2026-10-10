import type { RuntimeEvent } from '@phaneris/shared/durable-runtime'
import { DECISION_LAYER_FEATURES } from '@phaneris/shared/decisions/settings'
import type { DecisionRecord } from '@phaneris/shared/decisions'
import type { DecisionObservation, SessionDecisionItem, SessionDecisionQuery, SessionDecisionReport, SessionDecisionTotals } from '@phaneris/shared/decisions/session'
import type { RuntimeUsageRow } from '../durable-runtime/index'
import { createHash } from 'node:crypto'

const emptyTotals = (): SessionDecisionTotals => ({ points: 0, requests: 0, legacyCalls: 0, changed: 0, fallback: 0,
  unconfirmed: 0, failures: 0, cancelled: 0, knownCostUsd: 0, knownCostRequests: 0, unknownCostRequests: 0, inputTokens: 0, outputTokens: 0 })

export function buildSessionDecisionReport(input: {
  sessionId: string; workspaceId: string; enabled: boolean; completeSince: number; activeSince?: number; sessionCreatedAt: number;
  events: RuntimeEvent[]; usage: RuntimeUsageRow[]; legacy: DecisionRecord[]; query?: SessionDecisionQuery;
}): SessionDecisionReport {
  const { sessionId, workspaceId, query = {} } = input
  if (query.feature && !DECISION_LAYER_FEATURES.includes(query.feature)) throw new Error('Invalid decision feature')
  if (query.status && !['changed', 'fallback', 'unconfirmed', 'failed', 'cancelled'].includes(query.status)) throw new Error('Invalid decision status')
  if (query.turnId !== undefined && (typeof query.turnId !== 'string' || query.turnId.length > 256)) throw new Error('Invalid decision turn')
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)) throw new Error('Invalid decision page size')
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 100)) throw new Error('Invalid decision cursor')
  const points = new Map<string, SessionDecisionItem>()
  let revision = 0
  for (const event of input.events) {
    revision = Math.max(revision, event.seq ?? 0)
    const observation = event.payload as DecisionObservation
    if (observation.sessionId !== sessionId || !DECISION_LAYER_FEATURES.includes(observation.feature)) continue
    let item = points.get(observation.decisionPointId)
    if (!item) {
      item = { id: observation.decisionPointId, feature: observation.feature, startedAt: observation.t,
        updatedAt: observation.t, source: observation.source, attempts: [], observations: [] }
      points.set(item.id, item)
    }
    item.updatedAt = Math.max(item.updatedAt, observation.t)
    item.source ??= observation.source
    if (observation.kind === 'attempt_started' && observation.attemptId && !item.attempts.some(attempt => attempt.id === observation.attemptId)) {
      item.attempts.push({ id: observation.attemptId, provider: observation.provider, model: observation.model, sent: false, status: 'pending' })
    } else if (observation.kind === 'sent') {
      const attempt = item.attempts.find(attempt => attempt.id === observation.attemptId)
      if (attempt) attempt.sent = true
    } else if (observation.kind === 'answered') {
      const attempt = item.attempts.find(attempt => attempt.id === observation.attemptId)
      if (attempt) {
        attempt.record = observation.record
        attempt.accountingOperationId = observation.record.accountingOperationId
        const error = observation.record.error?.kind
        attempt.status = observation.record.ok ? 'succeeded' : error === 'cancelled' ? 'cancelled' : error === 'timeout' ? 'timeout' : 'failed'
      }
    } else if (observation.kind === 'unavailable') item.unavailableReason = observation.reason
    else if (observation.kind === 'recommended') item.recommendation = observation.outcome
    else if (observation.kind === 'applied') item.application = observation.application
    else if (observation.kind === 'observed') item.observations.push(observation.observation)
  }
  const tags: Record<string, typeof DECISION_LAYER_FEATURES[number]> = {
    decide_tool: 'decideTool', task_verdict: 'taskVerdicts', semantic_labels: 'semanticLabels', turn_outcome: 'turnOutcome',
    guarded_mode: 'guardedMode', risk_badges: 'riskBadges', automation_condition: 'automationConditions', task_repairs: 'taskRepairs',
    smart_titles: 'smartTitles', adaptive_thinking: 'adaptiveThinking', mid_turn_messages: 'midTurnMessages', large_results: 'largeResults', suggestions: 'suggestions',
  }
  for (const record of input.legacy) {
    const feature = tags[record.feature]
    if (!feature || record.sessionId !== sessionId || record.decisionPointId) continue
    const legacyId = record.id ?? createHash('sha256').update(JSON.stringify(record)).digest('hex')
    const id = `legacy:${legacyId}`
    if (points.has(id)) continue
    const time = Date.parse(record.t)
    if (!Number.isFinite(time)) continue
    points.set(id, { id, feature, legacy: true, startedAt: time, updatedAt: time, attempts: [{ id: legacyId,
      provider: record.provider, model: record.model, sent: false, status: record.ok ? 'succeeded' : record.error?.kind === 'cancelled' ? 'cancelled' : 'failed', record }], observations: [] })
  }
  const usage = input.usage.filter(row => (row.payload as { kind?: string } | undefined)?.kind === 'decision')
  for (const item of points.values()) for (const attempt of item.attempts) {
    if (attempt.status === 'pending' && item.updatedAt < (input.activeSince ?? 0)) attempt.status = 'unknown'
  }
  const usageByAttempt = new Map(usage.map(row => [(row.payload as { attemptId?: string }).attemptId, row]))
  for (const item of points.values()) for (const attempt of item.attempts) {
    const row = usageByAttempt.get(attempt.id)
    if (!row) continue
    attempt.inputTokens = row.inputTokens
    attempt.outputTokens = row.outputTokens
    attempt.costUsd = row.costUsd
    attempt.accountingOperationId = (row.payload as { accountingOperationId?: string }).accountingOperationId
  }
  const items = [...points.values()].filter(item => {
    if (query.feature && item.feature !== query.feature) return false
    if (query.turnId && item.source?.turnId !== query.turnId) return false
    if (query.status === 'changed') return item.application?.status === 'applied' && item.application.changed
    if (query.status === 'fallback') return item.application?.status === 'fallback'
    if (query.status === 'unconfirmed') return !item.application || item.application.status === 'unknown'
    if (query.status === 'failed') return item.attempts.some(attempt => attempt.status === 'failed' || attempt.status === 'timeout')
    if (query.status === 'cancelled') return item.attempts.some(attempt => attempt.status === 'cancelled')
    return true
  }).sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
  const filtered = !!query.status || !!query.turnId
  const selectedIds = new Set(items.filter(item => !item.legacy).map(item => item.id))
  const selectedUsage = usage.filter(row => {
    const payload = row.payload as { feature?: string; decisionPointId?: string }
    if (query.feature && payload.feature !== query.feature) return false
    return !filtered || (!!payload.decisionPointId && selectedIds.has(payload.decisionPointId))
  })
  const summarize = (selection: SessionDecisionItem[], rows: RuntimeUsageRow[]): SessionDecisionTotals => {
    const total = emptyTotals()
    for (const item of selection) {
      if (item.legacy) total.legacyCalls += item.attempts.length
      else total.points++
      total.requests += item.attempts.filter(attempt => attempt.sent).length
      if (item.application?.status === 'applied' && item.application.changed) total.changed++
      if (item.application?.status === 'fallback') total.fallback++
      if (!item.application || item.application.status === 'unknown') total.unconfirmed++
      total.failures += item.attempts.filter(attempt => attempt.status === 'failed' || attempt.status === 'timeout').length
      total.cancelled += item.attempts.filter(attempt => attempt.status === 'cancelled').length
    }
    for (const row of new Map(rows.map(row => [row.usageId, row])).values()) {
      if (typeof row.costUsd === 'number' && Number.isFinite(row.costUsd) && row.costUsd >= 0) { total.knownCostUsd += row.costUsd; total.knownCostRequests++ }
      else total.unknownCostRequests++
      total.inputTokens += row.inputTokens ?? 0
      total.outputTokens += row.outputTokens ?? 0
    }
    // In-flight or interrupted requests can have no ledger completion yet.
    const accountedAttempts = new Set(rows.map(row => (row.payload as { attemptId?: string }).attemptId))
    for (const item of selection) if (!item.legacy) {
      total.unknownCostRequests += item.attempts.filter(attempt => attempt.sent && !accountedAttempts.has(attempt.id)).length
    }
    return total
  }
  let offset = 0
  if (query.cursor) {
    const match = /^(\d+):(\d+)$/.exec(query.cursor)
    if (!match || Number(match[1]) !== revision) throw new Error('Decision snapshot changed; reload the first page')
    offset = Number(match[2])
    if (!Number.isSafeInteger(offset) || offset > items.length) throw new Error('Invalid decision cursor')
  }
  const limit = query.limit ?? 50
  const features = DECISION_LAYER_FEATURES.map(feature => ({ feature, totals: summarize(items.filter(item => item.feature === feature),
    selectedUsage.filter(row => (row.payload as { feature?: string }).feature === feature)) }))
    .filter(entry => entry.totals.points || entry.totals.legacyCalls || entry.totals.inputTokens || entry.totals.unknownCostRequests || entry.totals.knownCostUsd)
  const recordedFrom = input.events[0]?.createdAt
  return { schemaVersion: 1, sessionId, workspaceId, revision, enabled: input.enabled,
    coverage: input.sessionCreatedAt < input.completeSince || [...points.values()].some(item => item.legacy)
      || usage.some(row => !(row.payload as { decisionPointId?: string }).decisionPointId) ? 'partial' : 'recorded',
    recordedFrom, totals: summarize(items, selectedUsage), features, items: items.slice(offset, offset + limit),
    turnIds: [...new Set([...points.values()].flatMap(item => item.source?.turnId ? [item.source.turnId] : []))],
    ...(offset + limit < items.length ? { nextCursor: `${revision}:${offset + limit}` } : {}) }
}
