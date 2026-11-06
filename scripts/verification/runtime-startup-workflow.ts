/** Local lifecycle contract: normal opens, explicit diagnostics, no unattended snapshots. */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { createDurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('runtime-startup', async evidence => {
  const workspace = join(evidence.directory, 'workspace'), seed = createDurableRuntime()
  seed.commands.acceptRun({ workspaceRootPath: workspace, sessionId: 'retained', operationId: 'retained-run', turnId: 'retained-turn',
    userMessageId: 'retained-input', userMessage: 'keep this fact' })
  await seed.effects.prepareTool(workspace, { sessionId: 'retained', runOperationId: 'retained-run',
    providerToolCallId: 'unknown-call', toolName: 'Write', args: { path: 'unknown.txt' } })
  seed.commands.completeRun(workspace, 'retained-run', 'interrupted')
  const file = join(workspace, 'runtime/runtime.db'), sql = new Database(file)
  sql.exec('CREATE TABLE startup_fixture (id INTEGER PRIMARY KEY, payload BLOB); BEGIN')
  const insert = sql.prepare('INSERT INTO startup_fixture(payload) VALUES (randomblob(32768))')
  for (let i = 0; i < 2048; i++) insert.run()
  sql.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
  const rootPage = (sql.query("SELECT rootpage FROM sqlite_schema WHERE name='startup_fixture'").get() as { rootpage: number }).rootpage
  sql.close(); await seed.close()
  const scenes: string[] = [], timings: unknown[] = []
  for (const state of ['first-reopen', 'warm-reopen']) {
    const runtime = createDurableRuntime(), notices: string[] = [], started = performance.now()
    try {
      await runtime.admin.start([workspace], (_root, error) => notices.push(String(error)))
      timings.push({ state, readyMs: performance.now() - started })
      assert.equal(notices.length, 0)
      assert(!existsSync(join(workspace, 'runtime/backups')))
      assert(runtime.queries.events(workspace, { sessionId: 'retained' }).some(event => event.type === 'user_message_committed'))
      assert.equal(runtime.queries.unsettledTools(workspace).length, 1)
      await assert.rejects(runtime.effects.prepareTool(workspace, { sessionId: 'retained', runOperationId: 'retained-run',
        providerToolCallId: 'repeat', toolName: 'Write', args: { path: 'unknown.txt' } }), /unconfirmed outcome/)
      scenes.push(`${state}:normal-open-retains-facts-and-replay-protection`)
      await new Promise(resolve => setTimeout(resolve, 1200))
      assert(!existsSync(join(workspace, 'runtime/backups')))
    } finally { await runtime.close() }
  }
  scenes.push('idle-startup-does-not-create-snapshot-directory')
  const diagnostic = createDurableRuntime()
  try {
    assert(diagnostic.admin.checkDatabaseIntegrity(workspace).ok)
    scenes.push('complete-integrity-check-remains-explicitly-available')
  } finally { await diagnostic.close() }

  // A corrupt page in an unrelated table is only visited by the explicit full
  // scan. SQLite can still open and recover Runtime's own indexed records.
  const isolated = join(evidence.directory, 'unused-page'), isolatedFile = join(isolated, 'runtime/runtime.db')
  mkdirSync(join(isolated, 'runtime'), { recursive: true }); copyFileSync(file, isolatedFile)
  const bytes = readFileSync(isolatedFile), encoded = bytes.readUInt16BE(16), pageSize = encoded === 1 ? 65536 : encoded
  bytes[(rootPage - 1) * pageSize] = 0
  writeFileSync(isolatedFile, bytes)
  const noScan = createDurableRuntime(), noScanNotices: string[] = []
  try {
    await noScan.admin.start([isolated], (_root, error) => noScanNotices.push(String(error)))
    assert.deepEqual(noScanNotices, [])
    assert.equal(noScan.queries.storageStatus(isolated).recovery, undefined)
    scenes.push('normal-startup-does-not-scan-unrelated-pages')
    const result = await Promise.resolve().then(() => noScan.admin.checkDatabaseIntegrity(isolated))
      .then(value => value.ok, () => false)
    assert.equal(result, false)
    scenes.push('explicit-diagnostic-finds-corruption-outside-normal-open-path')
  } finally { await noScan.close() }

  const broken = join(evidence.directory, 'broken'), badFile = join(broken, 'runtime/runtime.db'), badBytes = Buffer.from('not a sqlite database')
  mkdirSync(join(broken, 'runtime'), { recursive: true }); writeFileSync(badFile, badBytes)
  const recovery = createDurableRuntime(), notices: string[] = []
  try {
    await recovery.admin.start([broken, workspace], (_root, error) => notices.push(String(error)))
    assert(notices.length > 0); assert(readFileSync(badFile).equals(badBytes))
    assert(recovery.queries.storageStatus(broken).recovery)
    assert.equal(recovery.queries.storageStatus(workspace).recovery, undefined)
    scenes.push('unopenable-database-is-preserved-and-isolated')
  } finally { await recovery.close() }
  evidence.json('startup.json', { timings, scenes, bytes: readFileSync(file).length,
    scope: 'Synthetic 64 MiB database. No live profile mutation or OS cold-cache performance claim.' })
  evidence.complete(scenes, ['User database performance', 'OS cold-cache measurements', 'Signed installer'])
  console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory, timings }))
})
