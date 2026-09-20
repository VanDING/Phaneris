import type { DurableModelOutcomeRequest, RuntimeEvent } from '@phaneris/shared/durable-runtime'
import type { RuntimeUsageRow } from './store.js'

/** Persistence parity only; neither SDK session totals nor provider billing reconciliation. */
export function auditModelUsage(events: RuntimeEvent[], rows: RuntimeUsageRow[]) {
  const expected = new Map<string, DurableModelOutcomeRequest>()
  const dispatched = new Map<string, string>()
  const completed = new Set<string>()
  const reconciled = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'model_recovery_decided' && event.eventId.endsWith(':reconciliation')) {
      const verdict = (event.payload as { verdict?: string }).verdict
      if (verdict) reconciled.set(event.eventId.slice(0, -':reconciliation'.length), verdict)
    }
    if (event.type === 'model_dispatch_committed') {
      const dispatch = event.payload as { runOperationId: string; providerRequestId: string; operationId: string }
      dispatched.set(`model:${dispatch.runOperationId}:${dispatch.providerRequestId}`, dispatch.operationId)
    }
    if (event.type !== 'model_outcome_committed') continue
    const outcome = event.payload as DurableModelOutcomeRequest
    completed.add(`model:${outcome.runOperationId}:${outcome.providerRequestId}`)
    if (outcome.usage) expected.set(`model:${outcome.runOperationId}:${outcome.providerRequestId}`, outcome)
  }
  const issues: Array<{ identity: string; kind: 'missing' | 'mismatch' | 'unexpected' | 'duplicate' | 'pending_outcome' | 'reconciled_without_usage' }> = []
  for (const [identity, operationId] of dispatched) {
    if (completed.has(identity)) continue
    const verdict = reconciled.get(operationId)
    if (verdict === 'provider_not_billed') continue
    issues.push({ identity, kind: verdict ? 'reconciled_without_usage' : 'pending_outcome' })
  }
  const seen = new Set<string>()
  const nativeFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens'] as const
  const costFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const
  for (const row of rows) {
    if (!row.usageId.startsWith('model:')) continue
    if (seen.has(row.usageId)) issues.push({ identity: row.usageId, kind: 'duplicate' })
    seen.add(row.usageId)
    const outcome = expected.get(row.usageId)
    if (!outcome) {
      issues.push({ identity: row.usageId, kind: 'unexpected' })
      continue
    }
    const source = outcome.usage!
    const original = (source.payload as { usage?: Record<string, unknown> } | undefined)?.usage
    const persisted = (row.payload as { usage?: Record<string, unknown> } | undefined)?.usage
    const originalCost = original?.cost as Record<string, unknown> | undefined
    const persistedCost = persisted?.cost as Record<string, unknown> | undefined
    if (row.sessionId !== outcome.sessionId || row.operationId !== outcome.runOperationId
      || row.provider !== outcome.provider || row.model !== outcome.model
      || row.inputTokens !== source.inputTokens || row.outputTokens !== source.outputTokens
      || row.costUsd !== source.costUsd
      || nativeFields.some(key => original?.[key] !== persisted?.[key])
      || costFields.some(key => originalCost?.[key] !== persistedCost?.[key])) {
      issues.push({ identity: row.usageId, kind: 'mismatch' })
    }
  }
  for (const identity of expected.keys()) if (!seen.has(identity)) issues.push({ identity, kind: 'missing' })
  return {
    scope: 'model_outcomes_vs_usage_ledger' as const,
    expectedRows: expected.size, actualRows: seen.size, issueCount: issues.length,
    issues: issues.slice(0, 100), // bounded audit payload; issueCount retains the full count
  }
}
