#!/usr/bin/env bun
/** F01-F05: execute real gates against CI/registry copies and actual ESLint configurations. */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ESLint } from 'eslint'
import { criticalTestGroups, criticalWorkflows } from '../critical-scenarios'
import { UV_VERSION } from '../build/common'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('governance-closeout', async run => {
  const root = resolve(import.meta.dir, '../..')
  const records: { id: string; passed: boolean; detail?: string }[] = []
  async function command(id: string, entry: string, args: string[], expected = 1, attempts = 1) {
    let last: { stdout: string; stderr: string; code: number | null } = { stdout: '', stderr: '', code: null }
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const child = Bun.spawn([process.execPath, entry, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      last = { stdout, stderr, code }
      if (code === expected) break
    }
    writeFileSync(join(run.directory, `${id}.log`), last.stdout + last.stderr)
    records.push({ id, passed: last.code === expected, detail: `exit=${last.code}; expected=${expected}${attempts > 1 ? `; attempts=${attempts}` : ''}` })
    return last
  }
  const workflow = readFileSync(join(root, '.github/workflows/validate.yml'), 'utf8')
  for (const [id, text] of [
    ['disabled-job', workflow.replace('  validate:\n', '  validate:\n    if: false\n')],
    ['ignored-job-errors', workflow.replace('  validate:\n', '  validate:\n    continue-on-error: true\n')],
    ['missing-pr-trigger', workflow.replace('  pull_request:\n', '')],
    ['disabled-step', workflow.replace('      - name: Run validation suite\n', '      - name: Run validation suite\n        if: false\n')],
    ['ignored-step-errors', workflow.replace('      - name: Run validation suite\n', '      - name: Run validation suite\n        continue-on-error: true\n')],
    ['missing-evidence', workflow.replaceAll('if-no-files-found: error', 'if-no-files-found: warn')],
    ['missing-runtime-supply', workflow.replace(/      - name: Provision validation runtime\n[\s\S]*?(?=      - name:)/g, '')],
  ]) {
    const path = join(run.directory, `${id}.yml`)
    writeFileSync(path, text!)
    await command(id!, 'scripts/check-governance.ts', [`--workflow=${path}`])
  }
  for (const [id, registry] of [
    ['missing-critical-workflow', { workflows: criticalWorkflows.filter(row => row.id !== 'plugin-transaction'), groups: criticalTestGroups }],
    ['missing-critical-group', { workflows: criticalWorkflows, groups: criticalTestGroups.slice(1) }],
  ] as const) {
    const path = join(run.directory, `${id}.json`)
    writeFileSync(path, JSON.stringify(registry))
    await command(id, 'scripts/check-governance.ts', [`--registry=${path}`])
  }
  await command('strict-final-tree', 'scripts/check-identity.ts', ['--strict'], 0)
  await command('rpc-census-gate', 'scripts/contract-inventory.ts', [], 0)
  const census = JSON.parse(readFileSync(join(root, 'scripts/rpc-contract-inventory.json'), 'utf8')) as {
    rows: { kind: string; runtimeValidation: string; sites: unknown[] }[]
  }
  records.push({ id: 'nonempty-handler-census', passed: census.rows.some(row => row.kind === 'method' && row.sites.length > 0) })
  records.push({ id: 'all-central-contracts-have-handlers', passed: census.rows
    .filter(row => row.runtimeValidation.startsWith('protocol input contract')).every(row => row.sites.length > 0) })
  for (const [member, file] of [['apps/electron', 'src/renderer/App.tsx'], ['packages/ui', 'src/index.ts']] as const) {
    const eslint = new ESLint({ cwd: join(root, member) })
    for (const [id, source, rule] of [
      ['debugger', 'debugger;', 'no-debugger'],
      ['unsafe-finally', 'function example() { try { throw new Error() } finally { return 1 } }', 'no-unsafe-finally'],
    ]) {
      const result = await eslint.lintText(source!, { filePath: join(root, member, file) })
      records.push({ id: `${member}:${id}`, passed: result.some(row => row.messages.some(message => message.ruleId === rule && message.severity === 2)) })
    }
  }
  await command('no-baseline-initialization', 'scripts/lint-workspace.ts', [`--baseline=${join(run.directory, 'unauthorized-baseline.json')}`, '--initialize-baseline'])
  const clean = join(run.directory, 'clean-runtime')
  for (const file of ['packages/session-tools-core/src/runtime/resolve-script-runtime.ts',
    'apps/electron/resources/bin/docx-tool', 'apps/electron/resources/bin/docx-tool.cmd']) {
    mkdirSync(dirname(join(clean, file)), { recursive: true })
    copyFileSync(join(root, file), join(clean, file))
  }
  await command('cold-runtime-missing-stamp', 'scripts/check-python-runtime-pin.ts', [`--repository=${clean}`])
  // The provision step downloads the pinned uv from GitHub, so a transient
  // network failure is retried — but never waived: the record still fails if the
  // binary never appears, and the failure text is kept for the parent summary.
  await command('cold-runtime-provision', 'scripts/provision-validation-runtime.ts', [`--repository=${clean}`], 0, 2)
  const binary = join(clean, 'apps/electron/resources/bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'uv.exe' : 'uv')
  if (!existsSync(binary)) {
    // Report the provisioning failure instead of crashing on a missing file: the
    // gate must stay red with a readable reason, not with an ENOENT stack.
    const provisionLog = readFileSync(join(run.directory, 'cold-runtime-provision.log'), 'utf8')
    records.push({ id: 'cold-runtime-pinned', passed: false, detail: 'not run: the clean tree has no uv binary' })
    records.push({ id: 'cold-runtime-executable-version', passed: false, detail: `not run: provisioning produced no binary; tail=${provisionLog.trim().split('\n').slice(-2).join(' | ')}` })
  } else {
    await command('cold-runtime-pinned', 'scripts/check-python-runtime-pin.ts', [`--repository=${clean}`], 0)
    const version = Bun.spawnSync([binary, '--version'], { stdout: 'pipe', stderr: 'pipe' })
    records.push({ id: 'cold-runtime-executable-version', passed: version.exitCode === 0 && version.stdout.toString().trim().split(/\s+/).slice(0, 2).join(' ') === `uv ${UV_VERSION}`, detail: version.stdout.toString().trim() })
  }
  run.json('governance-closeout.json', { records })
  assert.deepEqual(records.filter(record => !record.passed), [], 'Closeout gates failed; see governance-closeout.json')
  run.complete(records.map(record => record.id), ['GitHub Actions remote execution'])
})
