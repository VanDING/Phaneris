import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Fixed before changing the lease: both processes observe the same dead PID;
// after A replaces that lease, B must not rename A's live lease and also enter.
// Cover live ownership, independent workspaces, crash recovery, invalid evidence,
// release ownership/idempotency, a junction escape and transient backup inputs.
await verificationWorkflow('assistant-writer', async run => {
  const control = join(run.directory, 'control'); mkdirSync(control, { recursive: true })
  const children: Array<{ name: string; child: ReturnType<typeof Bun.spawn>; stdout: Promise<string>; stderr: Promise<string> }> = []
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = [], observations: unknown[] = []
  const state = (name: string, phase: string) => existsSync(join(control, `${name}-${phase}.json`))
  const release = (name: string, phase = 'release') => writeFileSync(join(control, `${name}-${phase}`), 'release')
  async function wait(name: string, phases: string[]): Promise<string> {
    const until = Date.now() + 20_000
    for (;;) {
      const phase = phases.find(phase => state(name, phase)); if (phase) return phase
      assert(Date.now() < until, `Writer ${name} did not reach ${phases.join('/')}`); await Bun.sleep(20)
    }
  }
  function start(name: string, root: string, stale?: number, nodeEntry?: string) {
    const child = Bun.spawn([nodeEntry ? 'node' : process.execPath, nodeEntry ?? join(import.meta.dir, 'fixtures/assistant-writer-process.ts'), root, control, name, String(stale ?? '')], { stdout: 'pipe', stderr: 'pipe' })
    children.push({ name, child, stdout: new Response(child.stdout).text(), stderr: new Response(child.stderr).text() })
    return child
  }
  async function deadPid() {
    const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' }); await child.exited
    assert.throws(() => process.kill(child.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH'); return child.pid
  }
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    await scene('stale-owner-interleaving-never-admits-two-writers', async () => {
      const root = join(run.directory, 'race'), pid = await deadPid(); mkdirSync(join(root, 'assistant'), { recursive: true })
      writeFileSync(join(root, 'assistant/.writer.lock'), JSON.stringify({ version: 1, pid, nonce: 'old-dead-owner' }))
      const a = start('race-a', root, pid); assert.equal(await wait('race-a', ['stale-checked', 'rejected']), 'stale-checked')
      const b = start('race-b', root, pid), bPhase = await wait('race-b', ['stale-checked', 'rejected'])
      release('race-a', 'continue'); assert.equal(await wait('race-a', ['acquired', 'rejected']), 'acquired')
      if (bPhase === 'stale-checked') release('race-b', 'continue')
      const second = await wait('race-b', ['acquired', 'rejected'])
      observations.push({ scene: 'race', a: a.pid, b: b.pid, second, owner: JSON.parse(readFileSync(join(root, 'assistant/.writer.lock'), 'utf8')) })
      try { assert.equal(second, 'rejected', 'A remained alive while B reclaimed its new lease') }
      finally { release('race-a'); release('race-b'); await Promise.all([a.exited, b.exited]) }
    })
    await scene('live-owner-is-retained-byte-for-byte', async () => {
      const root = join(run.directory, 'live'), a = start('live-a', root); assert.equal(await wait('live-a', ['acquired', 'rejected']), 'acquired')
      const file = join(root, 'assistant/.writer.lock'), original = readFileSync(file)
      const b = start('live-b', root); assert.equal(await wait('live-b', ['acquired', 'rejected']), 'rejected'); await b.exited
      assert.deepEqual(readFileSync(file), original); release('live-a'); assert.equal(await a.exited, 0)
      assert(state('live-a', 'released')); assert(!existsSync(file))
    })
    await scene('independent-workspaces-have-independent-writers', async () => {
      const a = start('independent-a', join(run.directory, 'independent-a')), b = start('independent-b', join(run.directory, 'independent-b'))
      assert.equal(await wait('independent-a', ['acquired', 'rejected']), 'acquired'); assert.equal(await wait('independent-b', ['acquired', 'rejected']), 'acquired')
      release('independent-a'); release('independent-b'); assert.deepEqual(await Promise.all([a.exited, b.exited]), [0, 0])
    })
    await scene('process-death-releases-lock-and-retains-stale-evidence', async () => {
      const root = join(run.directory, 'crash'), a = start('crash-a', root); assert.equal(await wait('crash-a', ['acquired', 'rejected']), 'acquired')
      const original = readFileSync(join(root, 'assistant/.writer.lock')); a.kill('SIGKILL'); await a.exited
      const b = start('crash-b', root); assert.equal(await wait('crash-b', ['acquired', 'rejected']), 'acquired')
      const stale = readdirSync(join(root, 'assistant')).filter(file => file.startsWith('.writer-stale-'))
      assert.equal(stale.length, 1); assert.deepEqual(readFileSync(join(root, 'assistant', stale[0]!)), original)
      release('crash-b'); assert.equal(await b.exited, 0)
    })
    await scene('invalid-evidence-is-retained-without-leaking-the-os-lock', async () => {
      const root = join(run.directory, 'invalid'); mkdirSync(join(root, 'assistant'), { recursive: true })
      const file = join(root, 'assistant/.writer.lock'), bytes = 'INVALID_LEASE_RETAIN_ME'; writeFileSync(file, bytes)
      const a = start('invalid-a', root); assert.equal(await wait('invalid-a', ['acquired', 'rejected']), 'rejected'); await a.exited; assert.equal(readFileSync(file, 'utf8'), bytes)
      writeFileSync(file, JSON.stringify({ version: 1, pid: await deadPid(), nonce: 'repaired-fixture-only' }))
      const b = start('invalid-b', root); assert.equal(await wait('invalid-b', ['acquired', 'rejected']), 'acquired'); release('invalid-b'); assert.equal(await b.exited, 0)
    })
    for (const [name, override] of Object.entries({ 'object-nonce': { nonce: {} }, 'future-version': { version: 2 }, 'zero-pid': { pid: 0 }, 'empty-nonce': { nonce: '' } })) {
      await scene(`invalid-${name}-retains-ownership-evidence`, async () => {
        const root = join(run.directory, name); mkdirSync(join(root, 'assistant'), { recursive: true })
        const file = join(root, 'assistant/.writer.lock'), bytes = JSON.stringify({ version: 1, pid: await deadPid(), nonce: 'valid-fixture', ...override })
        writeFileSync(file, bytes)
        const child = start(name, root)
        try { assert.equal(await wait(name, ['acquired', 'rejected']), 'rejected'); assert.equal(readFileSync(file, 'utf8'), bytes) }
        finally { release(name); await child.exited }
      })
    }
    await scene('bun-and-node-writers-share-the-same-os-lease', async () => {
      const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/assistant-writer-process.ts')], target: 'node', format: 'cjs', outdir: run.directory, naming: 'assistant-writer-node.cjs' })
      assert(build.success, build.logs.map(String).join('\n'))
      const nodeEntry = join(run.directory, 'assistant-writer-node.cjs'), root = join(run.directory, 'mixed-runtime')
      const a = start('mixed-bun-a', root); assert.equal(await wait('mixed-bun-a', ['acquired', 'rejected']), 'acquired')
      const b = start('mixed-node-b', root, undefined, nodeEntry); assert.equal(await wait('mixed-node-b', ['acquired', 'rejected']), 'rejected'); await b.exited
      release('mixed-bun-a'); assert.equal(await a.exited, 0)
      const c = start('mixed-node-c', root, undefined, nodeEntry); assert.equal(await wait('mixed-node-c', ['acquired', 'rejected']), 'acquired')
      const d = start('mixed-bun-d', root); assert.equal(await wait('mixed-bun-d', ['acquired', 'rejected']), 'rejected'); await d.exited
      release('mixed-node-c'); assert.equal(await c.exited, 0)
    })
    await scene('release-never-removes-a-different-owner', async () => {
      const root = join(run.directory, 'release-owner'), a = start('release-a', root); assert.equal(await wait('release-a', ['acquired', 'rejected']), 'acquired')
      const file = join(root, 'assistant/.writer.lock'), bytes = JSON.stringify({ version: 1, pid: a.pid, nonce: 'different-owner' }); writeFileSync(file, bytes)
      release('release-a'); assert.equal(await a.exited, 2); assert.equal(readFileSync(file, 'utf8'), bytes)
    })
    await scene('assistant-directory-junction-cannot-escape-the-workspace', async () => {
      const root = join(run.directory, 'junction'), external = join(run.directory, 'external'); mkdirSync(root); mkdirSync(external)
      symlinkSync(external, join(root, 'assistant'), process.platform === 'win32' ? 'junction' : 'dir')
      const child = start('junction', root); assert.equal(await wait('junction', ['acquired', 'rejected']), 'rejected'); await child.exited
      assert.deepEqual(readdirSync(external), [])
    })
    await scene('backup-excludes-live-writer-artifacts-and-keeps-recovery-records', async () => {
      const root = join(run.directory, 'backup'); mkdirSync(join(root, 'assistant'), { recursive: true }); mkdirSync(join(root, 'tasks/.publications'), { recursive: true })
      writeFileSync(join(root, 'assistant/.writer.lock'), '{}'); writeFileSync(join(root, 'assistant/.writer.sqlite'), '')
      writeFileSync(join(root, 'assistant/.writer.sqlite-journal'), 'temporary'); writeFileSync(join(root, 'tasks/.publications/writer.sqlite'), '')
      writeFileSync(join(root, 'tasks/.publications/retained.json'), '{"retain":true}')
      const { createWorkspaceBackup } = await import('../../packages/server-core/src/services/workspace-backup')
      const backup = createWorkspaceBackup(root, join(run.directory, 'backup-output'))
      assert(!backup.files.some(file => /(?:\.writer\.(?:lock|sqlite)(?:-.*)?|\.publications\/writer\.sqlite(?:-.*)?)$/.test(file.path)))
      assert(backup.files.some(file => file.path === 'tasks/.publications/retained.json'))
    })
    run.json('scenarios.json', { checks, failures, observations }); assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Real local writer subprocesses and Windows junction; native macOS/Linux and network filesystems require platform runs.'])
  } finally {
    for (const { child, name, stdout, stderr } of children) {
      if (child.exitCode === null) child.kill('SIGKILL'); await child.exited
      writeFileSync(join(run.directory, name + '.log'), await stdout + await stderr)
    }
  }
})
