/** M0 failure matrix predates implementation. Real SQLite + worker lifecycle;
 * compare a fixed isolated database, never the user's runtime database. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { createDurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('runtime-startup', async evidence => {
  const workspace = join(evidence.directory, 'workspace')
  const seed = createDurableRuntime()
  seed.commands.acceptRun({ workspaceRootPath: workspace, sessionId: 'retained', operationId: 'retained-run', turnId: 'retained-turn',
    userMessageId: 'retained-input', userMessage: 'keep this fact' })
  const pending = await seed.effects.prepareTool(workspace, { sessionId: 'retained', runOperationId: 'retained-run',
    providerToolCallId: 'unknown-call', toolName: 'Write', args: { path: 'unknown.txt' } })
  seed.commands.completeRun(workspace, 'retained-run', 'interrupted')
  const file = join(workspace, 'runtime/runtime.db')
  const sql = new Database(file)
  sql.exec('CREATE TABLE startup_fixture (id INTEGER PRIMARY KEY, payload BLOB); BEGIN')
  const insert = sql.prepare('INSERT INTO startup_fixture(payload) VALUES (randomblob(32768))')
  for (let i = 0; i < 2048; i++) insert.run()
  sql.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)'); sql.close()
  const syncStart = performance.now()
  assert(seed.admin.checkDatabaseIntegrity(workspace).ok)
  const synchronousMs = performance.now() - syncStart
  const maintenanceStart = performance.now()
  seed.admin.backupDatabase(workspace, join(evidence.directory, 'synchronous-backup.db'))
  seed.admin.maintainDatabase(workspace, { projectionRetentionMs: 30 * 24 * 60 * 60 * 1000 })
  const synchronousMaintenanceMs = performance.now() - maintenanceStart
  await seed.close()
  const scenes: string[] = [], timings: unknown[] = []
  for (const state of ['first-reopen', 'warm-reopen']) {
    const runtime = createDurableRuntime(), notices: string[] = []
    let ticks = 0
    const pulse = setInterval(() => { ticks++ }, 5)
    const started = performance.now()
    try {
      await runtime.admin.start([workspace], (_root, error) => notices.push(String(error)))
      const readyMs = performance.now() - started
      assert.equal(notices.length, 0)
      assert(ticks > 0, 'Startup verification must yield the event loop')
      assert(!existsSync(join(workspace, 'runtime/backups')), 'Backup must not gate workspace readiness')
      assert(runtime.queries.events(workspace, { sessionId: 'retained' }).some(e => e.type === 'user_message_committed'))
      assert.equal(runtime.queries.unsettledTools(workspace).length, 1)
      await assert.rejects(runtime.effects.prepareTool(workspace, { sessionId: 'retained', runOperationId: 'retained-run',
        providerToolCallId: 'repeat', toolName: 'Write', args: { path: 'unknown.txt' } }), /unconfirmed outcome/)
      timings.push({ state, readyMs, ticks })
      scenes.push(`${state}:full-integrity-yields-and-retains-facts-and-replay-protection`)
    } finally { clearInterval(pulse); await runtime.close() }
  }
  const runtime = createDurableRuntime()
  await runtime.admin.start([workspace], (_root, error) => { throw error })
  let backupTicks = 0
  const pulse = setInterval(() => { backupTicks++ }, 5)
  try {
    await runtime.admin.maintainWorkspace(workspace)
    assert(backupTicks > 0, 'Backup/VACUUM must yield the event loop')
    const backup = join(workspace, 'runtime/backups', `runtime-${new Date().toISOString().slice(0, 10)}.db`)
    assert(existsSync(backup))
    scenes.push('background-maintenance-publishes-real-backup-with-responsive-main-thread')
  } finally { clearInterval(pulse); await runtime.close() }
  const broken = join(evidence.directory, 'broken')
  mkdirSync(join(broken, 'runtime'), { recursive: true })
  const badFile = join(broken, 'runtime/runtime.db'), badBytes = Buffer.from('not a sqlite database')
  writeFileSync(badFile, badBytes)
  const recovery = createDurableRuntime(), notices: string[] = []
  try {
    await recovery.admin.start([broken, workspace], (_root, error) => notices.push(String(error)))
    assert(notices.length > 0)
    assert(readFileSync(badFile).equals(badBytes))
    assert(recovery.queries.storageStatus(broken).recovery)
    assert.equal(recovery.queries.storageStatus(workspace).recovery, undefined)
    scenes.push('corrupt-database-is-preserved-and-isolated-before-startup-completes')
  } finally { await recovery.close() }
  const closing = createDurableRuntime()
  await closing.admin.start([workspace], () => {})
  const maintenance = closing.admin.maintainWorkspace(workspace)
  const outcome = maintenance.catch(error => String(error))
  await closing.close(); await outcome
  assert.throws(() => closing.queries.events(workspace), /closed/)
  scenes.push('shutdown-cancels-and-drains-worker-before-closing-authority')
  evidence.json('startup.json', { synchronousMs, synchronousMaintenanceMs, synchronousReadyMs: synchronousMs + synchronousMaintenanceMs,
    timings, backupTicks, scenes, bytes: readFileSync(file).length,
    scope: 'same synthetic 64 MiB database; first-reopen means first process reopen, not an OS cold-cache measurement' })
  evidence.complete(scenes, ['User database performance', 'OS cold-cache measurements', 'Signed installer'])
  console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory, synchronousMs, timings }))
})
