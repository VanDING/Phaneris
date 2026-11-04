import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-extraction', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const config = mkdtempSync(join(cache, 'resident-extraction-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-extraction.ts', run.directory], {
    cwd: process.cwd(), env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: 'extraction-fixture-token' }, stdout: 'pipe', stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill(), 120000)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timeout)
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-8000))
  const evidence = JSON.parse(readFileSync(join(run.directory, 'extraction-evidence.json'), 'utf8')) as { scenes: string[] }
  for (const file of ['memory/memory.db', 'assistant/context.db']) copyFileSync(join(config, 'alpha', file), join(run.directory, file.split('/').at(-1)!))
  run.complete(evidence.scenes, ['Paid-model extraction quality and semantic conflict resolution', 'Attachment parsing', 'Remote hosting and multi-Host ownership'])
  console.log(JSON.stringify({ passed: evidence.scenes.length, output: run.directory }))
})
