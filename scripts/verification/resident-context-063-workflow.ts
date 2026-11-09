import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-context-063', async run => {
  const config = mkdtempSync(resolve('.cache/verification/context-063-'))
  const child = Bun.spawn([process.execPath, 'scripts/verification/fixtures/resident-context-063.ts', run.directory], {
    env: { ...process.env, PHANERIS_CONFIG_DIR: config, PHANERIS_SERVER_TOKEN: 'context-063-isolated' }, stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), 240000)
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timer); writeFileSync(join(run.directory, 'host.log'), out + err)
  assert.equal(code, 0, (out + err).slice(-7000))
  const result = JSON.parse(readFileSync(join(run.directory, 'evidence.json'), 'utf8'))
  run.complete(result.scenes, ['Real model autonomous behavior (separate live workflow)', 'Real Work data migration', 'Signed installation'])
})
