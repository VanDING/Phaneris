#!/usr/bin/env bun
/** V01–V07, written before the artifact isolation implementation. Runs the actual CLI workflows. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('verification-output', async evidence => {
const root = resolve(import.meta.dir, '../..'), parent = join(root, '.cache/verification')
const output = evidence.directory, checks: { id: string; passed: boolean }[] = []
const workflows = ['runtime-boundary-gate-workflow.ts', 'durable-runtime-boundary-workflow.ts', 'durable-runtime-crash-workflow.ts']
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
const hashes = () => Object.fromEntries(tracked.filter(file => existsSync(join(root, file))).map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]))
const before = hashes()
async function invoke(args: string[], expected = 0) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  assert.equal(code, expected, `${args.join(' ')}\n${stdout}\n${stderr}`)
  return stdout
}
try {
  const runs: string[] = []
  for (let repeat = 0; repeat < 2; repeat++) for (const name of workflows) {
    const stdout = await invoke(['run', `scripts/verification/${name}`])
    const parsed = JSON.parse(stdout.trim().split('\n').at(-1)!)
    const dir = dirname(parsed.output)
    assert(dir.startsWith(parent))
    runs.push(dir)
    await invoke(['run', 'scripts/verification/verification-artifacts.ts', `--verify=${dir}`])
  }
  assert.equal(new Set(runs).size, 6)
  checks.push({ id: 'V01', passed: true })
  const concurrent = await Promise.all([0, 1].map(async () => {
    const stdout = await invoke(['run', 'scripts/verification/durable-runtime-boundary-workflow.ts'])
    return dirname(JSON.parse(stdout.trim().split('\n').at(-1)!).output)
  }))
  assert.notEqual(concurrent[0], concurrent[1])
  for (const dir of concurrent) await invoke(['run', 'scripts/verification/verification-artifacts.ts', `--verify=${dir}`])
  checks.push({ id: 'V02', passed: true })
  const occupied = join(output, 'occupied'); mkdirSync(occupied); writeFileSync(join(occupied, 'sentinel'), 'preserve')
  await invoke(['run', 'scripts/verification/runtime-boundary-gate-workflow.ts', `--output-dir=${occupied}`], 1)
  assert.equal(readFileSync(join(occupied, 'sentinel'), 'utf8'), 'preserve')
  checks.push({ id: 'V03', passed: true })
  const corrupt = join(output, 'corrupt'); cpSync(runs[0]!, corrupt, { recursive: true })
  const manifestPath = join(corrupt, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, passed: 0, sceneIds: [] }))
  await invoke(['run', 'scripts/verification/verification-artifacts.ts', `--verify=${corrupt}`], 1)
  checks.push({ id: 'V04', passed: true })
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const artifact = join(corrupt, manifest.artifacts[0].path)
  writeFileSync(artifact, 'tampered')
  await invoke(['run', 'scripts/verification/verification-artifacts.ts', `--verify=${corrupt}`], 1)
  rmSync(artifact)
  await invoke(['run', 'scripts/verification/verification-artifacts.ts', `--verify=${corrupt}`], 1)
  checks.push({ id: 'V05', passed: true })
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-critical-preflight-'))
  await invoke(['run', 'scripts/test-critical.ts', '--preflight', `--repository=${fixture}`], 1)
  checks.push({ id: 'V06', passed: true })
  const failed = join(output, 'failed')
  await invoke(['run', 'scripts/verification/runtime-boundary-gate-workflow.ts', `--output-dir=${failed}`, '--unknown'], 1)
  assert.equal(JSON.parse(readFileSync(join(failed, 'manifest.json'), 'utf8')).exitCode, 1)
  assert(existsSync(join(failed, 'failure.json')))
  checks.push({ id: 'V07', passed: true })
  assert.deepEqual(hashes(), before, 'Default verification runs must not change tracked files')
  evidence.complete(checks.map(check => check.id), ['GitHub Actions remote execution', 'native Windows/Linux execution'])
} finally {
  evidence.json('verification-output.json', { generatedAt: new Date().toISOString(), checks,
    trackedFileCount: tracked.length, trackedHashesUnchanged: JSON.stringify(before) === JSON.stringify(hashes()) })
  console.log(JSON.stringify({ output, passed: checks.length }))
}
})
