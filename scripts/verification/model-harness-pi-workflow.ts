#!/usr/bin/env bun
/** Independent Host + real Pi child + real SQLite + loopback inference; no SessionManager. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runtimeBoundaryEvidence } from './runtime-boundary-evidence'
import { verificationWorkflow } from './verification-artifacts'
import type { PiAgent } from '../../packages/shared/src/agent/pi-agent'
await verificationWorkflow('model-harness-pi', async evidence => {
const repo = resolve(import.meta.dir, '../..')
const distribution = process.env.PHANERIS_VERIFY_PI_DISTRIBUTION
const moduleRoot = distribution ? resolve(distribution) : repo
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-harness-pi-'))
process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
process.env.NODE_ENV = 'test'
const workspace = join(fixture, 'workspace'), sessionId = 'harness-pi'
mkdirSync(join(workspace, 'sessions', sessionId), { recursive: true })
writeFileSync(join(workspace, 'evidence.txt'), 'INDEPENDENT_TOOL_EVIDENCE')
writeFileSync(join(workspace, 'unreceived-evidence.txt'), 'DELIVERY_REQUIRES_A_RESPONSE')
writeFileSync(join(workspace, 'long-evidence.txt'), Array.from({ length: 1500 }, (_, i) => `Line ${i}: ${'source evidence '.repeat(20)}`).join('\n'))
writeFileSync(join(workspace, 'plan.md'), '# Accepted scope\nProduce a research document.')
const requests: any[] = [], wire: any[] = [], events: any[] = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push(body)
  if (requests.length === 10) return Response.json({ error: { message: 'Fixture rejected the request before producing a response', type: 'invalid_request_error' } }, { status: 400 })
  const chunk = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: `boundary-${requests.length}`, object: 'chat.completion.chunk',
    created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
  const submit = requests.length === 3
  const discover = requests.length === 6
  const tool = (body.tools ?? []).find((t: any) => discover ? t.function?.name === 'tool_search' : submit ? t.function?.name.endsWith('__SubmitPlan') : /^read$/i.test(t.function?.name ?? ''))
  const invokeTool = requests.length <= 3 || requests.length === 5 || discover || requests.length === 9
  assert(!invokeTool || tool, 'Real Pi read tool is missing on the first turn')
  const calls = invokeTool ? [{ index: 0, id: `harness-tool-${requests.length}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(discover ? { query: 'pages' } : submit ? { planPath: join(workspace, 'plan.md') } : { path: join(workspace, requests.length === 9 ? 'unreceived-evidence.txt' : requests.length === 5 ? 'long-evidence.txt' : requests.length === 1 ? 'missing.txt' : 'evidence.txt') }) } }] : []
  if (requests.length === 5) calls.push({ ...calls[0]!, index: 1, id: 'harness-parallel-read' })
  const reply = invokeTool
    ? chunk({ tool_calls: calls }, 'tool_calls')
    : chunk({ content: 'INDEPENDENT_RUN_COMPLETE' }) + chunk({}, 'stop')
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
      baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback fixture', provider: 'pi', contextWindow: 64000, maxTokens: 4096 }] } },
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
  for (const id of ['first', 'second', 'third', 'fourth']) {
    const handle = runtime.execution.begin(scope)
    runtime.execution.accept(handle, { operationId: `run-${id}`, userMessageId: id, userMessage: `Read the evidence ${id}` })
    const result = await runtime.execution.drive(handle, driver, { message: `Read the evidence ${id}`, options: { inputId: id } })
    assert.equal(result.kind, 'terminal')
    if (id === 'first') { assert.equal(requests.length, 3, 'Plan submission must stop follow-up inference'); assert(acknowledged, 'Host must acknowledge before pause') }
    if (id === 'third') {
      const updateBrowser = agent.updateBrowserToolEnabled
      assert(updateBrowser)
      updateBrowser.call(agent, true); updateBrowser.call(agent, false)
    }
  }
  const facts = runtime.queries.events(workspace, { sessionId })
  assert.equal(facts.filter(e => e.type === 'tool_dispatch_committed').length, 6)
  assert.equal(facts.filter(e => e.type === 'tool_outcome_committed').length, 6)
  assert.equal(facts.filter(e => e.type === 'operation_terminal').length, 4)
  assert.ok(facts.some(e => e.type === 'usage_committed'))
  assert.ok(JSON.stringify(requests[2]).includes('INDEPENDENT_TOOL_EVIDENCE'))
  assert.ok(JSON.stringify(requests[3]).includes('Plan submitted for review'))
  assert.ok(events.some(e => e.type === 'text_complete'))
  const tools = requests.map(r => (r.tools ?? []).map((t: any) => t.function.name).sort())
  assert.deepEqual(tools[0], tools[4])
  assert(!tools[0]!.some((name: string) => name.endsWith('__list_pages')))
  assert(tools.at(-1)!.some((name: string) => name.endsWith('__list_pages')))
  assert(JSON.stringify(requests.at(-1).messages.filter((message: any) => ['system', 'developer'].includes(message.role))).includes('Pages are persistent'))
  const longResult = facts.filter(e => e.type === 'tool_outcome_committed').map(e => e.payload as any).find(p => p.result?.details?.phanerisResult?.source?.path?.endsWith('long-evidence.txt'))
  assert(longResult, 'Canonical outcome must retain typed read coverage')
  assert.equal(longResult.result.details.phanerisResult.coverage.kind, 'partial')
  const ranged = facts.filter(e => e.type === 'tool_outcome_committed').map(e => e.payload as any).filter(p => p.result?.details?.phanerisResult?.source?.path?.endsWith('long-evidence.txt'))
  assert.equal(ranged.length, 2)
  assert(ranged.every(p => JSON.stringify(p.result.content).length < 40000), 'Parallel results must respect the reserved text budget')
  assert(JSON.stringify(requests[5]).includes('offset='), 'Exact continuation must reach the next provider request')
  assert(!JSON.stringify(requests[5]).includes('[Large response (~'), 'Read must not undergo generic summarization')
  const failedDelivery = runtime.execution.begin(scope)
  runtime.execution.accept(failedDelivery, { operationId: 'run-failed-delivery', userMessageId: 'failed-delivery', userMessage: 'Read delivery evidence' })
  await runtime.execution.drive(failedDelivery, driver, { message: 'Read delivery evidence', options: { inputId: 'failed-delivery' } })
  assert.equal(requests.length, 10)
  assert.equal((agent as any).prerequisiteManager, undefined,
    'Original-read receipts must not be a second execution gate; failed provider requests retain ordinary runtime facts')
  const utility = await (agent as PiAgent).queryLlm({ prompt: 'UTILITY_ONLY_CONTEXT', systemPrompt: 'ISOLATED_UTILITY_CONTEXT', model: 'pi/fixture' })
  assert.equal(utility.text, 'INDEPENDENT_RUN_COMPLETE')
  assert.equal((requests[10].tools ?? []).length, 0, 'Utility requests must not inherit active main-session tools')
  assert(JSON.stringify(requests[10].messages).includes('ISOLATED_UTILITY_CONTEXT'))
  assert(!JSON.stringify(requests[10].messages).includes('Pages are persistent'))
  assert(!JSON.stringify(requests[10].messages).includes('INDEPENDENT_TOOL_EVIDENCE'))
  const resumed = runtime.execution.begin(scope)
  runtime.execution.accept(resumed, { operationId: 'run-after-utility', userMessageId: 'after-utility', userMessage: 'Continue the main task' })
  await runtime.execution.drive(resumed, driver, { message: 'Continue the main task', options: { inputId: 'after-utility' } })
  assert.equal(requests.length, 12)
  assert((requests[11].tools ?? []).some((tool: any) => tool.function.name.endsWith('__list_pages')))
  assert(!JSON.stringify(requests[11].messages).includes('ISOLATED_UTILITY_CONTEXT'))
  const finalFacts = runtime.queries.events(workspace, { sessionId })
  const utilityRun = finalFacts.find(event => event.type === 'model_dispatch_committed' && event.operationId.startsWith(`utility:${sessionId}:`))
  assert(utilityRun, 'Utility inference must have its own durable model dispatch')
  assert(finalFacts.some(event => event.type === 'usage_committed' && event.operationId === utilityRun.operationId), 'Utility usage must be accounted independently')
  const output = evidence.directory
  const backup = runtime.admin.backupDatabase(workspace, join(workspace, 'harness-pi-backup.db'))
  const db = join(output, 'harness-pi.db')
  writeFileSync(db, readFileSync(backup))
  const child = (agent as any).subprocess
  await runtime.close()
  assert.equal((agent as any).subprocess, null, 'Host close must release the real Pi subprocess')
  if (child) assert(child.exitCode !== null || child.signalCode, 'The retained Pi subprocess must exit before close returns')
  evidence.json('harness-pi.json', { schemaVersion: 1, generatedAt: new Date().toISOString(),
    ...runtimeBoundaryEvidence('bun run scripts/verification/model-harness-pi-workflow.ts', fixture), scope: 'Real Pi/SQLite/Host, deterministic loopback inference, no SessionManager', distribution: distribution ?? null,
    checks: ['real Pi failed read recovery', 'real read T1/T2', 'host-confirmed plan pause', 'accepted continuation', 'tool parity', 'canonical plan tool result', 'inner-loop capability guidance', 'activated tools survive rebuild', 'parallel result budget', 'failed provider request does not acknowledge reading', 'utility prompt tools and usage remain isolated'],
    providerCalls: requests.length, toolCalls: 7, tools, facts: finalFacts, wireTypes: wire.map(w => w.type),
    lifecycle: { closed: true, childPid: child?.pid, exitCode: child?.exitCode, signal: child?.signalCode },
    database: { path: db, sha256: createHash('sha256').update(readFileSync(db)).digest('hex') } })
  evidence.complete(['real Pi failed read recovery', 'real read T1/T2', 'host-confirmed plan pause', 'accepted continuation', 'tool parity', 'canonical plan tool result', 'inner-loop capability guidance', 'activated tools survive rebuild', 'parallel result budget', 'failed provider request does not acknowledge reading', 'utility prompt tools and usage remain isolated'],
    ['live provider APIs', 'native Windows/Linux execution', 'signed installer/release'])
  completed = true
  console.log(JSON.stringify({ passed: 11, output: join(output, 'harness-pi.json') }))
} finally {
  await runtime.close(); api.stop(true)
  if (!completed) evidence.json('harness-pi.json', { completed, fixture, providerCalls: requests.length, wireTypes: wire.map(w => w.type), events })
}
})
