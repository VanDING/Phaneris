import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-delegation', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const config = mkdtempSync(join(cache, 'resident-delegation-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-delegation.ts', run.directory], {
    env: { ...process.env, PHANERIS_CONFIG_DIR: config, NODE_ENV: 'test', PHANERIS_SERVER_TOKEN: 'delegation-fixture-token' },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-7000))
  // The child has stopped its Host: the closed SQLite database is a consistent artifact.
  copyFileSync(join(config, 'alpha', 'assistant', 'delegations.db'), join(run.directory, 'delegations.db'))
  const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const db = openSqliteDatabase(join(run.directory, 'delegations.db'))
  try {
    for (const row of db.prepare('SELECT body FROM work').all() as Array<{ body: string }>) {
      const receipt = JSON.parse(row.body)
      assert.equal(receipt.formatVersion, 2)
      for (const field of ['request', 'instructions', 'acceptanceCriteria', 'effectiveConfig', 'adjustments']) assert.equal(field in receipt, false)
      if (receipt.result) assert.deepEqual(Object.keys(receipt.result).sort(), ['messageId', 'sessionId'])
    }
    assert.equal((db.prepare('SELECT count(*) AS count FROM legacy_work_archive').get() as { count: number }).count, 2)
  } finally { db.close() }
  const evidence = JSON.parse(readFileSync(join(run.directory, 'delegation-result.json'), 'utf8')) as { scenes: string[] }
  run.json('delegation-evidence.json', evidence)
  run.complete(evidence.scenes, ['Paid model quality', 'Automatic recovery of uncertain effects', 'Frontend and context delivery quality (separate workflows)'])
  console.log(JSON.stringify({ passed: evidence.scenes.length, output: run.directory }))
})
