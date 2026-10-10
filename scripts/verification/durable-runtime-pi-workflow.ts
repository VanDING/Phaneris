#!/usr/bin/env bun
/** Independent Host + real Pi child + real SQLite + loopback inference; no SessionManager. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runtimeBoundaryEvidence } from './runtime-boundary-evidence'
const repo = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-independent-pi-'))
process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
process.env.NODE_ENV = 'test'
const workspace = join(fixture, 'workspace'), sessionId = 'independent-pi'
mkdirSync(join(workspace, 'sessions', sessionId), { recursive: true })
writeFileSync(join(workspace, 'evidence.txt'), 'INDEPENDENT_TOOL_EVIDENCE')
const requests: any[] = [], wire: any[] = [], events: any[] = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push(body)
  const chunk = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: `boundary-${requests.length}`, object: 'chat.completion.chunk',
    created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
  const tool = (body.tools ?? []).find((t: any) => /^read$/i.test(t.function?.name ?? ''))
  const invokeTool = requests.length === 1
  assert(!invokeTool || tool, 'Real Pi read tool is missing on the first turn')
  const reply = invokeTool
    ? chunk({ tool_calls: [{ index: 0, id: 'boundary-read', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ path: join(workspace, 'evidence.txt') }) } }] }, 'tool_calls')
    : chunk({ content: 'INDEPENDENT_RUN_COMPLETE' }) + chunk({}, 'stop')
  return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
const runtime = createDurableRuntime()
const scope = { sessionId, workspaceRootPath: workspace }
const agent = new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture',
  workspace: { id: 'independent', name: 'Independent runtime fixture', rootPath: workspace },
  session: { id: sessionId, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, isHeadless: true,
  runtime: { paths: { piServer: join(repo, 'packages/pi-agent-server/dist/index.js'), node: process.execPath },
    baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
  envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, HOME: fixture, USERPROFILE: fixture, NODE_ENV: 'test' },
  ...bindPiRuntime(runtime, scope),
})
const original = (agent as any).handleLine.bind(agent)
;(agent as any).handleLine = (line: string) => { try { wire.push(JSON.parse(line)) } catch {} return original(line) }
try {
  runtime.execution.subscribe(sessionId, { event: event => { events.push(event) } })
  const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
  for (const id of ['first', 'second']) {
    const handle = runtime.execution.begin(scope)
    runtime.execution.accept(handle, { operationId: `run-${id}`, userMessageId: id, userMessage: `Read the evidence ${id}` })
    const result = await runtime.execution.drive(handle, driver, { message: `Read the evidence ${id}`, options: { inputId: id } })
    assert.equal(result.kind, 'terminal')
  }
  const facts = runtime.queries.events(workspace, { sessionId })
  assert.equal(facts.filter(e => e.type === 'tool_dispatch_committed').length, 1)
  assert.equal(facts.filter(e => e.type === 'tool_outcome_committed').length, 1)
  assert.equal(facts.filter(e => e.type === 'operation_terminal').length, 2)
  assert.ok(facts.some(e => e.type === 'usage_committed'))
  assert.ok(JSON.stringify(requests[1]).includes('INDEPENDENT_TOOL_EVIDENCE'))
  assert.ok(events.some(e => e.type === 'text_complete'))
  const tools = requests.map(r => (r.tools ?? []).map((t: any) => t.function.name).sort())
  assert.deepEqual(tools[0], tools.at(-1))
  const output = join(repo, 'docs/verification/results/durable-runtime-boundary')
  mkdirSync(output, { recursive: true })
  const backup = runtime.admin.backupDatabase(workspace, join(workspace, 'independent-pi-backup.db'))
  const db = join(output, 'independent-pi.db')
  writeFileSync(db, readFileSync(backup))
  const child = (agent as any).subprocess
  await runtime.close()
  assert.equal((agent as any).subprocess, null, 'Host close must release the real Pi subprocess')
  if (child) assert(child.exitCode !== null || child.signalCode, 'The retained Pi subprocess must exit before close returns')
  writeFileSync(join(output, 'independent-pi.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixture,
    ...runtimeBoundaryEvidence('bun run scripts/verification/durable-runtime-pi-workflow.ts', fixture), scope: 'Real Pi/SQLite/Host, deterministic loopback inference, no SessionManager',
    checks: ['independent execution', 'real read effect T1/T2', 'usage', 'two terminal turns', 'first-turn tool parity', 'canonical tool context'],
    providerCalls: requests.length, toolCalls: 1, tools, facts, wireTypes: wire.map(w => w.type),
    lifecycle: { closed: true, childPid: child?.pid, exitCode: child?.exitCode, signal: child?.signalCode },
    database: { path: db, sha256: createHash('sha256').update(readFileSync(db)).digest('hex') } }, null, 2) + '\n')
  console.log(JSON.stringify({ passed: 6, output: join(output, 'independent-pi.json') }))
} finally { await runtime.close(); api.stop(true) }
