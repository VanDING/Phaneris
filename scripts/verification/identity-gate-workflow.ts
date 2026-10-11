#!/usr/bin/env bun
/** D03: exercise the real strict scanner against an isolated, generated identity tree. */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('identity-gate', async run => {
  const root = resolve(import.meta.dir, '../..'), fixture = join(run.directory, 'repository')
  const files = ['phaneris.identity.json', 'scripts/check-identity.ts', 'scripts/identity-core.ts',
    'scripts/identity-allowlist.json', 'packages/shared/src/identity.generated.ts',
    'apps/electron/identity.generated.yml', 'apps/electron/electron-builder.yml', 'apps/electron/package.json']
  for (const file of files) {
    mkdirSync(dirname(join(fixture, file)), { recursive: true })
    copyFileSync(join(root, file), join(fixture, file))
  }
  const identity = JSON.parse(readFileSync(join(fixture, 'phaneris.identity.json'), 'utf8')) as { legacy: { dataDirName: string } }
  const compatibility = `export const migrationInput = ${JSON.stringify(identity.legacy.dataDirName)}`
  const newlyIntroduced = `export const productOutput = ${JSON.stringify(identity.legacy.dataDirName)}`
  const allowlist = JSON.parse(readFileSync(join(fixture, 'scripts/identity-allowlist.json'), 'utf8')) as { rules: unknown[] }
  allowlist.rules = allowlist.rules.filter(rule => files.includes((rule as { glob: string }).glob))
  allowlist.rules.push({ glob: 'fixture.ts', tokens: ['*'], lines: [compatibility], category: 'read-compatibility', reason: 'Only this frozen migration input belongs to the legacy format.' })
  const allowance = join(fixture, 'scripts/identity-allowlist.json'), source = join(fixture, 'fixture.ts')
  writeFileSync(allowance, JSON.stringify(allowlist))
  const cases: { id: string; exitCode: number; residual: number }[] = []
  const scan = (id: string, expected: number) => {
    const child = Bun.spawnSync([process.execPath, join(fixture, 'scripts/check-identity.ts'), '--strict', '--json'], { cwd: fixture, stdout: 'pipe', stderr: 'pipe' })
    const report = JSON.parse(child.stdout.toString()) as { residual: { open: number }; driftProblems: string[] }
    run.json(`${id}.json`, report)
    assert.equal(child.exitCode, expected, `${id}: ${child.stderr.toString()}`)
    cases.push({ id, exitCode: child.exitCode, residual: report.residual.open })
  }
  writeFileSync(source, compatibility + '\n')
  scan('reasoned-exact-compatibility', 0)
  writeFileSync(source, compatibility + '\n' + newlyIntroduced + '\n')
  scan('new-token-in-approved-file', 1)
  writeFileSync(source, compatibility.replace('migrationInput', 'changedInput') + '\n')
  scan('changed-compatibility-line', 1)
  writeFileSync(source, compatibility + '\n')
  mkdirSync(join(fixture, 'docs'), { recursive: true })
  writeFileSync(join(fixture, 'docs/new.md'), newlyIntroduced + '\n')
  scan('new-maintainer-document', 1)
  writeFileSync(join(fixture, 'docs/new.md'), 'Current product documentation\n')
  const reviewed = readFileSync(allowance, 'utf8')
  allowlist.rules.push({ glob: 'missing-fixture.ts', tokens: ['*'], lines: [compatibility],
    category: 'read-compatibility', reason: 'Intentionally stale fixture allowance must fail.' })
  writeFileSync(allowance, JSON.stringify(allowlist))
  scan('stale-allowance', 1)
  writeFileSync(allowance, reviewed)
  writeFileSync(join(fixture, 'packages/shared/src/identity.generated.ts'), 'changed generated output\n')
  scan('generated-identity-drift', 1)
  run.json('identity-gate.json', { cases })
  run.complete(cases.map(item => item.id))
})
