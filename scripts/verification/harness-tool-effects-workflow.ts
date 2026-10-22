/** Failure cases registered before implementing scheduling; no online services. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { verificationWorkflow } from './verification-artifacts'
import { getToolDefsAsJsonSchema } from '../../packages/session-tools-core/src/tool-defs'
import { getGuardedModeCall } from '../../packages/shared/src/agent/core/guarded-mode'
import { shouldAllowToolInMode } from '../../packages/shared/src/agent/mode-manager'
import { shouldPromptInAskMode } from '../../packages/shared/src/agent/core/pre-tool-use'

await verificationWorkflow('harness-tool-effects', async evidence => {
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-tool-effects-'))
  const results: Array<{ id: string; passed: boolean; error?: string }> = []
  const scenario = async (id: string, run: () => unknown) => {
    try { await run(); results.push({ id, passed: true }) }
    catch (error) { results.push({ id, passed: false, error: String(error) }) }
  }
  await scenario('canonical-readonly-metadata-reaches-host-proxies', () => {
    const definitions = getToolDefsAsJsonSchema({ prefix: 'mcp__session__' })
    assert.equal((definitions.find(tool => tool.name.endsWith('__call_llm')) as any).readOnly, true)
    assert.notEqual((definitions.find(tool => tool.name.endsWith('__set_session_labels')) as any).readOnly, true)
  })
  for (const toolName of ['mcp__session__set_session_labels', 'mcp__session__set_session_status']) {
    await scenario(`guarded-automation-effects:${toolName}`, () => {
      const call = getGuardedModeCall(toolName, {}, { workspaceRootPath: fixture, workingDirectory: fixture, activeSourceSlugs: [] })
      assert.equal(call?.promptType, 'mcp_mutation')
    })
  }
  for (const command of ['upload @e1 secret.txt', 'snapshot; upload @e1 secret.txt', ['upload', '@e1', 'secret.txt'], 'evaluate fetch("https://fixture.invalid", {method:"POST"})', 'set-clipboard copied data']) {
    await scenario(`browser-effect:${JSON.stringify(command)}`, () => {
      const name = 'mcp__session__browser_tool', args = { command }
      assert.equal(shouldAllowToolInMode(name, args, 'safe').allowed, false)
      assert(shouldPromptInAskMode(name, args, { isCommandWhitelisted: () => false } as never, { workspaceRootPath: fixture } as never))
      assert(getGuardedModeCall(name, args, { workspaceRootPath: fixture, activeSourceSlugs: [] })?.alwaysAsk)
    })
  }
  await scenario('browser-inspection-and-navigation-remain-available', () => {
    for (const command of ['snapshot', 'evaluate document.title', ['evaluate', 'document.body.innerText'], 'click @e2', 'fill @e3 search terms', 'fill @e3 "literal; upload text"']) {
      assert.equal(shouldAllowToolInMode('mcp__session__browser_tool', { command }, 'safe').allowed, true)
      assert.equal(shouldPromptInAskMode('mcp__session__browser_tool', { command }, {} as never, { workspaceRootPath: fixture } as never), null)
    }
  })
  await scenario('invalid-browser-syntax-is-an-input-error-not-an-approval', () => {
    const name = 'mcp__session__browser_tool', args = { command: 'fill @e1 "unterminated' }
    assert.equal(shouldAllowToolInMode(name, args, 'safe').allowed, false)
    assert.equal(shouldPromptInAskMode(name, args, { isCommandWhitelisted: () => false } as never, { workspaceRootPath: fixture } as never), null)
    assert.equal(getGuardedModeCall(name, args, { workspaceRootPath: fixture, activeSourceSlugs: [] }), null)
  })
  await scenario('resource-ordering-cancellation-and-barriers', async () => {
    const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
    const scheduler = new ToolExecutionScheduler()
    const resources = (name: string, params: Record<string, unknown>, readOnly = false) => toolExecutionResources(name, params, fixture, readOnly)
    const file = join(fixture, 'same.txt')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const trace: string[] = []
    const first = scheduler.run(resources('write', { path: file }), undefined, async () => { trace.push('write-start'); await gate; trace.push('write-end') })
    const abort = new AbortController()
    const cancelled = scheduler.run(resources('write', { path: file }), abort.signal, async () => { trace.push('CANCELLED-EFFECT') }).catch(() => { trace.push('cancelled') })
    const read = scheduler.run(resources('read', { path: 'same.txt' }), undefined, async () => { trace.push('read-after-write') })
    const other = scheduler.run(resources('read', { path: 'other.txt' }), undefined, async () => { trace.push('independent-read') })
    await other
    assert(trace.includes('write-start'))
    assert(!trace.includes('read-after-write'))
    abort.abort()
    await cancelled
    release()
    await Promise.all([first, read])
    assert(!trace.includes('CANCELLED-EFFECT'))
    assert(trace.indexOf('read-after-write') > trace.indexOf('write-end'))
    // A failure must release the resource for a subsequent operation.
    await assert.rejects(scheduler.run(resources('write', { path: file }), undefined, async () => { throw new Error('fixture failure') }))
    await scheduler.run(resources('write', { path: file }), undefined, async () => { trace.push('recovered') })
    // An opaque shell operation blocks effects until its actual promise settles.
    let releaseShell!: () => void
    const shell = scheduler.run(resources('powershell', { command: 'fixture' }), undefined, async () => { await new Promise<void>(resolve => { releaseShell = resolve }); trace.push('shell-end') })
    const after = scheduler.run(resources('read', { path: 'other.txt' }), undefined, async () => { trace.push('after-shell') })
    await new Promise(resolve => setTimeout(resolve, 5))
    assert(!trace.includes('after-shell'))
    releaseShell()
    await Promise.all([shell, after])
    assert(trace.indexOf('after-shell') > trace.indexOf('shell-end'))
    evidence.json('scheduler-trace.json', { trace })
  })
  await scenario('path-aliases-and-parent-scan-conflict', async () => {
    const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
    const directory = join(fixture, 'real'), alias = join(fixture, 'alias')
    mkdirSync(directory)
    writeFileSync(join(directory, 'file.txt'), 'fixture')
    symlinkSync(directory, alias, 'junction')
    const real = toolExecutionResources('write', { path: join(directory, 'file.txt') }, fixture)
    assert.deepEqual(real, toolExecutionResources('edit', { path: join(alias, 'file.txt') }, fixture))
    const scheduler = new ToolExecutionScheduler()
    let release!: () => void
    const trace: string[] = []
    const scan = scheduler.run(toolExecutionResources('grep', { path: alias }, fixture), undefined, async () => { await new Promise<void>(resolve => { release = resolve }); trace.push('scan-end') })
    const write = scheduler.run(real, undefined, async () => { trace.push('write') })
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.deepEqual(trace, [])
    release()
    await Promise.all([scan, write])
    assert.deepEqual(trace, ['scan-end', 'write'])
  })
  await scenario('codemode-does-not-lock-out-nested-tools', async () => {
    const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
    const scheduler = new ToolExecutionScheduler()
    const signal = AbortSignal.timeout(2000)
    await scheduler.run(toolExecutionResources('codemode', {}, fixture), signal, () =>
      scheduler.run(toolExecutionResources('write', { path: 'nested.txt' }, fixture), signal, async () => 'nested'))
  })
  await scenario('parallel-reads-and-fair-writer-order', async () => {
    const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
    const scheduler = new ToolExecutionScheduler()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const trace: string[] = []
    const read = toolExecutionResources('read', { path: 'fair.txt' }, fixture)
    const first = scheduler.run(read, undefined, async () => { trace.push('r1'); await gate })
    const parallel = scheduler.run(read, undefined, async () => { trace.push('r2') })
    await parallel
    assert.deepEqual(trace, ['r1', 'r2'])
    const write = scheduler.run(toolExecutionResources('write', { path: 'fair.txt' }, fixture), undefined, async () => { trace.push('w') })
    const later = scheduler.run(read, undefined, async () => { trace.push('r3') })
    await new Promise(resolve => setTimeout(resolve, 5))
    assert(!trace.includes('r3'))
    release()
    await Promise.all([first, write, later])
    assert.deepEqual(trace, ['r1', 'r2', 'w', 'r3'])
  })
  await scenario('source-reads-remain-parallel-without-trusting-server-hints', async () => {
    const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
    const scheduler = new ToolExecutionScheduler()
    const resource = toolExecutionResources('mcp__fixture__search_documents', {}, fixture)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const trace: string[] = []
    const first = scheduler.run(resource, undefined, async () => { trace.push('r1'); await gate })
    const second = scheduler.run(resource, undefined, async () => { trace.push('r2') })
    await new Promise(resolve => setTimeout(resolve, 5))
    const overlapped = trace.includes('r2')
    release()
    await Promise.all([first, second])
    assert(overlapped, 'Ordinary read-only source tools should not be serialized')
    assert.equal(toolExecutionResources('mcp__fixture__send_message', {}, fixture, true)[0]?.access, 'write', 'External readOnly hints cannot classify a mutation as a read')
  })
  await scenario('browser-inspection-does-not-block-independent-file-work', async () => {
    const { ToolExecutionScheduler, toolExecutionResources } = await import('../../packages/pi-agent-server/src/tool-execution-scheduler')
    const scheduler = new ToolExecutionScheduler()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let readEntered = false
    const browser = scheduler.run(toolExecutionResources('mcp__session__browser_tool', { command: 'snapshot' }, fixture), undefined, async () => { await gate })
    const read = scheduler.run(toolExecutionResources('read', { path: 'independent.txt' }, fixture), undefined, async () => { readEntered = true })
    await new Promise(resolve => setTimeout(resolve, 5))
    const independent = readEntered
    release()
    await Promise.all([browser, read])
    assert(independent)
  })
  await scenario('shared-scheduling-ports-stay-transitively-pure', () => {
    const graph = join(fixture, 'graph')
    const file = (path: string, body: string) => {
      const target = join(graph, path), parent = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')))
      mkdirSync(parent, { recursive: true }); writeFileSync(target, body)
    }
    mkdirSync(join(graph, 'apps'), { recursive: true })
    for (const name of ['schemas', 'persisted-types', 'connection-normalize', 'source-validation']) file(`packages/shared/src/config/${name}.ts`, 'export const fixture = true')
    file('packages/shared/src/protocol/index.ts', 'export const fixture = true')
    file('packages/shared/src/agent/permissions-validation.ts', 'export const fixture = true')
    file('packages/shared/src/config/repository.ts', 'import { writeFileSync } from "node:fs"; const CONFIG_FILE = "config.json"; writeFileSync(CONFIG_FILE, "{}")')
    for (const name of ['agent-assembly', 'agent-product-context', 'agent-product-callbacks', 'source-resources', 'product-repository']) file(`packages/server-core/src/sessions/${name}.ts`, 'export const fixture = true')
    file('packages/shared/package.json', JSON.stringify({ name: '@phaneris/shared', exports: {
      './agent/mcp-tool-names': './src/agent/mcp-tool-names.ts', './agent/browser-tool-effects': './src/agent/browser-tool-effects.ts',
    } }))
    file('packages/pi-agent-server/package.json', JSON.stringify({ name: '@phaneris/pi-agent-server', dependencies: { '@phaneris/shared': 'workspace:*' } }))
    file('packages/shared/src/agent/mcp-tool-names.ts', 'export const fixture = true')
    file('packages/shared/src/agent/browser-tool-effects.ts', 'export { fixture } from "./browser-command-parser"')
    file('packages/shared/src/agent/browser-command-parser.ts', 'export const fixture = true')
    file('packages/pi-agent-server/src/scheduling.ts', 'import "@phaneris/shared/agent/mcp-tool-names"; import "@phaneris/shared/agent/browser-tool-effects"')
    const check = (name: string) => {
      const output = join(evidence.directory, name)
      const child = spawnSync(process.execPath, [join(import.meta.dir, '../check-governance-boundaries.ts'), `--repository=${graph}`, `--output=${output}`], { encoding: 'utf8', timeout: 30000 })
      return { code: child.status, report: JSON.parse(readFileSync(output, 'utf8')), stderr: child.stderr }
    }
    const clean = check('pure-ports-clean.json')
    assert.equal(clean.code, 0, clean.stderr)
    file('packages/shared/src/agent/browser-command-parser.ts', 'import "node:fs"; export const fixture = true')
    file('packages/shared/src/agent/mcp-tool-names.ts', 'import "node:fs"; export const fixture = true')
    const mutated = check('pure-ports-mutation.json')
    assert.equal(mutated.code, 1)
    for (const name of ['browser-tool-effects', 'mcp-tool-names']) assert(mutated.report.failures.some((failure: string) => failure.includes(name) && failure.includes('pure closure reaches node:fs')))
  })
  evidence.json('scenarios.json', { fixture, scope: 'Real registry and Guarded classification; isolated scheduling contracts', results })
  console.log(JSON.stringify({ output: evidence.directory, results }))
  assert.equal(results.filter(result => !result.passed).length, 0)
  evidence.complete(results.map(result => result.id), ['real provider APIs', 'native browser UI', 'cross-process resource locking'])
})
