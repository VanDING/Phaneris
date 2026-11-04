import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-history', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const config = mkdtempSync(join(cache, 'resident-history-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-history.ts', run.directory], {
    cwd: process.cwd(), env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: 'history-fixture-token' }, stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-6000))
  const evidence = JSON.parse(readFileSync(join(run.directory, 'history-evidence.json'), 'utf8')) as { scenes: string[] }
  copyFileSync(join(config, 'alpha/memory/memory.db'), join(run.directory, 'memory.db'))
  run.complete(evidence.scenes, ['Automatic memory extraction and semantic ranking', 'Provider history invalidation, working sets and context segments', 'P3b event consumption and automatic delivery', 'Paid model quality, frontend and multi-Host operation'])
  console.log(JSON.stringify({ passed: evidence.scenes.length, output: run.directory }))
})
