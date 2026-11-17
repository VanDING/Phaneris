import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Real Windows share-mode failure: reads work, replacement/deletion does not. */
export async function holdFileAgainstReplacement(file: string, artifacts: string): Promise<() => Promise<void>> {
  assert.equal(process.platform, 'win32', 'This fault requires Windows FileShare semantics')
  assert(process.env.SystemRoot)
  const id = crypto.randomUUID(), ready = join(artifacts, `hold-${id}.ready`)
  const child = Bun.spawn([join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    "$stream = [IO.File]::Open($env:PHANERIS_HOLD_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); try { [IO.File]::WriteAllText($env:PHANERIS_HOLD_READY, 'held'); [Console]::In.ReadLine() | Out-Null } finally { $stream.Dispose() }"],
  { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PHANERIS_HOLD_FILE: file, PHANERIS_HOLD_READY: ready } })
  const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text(), until = Date.now() + 15_000
  while (!existsSync(ready) && child.exitCode === null && Date.now() < until) await Bun.sleep(20)
  if (!existsSync(ready)) {
    if (child.exitCode === null) child.kill('SIGKILL'); await child.exited
    throw new Error(`Could not hold fixture file: ${await stderr}`)
  }
  return async () => {
    child.stdin.write('release\n'); child.stdin.end()
    const code = await child.exited
    writeFileSync(join(artifacts, `hold-${id}.log`), await stdout + await stderr)
    assert.equal(code, 0)
  }
}
