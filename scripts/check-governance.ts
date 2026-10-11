#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { UV_VERSION } from './build/common'
import { criticalWorkflows, criticalTestGroups } from './critical-scenarios'

const root = resolve(import.meta.dir, '..')
function input(flag: string, fallback: string) {
  const explicit = process.argv.slice(2).find(argument => argument.startsWith(`--${flag}=`))?.slice(flag.length + 3)
  return explicit ? resolve(explicit) : join(root, fallback)
}
interface Step { name?: string; uses?: string; if?: unknown; run?: string; with?: Record<string, unknown>; 'continue-on-error'?: unknown }
interface Job { steps: Step[]; if?: unknown; 'continue-on-error'?: unknown }
const workflow = loadYaml(readFileSync(input('workflow', '.github/workflows/validate.yml'), 'utf8')) as { on?: Record<string, unknown>; jobs: Record<string, Job> }
assert(workflow.on && Object.hasOwn(workflow.on, 'pull_request'), 'PR validation trigger is required')
assert(workflow.on && Object.hasOwn(workflow.on, 'push') && Object.hasOwn(workflow.on, 'workflow_dispatch'), 'Push and manual validation triggers are required')
const push = workflow.on.push as { branches?: string[] }
assert(push.branches?.includes('main'), 'origin/main pushes must validate')
for (const name of ['validate', 'quality-windows', 'full-validation', 'production-container', 'native-macos']) {
  const job = workflow.jobs[name]
  assert(job, `Missing validation job: ${name}`)
  assert.equal(job.if, name === 'full-validation' ? "github.event_name != 'pull_request'" : undefined, `${name} has an unapproved job condition`)
  assert.equal(job['continue-on-error'] ?? false, false, `${name} must propagate failures`)
  for (const step of job.steps) {
    assert.equal(step['continue-on-error'] ?? false, false, `${name}/${step.name} must propagate failures`)
    if (step.run || step.uses) assert(step.if === undefined || step.if === 'always()'
      || name === 'validate' && step.run === 'bun run build:smoke' && step.if === "github.event_name == 'pull_request'",
    `${name}/${step.name} has an unapproved step condition`)
  }
}
for (const [job, command] of [['validate', 'bun run validate:ci'], ['full-validation', 'bun run validate:full'],
  ['quality-windows', 'bun run runtime:check'], ['native-macos', 'bun run test:native-client']]) {
  const steps = workflow.jobs[job!]!.steps
  const supplied = steps.findIndex(step => step.run === 'bun run runtime:provision:validation')
  const validated = steps.findIndex(step => step.run?.includes(command!))
  assert(supplied >= 0 && validated > supplied, `${job} must provision the pinned bundled runtime before validation`)
}
for (const job of ['validate', 'full-validation']) {
  const steps = workflow.jobs[job]?.steps
  assert(steps, `Missing validation job: ${job}`)
  const uv = steps.find(step => step.uses?.startsWith('astral-sh/setup-uv@'))
  assert.equal(uv?.with?.version, UV_VERSION, `${job} must pin uv ${UV_VERSION}`)
}
for (const job of ['validate', 'quality-windows', 'full-validation', 'production-container', 'native-macos']) {
  const steps = workflow.jobs[job]?.steps ?? []
  const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))
  assert(upload && upload.if === 'always()', `${job} must always upload verification evidence`)
  assert(upload.uses?.match(/@[a-f0-9]{40}$/), 'Artifact action must be pinned to a commit')
  assert.equal(upload.with?.path, '.cache/verification/')
  assert.equal(upload.with?.['if-no-files-found'], 'error', `${job} must reject missing evidence`)
}
assert(workflow.jobs.validate?.steps.some(step => step.run === 'bun run build:smoke' && step.if === "github.event_name == 'pull_request'"), 'PRs must build the production paths')
assert(workflow.jobs.validate?.steps.some(step => step.run === 'bun run test:critical'), 'Critical scenarios must run in CI')
assert(workflow.jobs.validate.steps.some(step => step.run === 'bunx playwright install --with-deps chromium'), 'Production renderer workflows require a real browser in CI')
assert(workflow.jobs['native-macos']?.steps.some(step => step.run === 'bun run test:native-client'), 'Native main/preload renderer acceptance must run in macOS CI')
assert(workflow.jobs['production-container']?.steps.some(step => step.run === 'bun run test:container'), 'Production container acceptance must run in Linux CI')
assert(workflow.jobs['full-validation'].steps.some(step => step.run === 'bun run test:clean-install'), 'Independent frozen install must run in CI')
const metadata = JSON.parse(readFileSync(input('manifest', 'package.json'), 'utf8')) as { scripts: Record<string, string> }
for (const gate of ['boundaries', 'cycles', 'rpc-contracts', 'distribution']) {
  assert(metadata.scripts.lint?.split(' && ').includes(`bun run check:${gate}`), `${gate} must run in the lint/pre-push gate`)
  assert(metadata.scripts[`check:${gate}`], `Missing ${gate} entry`)
}
assert.equal(metadata.scripts['identity:check'], 'bun run scripts/check-identity.ts --strict', 'Identity validation must reject unclassified residuals')
const registryPath = process.argv.some(arg => arg.startsWith('--registry=')) ? input('registry', '') : undefined
const registry = registryPath ? JSON.parse(readFileSync(registryPath, 'utf8')) : { workflows: criticalWorkflows, groups: criticalTestGroups }
const policy = JSON.parse(readFileSync(join(root, 'scripts/critical-scenario-policy.json'), 'utf8'))
assert.deepEqual(registry.workflows, policy.workflows, 'Every required workflow, minimum and artifact must remain wired')
assert.deepEqual(registry.groups, policy.groups, 'Every required package test group must remain wired')
assert.equal(metadata.scripts['lint:workspace'], 'bun run scripts/lint-workspace.ts', 'CI lint must use the reviewed baseline without initialization flags')
assert.equal(metadata.scripts['test:doc-tools'], 'bun run scripts/test-doc-tools.ts', 'Document tests must use the product Python pin')
const coverage = JSON.parse(readFileSync(input('coverage', 'scripts/quality-coverage.json'), 'utf8')) as {
  members: Record<string, { typecheck: string; lint: string; build: string; behavior: string; owner: string }>
  tooling: { projects: string[]; behavior: string; lint: string; typecheckExceptions: { file: string; reason: string; sha256?: string }[] }
}
const members = ['packages', 'apps'].flatMap(parent => readdirSync(join(root, parent), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, parent, entry.name, 'package.json'))).map(entry => `${parent}/${entry.name}`)).sort()
assert.deepEqual(Object.keys(coverage.members).sort(), members, 'Every workspace member must have a quality coverage row')
for (const [member, row] of Object.entries(coverage.members)) {
  assert(existsSync(join(root, member, row.typecheck)), `Missing typecheck project: ${member}`)
  for (const field of ['lint', 'build', 'behavior', 'owner'] as const) assert(row[field]?.trim(), `${member} requires ${field} coverage or an explicit gap`)
}
assert(coverage.tooling.projects.length > 0 && coverage.tooling.behavior && coverage.tooling.lint)
for (const project of coverage.tooling.projects) assert(existsSync(join(root, project)), `Missing tooling project ${project}`)
const tooling = JSON.parse(readFileSync(join(root, 'tsconfig.tooling.json'), 'utf8')) as { exclude: string[] }
assert.deepEqual([...tooling.exclude].sort(), coverage.tooling.typecheckExceptions.map(entry => entry.file).sort(), 'Every tooling exclusion needs an explicit reason')
for (const exception of coverage.tooling.typecheckExceptions) {
  assert(exception.reason, `Unexplained tooling exception: ${exception.file}`)
  if (exception.file === 'scripts/performance/server.ts') continue // Checked by its registered server project.
  assert.equal(createHash('sha256').update(readFileSync(join(root, exception.file))).digest('hex'), exception.sha256,
    `Frozen historical script changed; restore typecheck coverage before editing ${exception.file}`)
}
console.log(`Governance wiring OK: ${members.length} members, ${coverage.tooling.projects.length} tooling projects; uv and artifact pins checked`)
