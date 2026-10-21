import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolveScriptRuntime } from '../../packages/session-tools-core/src/runtime/resolve-script-runtime'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upgrade-0153-document-tools', async run => {
  const root = resolve(import.meta.dir, '../..')
  const runtime = resolveScriptRuntime('python3', { resourcesBasePath: join(root, 'apps/electron'), isPackaged: false })
  assert.equal(runtime.argsPrefix[0], 'run', 'this workflow requires the shipped uv script runtime')
  const args = [runtime.command, ...runtime.argsPrefix, '--no-project',
    join(root, 'scripts/verification/fixtures/document-tools.py'), root, run.directory]
  const child = Bun.spawn(args, { cwd: root, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => {
    if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/PID', String(child.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' })
    else child.kill('SIGKILL')
  }, 600_000)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'driver.log'), stdout + stderr)
    assert.equal(code, 0, (stdout + stderr).slice(-4000))
    const report = JSON.parse(readFileSync(join(run.directory, 'document-tools.json'), 'utf8')) as { scenes: string[]; commands: number }
    assert.equal(report.scenes.length, 8)
    assert(report.commands >= 20, 'all eight tools must perform real CLI tasks and read back results')
    run.json('runtime.json', { command: args, source: runtime.source })
    run.complete(report.scenes, ['Other operating systems', 'Office application visual rendering; this workflow checks CLI outputs and semantics'])
  } finally { clearTimeout(timer) }
})
