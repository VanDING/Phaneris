import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow, verifyVerificationDirectory } from './verification-artifacts'

await verificationWorkflow('resident-work-continuity-acceptance', async run => {
  const workflows = ['resident-work-continuity', 'resident-work-continuity-loop', 'resident-work-continuity-performance',
    'resident-work-continuity-maintenance', 'resident-work-continuity-migration', 'resident-context-063-recovery',
    'resident-assistant-management', 'durable-runtime-crash', 'durable-runtime-pi']
  const results: Array<{ workflow: string; directory: string; exitCode: number; passed: number }> = []
  for (const workflow of workflows) {
    const directory = join(run.directory, workflow)
    const child = Bun.spawn([process.execPath, 'run', `scripts/verification/${workflow}-workflow.ts`, `--output-dir=${directory}`],
      { stdout: 'pipe', stderr: 'pipe' })
    const [out, err, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, `${workflow}.log`), out + err)
    const manifest = exitCode === 0 ? verifyVerificationDirectory(directory) : undefined
    results.push({ workflow, directory, exitCode, passed: manifest?.passed ?? 0 })
    run.json('acceptance-results.json', results)
    console.log(`${workflow}: ${exitCode === 0 ? `${manifest!.passed} passed` : 'failed'}`)
  }
  const tracked = execFileSync('git', ['diff', '--name-only', '--', 'packages', 'scripts'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'packages', 'scripts'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
  run.json('implementation-source-hashes.json', [...new Set([...tracked, ...added])].sort().map(path => ({ path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })))
  assert(results.every(result => result.exitCode === 0), `Failed: ${results.filter(result => result.exitCode !== 0).map(result => result.workflow).join(', ')}`)
  run.complete(results.map(result => result.workflow), ['Paid autonomous semantics (run resident-work-continuity-live-workflow.ts)',
    'Full resident rollout, Windows packaging and CI (separate gates)', 'Production writes, installation and publishing'])
})
