#!/usr/bin/env bun
/** One repeatable entry point and manifest for the Session storage acceptance flows. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow, verifyVerificationDirectory } from './verification-artifacts'

await verificationWorkflow('session-foundation-suite', async run => {
  const workflows = [
    { id: 'session-foundation', minimum: 7, required: ['messages.json', 'tool-recovery.json'] },
    { id: 'session-branch', minimum: 6, required: ['session-branch.json'] },
    { id: 'session-transfer', minimum: 5, required: ['transfer.json'] },
    { id: 'session-metadata', minimum: 6, required: ['metadata.json'] },
    { id: 'session-drafts', minimum: 6, required: ['drafts.json'] },
    { id: 'session-artifacts', minimum: 7, required: ['artifacts.json'] },
    { id: 'workspace-recovery', minimum: 10, required: ['restored-runtime.json'] },
  ]
  const results: Array<{ id: string; passed: number; directory: string }> = []
  for (const workflow of workflows) {
    const directory = join(run.directory, workflow.id)
    const child = Bun.spawn([process.execPath, join(import.meta.dir, `${workflow.id}-workflow.ts`), `--output-dir=${directory}`], {
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    run.json(`${workflow.id}-process.json`, { exitCode, stdout, stderr })
    assert.equal(exitCode, 0, `${workflow.id} failed: ${stderr}\n${stdout}`)
    verifyVerificationDirectory(directory, { workflow: workflow.id, minimum: workflow.minimum, required: workflow.required })
    const manifest = await Bun.file(join(directory, 'manifest.json')).json() as { passed: number }
    results.push({ id: workflow.id, passed: manifest.passed, directory })
  }
  run.json('suite.json', { results, totalScenes: results.reduce((sum, result) => sum + result.passed, 0) })
  run.complete(results.map(result => result.id), ['live external provider and OAuth', 'Office visual rendering', 'native Linux filesystem semantics'])
  console.log(JSON.stringify({ workflows: results.length, scenes: results.reduce((sum, result) => sum + result.passed, 0), output: run.directory }))
})
