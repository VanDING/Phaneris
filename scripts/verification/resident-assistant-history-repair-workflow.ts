import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure contract, written before the repair: an already-broken v2 catalogue
// (all sources pending while old projection rows remain) and a v1 catalogue
// must become an exact, repeatable replacement without touching suppression,
// memories, revisions or extraction checkpoints; a corrupt source must not
// starve valid sources; known Session L0 must read before history succeeds.
await verificationWorkflow('resident-assistant-history-repair', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const config = mkdtempSync(join(cache, 'resident-history-repair-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-history-repair.ts', run.directory], {
    cwd: process.cwd(), env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: 'history-repair-fixture-token' },
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-8000))
  const evidence = JSON.parse(readFileSync(join(run.directory, 'history-repair-evidence.json'), 'utf8')) as { scenes: string[] }
  run.complete(evidence.scenes, ['Live model extraction from repaired history', 'Assistant history indexing beyond the isolated Host fixture', 'Installed user data'])
  console.log(JSON.stringify({ passed: evidence.scenes.length, output: run.directory }))
})
