import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-identity', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const config = mkdtempSync(join(cache, 'resident-assistant-identity-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-assistant-identity.ts', run.directory], {
    cwd: process.cwd(), env: { ...process.env, PHANERIS_CONFIG_DIR: config,
      PHANERIS_SERVER_TOKEN: 'resident-assistant-fixture-token' }, stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  writeFileSync(join(run.directory, 'host.log'), stdout + stderr)
  assert.equal(code, 0, (stdout + stderr).slice(-5000))
  const result = JSON.parse(readFileSync(join(run.directory, 'identity-result.json'), 'utf8')) as { scenes: string[]; [key: string]: unknown }
  for (const [workspace, id] of [['alpha', result.assistantId], ['beta', result.otherAssistantId]]) {
    assert.equal(typeof id, 'string')
    copyFileSync(join(config, String(workspace), 'sessions', String(id), 'session.jsonl'), join(run.directory, `${workspace}-assistant.jsonl`))
  }
  run.json('identity-evidence.json', result)
  run.complete(result.scenes, ['Live model quality', 'Native model tool invocation and frontend', 'Worker execution configuration and delegation', 'Provider context invalidation'])
  console.log(JSON.stringify({ passed: result.scenes.length, output: run.directory }))
})
