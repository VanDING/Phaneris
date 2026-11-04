import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-temporal', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = mkdtempSync(resolve('.cache/verification/resident-temporal-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-temporal.ts', run.directory], {
    cwd: process.cwd(), env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: 'temporal-fixture-token' }, stdout: 'pipe', stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill(), 90000)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timeout)
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-8000))
  const evidence = JSON.parse(readFileSync(join(run.directory, 'temporal-evidence.json'), 'utf8')) as { scenes: string[] }
  copyFileSync(join(config, 'alpha/memory/memory.db'), join(run.directory, 'memory.db'))
  copyFileSync(join(config, 'alpha/assistant/context.db'), join(run.directory, 'context.db'))
  run.complete(evidence.scenes, ['Semantic conflict and supersession inference', 'Paid-model quality', 'Remote hosting and multi-Host ownership'])
  console.log(JSON.stringify({ passed: evidence.scenes.length, output: run.directory }))
})
