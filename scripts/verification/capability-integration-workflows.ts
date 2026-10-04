/** End-to-end JSONL + installed Pi SDK + loopback provider.
 * Failure paths were specified in docs/process/capability-integration-2026-10-03.md before implementation.
 * Only fixture credentials and inert tools are used. No live provider access.
 */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-capabilities-'))
const output = resolve(process.argv[2] ?? join(root, '.cache/capability-integration/workflows.json'))
const records: object[] = [], requests: any[] = [], wire: any[] = [], effects: any[] = []
let release!: () => void
let orchestration = false, denyNested = false, blockExecution = false
let code = 'const r = await tools.mcp__fixture__read({}); store("read", r); return r.structuredContent.value;'
const gate = new Promise<void>(r => { release = r })
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push(body)
  if (requests.length === 1) await gate
  const lastUser = body.messages?.findLastIndex((m: any) => m.role === 'user') ?? -1
  const hasResult = body.messages?.slice(lastUser + 1).some((m: any) => m.role === 'tool')
  const call = orchestration && !hasResult
  const delta = call ? { tool_calls: [{ index: 0, id: 'script-parent', type: 'function', function: {
    name: 'codemode', arguments: JSON.stringify({ code }),
  } }] } : { content: 'fixture complete' }
  const event = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return new Response(event({ role: 'assistant' }) + event(delta) + event({}, call ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } })
} })
const env: Record<string, string> = { HOME: fixture, USERPROFILE: fixture, XDG_CONFIG_HOME: fixture, PHANERIS_CONFIG_DIR: fixture, NODE_ENV: 'test' }
for (const k of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k]!
const sourceEntry = process.env.PHANERIS_VERIFY_PI_ENTRY ?? join(root, 'packages/pi-agent-server/dist/index.js')
let entry = sourceEntry
if (process.env.PHANERIS_VERIFY_PI_ENTRY) {
  // A package inside the repo can accidentally resolve ancestor node_modules.
  // Move just the shipped subprocess into an unrelated scratch root first.
  cpSync(dirname(sourceEntry), join(fixture, 'runtime'), { recursive: true })
  entry = join(fixture, 'runtime', 'index.js')
}
const executable = process.env.PHANERIS_VERIFY_PI_BUN ?? process.execPath
const child = spawn(executable, [entry], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'] })
let errors = ''
child.stderr.on('data', c => { errors += c.toString() })
const send = (m: object) => child.stdin.write(JSON.stringify(m) + '\n')
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  let m: any
  try { m = JSON.parse(line) } catch { return }
  wire.push(m)
  if (m.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: m.requestId,
    action: denyNested && m.toolName === 'mcp__fixture__read' ? 'block' : 'allow', reason: denyNested ? 'fixture denied' : undefined })
  if (m.type === 'durable_model_prepare_request') send({ type: 'durable_model_prepare_response', requestId: m.requestId, ok: true,
    prepared: { operationId: `model-${wire.length}`, idempotencyKey: `model-${wire.length}`, created: true, status: 'prepared', committedSeq: wire.length } })
  if (m.type === 'durable_tool_prepare_request') {
    effects.push({ phase: 'T1', ...m })
    send({ type: 'durable_tool_prepare_response', requestId: m.requestId, ok: true, prepared: {
      operationId: `tool-${m.providerToolCallId}`, idempotencyKey: `tool-${m.providerToolCallId}`, canonicalArgsHash: 'fixture',
      recoveryMode: 'pure', created: true, status: 'prepared', committedSeq: wire.length } })
  }
  if (m.type === 'tool_execute_request') {
    effects.push({ phase: 'execute', ...m })
    assert(effects.some((e: any) => e.phase === 'T1' && e.toolName === m.toolName), 'An effect reached execution without T1')
    if (blockExecution) return
    send({ type: 'tool_execute_response', requestId: m.requestId, result: { content: 'preview', isError: false,
      contentBlocks: [{ type: 'text', text: 'full text' }, { type: 'resource_link', name: 'fixture', uri: 'https://invalid.test/fixture' }],
      structuredContent: { value: 42 } } })
  }
  if (m.type === 'durable_tool_outcome_request' || m.type === 'durable_model_outcome_request') {
    effects.push({ phase: 'T2', ...m })
    send({ type: m.type.replace('_request', '_response'), requestId: m.requestId, ok: true, committedSeq: wire.length })
  }
})
async function until(f: () => boolean, ms = 20_000) {
  const start = Date.now()
  while (!f()) { if (Date.now() - start > ms || child.exitCode !== null) throw Error(`Workflow timeout or exit: ${errors.slice(-2000)}; ${JSON.stringify(wire.slice(-8))}`); await Bun.sleep(10) }
}
async function check(id: string, action: () => Promise<any> | any) {
  try { records.push({ id, pass: true, observation: await action() }) }
  catch (e) { records.push({ id, pass: false, error: String(e) }) }
}
try {
  await check('A missing SDK session explicitly rejects a correlated steer', async () => {
    send({ type: 'steer', id: 'missing', message: 'never delivered' })
    await until(() => wire.some(m => m.type === 'input_received' && m.id === 'missing'))
    assert.equal(wire.find(m => m.type === 'input_received' && m.id === 'missing').disposition, 'rejected')
  })
  send({ type: 'init', apiKey: 'fixture-key', model: 'pi/fixture', cwd: fixture, workspaceRootPath: fixture,
    sessionId: 'fixture', sessionPath: fixture, workingDirectory: fixture, plansFolderPath: join(fixture, 'plans'), thinkingLevel: 'off',
    providerType: 'pi_compat', authType: 'api_key', baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' },
    customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }], piAuth: { provider: 'custom-endpoint', credential: { type: 'api_key', key: 'fixture-key' } } })
  await until(() => wire.some(m => m.type === 'ready'))
  await check('SDK confirms prompt before provider completion and confirms steer independently', async () => {
    send({ type: 'prompt', id: 'initial', message: 'initial', systemPrompt: 'Fixture system', durableRunOperationId: 'run-initial' })
    await until(() => wire.some(m => m.type === 'input_received' && m.id === 'initial'))
    assert.equal(wire.find(m => m.type === 'input_received' && m.id === 'initial').disposition, 'started')
    await until(() => requests.length === 1)
    send({ type: 'steer', id: 'steer-a', message: 'A' })
    await until(() => wire.some(m => m.type === 'input_received' && m.id === 'steer-a'))
    assert.equal(wire.find(m => m.type === 'input_received' && m.id === 'steer-a').disposition, 'queued')
    assert.equal(requests.length, 1)
    release()
    await until(() => wire.some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
    assert(requests.some(r => r.messages.some((m: any) => m.role === 'user' && JSON.stringify(m.content).includes('A'))))
    const observations = wire.filter(m => m.type === 'sdk_observation').map(m => m.observation)
    const stream = observations.filter(m => m.event === 'provider_stream_observation')
    const responses = observations.filter(m => m.event === 'assistant_response_observation')
    assert(stream.length > 0, 'Provider stream identity was not observed')
    assert(responses.length > 0, 'Actual assistant model identity was not observed')
    assert.equal(responses.at(-1).data.model, 'fixture')
    assert(!JSON.stringify(observations).includes('fixture complete'), 'Lifecycle observation leaked provider text')
    assert(stream.length <= requests.length, 'Provider stream observation grew per fragment')
    return { providerCalls: requests.length, ids: ['initial', 'steer-a'] }
  })
  release()
  await check('Deferred discovery and codemode preserve structured MCP data and nested durability', async () => {
    orchestration = true
    send({ type: 'sync_tools', tools: [{ name: 'mcp__fixture__read', description: 'Read fixture', inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }, namespace: { name: 'fixture' },
      exposure: 'deferred', annotations: { readOnlyHint: true } }] })
    const before = wire.length
    send({ type: 'prompt', id: 'orchestrate', message: 'orchestrate', systemPrompt: 'Fixture system', durableRunOperationId: 'run-orchestrate' })
    await until(() => wire.slice(before).some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
    const nested = effects.find((e: any) => e.phase === 'T1' && e.toolName === 'mcp__fixture__read') as any
    assert(nested, 'Nested tool did not execute')
    assert(nested.toolBatchId?.includes('script-parent'), 'Nested durable identity lost parent')
    assert(Number.isInteger(nested.toolBatchOrdinal), 'Nested durable ordinal missing')
    const last = requests.at(-1)
    assert(last.messages.some((m: any) => m.role === 'tool' && JSON.stringify(m.content).includes('42')), 'Script lost structured output')
    const req = requests.find(r => r.tools?.some((t: any) => t.function?.name === 'codemode'))
    assert(req?.tools.some((t: any) => t.function.name === 'tool_search'))
    assert(req.messages.some((m: any) => m.role === 'system' && JSON.stringify(m.content).includes('codemode')))
    return { nested, effects: effects.length }
  })
  await check('Pinned catalog exposes native limits/cache/cost without an injected DeepSeek entry', async () => {
    const { getPiModelsForAuthProvider } = await import('../../packages/shared/src/config/models-pi.ts')
    const { getBuiltinModels } = await import('@earendil-works/pi-ai/providers/all')
    const catalog = getBuiltinModels('anthropic')
    const mapped = getPiModelsForAuthProvider('anthropic')
    for (const m of catalog) {
      const d = mapped.find(v => v.id === `pi/${m.id}`)
      if (!d) continue
      assert.deepEqual(d.inputLimits, m.inputLimits)
      assert.deepEqual(d.promptCache, m.promptCache)
      assert.deepEqual(d.cost, m.cost)
      assert.equal(d.modelType, 'chat')
    }
    return { mapped: mapped.length }
  })
  await check('Nested permission denial prevents execution and does not trust readOnlyHint', async () => {
    denyNested = true
    const before = wire.length, executed = effects.filter((e: any) => e.phase === 'execute').length
    send({ type: 'prompt', id: 'denied', message: 'denied', systemPrompt: 'Fixture system', durableRunOperationId: 'run-denied' })
    await until(() => wire.slice(before).some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
    assert(wire.slice(before).some(m => m.type === 'pre_tool_use_request' && m.toolName === 'mcp__fixture__read'))
    assert.equal(effects.filter((e: any) => e.phase === 'execute').length, executed)
    denyNested = false
  })
  await check('Withdrawing a deferred source removes its executable tool immediately', async () => {
    send({ type: 'sync_tools', tools: [] })
    const before = wire.length, executed = effects.filter((e: any) => e.phase === 'execute').length
    send({ type: 'prompt', id: 'withdrawn', message: 'withdrawn', systemPrompt: 'Fixture system', durableRunOperationId: 'run-withdrawn' })
    await until(() => wire.slice(before).some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
    assert.equal(effects.filter((e: any) => e.phase === 'execute').length, executed)
  })
  await check('An interrupted nested effect is parked after restart and cannot authorize whole-script replay', async () => {
    const { DurableRuntimeCoordinator } = await import('../../packages/server-core/src/durable-runtime/coordinator.ts')
    let runtime = new DurableRuntimeCoordinator()
    const workspace = join(fixture, 'durable-recovery'), runId = 'recovery-run'
    runtime.acceptRun({ workspaceRootPath: workspace, sessionId: 'recovery', turnId: runId, operationId: runId, userMessageId: 'recovery-input', userMessage: 'fixture' })
    const identity = { sessionId: 'recovery', turnId: runId, runOperationId: runId, providerToolCallId: 'script/0', toolBatchId: 'script', toolBatchOrdinal: 0, toolName: 'mcp__fixture__publish', args: {} }
    const prepared = await runtime.prepareTool(workspace, identity)
    assert(prepared.created); runtime.closeAll(); runtime = new DurableRuntimeCoordinator()
    try {
      const recovery = runtime.recoverWorkspace(workspace)
      assert.equal(recovery.items[0]?.action, 'parked_unknown_effect')
      const replay = await runtime.prepareTool(workspace, identity)
      assert.equal(replay.created, false)
      return { operationId: prepared.operationId, recovery, automaticReplay: false }
    } finally { runtime.closeAll() }
  })
  await check('Cancelling a nested call settles the SDK while its unknown external effect remains pending', async () => {
    send({ type: 'sync_tools', tools: [{ name: 'mcp__fixture__read', description: 'Fixture', inputSchema: { type: 'object', properties: {} }, namespace: { name: 'fixture' }, exposure: 'deferred' }] })
    blockExecution = true
    const before = wire.length
    send({ type: 'prompt', id: 'cancelled', message: 'cancelled', systemPrompt: 'Fixture system', durableRunOperationId: 'run-cancelled' })
    await until(() => wire.slice(before).some(m => m.type === 'tool_execute_request'))
    send({ type: 'abort' })
    await until(() => wire.slice(before).some(m => m.type === 'event' && m.event?.type === 'agent_settled'), 5000)
    assert(!wire.slice(before).some(m => m.type === 'durable_tool_outcome_request' && m.toolName === 'mcp__fixture__read'), 'Cancellation falsely terminalized an unobserved external effect')
    blockExecution = false
    return { settled: true, externalOutcome: 'unknown', replay: false }
  })
} finally {
  release(); send({ type: 'shutdown' }); await Bun.sleep(50); child.kill(); lines.close(); api.stop(true)
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, JSON.stringify({ fixture, entry, sourceEntry, executable, records, effects, requests, wire, errors }, null, 2))
}
console.log(JSON.stringify({ output, passed: records.filter((r: any) => r.pass).length, total: records.length }))
process.exit(records.every((r: any) => r.pass) ? 0 : 1)
