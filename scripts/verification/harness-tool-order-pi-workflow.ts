#!/usr/bin/env bun
/** Independent Host + real Pi child + real SQLite + loopback inference; no SessionManager. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runtimeBoundaryEvidence } from './runtime-boundary-evidence'
import { verificationWorkflow } from './verification-artifacts'
await verificationWorkflow('harness-tool-order-pi', async evidence => {
const repo = resolve(import.meta.dir, '../..')
const distribution = process.env.PHANERIS_VERIFY_PI_DISTRIBUTION
const moduleRoot = distribution ? resolve(distribution) : repo
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-tool-order-pi-'))
process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
process.env.NODE_ENV = 'test'
const workspace = join(fixture, 'workspace'), sessionId = 'tool-order-pi'
mkdirSync(join(workspace, 'sessions', sessionId), { recursive: true })
const workspaceAlias = join(fixture, 'workspace-alias')
symlinkSync(workspace, workspaceAlias, 'junction')
writeFileSync(join(workspace, 'evidence.txt'), 'INDEPENDENT_TOOL_EVIDENCE')
writeFileSync(join(workspace, 'plan.md'), '# Accepted scope\nProduce a research document.')
const requests: any[] = [], wire: any[] = [], events: any[] = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push(body)
  const chunk = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: `boundary-${requests.length}`, object: 'chat.completion.chunk',
    created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
  // The fixture rejects orphaned tool results, as a strict provider would.
  const pending = new Set<string>()
  for (const message of body.messages ?? []) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) pending.add(call.id)
    if (message.role === 'tool') assert(pending.delete(message.tool_call_id), 'Orphaned tool result')
  }
  assert.equal(pending.size, 0, 'Provider context contains unfulfilled tool calls')
  const tool = (suffix: string) => {
    const found = (body.tools ?? []).find((t: any) => t.function?.name === suffix || t.function?.name.endsWith('__' + suffix))
    assert(found, 'Missing fixture tool: ' + suffix)
    return found.function.name
  }
  const call = (index: number, id: string, name: string, args: unknown) => ({ index, id, type: 'function', function: { name: tool(name), arguments: JSON.stringify(args) } })
  const calls = requests.length === 1
    ? [call(0, 'same-1', 'write', { path: 'same.txt', content: 'FIRST' }), call(1, 'same-2', 'write', { path: join(workspaceAlias, 'same.txt'), content: 'SECOND' })]
    : requests.length === 2
      ? [call(0, 'before-handoff', 'write', { path: join(workspace, 'before.txt'), content: 'SETTLED' }),
        call(1, 'handoff', 'SubmitPlan', { planPath: join(workspace, 'plan.md') }),
        call(2, 'must-not-run', 'write', { path: join(workspace, 'late.txt'), content: 'UNAUTHORIZED AFTER PAUSE' })]
      : []
  const reply = calls.length ? chunk({ tool_calls: calls }, 'tool_calls') : chunk({ content: 'ORDERING_VERIFIED' }) + chunk({}, 'stop')
  return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
const { assembleSessionAgent } = await import(join(moduleRoot, 'packages/server-core/src/sessions/agent-assembly.ts')) as typeof import('../../packages/server-core/src/sessions/agent-assembly')
const { createDurableRuntime } = await import(join(moduleRoot, 'packages/server-core/src/durable-runtime/index.ts')) as typeof import('../../packages/server-core/src/durable-runtime')
const { PiRuntimeDriver, bindPiRuntime } = await import(join(moduleRoot, 'packages/server-core/src/runtime-adapters/pi-driver.ts')) as typeof import('../../packages/server-core/src/runtime-adapters/pi-driver')
const runtime = createDurableRuntime()
const scope = { sessionId, workspaceRootPath: workspace }
const agent = assembleSessionAgent({
  context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
    connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
      baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback fixture', provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
  hostRuntime: { appRootPath: moduleRoot, isPackaged: !!distribution, resourcesPath: distribution ? join(moduleRoot, 'resources') : undefined, nodeRuntimePath: distribution ? join(moduleRoot, 'vendor/bun/bun') : process.execPath },
  config: { model: 'pi/fixture', miniModel: 'pi/fixture',
  workspace: { id: 'independent', slug: 'independent', createdAt: 1, name: 'Independent runtime fixture', rootPath: workspace },
  session: { id: sessionId, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, isHeadless: true,
  envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, HOME: fixture, USERPROFILE: fixture, NODE_ENV: 'test' },
  },
  callbacks: {}, resources: bindPiRuntime(runtime, scope),
})
const original = (agent as any).handleLine.bind(agent)
;(agent as any).handleLine = (line: string) => { try { wire.push(JSON.parse(line)) } catch {} return original(line) }
agent.setPermissionMode('allow-all')
let acknowledged = false
agent.onPlanSubmitted = async path => {
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.match(readFileSync(path, 'utf8'), /Produce a research document/)
  acknowledged = true
}
let completed = false
try {
  runtime.execution.subscribe(sessionId, { event: event => { events.push(event) } })
  const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
  for (const id of ['first', 'second']) {
    const handle = runtime.execution.begin(scope)
    runtime.execution.accept(handle, { operationId: `run-${id}`, userMessageId: id, userMessage: `Verify tool ordering ${id}` })
    const result = await runtime.execution.drive(handle, driver, { message: `Verify tool ordering ${id}`, options: { inputId: id } })
    assert.equal(result.kind, 'terminal')
    if (id === 'first') { assert.equal(requests.length, 2, 'Plan submission must stop follow-up inference'); assert(acknowledged, 'Host must acknowledge before pause') }
  }
  const facts = runtime.queries.events(workspace, { sessionId })
  assert.equal(facts.filter(e => e.type === 'tool_dispatch_committed').length, 4)
  assert.equal(facts.filter(e => e.type === 'tool_outcome_committed').length, 4)
  assert.equal(facts.filter(e => e.type === 'operation_terminal').length, 2)
  assert.ok(facts.some(e => e.type === 'usage_committed'))
  assert.equal(readFileSync(join(workspace, 'same.txt'), 'utf8'), 'SECOND')
  assert.equal(readFileSync(join(workspace, 'before.txt'), 'utf8'), 'SETTLED')
  assert.equal(existsSync(join(workspace, 'late.txt')), false)
  const boundary = (type: string, id: string) => facts.find(e => e.type === type && (e.payload as any).providerToolCallId === id)!.seq!
  assert(boundary('tool_outcome_committed', 'same-1') < boundary('tool_dispatch_committed', 'same-2'), 'Same-file T2 must precede the next T1')
  assert(boundary('tool_outcome_committed', 'before-handoff') < boundary('tool_dispatch_committed', 'handoff'))
  assert(!facts.some(e => (e.payload as any).providerToolCallId === 'must-not-run'), 'Unstarted post-handoff calls must not cross T1')
  assert.ok(JSON.stringify(requests[2]).includes('Plan submitted for review'))
  assert.ok(events.some(e => e.type === 'text_complete'))
  const tools = requests.map(r => (r.tools ?? []).map((t: any) => t.function.name).sort())
  assert.deepEqual(tools[0], tools.at(-1))
  const output = evidence.directory
  const backup = runtime.admin.backupDatabase(workspace, join(workspace, 'tool-order-pi-backup.db'))
  const db = join(output, 'tool-order-pi.db')
  writeFileSync(db, readFileSync(backup))
  const child = (agent as any).subprocess
  await runtime.close()
  assert.equal((agent as any).subprocess, null, 'Host close must release the real Pi subprocess')
  if (child) assert(child.exitCode !== null || child.signalCode, 'The retained Pi subprocess must exit before close returns')
  evidence.json('tool-order-pi.json', { schemaVersion: 1, generatedAt: new Date().toISOString(),
    ...runtimeBoundaryEvidence('bun run scripts/verification/harness-tool-order-pi-workflow.ts', fixture), scope: 'Real Pi/SQLite/Host, deterministic loopback inference, no SessionManager', distribution: distribution ?? null,
    checks: ['same-file T1/T2 ordering', 'last ordered write wins', 'prior effect settles before handoff', 'no post-handoff dispatch', 'strict provider continuation', 'tool parity'],
    providerCalls: requests.length, toolCalls: 4, tools, facts, wireTypes: wire.map(w => w.type),
    lifecycle: { closed: true, childPid: child?.pid, exitCode: child?.exitCode, signal: child?.signalCode },
    database: { path: db, sha256: createHash('sha256').update(readFileSync(db)).digest('hex') } })
  evidence.complete(['same-file T1/T2 ordering', 'last ordered write wins', 'prior effect settles before handoff', 'no post-handoff dispatch', 'strict provider continuation', 'tool parity'],
    ['live provider APIs', 'native Windows/Linux execution', 'signed installer/release'])
  completed = true
  console.log(JSON.stringify({ passed: 6, output: join(output, 'tool-order-pi.json') }))
} finally {
  await runtime.close(); api.stop(true)
  if (!completed) evidence.json('tool-order-pi.json', { completed, fixture, providerCalls: requests.length, wireTypes: wire.map(w => w.type), events })
}
})
