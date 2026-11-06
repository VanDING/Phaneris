/** Existing recovery points are user data; normal startup must not create or prune them. */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createDurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('runtime-backup-retention', async evidence => {
  const workspace = join(evidence.directory, 'workspace'), backups = join(workspace, 'runtime/backups')
  mkdirSync(backups, { recursive: true })
  const seed = createDurableRuntime()
  seed.queries.events(workspace)
  const original = seed.admin.backupDatabase(workspace, join(evidence.directory, 'original.db'))
  await seed.close()
  for (const day of ['2000-01-01', '2000-01-02', '2000-01-03']) copyFileSync(original, join(backups, `runtime-${day}.db`))
  const today = `runtime-${new Date().toISOString().slice(0, 10)}.db`
  writeFileSync(join(backups, today), 'previous interrupted snapshot')
  writeFileSync(join(backups, today + '-journal'), 'previous interrupted journal')
  writeFileSync(join(backups, 'manual.db'), 'user recovery point')
  const inventory = () => Object.fromEntries(readdirSync(backups).sort().map(name => [name,
    createHash('sha256').update(readFileSync(join(backups, name))).digest('hex')]))
  const before = inventory(), scenes: string[] = [], errors: string[] = []
  const runtime = createDurableRuntime()
  try {
    await runtime.admin.start([workspace], (_root, error) => errors.push(String(error)))
    assert.deepEqual(inventory(), before)
    scenes.push('startup-keeps-all-existing-recovery-points')
    await new Promise(resolve => setTimeout(resolve, 1200))
    assert.deepEqual(inventory(), before)
    scenes.push('idle-launch-does-not-replace-or-prune-snapshots')
    assert.equal(readFileSync(join(backups, today), 'utf8'), 'previous interrupted snapshot')
    scenes.push('interrupted-old-snapshot-is-not-an-automatic-replacement-request')
    assert.equal(readFileSync(join(backups, 'manual.db'), 'utf8'), 'user recovery point')
    scenes.push('manual-recovery-points-remain-untouched')
    assert.throws(() => runtime.admin.backupDatabase(workspace, join(backups, today)))
    assert.deepEqual(inventory(), before)
    scenes.push('explicit-backup-still-refuses-overwrite')
    runtime.admin.backupDatabase(workspace, join(evidence.directory, 'explicit.db'))
    assert.deepEqual(inventory(), before)
    scenes.push('explicit-offline-operation-does-not-install-a-schedule')
    assert.deepEqual(errors, [])
  } finally { await runtime.close() }
  assert.deepEqual(inventory(), before)
  scenes.push('shutdown-keeps-existing-files-byte-identical')
  evidence.json('backups.json', { scenes, before, after: inventory(), errors })
  evidence.complete(scenes, ['Hard power loss during an explicit operation', 'Live profile mutation', 'Signed packaging'])
  console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
})
