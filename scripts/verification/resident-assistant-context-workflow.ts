import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// The pre-0.6.3 fixture remains a historical baseline, not a second current policy.
await verificationWorkflow('resident-assistant-context', async run => {
  const scenes: string[] = []
  for (const [script, name] of [['resident-context-063-workflow', 'context'], ['resident-context-063-recovery-workflow', 'recovery']]) {
    const output = join(run.directory, name!)
    const child = Bun.spawn([process.execPath, `scripts/verification/${script}.ts`, '--output-dir', output], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 300000)
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(timer); writeFileSync(join(run.directory, `${name}.log`), out + err)
    assert.equal(code, 0, (out + err).slice(-5000))
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.exitCode, 0); scenes.push(...manifest.sceneIds)
  }
  run.complete(scenes, ['Real model behavior uses resident-context-063-live-workflow', 'Real Work migration', 'Signed installation'])
})
