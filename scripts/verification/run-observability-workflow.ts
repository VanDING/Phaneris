/** See the failure matrix written before implementation. No user credentials or sessions. */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..'), temporary = mkdtempSync(join(tmpdir(), 'phaneris-run-observability-'))
const configRoot = join(temporary, 'config'), workspaceRoot = join(temporary, 'workspace')
const output = join(root, '.cache/run-observability/evidence')
mkdirSync(output, { recursive: true }); mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot; process.env.NODE_ENV = 'test'
const checks: Array<{ id: string; pass: boolean; evidence?: unknown; error?: string }> = []
async function check(id: string, action: () => unknown | Promise<unknown>) {
  try { checks.push({ id, pass: true, evidence: await action() }) }
  catch (error) { checks.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }); console.error(checks.at(-1)?.error) }
  console.log(`${checks.at(-1)!.pass ? 'PASS' : 'FAIL'} ${id}`)
}
let modelMode = 'text', modelRequests = 0, fee: unknown = 0, bodyDelay = 0, failedDecision = false
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.endsWith('/systemone')) {
    const body = await request.json() as { model: string; questions: Record<string, unknown> }
    const answer = { id: 'gen-observability', model: body.model,
      answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { noul: .9 }])),
      usage: { input_tokens: 7, output_tokens: 3, ...(fee !== undefined ? { cost: fee } : {}) } }
    const stream = new ReadableStream<Uint8Array>({ async start(controller) {
      if (bodyDelay) await Bun.sleep(bodyDelay)
      controller.enqueue(new TextEncoder().encode(failedDecision ? '{"error":"private text must not persist"}' : JSON.stringify(answer)))
      controller.close()
    } })
    return new Response(stream, { status: failedDecision ? 503 : 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'decision-header-id' } })
  }
  const mode = modelMode, seq = ++modelRequests
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({ async start(controller) {
    const send = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: `model-response-${seq}`, object: 'chat.completion.chunk', created: 1,
      model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`))
    send({ role: 'assistant', content: '' }); await Bun.sleep(25)
    if (mode === 'thinking') send({ reasoning_content: 'Checking evidence' })
    else if (mode === 'tool') send({ tool_calls: [{ index: 0, id: `call-${seq}`, type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] })
    else send({ content: 'Checked ' })
    await Bun.sleep(35)
    if (mode === 'thinking') send({ reasoning_content: ' carefully.' })
    else if (mode === 'tool') send({ tool_calls: [{ index: 0, function: { arguments: '"fixture.txt"}' } }] })
    else send({ content: 'the evidence.' })
    await Bun.sleep(25)
    send({}, mode === 'tool' ? 'tool_calls' : 'stop', { prompt_tokens: 1000 + seq * 400, completion_tokens: mode === 'missing-usage' ? 0 : seq % 4 + 3,
      total_tokens: 1006 + seq * 400, prompt_tokens_details: { cached_tokens: 500 } })
    controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close()
  } })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': `native-${seq}` } })
} })
const workspace = { id: 'fixture', name: 'Acceptance', rootPath: workspaceRoot, createdAt: Date.now() }
writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'fixture',
  decisionLayer: { enabled: true, provider: 'openrouter', baseUrl: api.url.href, model: 'inception/mercury-decide:free', deadlineMs: 500,
    features: { suggestions: true, smartTitles: true } } }))
const sdk = await import('@earendil-works/pi-ai')
const { streamSimple } = await import('@earendil-works/pi-ai/compat')
const { wrapDurableModelStream } = await import('../../packages/pi-agent-server/src/durable-model-stream.ts')
const { prepareRequestDiagnostics } = await import('../../packages/pi-agent-server/src/request-diagnostics.ts')
const { createSessionEventAdapter } = await import('../../packages/pi-agent-server/src/session-event-adapter.ts')
const { PiEventAdapter } = await import('../../packages/shared/src/agent/backend/pi/event-adapter.ts')
const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime/index.ts')
const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager.ts')
const storage = await import('../../packages/shared/src/sessions/storage.ts')
const decisions = await import('../../packages/shared/src/decisions/index.ts')
const points = await import('../../packages/server-core/src/decisions/decision-point.ts')
const { WsRpcServer } = await import('../../packages/server-core/src/transport/server.ts')
const { WsRpcClient } = await import('../../packages/server-core/src/transport/client.ts')
const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions.ts')
const { registerDecisionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/decisions.ts')
const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol/channels.ts')
const { readAssistantTiming } = await import('../../packages/core/src/utils/assistant-timing.ts')
const { buildTrajectorySnapshot } = await import('../../packages/ui/src/components/trajectory/trajectory-snapshot.ts')
const { deriveTrajectoryLayout, flattenTurnRecords } = await import('../../packages/ui/src/components/trajectory/trajectory-layout.ts')
const { deriveTrajectoryPerformance } = await import('../../packages/ui/src/components/trajectory/trajectory-performance.ts')
const runtime = createDurableRuntime(), manager = new SessionManager(runtime) as any
manager.eventSink = () => {}
async function session(name: string) {
  const stored = await storage.createSession(workspaceRoot, { name })
  const managed = createManagedSession(stored, workspace as never, { messagesLoaded: true }) as any
  manager.registerManagedSession(managed); return managed
}
const main = await session('Controlled provider acceptance'), legacy = await session('Historical format acceptance'), empty = await session('Empty acceptance')
const large = await session('Replayed controlled metrics · 1001 requests')
const run = runtime.execution.begin({ workspaceRootPath: workspaceRoot, sessionId: main.id })
runtime.execution.accept(run, { operationId: 'observability-run', userMessageId: 'source-user', userMessage: 'Inspect the recorded AI behavior.' })
main.messages.push({ id: 'source-user', role: 'user', content: 'Inspect the recorded AI behavior.', timestamp: Date.now(), turnId: 'source-turn' })
const native = new PiEventAdapter(), queued: any[] = []
const forward = createSessionEventAdapter({ currentSession: () => null, send: message => {
  if (message.type === 'event') queued.push(JSON.parse(JSON.stringify(message.event)))
}, debugLog: () => {}, observeSdkLifecycle: () => {}, lengthContinuationTracker: {} as never,
  accounting: {} as never, diagnostics: {} as never, prefetch: () => {}, settled: () => {} })
const model = { id: 'fixture-model', name: 'Fixture model', api: 'openai-completions', provider: 'openai', baseUrl: `${api.url.origin}/v1`,
  reasoning: true, input: ['text'], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Parameters<typeof streamSimple>[0]
let ordinal = 0, commitDelay = 0
const diagnostics = new Map<number, ReturnType<typeof prepareRequestDiagnostics>>()
const stream = wrapDurableModelStream(streamSimple, async (actualModel, _context, observation) => {
  diagnostics.set(ordinal + 1, prepareRequestDiagnostics(actualModel, _context))
  const requestId = String(++ordinal), identity = { sessionId: main.id, runOperationId: 'observability-run', turnId: 'source-turn',
    providerRequestId: requestId, provider: actualModel.provider, model: actualModel.id, canonicalRequestHash: `request-${requestId}` }
  const prepared = await runtime.effects.prepareModel(workspaceRoot, identity)
  return async message => {
    if (commitDelay) await Bun.sleep(commitDelay)
    const metrics = (message as any).assistantMetrics
    const committed = await runtime.effects.commitModelOutcome(workspaceRoot, { ...identity, operationId: prepared.operationId, stopReason: message.stopReason,
      responseId: message.responseId, requestObservation: observation, content: message.content,
      usage: { inputTokens: message.usage.input, outputTokens: message.usage.output, costUsd: message.usage.cost.total,
        payload: { kind: 'model_attempt', usage: message.usage, requestSeq: ordinal, assistantMetrics: metrics } } })
    Object.assign(message, { durableOperationId: prepared.operationId, durableSeq: committed.committedSeq, durableRequestSeq: ordinal })
  }
})
async function modelCall(mode: string) {
  modelMode = mode; native.startTurn('source-turn')
  const source = await stream(model, sdk.normalizeContext({ systemPrompt: 'Observe controlled responses.',
    tools: [{ name: 'read_file', description: 'Read controlled fixture evidence.', parameters: sdk.Type.Object({ path: sdk.Type.String() }) }],
    messages: [{ role: 'user', content: 'Inspect evidence.', timestamp: Date.now() }] }), { apiKey: 'fixture-only', maxRetries: 0 })
  let result: any
  for await (const event of source) {
    if (event.type === 'start') forward({ type: 'message_start', message: event.partial } as never)
    else if (event.type === 'done' || event.type === 'error') {
      result = event.type === 'done' ? event.message : event.error
      const diagnostic = diagnostics.get(result.durableRequestSeq)
      forward({ type: 'message_end', message: result, requestSeq: result.durableRequestSeq,
        durableOperationId: result.durableOperationId, durableSeq: result.durableSeq,
        promptSnapshot: diagnostic?.systemPrompt, contextSnapshot: diagnostic?.contextSnapshot } as never)
    } else forward({ type: 'message_update', message: event.partial, assistantMessageEvent: event } as never)
    while (queued.length) for (const product of native.adaptEvent(queued.shift())) await manager.processEvent(main, product)
  }
  return result
}
const rpc = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async token => token === 'fixture-token' })
let client: InstanceType<typeof WsRpcClient> | undefined
try {
  await check('R01/R08 actual SSE → wrapper → JSON transport → host persistence', async () => {
    const message = await modelCall('text'), metrics = message.assistantMetrics
    assert.equal(metrics.timingVersion, 2); assert(metrics.firstOutputTime >= metrics.stepStartTime)
    assert(metrics.completedTime > message.timestamp); assert(metrics.generationDurationMs > 0)
    assert(readAssistantTiming(metrics).tokensPerSecond! > 0)
    assert.equal(main.messages.at(-1).assistantMetrics.timingSource, 'pi_provider_callbacks')
    return metrics
  })
  for (const mode of ['thinking', 'tool']) await check(`R02 ${mode}-only stream has first output but no first text`, async () => {
    const metrics = (await modelCall(mode)).assistantMetrics
    assert.equal(metrics.firstTextTime, null); assert.equal(metrics.firstTextLatencyMs, null)
    const values = readAssistantTiming(metrics)
    assert(values.ttftMs! > 0)
    if (metrics.generationDurationMs < 1) assert.equal(values.rateUnavailableReason, 'generation_unavailable')
    else assert(values.tokensPerSecond! > 0)
    return metrics
  })
  await check('R06 valid latency remains measurable when output usage is missing', async () => {
    const value = readAssistantTiming((await modelCall('missing-usage')).assistantMetrics)
    assert(value.ttftMs! > 0); assert.equal(value.tokensPerSecond, null); assert.equal(value.rateUnavailableReason, 'usage_missing')
    return value
  })
  await check('R07 slow durable commit does not enter generation duration', async () => {
    commitDelay = 180
    const start = performance.now(), message = await modelCall('text'), elapsed = performance.now() - start
    commitDelay = 0
    assert(elapsed - message.assistantMetrics.requestDurationMs >= 150)
    return { elapsed, measured: message.assistantMetrics.requestDurationMs }
  })
  await check('R03/R04/R05/R06 boundary streams stay explicitly unavailable', async () => {
    const cases = ['missing-start', 'empty', 'multiple', 'error', 'abort']
    const evidence: unknown[] = []
    for (const mode of cases) {
      const wrapped = wrapDurableModelStream(async (actualModel, _context, options) => {
        if (mode !== 'missing-start') await options?.onPayload?.({}, actualModel)
        if (mode === 'multiple') await options?.onPayload?.({}, actualModel)
        const message: any = { role: 'assistant', provider: 'openai', api: model.api, model: model.id, content: [], timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: mode === 'error' ? 'error' : mode === 'abort' ? 'aborted' : 'stop' }
        const events = sdk.createAssistantMessageEventStream()
        if (mode !== 'empty') events.push({ type: 'text_delta', contentIndex: 0, delta: 'output', partial: message })
        events.push(mode === 'error' || mode === 'abort' ? { type: 'error', reason: message.stopReason, error: message } : { type: 'done', reason: 'stop', message })
        return events
      }, async () => async () => {})
      const result: any = await (await wrapped(model, sdk.normalizeContext({ messages: [] }), {})).result(), values = readAssistantTiming(result.assistantMetrics)
      assert.equal(values.ttftMs, null); assert.equal(values.tokensPerSecond, null)
      evidence.push({ mode, reason: values.unavailableReason })
    }
    return evidence
  })
  for (let index = 0; index < 18; index++) await modelCall(index % 5 === 0 ? 'tool' : 'text')
  const seed = main.messages.find((message: any) => message.assistantMetrics?.timingVersion === 2)
  const oldMetrics = { timingRecorded: true, stepStartTime: 1000, firstTokenTime: 2000, completedTime: 1000, usageProvided: true, outputTokens: 5 }
  legacy.messages.push({ id: 'legacy-user', role: 'user', content: 'Review historical evidence.', turnId: 'legacy-turn', timestamp: 1000 },
    { ...seed, id: 'legacy-assistant', timestamp: 1001, turnId: 'legacy-turn', requestSeq: 1, assistantMetrics: oldMetrics,
      contextSnapshot: { version: 1, system: { chars: 100 } } })
  main.messages.splice(1, 0, { ...seed, id: 'mixed-legacy', requestSeq: 1,
    assistantMetrics: { ...oldMetrics, firstTokenTime: null }, timestamp: seed.timestamp - 1 })
  main.messages.push({ id: 'late-tool-error', role: 'tool', content: 'Controlled late failure', toolName: 'read_file', toolUseId: 'late-error',
    toolResult: 'Fixture failure', isError: true, toolDuration: 2000, timestamp: Date.now(), turnId: 'source-turn' })
  large.messages.push({ id: 'large-user', role: 'user', content: 'Replay captured metrics to verify long-history rendering.', timestamp: seed.timestamp, turnId: 'large-turn' })
  for (let index = 0; index < 1001; index++) {
    const metrics = { ...seed.assistantMetrics }
    if (index === 503) metrics.generationDurationMs = null
    if (index === 900) {
      metrics.generationDurationMs *= 100
      metrics.requestDurationMs = metrics.firstOutputLatencyMs + metrics.generationDurationMs
    }
    large.messages.push({ ...seed, id: `large-${index}`, durableOperationId: undefined, durableSeq: undefined,
      timestamp: seed.timestamp + index, turnId: 'large-turn', requestSeq: index + 1, assistantMetrics: metrics })
  }
  manager.persistSession(main)
  manager.persistSession(legacy)
  manager.persistSession(large)
  await manager.flushSession(main.id)
  await manager.flushSession(legacy.id)
  await manager.flushSession(large.id)
  await runtime.execution.finish(run, 'complete')
  await check('R08 save/reload preserves metrics and matches durable evidence', async () => {
    const saved = storage.loadSession(workspaceRoot, main.id) as any
    assert(saved); assert.equal(saved.messages.filter((message: any) => message.assistantMetrics?.timingVersion === 2).length, ordinal)
    const rows = runtime.queries.usage(workspaceRoot, { sessionId: main.id })
    assert.equal(rows.length, ordinal); assert(rows.every(row => (row.payload as any).assistantMetrics?.timingVersion === 2))
    return { requests: ordinal, durableRows: rows.length }
  })
  const decisionRequest = { state: 'Controlled decision evidence.', questions: { yes: { type: 'noul' as const, instructions: 'Yes or no' } } }
  const point = (await points.openDecisionPoint({ sessionId: main.id, feature: 'suggestions', record: 'suggestions', source: { turnId: 'source-turn' },
    resolveClient: options => decisions.resolveDecisionClient({ ...options, apiKeyOverride: 'fixture-only' }) }))!
  assert(point)
  await check('R10/R14 explicit OpenRouter zero survives accounting and records', async () => {
    fee = 0; const result = await point(decisionRequest)
    assert(result); assert.equal(result.usage.costUsd, 0); assert.equal(result.usage.costField, 'usage.cost')
    assert.equal(result.usage.costSource, 'provider_reported'); assert.equal(result.responseId, 'gen-observability')
    return result
  })
  await check('R10 absent and invalid amounts remain unknown', async () => {
    for (const value of [undefined, -1, '0']) {
      fee = value; const result = await point(decisionRequest)
      assert(result); assert.equal(result.usage.costUsd, undefined); assert.equal(result.usage.costSource, 'unknown')
    }
  })
  await check('R11 the established cost_usd gateway field is preserved', async () => {
    const response = decisions.parseSystemOneResponse({ answers: { yes: { noul: .8 } }, usage: { cost_usd: .12, cost: 99 } }, decisionRequest.questions)
    assert.equal(response.usage.costUsd, .12)
  })
  await check('R12 complete response latency includes delayed body', async () => {
    fee = .002; bodyDelay = 120; const result = await point(decisionRequest); bodyDelay = 0
    assert(result); assert(result.latencyMs >= 100); assert.equal(result.latencyScope, 'response_body')
    return { measured: result.latencyMs }
  })
  await check('R12/R13 body deadline causes timeout without a fabricated free charge', async () => {
    fee = 0; bodyDelay = 450; const result = await point({ ...decisionRequest, deadlineMs: 250 }); bodyDelay = 0
    assert.equal(result, null)
  })
  failedDecision = true; await point(decisionRequest); failedDecision = false
  await decisions.getDecisionRecorder().append({ t: new Date().toISOString(), feature: 'smart_titles', provider: 'openrouter', model: 'inception/mercury-decide:free',
    ok: false, questions: {}, state: null, error: { kind: 'timeout', message: 'Historical timeout' }, sessionId: legacy.id })
  await decisions.getDecisionRecorder().flush()
  registerSessionsHandlers(rpc, { sessionManager: manager, platform: { logger: { log: () => {}, info: () => {}, error: () => {}, warn: () => {} } } } as never)
  registerDecisionsHandlers(rpc, { sessionManager: manager } as never)
  manager.eventSink = (channel: string, target: any, ...args: any[]) => rpc.push(channel, target, ...args)
  await rpc.listen()
  client = new WsRpcClient(`ws://127.0.0.1:${rpc.port}`, { mode: 'remote', workspaceId: 'fixture', token: 'fixture-token', autoReconnect: false })
  client.connect()
  await check('R14 authenticated RPC retains zero, provenance and failed-call diagnostics', async () => {
    const report = await client!.invoke(RPC_CHANNELS.decisions.GET_SESSION, main.id)
    assert.equal(report.totals.knownCostRequests, 2)
    const attempts = report.items.flatMap(item => item.attempts)
    const zero = attempts.find(attempt => attempt.costUsd === 0)!
    assert(zero); assert.equal(zero.costSource, 'provider_reported'); assert.equal(zero.responseId, 'gen-observability')
    const timeout = attempts.find(attempt => attempt.status === 'timeout')!
    assert(timeout); assert.equal(timeout.costUsd, undefined); assert.equal(timeout.costUnavailableReason, 'request_failed')
    assert.equal(timeout.deadlineMs, 250); assert(timeout.latencyMs! >= 200); assert.equal(timeout.latencyScope, 'request_failure')
    writeFileSync(join(output, 'decision-rpc.json'), JSON.stringify(report, null, 2)); return report.totals
  })
  await check('R15 historical call evidence remains distinct from behavior grouping through RPC', async () => {
    const report = await client!.invoke(RPC_CHANNELS.decisions.GET_SESSION, legacy.id)
    writeFileSync(join(output, 'historical-decision-rpc.json'), JSON.stringify(report, null, 2))
    assert.equal(report.totals.legacyCalls, 1); assert.equal(report.totals.points, 0)
    return report.totals
  })
  await check('R09 mixed legacy samples are excluded and the weighted rate is reproducible', async () => {
    const snapshot = buildTrajectorySnapshot({ messages: main.messages })
    const records = flattenTurnRecords(deriveTrajectoryLayout(snapshot))
    const summary = deriveTrajectoryPerformance(snapshot, records)
    assert.equal(summary.legacyCount, 1); assert.equal(summary.ttftCount, ordinal)
    assert.equal(summary.rateCount, main.messages.filter((message: any) => readAssistantTiming(message.assistantMetrics).tokensPerSecond !== null).length)
    const measured = summary.requests.filter(request => request.timing.tokensPerSecond !== null)
    const expected = measured.reduce((sum, request) => sum + request.outputTokens!, 0)
      / measured.reduce((sum, request) => sum + request.timing.generationMs! / 1000, 0)
    assert.equal(summary.averageRate, expected)
    writeFileSync(join(output, 'request-statistics.json'), JSON.stringify(summary, null, 2)); return { p50: summary.p50, p95: summary.p95, rate: summary.averageRate }
  })
  // The Run panel UI (Overview / Context / Decision) is redesigned and now
  // verified end to end by scripts/verification/run-redesign-workflow.ts. This
  // workflow keeps the data-layer facts: renderer UI selectors from the earlier
  // panel are intentionally not asserted here anymore.
} finally {
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), fixture: temporary, checks }, null, 2))
  client?.destroy(); await rpc.close(); api.stop(true)
  await manager.cleanup()
}
if (checks.some(check => !check.pass)) process.exitCode = 1
console.log(`${checks.filter(check => check.pass).length}/${checks.length} observability checks passed; evidence: ${output}`)