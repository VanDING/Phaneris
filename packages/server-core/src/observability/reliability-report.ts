import { createHash } from 'node:crypto'
import type { RuntimeEvent, RuntimeReliabilityReport, ReliabilityObservation } from '@phaneris/shared/durable-runtime'
import { canonicalJson, type DurableRuntime, type RuntimeUsageRow } from '../durable-runtime/index'

/** Query-side observation has no execution callback, dispatcher or intervention capability. */
export function safelyBuildReliabilityReport(read: () => RuntimeReliabilityReport): ReliabilityObservation {
  try { return read() } catch { return { state: 'unavailable' } }
}
export function readSessionReliabilityReport(runtime: DurableRuntime, workspaceRoot: string, sessionId: string, now?: number): RuntimeReliabilityReport {
  const events: RuntimeEvent[] = []
  let afterSeq = 0
  for (;;) {
    const batch = runtime.queries.events(workspaceRoot, { sessionId, afterSeq, limit: 10_000 })
    if (!batch.length) break
    const nextSeq = batch.at(-1)?.seq
    if (nextSeq === undefined || nextSeq <= afterSeq) throw new Error('Runtime facts did not advance')
    events.push(...batch); afterSeq = nextSeq
  }
  return buildReliabilityReport({ sessionId, events, usage: runtime.queries.usage(workspaceRoot, { sessionId }), now })
}
export function buildReliabilityReport(input: { sessionId: string; events: RuntimeEvent[]; usage: RuntimeUsageRow[]; now?: number }): RuntimeReliabilityReport {
  const events = [...new Map(input.events.filter(event => event.sessionId === input.sessionId && !event.partial).map(event => [event.eventId, event])).values()]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.eventId.localeCompare(b.eventId))
  const report: RuntimeReliabilityReport = { schemaVersion: 1, state: 'available', sessionId: input.sessionId, scope: 'retained-session-runtime-facts', asOf: input.now ?? Date.now(), lastSeq: events.at(-1)?.seq ?? 0,
    terminal: {}, unsettled: { count: 0, toolCount: 0, modelCount: 0, oldestAgeMs: null, operationIds: [] }, knownCostUsd: null, unknownCostRequests: 0, userAcceptance: 'unknown', taskBudgets: [],
    observations: { pollingCandidates: 0, sdkRetries: 0, compactions: 0, recoveries: 0 }, signals: [] }
  const pending = new Map<string, RuntimeEvent>(), budgets = new Map<string, RuntimeReliabilityReport['taskBudgets'][number]>()
  const modelRequests = new Map<string, string | undefined>()
  // RuntimeEvent.operationId identifies the parent run. Effect identities live
  // in the payload (or in deterministic event IDs for older retained facts).
  const effectId = (event: RuntimeEvent): string | undefined => {
    const payload = event.payload as Record<string, unknown> | null
    if (typeof payload?.operationId === 'string') return payload.operationId
    for (const suffix of [':dispatch', ':outcome', ':reconciled-outcome', ':reconciliation']) {
      if (event.eventId.endsWith(suffix)) return event.eventId.slice(0, -suffix.length)
    }
    return undefined
  }
  const repeated = new Map<string, { toolName: string; events: RuntimeEvent[] }>()
  const errors = new Map<string, { toolName: string; events: RuntimeEvent[] }>()
  const add = (map: typeof repeated, key: string, toolName: string, event: RuntimeEvent) => {
    const group = map.get(key) ?? { toolName, events: [] }; group.events.push(event); map.set(key, group)
  }
  for (const event of events) {
    const p = event.payload as Record<string, unknown> | null
    if (!p || typeof p !== 'object') continue
    if (event.type === 'operation_terminal') {
      const reason = typeof p.reason === 'string' ? p.reason : 'unknown'; report.terminal[reason] = (report.terminal[reason] ?? 0) + 1
    } else if (event.type === 'tool_dispatch_committed' || event.type === 'model_dispatch_committed') {
      const id = effectId(event)
      if (id) pending.set(id, event)
      if (event.type === 'model_dispatch_committed') {
        if (id) modelRequests.set(id, typeof p.runOperationId === 'string' && typeof p.providerRequestId === 'string' ? `model:${p.runOperationId}:${p.providerRequestId}` : undefined)
        continue
      }
      const name = String(p.toolName ?? 'unknown')
      // These names establish only a polling candidate, not progress or a loop.
      if (/^(read|list|get|search|wait|sleep|poll|status)(?:$|[_.-])/i.test(name)) { report.observations.pollingCandidates++; continue }
      if (typeof p.canonicalArgsHash === 'string') add(repeated, `${p.runOperationId}:${name}:${p.canonicalArgsHash}`, name, event)
    } else if (event.type === 'tool_outcome_committed' || event.type === 'model_outcome_committed') {
      const id = effectId(event)
      if (id) pending.delete(id)
      if (event.type === 'tool_outcome_committed' && p.isError === true) {
        const name = String(p.toolName ?? 'unknown')
        if (!/^(read|list|get|search|wait|sleep|poll|status)(?:$|[_.-])/i.test(name)) {
          const signature = createHash('sha256').update(canonicalJson(p.result)).digest('hex')
          add(errors, `${p.runOperationId}:${name}:${signature}`, name, event)
        }
      }
    } else if (event.type === 'tool_recovery_decided' || event.type === 'model_recovery_decided') {
      report.observations.recoveries++
      if (event.type === 'model_recovery_decided' && ['provider_not_billed', 'billed_response_unavailable', 'manual_abandon'].includes(String(p.verdict))) {
        // The recovery decision is committed on the parent run. Its event ID
        // retains the child effect identity; do not confuse an explicit decision
        // with the indeterminate observation recorded during recovery.
        const id = effectId(event)
        if (id) pending.delete(id)
      }
    }
    else if (event.type === 'sdk_observation') {
      if (typeof p.event === 'string' && /retry.*start/i.test(p.event)) report.observations.sdkRetries++
      if (typeof p.event === 'string' && /compaction.*end/i.test(p.event)) report.observations.compactions++
    } else if (event.type === 'task_fact_committed') {
      const entry = p.entry as Record<string, unknown> | undefined
      if (typeof p.taskSlug !== 'string' || typeof p.runId !== 'string' || !entry) continue
      const key = `${p.taskSlug}:${p.runId}`, budget = budgets.get(key) ?? { taskSlug: p.taskSlug, runId: p.runId, limit: null, used: null }
      if (entry.kind === 'run-started' && typeof entry.tokenBudget === 'number') budget.limit = entry.tokenBudget
      if (entry.kind === 'usage-observed' && typeof entry.tokensUsed === 'number') budget.used = Math.max(budget.used ?? 0, entry.tokensUsed)
      budgets.set(key, budget)
    }
  }
  for (const [map, kind] of [[repeated, 'repeated-action'], [errors, 'repeated-error']] as const) for (const group of map.values()) {
    if (group.events.length < 3) continue
    report.signals.push({ kind, toolName: group.toolName, count: group.events.length, operationIds: group.events.flatMap(event => effectId(event) ?? []), firstSeq: group.events[0]!.seq ?? 0, lastSeq: group.events.at(-1)!.seq ?? 0 })
  }
  report.unsettled.count = pending.size
  report.unsettled.operationIds = [...pending.keys()]
  report.unsettled.toolCount = [...pending.values()].filter(event => event.type === 'tool_dispatch_committed').length
  report.unsettled.modelCount = pending.size - report.unsettled.toolCount
  if (pending.size) report.unsettled.oldestAgeMs = Math.max(0, report.asOf - Math.min(...[...pending.values()].map(event => event.createdAt)))
  const usage = [...new Map(input.usage.filter(row => row.sessionId === input.sessionId).map(row => [row.usageId, row])).values()]
  const known = usage.filter(row => typeof row.costUsd === 'number' && Number.isFinite(row.costUsd) && row.costUsd >= 0)
  report.knownCostUsd = known.length ? known.reduce((sum, row) => sum + row.costUsd!, 0) : null
  const usageIds = new Set(usage.map(row => row.usageId))
  // A settled or explicitly abandoned request can still lack accounting.
  // Missing usage is unknown, including when recovery no longer lists it as T1.
  report.unknownCostRequests = usage.length - known.length + [...modelRequests.values()].filter(id => !id || !usageIds.has(id)).length
  report.taskBudgets = [...budgets.values()]
  return report
}
