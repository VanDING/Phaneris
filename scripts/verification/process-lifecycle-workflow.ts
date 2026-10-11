/** L01–L04: real server/Pi exits plus the shared Electron lifecycle ports. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { assertNoSecret, deadline, repository, seedServer, startProcess, type RunningProcess } from './fixtures/governance-process-support'

await verificationWorkflow('process-lifecycle', async evidence => {
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-process-lifecycle-'))
  const children: RunningProcess[] = [], checks: { id: string; passed: true; elapsedMs?: number }[] = []
  try {
    for (const fault of ['unhandled', 'uncaught', 'hang-cleanup', 'throw-cleanup']) {
      const child = await startProcess(seedServer(join(fixture, fault))); children.push(child)
      const started = performance.now()
      child.process.stdin.write(`${JSON.stringify({ governanceFault: fault })}\n`)
      // First observe the synchronous admission close before waiting for cleanup.
      await new Promise(resolve => setTimeout(resolve, 200))
      await assert.rejects(fetch(child.url.replace(/^ws/, 'http') + '/api/config'))
      assert.equal(await deadline(child.exited, 13_000), 1, 'Unexpected global failure must cause bounded nonzero exit')
      const detail = child.stderr()
      assert(detail.includes(`governance-${fault}`))
      assert(detail.includes('governance-original-cause'), 'Preserve original error cause')
      if (fault === 'hang-cleanup') assert(detail.includes('deadline'))
      checks.push({ id: `L01-server-${fault}`, passed: true, elapsedMs: Math.round(performance.now() - started) })
    }
    const normal = await startProcess(seedServer(join(fixture, 'normal'))); children.push(normal)
    assert.equal(await normal.stop(), 0)
    checks.push({ id: 'L01-normal-signal-shutdown', passed: true })
    for (const scenario of ['hang', 'throw', 'normal']) {
      const child = spawn(process.execPath, [join(import.meta.dir, 'fixtures/process-lifecycle-port.ts'), scenario], { cwd: repository, stdio: 'pipe' })
      let stdout = '', stderr = ''
      child.stdout.on('data', data => { stdout += data.toString() }); child.stderr.on('data', data => { stderr += data.toString() })
      const exit = await deadline(new Promise<number | null>((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit) }), 3000)
      writeFileSync(join(evidence.directory, `electron-port-${scenario}.log`), `${stdout}\n${stderr}`)
      assert.equal(exit, scenario === 'normal' ? 0 : 1)
      const exitRecord = stdout.trim().split('\n').map(line => JSON.parse(line) as { event: string; cleanups?: number }).find(record => record.event === 'exit')
      assert.equal(exitRecord?.cleanups, 1)
      assert.equal((stdout.match(/quiesced/g) ?? []).length, 1)
      if (scenario !== 'normal') assert(stderr.includes('port-first-failure') && stderr.includes('port-original-cause'))
      if (scenario === 'hang') assert(stderr.includes('deadline'))
      checks.push({ id: `L02-electron-port-${scenario}`, passed: true })
    }
    const quiesce = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/runtime-quiesce.ts'), join(fixture, 'runtime-quiesce')], { stdout: 'pipe', stderr: 'pipe' })
    const [quiesceOut, quiesceError, quiesceExit] = await Promise.all([
      new Response(quiesce.stdout).text(), new Response(quiesce.stderr).text(), deadline(quiesce.exited),
    ])
    writeFileSync(join(evidence.directory, 'runtime-quiesce.log'), quiesceOut + quiesceError)
    assert.equal(quiesceExit, 0, quiesceError)
    const quiesceResult = JSON.parse(quiesceOut.trim()) as { id: string; passed: boolean }
    assert(quiesceResult.passed)
    checks.push({ id: quiesceResult.id, passed: true })
    const stopFixture = seedServer(join(fixture, 'bootstrap-stop'))
    const stop = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/bootstrap-stop.ts'), join(repository, 'apps/electron')], {
      env: { ...process.env, PHANERIS_CONFIG_DIR: stopFixture.config }, stdout: 'pipe', stderr: 'pipe',
    })
    const [stopOut, stopError, stopExit] = await Promise.all([
      new Response(stop.stdout).text(), new Response(stop.stderr).text(), deadline(stop.exited),
    ])
    writeFileSync(join(evidence.directory, 'bootstrap-stop.log'), stopOut + stopError)
    assert.equal(stopExit, 0, stopError)
    assert(stopOut.includes('"id":"L07-bootstrap-stop-owner","passed":true,"cleanups":1'))
    checks.push({ id: 'L07-bootstrap-stop-owner', passed: true })
    for (const fault of ['unhandled', 'uncaught']) {
      const config = seedServer(join(fixture, `pi-${fault}`))
      const pi = await startProcess({ ...config, entry: join(repository, 'packages/pi-agent-server/dist/index.js'), ready: false,
        extra: { PHANERIS_DEBUG: 'true' } }); children.push(pi)
      await new Promise(resolve => setTimeout(resolve, 500))
      pi.process.stdin.write(`${JSON.stringify({ type: 'abort', governanceFault: fault })}\n`)
      assert.equal(await deadline(pi.exited, 5000), 1)
      const error = pi.stdout().trim().split('\n').map(line => JSON.parse(line) as { type: string; message?: string; code?: string }).find(message => message.type === 'error')
      assert(error?.message?.includes(`governance-${fault}`))
      assert(['uncaught', 'unhandled_rejection'].includes(error?.code ?? ''))
      checks.push({ id: `L04-pi-${fault}`, passed: true })
    }
    assertNoSecret(children)
    evidence.complete(checks.map(check => check.id), ['native Electron UI/exit integration', 'Windows/Linux native execution', 'live provider APIs'])
  } finally {
    await Promise.allSettled(children.map(child => child.stop('SIGKILL')))
    assertNoSecret(children)
    evidence.json('process-lifecycle.json', { fixture, checks })
    children.forEach((child, index) => writeFileSync(join(evidence.directory, `process-${index}.log`), `${child.stdout()}\n${child.stderr()}`))
  }
})
