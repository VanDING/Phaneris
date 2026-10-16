#!/usr/bin/env bun
/** V08/V09 canaries: mutate copies of real CI/coverage/warning inputs, never the checkout. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
await verificationWorkflow('governance-gates', async run => {
  const checks: { id: string; passed: boolean }[] = []
  async function reject(id: string, entry: string, args: string[]) {
    const child = Bun.spawn([process.execPath, 'run', entry, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    writeFileSync(join(run.directory, `${id}.log`), `${stdout}\n${stderr}`)
    assert.equal(code, 1, `Mutation ${id} must be rejected`)
    checks.push({ id, passed: true })
  }
  const workflow = readFileSync(join(root, '.github/workflows/validate.yml'), 'utf8')
  const missingUv = join(run.directory, 'missing-uv.yml')
  writeFileSync(missingUv, workflow.replace(/(  full-validation:[\s\S]*?)      - name: Install uv[\s\S]*?(?=      - name: Install dependencies)/, '$1'))
  await reject('V08-uv', 'scripts/check-governance.ts', [`--workflow=${missingUv}`])
  const missingUpload = join(run.directory, 'missing-upload.yml')
  writeFileSync(missingUpload, workflow.replaceAll('if: always()', 'if: success()'))
  await reject('V08-upload', 'scripts/check-governance.ts', [`--workflow=${missingUpload}`])
  const missingPipefail = join(run.directory, 'missing-pipefail.yml')
  writeFileSync(missingPipefail, workflow.replaceAll('shell: bash', 'shell: bash -e {0}'))
  await reject('CI-pipeline-exit', 'scripts/check-governance.ts', [`--workflow=${missingPipefail}`])
  const coverage = JSON.parse(readFileSync(join(root, 'scripts/quality-coverage.json'), 'utf8'))
  delete coverage.members['packages/server-core']
  const missingMember = join(run.directory, 'missing-member.json')
  writeFileSync(missingMember, JSON.stringify(coverage))
  await reject('V09-coverage', 'scripts/check-governance.ts', [`--coverage=${missingMember}`])
  const baseline = JSON.parse(readFileSync(join(root, 'scripts/lint-warning-baseline.json'), 'utf8'))
  assert(baseline.entries.length > 0)
  baseline.entries.shift()
  const missingWarning = join(run.directory, 'missing-warning.json')
  writeFileSync(missingWarning, JSON.stringify(baseline))
  await reject('V09-warning', 'scripts/lint-workspace.ts', [`--baseline=${missingWarning}`])
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const missingBoundary = join(run.directory, 'missing-boundary.json')
  metadata.scripts.lint = metadata.scripts.lint.replace(' && bun run check:boundaries', '')
  writeFileSync(missingBoundary, JSON.stringify(metadata))
  await reject('G04-unwired-boundary', 'scripts/check-governance.ts', [`--manifest=${missingBoundary}`])
  metadata.scripts.lint = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.lint
  metadata.scripts['identity:check'] = 'bun run scripts/check-identity.ts'
  const advisoryIdentity = join(run.directory, 'advisory-identity.json')
  writeFileSync(advisoryIdentity, JSON.stringify(metadata))
  await reject('G08-advisory-identity', 'scripts/check-governance.ts', [`--manifest=${advisoryIdentity}`])
  const noContainer = join(run.directory, 'no-container.yml')
  writeFileSync(noContainer, workflow.replace(/\n  production-container:[\s\S]*$/, ''))
  await reject('G08-no-production-container', 'scripts/check-governance.ts', [`--workflow=${noContainer}`])
  const noBrowser = join(run.directory, 'no-browser.yml')
  writeFileSync(noBrowser, workflow.replace('run: bunx playwright install --with-deps chromium', 'run: true'))
  await reject('G07-no-browser-runtime', 'scripts/check-governance.ts', [`--workflow=${noBrowser}`])
  run.json('governance-gates.json', { checks, untested: ['GitHub Actions remote execution'] })
  run.complete(checks.map(check => check.id), ['GitHub Actions remote execution'])
  console.log(JSON.stringify({ passed: checks.length, output: join(run.directory, 'governance-gates.json') }))
})
