import { expect, test } from 'bun:test'
import type { RuntimeEvent } from '@phaneris/shared/durable-runtime'
import type { RuntimeUsageRow } from './store.js'
import { auditModelUsage } from './model-usage-audit.js'

const usage = { input: 10, output: 5, cacheRead: 100, cacheWrite: 20, reasoning: 3,
  totalTokens: 135, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } }
const row: RuntimeUsageRow = {
  usageId: 'model:run:1', operationId: 'run', sessionId: 'session', provider: 'test', model: 'test',
  inputTokens: 10, outputTokens: 5, costUsd: 10, payload: { usage }, createdAt: 1,
}
const event = { type: 'model_outcome_committed', payload: {
  runOperationId: 'run', providerRequestId: '1', sessionId: 'session', provider: 'test', model: 'test',
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 10, payload: { usage } },
} } as RuntimeEvent

test('native usage parity preserves cache and reasoning breakdown without summing subsets twice', () => {
  expect(auditModelUsage([event], [row])).toMatchObject({ expectedRows: 1, actualRows: 1, issueCount: 0 })
  const changed = { ...row, payload: { usage: { ...usage, reasoning: 0 } } }
  expect(auditModelUsage([event], [changed]).issues[0]?.kind).toBe('mismatch')
  const changedCache = { ...row, payload: { usage: { ...usage, cacheRead: 0 } } }
  expect(auditModelUsage([event], [changedCache]).issues[0]?.kind).toBe('mismatch')
})

test('detects missing, duplicate and orphan model rows and excludes tool usage', () => {
  expect(auditModelUsage([event], []).issues[0]?.kind).toBe('missing')
  expect(auditModelUsage([event], [row, row]).issues[0]?.kind).toBe('duplicate')
  expect(auditModelUsage([], [row]).issues[0]?.kind).toBe('unexpected')
  expect(auditModelUsage([], [{ ...row, usageId: 'tool:run:1' }]).issueCount).toBe(0)
})

test('a dispatched request without a provider outcome is indeterminate, not a zero-cost success', () => {
  const dispatch = { type: 'model_dispatch_committed', payload: { runOperationId: 'run', providerRequestId: '1', operationId: 'modelop' } } as RuntimeEvent
  expect(auditModelUsage([dispatch], []).issues).toEqual([{ identity: 'model:run:1', kind: 'pending_outcome' }])
  expect(auditModelUsage([dispatch, event], [row]).issueCount).toBe(0)
  const resolution = { type: 'model_recovery_decided', eventId: 'modelop:reconciliation', payload: { verdict: 'provider_not_billed' } } as RuntimeEvent
  expect(auditModelUsage([dispatch, resolution], []).issueCount).toBe(0)
  resolution.payload = { verdict: 'billed_response_unavailable' }
  expect(auditModelUsage([dispatch, resolution], []).issues[0]?.kind).toBe('reconciled_without_usage')
})
