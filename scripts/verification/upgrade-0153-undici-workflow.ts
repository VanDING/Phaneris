/** CO-09: direct undici, executed by the isolated Node runtime, never Bun fetch. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upgrade-0153-undici', async run => {
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/undici.cjs'), run.directory], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 30_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'node.log'), stdout + stderr)
    assert.equal(code, 0, stdout + stderr)
    const report = JSON.parse(readFileSync(join(run.directory, 'undici.json'), 'utf8')) as { checks: string[] }
    assert.equal(report.checks.length, 3)
    run.complete(report.checks, ['external TLS proxies and proxy credentials', 'macOS/Linux execution'])
  } finally { clearTimeout(timer) }
})
