/** Failure matrix: reopen during exit, orphaned window, ordinary reopen, duplicate launch. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('windows-reopen', async run => {
  assert.equal(process.platform, 'win32', 'This workflow exercises native Windows instance handoff')
  const root = resolve(import.meta.dir, '../..')
  const executable = process.env.PHANERIS_REOPEN_EXECUTABLE
  const main = executable ? join(dirname(executable), 'resources/app/dist/main.cjs') : join(root, 'apps/electron/dist/main.cjs')
  run.json('built-main.json', { executable, sha256: createHash('sha256').update(readFileSync(main)).digest('hex') })
  const child = Bun.spawn(['node', join(import.meta.dir, 'fixtures/windows-reopen.cjs'), JSON.stringify({ root, output: run.directory, executable })], {
    cwd: root, stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), 300_000)
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, 'native.log'), out + err)
    assert.equal(code, 0, (out + err).slice(-5000))
    const report = JSON.parse(readFileSync(join(run.directory, 'windows-reopen.json'), 'utf8')) as { checks: string[] }
    run.complete(report.checks, ['Other operating systems', 'Physical interaction with the installed user profile', 'Signed installer'])
  } finally { clearTimeout(timer) }
})
