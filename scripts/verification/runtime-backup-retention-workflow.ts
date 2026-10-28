/** Declared before changes: interrupted daily files, unlimited copies, partial
 * publication, overwrite attempts, failed backup pruning and unmanaged files.
 * Exercises the public Runtime maintenance API against actual SQLite/files.
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { createDurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('runtime-backup-retention', async evidence => {
  const workspace = join(evidence.directory, 'workspace'), backups = join(workspace, 'runtime/backups')
  const day = new Date().toISOString().slice(0, 10), current = `runtime-${day}.db`
  mkdirSync(backups, { recursive: true })
  const runtime = createDurableRuntime(), scenes: string[] = [], errors: string[] = []
  try {
    runtime.queries.events(workspace)
    const original = runtime.admin.backupDatabase(workspace, join(evidence.directory, 'original.db'))
    for (const date of ['2000-01-01', '2000-01-02', '2000-01-03']) copyFileSync(original, join(backups, `runtime-${date}.db`))
    writeFileSync(join(backups, current), 'interrupted backup')
    writeFileSync(join(backups, current + '-journal'), 'interrupted journal')
    const stale = 'runtime-2000-01-01.db.00000000-0000-0000-0000-000000000000.tmp'
    writeFileSync(join(backups, stale), 'interrupted staging')
    writeFileSync(join(backups, 'manual.db'), 'user backup')
    runtime.admin.start([workspace], (_workspace, error) => errors.push(String(error)))
    assert.equal(errors.length, 0)
    const database = new Database(join(backups, current), { readonly: true })
    assert.deepEqual(database.query('PRAGMA quick_check').all(), [{ quick_check: 'ok' }])
    database.close()
    scenes.push('interrupted same-day backup is replaced by a complete SQLite snapshot')
    assert.deepEqual(readdirSync(backups).filter(name => /^runtime-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort(),
      ['runtime-2000-01-03.db', current].sort())
    scenes.push('maintenance retains today and the latest previous complete snapshot')
    assert(!existsSync(join(backups, current + '-journal')))
    assert(!existsSync(join(backups, stale)))
    scenes.push('completed backup removes owned interrupted staging and journal files')
    assert.equal(readFileSync(join(backups, 'manual.db'), 'utf8'), 'user backup')
    scenes.push('unmanaged backup files remain untouched')
    const before = readFileSync(join(backups, current))
    runtime.admin.start([workspace], (_workspace, error) => errors.push(String(error)))
    assert.equal(errors.length, 0)
    assert(readFileSync(join(backups, current)).equals(before))
    assert.throws(() => runtime.admin.backupDatabase(workspace, join(backups, current)))
    assert(readFileSync(join(backups, current)).equals(before))
    assert(!readdirSync(backups).some(name => name.endsWith('.tmp')))
    scenes.push('repeated maintenance and explicit overwrite attempts preserve the completed snapshot')

    const failedWorkspace = join(evidence.directory, 'failed-workspace'), failedBackups = join(failedWorkspace, 'runtime/backups')
    mkdirSync(join(failedBackups, current), { recursive: true })
    for (const date of ['2000-01-01', '2000-01-02', '2000-01-03']) copyFileSync(original, join(failedBackups, `runtime-${date}.db`))
    const failed = createDurableRuntime(), failedErrors: string[] = []
    try {
      failed.admin.start([failedWorkspace], (_workspace, error) => failedErrors.push(String(error)))
      assert(failedErrors.length > 0, 'An unexpected directory at the daily backup path must report an error')
      assert.equal(readdirSync(failedBackups).filter(name => name.startsWith('runtime-2000')).length, 3)
      scenes.push('failed replacement never prunes previous recovery points')
    } finally { await failed.close() }
    evidence.json('backups.json', { scenes, backups: readdirSync(backups), errors, failedErrors })
    evidence.complete(scenes, ['Hard power loss during VACUUM', 'Live profile mutation', 'Signed packaging'])
    console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
  } finally { await runtime.close() }
})
