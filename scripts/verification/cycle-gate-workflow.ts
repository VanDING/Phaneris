#!/usr/bin/env bun
/** C03: real resolved cycle gate rejects new cycles, expansion and unexplained/stale debt. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('cycle-gate', async run => {
  const repository = join(run.directory, 'repository'), sources = join(repository, 'packages/fixture/src')
  mkdirSync(sources, { recursive: true })
  mkdirSync(join(repository, 'apps'))
  writeFileSync(join(repository, 'packages/fixture/package.json'), JSON.stringify({ name: '@fixture/cycle', exports: { '.': './src/a.ts' } }))
  const a = 'packages/fixture/src/a.ts', b = 'packages/fixture/src/b.ts', c = 'packages/fixture/src/c.ts'
  const baseline = join(run.directory, 'baseline.json'), results: { id: string; output: string }[] = []
  const write = (file: string, contents: string) => writeFileSync(join(repository, file), contents)
  const allowance = (members: string[], reason = 'Verified recursive fixture composition') => ({ members, reason, owner: 'verification', edges: [{ from: a, to: b }, { from: b, to: a }] })
  const check = (id: string, allowed: unknown[], success: boolean) => {
    writeFileSync(baseline, JSON.stringify({ schemaVersion: 1, allowed }))
    const child = Bun.spawnSync([process.execPath, resolve('scripts/check-cycles.ts'), `--repository=${repository}`, `--baseline=${baseline}`], { stdout: 'pipe', stderr: 'pipe' })
    assert.equal(child.exitCode === 0, success, `${id}: ${child.stderr.toString()}`)
    results.push({ id, output: child.stdout.toString() + child.stderr.toString() })
  }
  write(a, "import './b'; export const a = 1\n"); write(b, 'export const b = 2\n')
  check('acyclic', [], true)
  write(b, "import './a'; export const b = 2\n")
  check('new-runtime-cycle', [], false)
  check('reasoned-exact-cycle', [allowance([a, b])], true)
  check('missing-reason', [allowance([a, b], '')], false)
  write(c, "import './a'; export const c = 3\n"); write(b, "import './a'; import './c'; export const b = 2\n")
  check('cycle-expansion', [allowance([a, b])], false)
  write(b, 'export const b = 2\n')
  check('stale-exception', [allowance([a, b])], false)
  run.json('cycle-gate.json', { results })
  run.complete(results.map(result => result.id))
})
