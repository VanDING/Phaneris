import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure cases fixed before the shutdown change: close callbacks can arrive
// after close() drains retained clients. Both close orders must naturally exit;
// an already disconnected client still gets normal cleanup and its callback.
await verificationWorkflow('rpc-shutdown', async run => {
  const checks: string[] = [], failures: unknown[] = []
  for (const mode of ['server-first', 'client-first', 'settled-client']) {
    const evidence = join(run.directory, `${mode}.json`)
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/rpc-shutdown-process.ts'), mode, evidence], { stdout: 'pipe', stderr: 'pipe' })
    const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const code = await Promise.race([child.exited, new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 4000) })])
      if (code === null) { child.kill('SIGKILL'); await child.exited }
      const observation = existsSync(evidence) ? JSON.parse(readFileSync(evidence, 'utf8')) : null
      assert.equal(code, 0, `Child retained resources or failed after shutdown: ${JSON.stringify(observation)}`)
      checks.push(mode)
    } catch (error) { failures.push({ mode, error: String(error) }) }
    finally {
      clearTimeout(deadline)
      if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
      writeFileSync(join(run.directory, `${mode}.log`), await stdout + await stderr)
    }
  }
  run.json('scenarios.json', { checks, failures }); assert.equal(failures.length, 0, JSON.stringify(failures))
  run.complete(checks, ['Real local WebSocket children; Electron application shutdown is validated separately.'])
})
