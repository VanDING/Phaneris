#!/usr/bin/env bun
/** F01: exercise the actual CI gate against deliberately forbidden source graphs. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-runtime-gate-'))
const source = (path: string, code: string) => { const file = join(fixture, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, code) }
mkdirSync(join(fixture, 'apps'))
source('packages/server-core/package.json', JSON.stringify({ name: '@phaneris/server-core', exports: { './runtime': './src/durable-runtime/index.ts' } }))
source('packages/server-core/src/sessions/SessionManager.ts', `export interface ManagedSession { isProcessing: boolean }
export class SessionManager { run(managed: any) { managed.runtime.isProcessing = true; managed.runtime.processingGeneration++; managed.runtime.messageQueue.push({}); managed.runtime.agent.chat('invalid') } }`)
source('packages/server-core/src/durable-runtime/index.ts', "export * from './coordinator.js'")
source('packages/server-core/src/durable-runtime/coordinator.ts', `import type { ManagedSession } from './barrel.js'
export class DurableRuntimeCoordinator { async load() { return import('../sessions/SessionManager.js') } }`)
source('packages/server-core/src/durable-runtime/barrel.ts', "export type { ManagedSession } from '../sessions/SessionManager.js'")
source('packages/server-core/src/consumer.ts', `import { DurableRuntimeCoordinator } from '@phaneris/server-core/runtime'
const deep = import('./durable-runtime/coordinator.js'); type Deep = import('./durable-runtime/coordinator.js').DurableRuntimeCoordinator`)
source('packages/server-core/src/durable-runtime/js-bridge.js', "export { SessionManager } from '../sessions/SessionManager.js'")
const output = join(fixture, 'report.json')
const process = Bun.spawn([Bun.which('bun')!, join(root, 'scripts/check-runtime-boundary.ts'), `--repository=${fixture}`, `--output=${output}`], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
assert.equal(code, 1, stderr)
const result = JSON.parse(readFileSync(output, 'utf8')), rules = new Set(result.violations.map((item: { rule: string }) => item.rule))
for (const rule of ['runtime-no-product-import', 'runtime-transitive-product-dependency', 'public-api-only', 'no-private-object-export', 'explicit-public-exports', 'host-owns-execution', 'host-owns-state', 'host-owns-queue', 'no-second-run-state']) assert(rules.has(rule), `Missing gate rule: ${rule}`)
assert(result.violations.some((item: { file: string }) => item.file.endsWith('js-bridge.js')))
const archive = join(root, 'docs/verification/results/durable-runtime-boundary/gate-mutations.json')
mkdirSync(dirname(archive), { recursive: true })
writeFileSync(archive, JSON.stringify({ command: 'bun run scripts/verification/runtime-boundary-gate-workflow.ts', fixture, passed: true, rejectedExitCode: code, ...result }, null, 2) + '\n')
console.log(JSON.stringify({ passed: true, rejectedViolations: result.violationCount, output: archive }))
