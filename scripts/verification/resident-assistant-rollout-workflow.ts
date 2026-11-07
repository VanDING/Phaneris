import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow, verifyVerificationDirectory } from './verification-artifacts'

// Integration gate: every constituent must actually execute, settle successfully,
// produce a nonempty manifest, and retain repeatable hashed evidence. No fixtures
// may share a writable user configuration or substitute a previous run's result.
await verificationWorkflow('resident-assistant-rollout', async run => {
  for (const build of ['server:build:subprocess', 'electron:build:main', 'electron:build:preload', 'electron:build:renderer', 'electron:build:assets']) {
    console.log(`Building ${build}`)
    const child = Bun.spawn([process.execPath, 'run', build], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, `${build.replaceAll(':', '-')}.log`), out + err)
    assert.equal(exit, 0, `Required build ${build} failed: ${(out + err).slice(-3000)}`)
  }
  const cases = ['memory', 'automatic-memory', 'history', 'extraction', 'temporal', 'relations', 'sources', 'structure',
    'recall', 'project-memory', 'layout', 'identity', 'native', 'private-state', 'source-access',
    'maintenance', 'context', 'delegation', 'deliverables', 'results', 'l0', 'control', 'history-repair', 'memory-repair', 'ui'] as const
  const results: Array<{ case: string; passed: number; directory: string; exitCode: number }> = []
  for (const name of cases) {
    console.log(`Running resident assistant ${name}`)
    const directory = join(run.directory, name)
    const child = Bun.spawn([process.execPath, 'run', `scripts/verification/resident-assistant-${name}-workflow.ts`, `--output-dir=${directory}`],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, `${name}.log`), out + err)
    const manifest = exit === 0 ? verifyVerificationDirectory(directory) : undefined
    results.push({ case: name, passed: manifest?.passed ?? 0, directory, exitCode: exit })
    run.json('rollout-results.json', results)
    console.log(manifest ? `Passed ${name}: ${manifest.passed} scenarios` : `Failed ${name}; see ${name}.log`)
  }
  assert(results.every(result => result.exitCode === 0), `Failed workflows: ${results.filter(result => result.exitCode !== 0).map(result => result.case).join(', ')}`)
  run.complete(results.map(result => `rollout-${result.case}`), ['Paid model quality', 'Real user Work data migration', 'Signed installer distribution', 'Operating-system process sandbox'])
})
