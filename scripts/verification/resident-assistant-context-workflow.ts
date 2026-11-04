import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-context', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const config = mkdtempSync(join(cache, 'resident-context-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-context.ts', run.directory], {
    cwd: process.cwd(), env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: 'resident-context-fixture' }, stdout: 'pipe', stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill(), 180000)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timeout)
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-8000))
  const result = JSON.parse(readFileSync(join(run.directory, 'context-evidence.json'), 'utf8')) as { scenes: string[] }
  for (const [source, name] of [['assistant/context.db', 'context.db'], ['assistant/delegations.db', 'delegations.db'], ['memory/memory.db', 'memory.db']]) copyFileSync(join(config, 'alpha', source!), join(run.directory, name!))
  run.complete(result.scenes, ['Paid model quality', 'Remote deployment, multi-Host ownership, physical-client interaction (separate UI workflow)'])
  console.log(JSON.stringify({ passed: result.scenes.length, output: run.directory }))
})
