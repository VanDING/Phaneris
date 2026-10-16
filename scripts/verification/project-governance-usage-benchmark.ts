import assert from 'node:assert/strict'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { DurableRuntimeStore, type RuntimeUsageRow } from '../../packages/server-core/src/durable-runtime/store'
import type { SqliteDatabase } from '../../packages/server-core/src/durable-runtime/sqlite-driver'

await verificationWorkflow('project-governance-usage', async run => {
  const samples = []
  for (const mode of ['memory', 'file-wal'] as const) for (const count of [0, 1000, 10000, 50000]) {
    const store = new DurableRuntimeStore(run.directory, {
      databasePath: mode === 'memory' ? ':memory:' : join(run.directory, `ledger-${count}.sqlite`),
    })
    try {
      const db = (store as unknown as { db: SqliteDatabase }).db
      const insert = db.prepare('INSERT INTO usage_ledger (usage_id,operation_id,session_id,payload_json,created_at) VALUES (?,?,?,?,?)')
      db.transaction(() => {
        for (let i = 0; i < count; i++) insert.run('seed-' + i, 'op-' + i, 'session-' + i % 100,
          JSON.stringify({ kind: 'conversation', usage: { input: 1200, output: 200, cost: { total: 0.005 } } }), i)
      })()
      let rowsDecoded = 0
      const list = store.listUsage.bind(store)
      store.listUsage = (...args) => { const rows = list(...args); rowsDecoded += rows.length; return rows }
      const runs = []
      for (let i = 0; i < 12; i++) {
        rowsDecoded = 0
        const usage: RuntimeUsageRow = { usageId: 'new-' + i, operationId: 'new-op-' + i, sessionId: 'current-session',
          inputTokens: 1200, outputTokens: 200, costUsd: 0.005, createdAt: count + i }
        const start = performance.now()
        store.commitFactsAndUsage({ events: [], usage: [usage] })
        const elapsedMs = performance.now() - start
        if (i >= 3) runs.push({ elapsedMs, rowsDecoded })
      }
      const duplicate: RuntimeUsageRow = { usageId: 'new-11', operationId: 'new-op-11', sessionId: 'current-session',
        inputTokens: 1200, outputTokens: 200, costUsd: 0.005, createdAt: count + 11 }
      store.commitFactsAndUsage({ events: [], usage: [duplicate] })
      assert.equal(list({ sessionId: 'current-session' }).length, 12)
      assert.throws(() => store.commitFactsAndUsage({ events: [], usage: [{ ...duplicate, costUsd: 0.01 }] }), /different content/)
      const ordered = runs.map(sample => sample.elapsedMs).sort((a, b) => a - b)
      samples.push({ mode, historyRows: count, medianMs: ordered[Math.floor(ordered.length / 2)], runs,
        identicalReplayCount: 12, conflictingReplayRejected: true,
        indexedQueryPlan: db.prepare('EXPLAIN QUERY PLAN SELECT * FROM usage_ledger WHERE usage_id = ?').all('new-11') })
    } finally { store.close() }
  }
  run.json('usage-benchmark.json', {
    cpu: cpus()[0]?.model, platform: process.platform, runtime: Bun.version,
    conditions: 'Production commitFactsAndUsage; seed outside timing; 3 warmups + 9 samples; listUsage instrumented only to count enumerated rows. Memory mode matches the original audit recipe; file-WAL has no measured before baseline.',
    samples,
  })
  console.log(JSON.stringify(samples.map(({ mode, historyRows, medianMs, runs }) => ({ mode, historyRows, medianMs, rowsDecoded: runs[0]?.rowsDecoded }))))
  run.complete(samples.map(sample => `${sample.mode}-${sample.historyRows}`), ['Live provider inference', 'Other hardware or operating systems'])
})
