/** Diagnostic only: real Pi/Host/SQLite + controlled SSE. Never calls a live provider. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('conversation-startup-diagnostic', async evidence => {
  const repo = resolve(import.meta.dir, '../..'), workspace = join(evidence.directory, 'workspace'), id = 'startup-diagnostic'
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config')
  process.env.NODE_ENV = 'test'
  mkdirSync(join(workspace, 'sessions', id), { recursive: true })
  const requests: any[] = [], chunks: any[] = [], hostEvents: any[] = [], wire: any[] = [], debug: string[] = [], clientEvents: any[] = []
  let holdStream = false
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json() as any, ordinal = requests.length + 1
    requests.push({ at: Date.now(), ordinal,
      headers: Object.fromEntries(['user-agent', 'x-opencode-session', 'session_id', 'x-session-affinity', 'x-client-request-id'].map(key => [key, req.headers.get(key)])),
      body: { model: body.model, stream: body.stream, reasoning_effort: body.reasoning_effort ?? null, thinking: body.thinking ?? null,
        max_tokens: body.max_tokens ?? null, max_completion_tokens: body.max_completion_tokens ?? null,
        systemCharacters: (body.messages ?? []).filter((m: any) => m.role === 'system').reduce((sum: number, m: any) => sum + JSON.stringify(m.content).length, 0),
        toolCount: body.tools?.length ?? 0, toolBytes: Buffer.byteLength(JSON.stringify(body.tools ?? [])),
        payloadBytes: Buffer.byteLength(JSON.stringify(body)) } })
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `diagnostic-${ordinal}`, object: 'chat.completion.chunk',
      created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }],
      ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, completion_tokens_details: { reasoning_tokens: 10 } } } : {}) })}\n\n`
    const encoder = new TextEncoder()
    const stream = new ReadableStream({ async start(controller) {
      try {
        controller.enqueue(encoder.encode(chunk({ role: 'assistant' })))
        for (let tick = 0; tick < 8; tick++) {
          if (req.signal.aborted) break
          chunks.push({ ordinal, type: 'thinking', at: Date.now() })
          controller.enqueue(encoder.encode(chunk({ reasoning_content: 'Fixture reasoning only. ' })))
          await Bun.sleep(100)
        }
        while (holdStream && !req.signal.aborted) await Bun.sleep(20)
        if (!req.signal.aborted) {
          chunks.push({ ordinal, type: 'text', at: Date.now() })
          controller.enqueue(encoder.encode(chunk({ content: 'FIXTURE_VISIBLE_RESPONSE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n'))
        }
        controller.close()
      } catch { /* Cancellation closes the controlled response stream. */ }
    } })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const preload = join(evidence.directory, 'loopback-fetch.cjs')
  writeFileSync(preload, `const nativeFetch = globalThis.fetch; globalThis.fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    if (url.hostname === 'opencode.ai') return nativeFetch(${JSON.stringify(api.url.href)}, {
      method: request.method, headers: request.headers, body: await request.text(), signal: request.signal });
    if (['127.0.0.1','localhost'].includes(url.hostname)) return nativeFetch(input, init);
    throw new Error('Diagnostic blocks external network: ' + url.hostname);
  };`)
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { loadSession } = await import('../../packages/shared/src/sessions/storage')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const manager = new SessionManager() as any, runtime = manager.durableRuntime, scope = { sessionId: id, workspaceRootPath: workspace }
  const managed = createManagedSession({ id, createdAt: Date.now() }, { id: 'diagnostic', slug: 'diagnostic', name: 'Diagnostic', rootPath: workspace, createdAt: 1 }, { messagesLoaded: true })
  manager.registerManagedSession(managed)
  manager.eventSink = (_channel: unknown, _target: unknown, event: any) => clientEvents.push({ ...event, at: Date.now() })
  const agent = assembleSessionAgent({
    context: { provider: 'pi', authType: 'api_key', resolvedModel: 'deepseek-flash', capabilities: { needsHttpPoolServer: true },
      connection: { slug: 'diagnostic', name: 'Diagnostic', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
        baseUrl: 'https://opencode.ai/zen/go/v1', customEndpoint: { api: 'openai-completions' },
        models: [{ id: 'deepseek-flash', name: 'Fixture', provider: 'pi', shortName: 'Fixture', description: 'Controlled fixture', contextWindow: 1000000,
          maxTokens: 384000, supportsThinking: true, thinkingLevelMap: { low: 'low', high: 'high', max: 'max' } }] } },
    hostRuntime: { appRootPath: repo, isPackaged: false, nodeRuntimePath: process.execPath, interceptorBundlePath: preload },
    config: { model: 'deepseek-flash', miniModel: 'deepseek-flash', thinkingLevel: 'max', isHeadless: true,
      workspace: { id: 'diagnostic', slug: 'diagnostic', name: 'Diagnostic', rootPath: workspace, createdAt: 1 },
      session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 },
      envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, HOME: evidence.directory, USERPROFILE: evidence.directory, NODE_ENV: 'test' } },
    callbacks: {}, resources: bindPiRuntime(runtime, scope),
  })
  const original = (agent as any).handleLine.bind(agent)
  // Supply a fixture credential at the authentication seam; no live vault is read.
  ;(agent as any).getPiAuth = async () => ({ provider: 'openai', credential: { type: 'api_key', key: 'fixture-only' } })
  agent.onDebug = message => { debug.push(message.slice(0, 250)) }
  ;(agent as any).handleLine = (line: string) => {
    try { const message = JSON.parse(line); wire.push({ at: Date.now(), type: message.type, event: message.event?.type, delta: message.event?.assistantMessageEvent?.type }) } catch {}
    return original(line)
  }
  const turns: any[] = []
  try {
    runtime.execution.subscribe(id, { event: async (event: any) => { hostEvents.push({ ...event, at: Date.now() }); await manager.processEvent(managed, event) } })
    const driver = await runtime.execution.ensureDriver(id, async () => new PiRuntimeDriver(agent))
    for (const [index, level] of (['max', 'off'] as const).entries()) {
      agent.setThinkingLevel(level)
      const acceptedAt = Date.now(), inputId = `diagnostic-${index}`
      const handle = runtime.execution.begin(scope)
      runtime.execution.accept(handle, { operationId: `run-${index}`, userMessageId: inputId, userMessage: 'Fixture latency test' })
      const result = await runtime.execution.drive(handle, driver, { message: 'Fixture latency test', options: { inputId } })
      assert.equal(result.kind, 'terminal')
      const ordinal = index + 1, firstThinking = chunks.find(chunk => chunk.ordinal === ordinal && chunk.type === 'thinking')!.at
      const firstText = chunks.find(chunk => chunk.ordinal === ordinal && chunk.type === 'text')!.at
      const visible = hostEvents.filter(event => event.at >= firstThinking && event.at < firstText && ['thinking_delta', 'text_delta', 'tool_start', 'status', 'info'].includes(event.type))
      turns.push({ level, cold: index === 0, acceptedAt, requestAt: requests[index].at, localToRequestMs: requests[index].at - acceptedAt,
        providerThinkingAt: firstThinking, providerTextAt: firstText, thinkingOnlyMs: firstText - firstThinking,
        hostVisibleDuringThinking: visible.length > 0, earlyVisibleEventTypes: [...new Set(visible.map(event => event.type))] })
    }
    if (process.env.PHANERIS_VERIFY_THINKING === '1') {
      assert(turns.every(turn => turn.hostVisibleDuringThinking), 'Thinking must reach the actual Host before the first text')
      assert(hostEvents.some(event => event.type === 'thinking_delta' && event.text.includes('Fixture reasoning')), 'Host must receive real thinking content')
      assert.equal(requests[1].body.thinking?.type, 'disabled', 'Known DeepSeek off must explicitly disable thinking')
      assert(clientEvents.some(event => event.type === 'thinking_delta' && event.delta.includes('Fixture reasoning')), 'Actual SessionManager must forward batched thinking')
    }
    // The native provider is a control for header behavior. Its remote URL and
    // provider hooks are preserved; only its fetch transport is sent to loopback.
    const { opencodeGoProvider } = await import('@earendil-works/pi-ai/providers/opencode-go')
    const { normalizeContext } = await import('@earendil-works/pi-ai')
    const native = opencodeGoProvider(), model = native.getModels().find(model => model.id.includes('deepseek') && model.api === 'openai-completions')!
    assert(model)
    const response = await native.streamSimple(model, normalizeContext({ messages: [{ role: 'user', content: 'Fixture control', timestamp: Date.now() }] }), {
      apiKey: 'fixture-only', sessionId: 'stable-native-control', reasoning: 'max', maxTokens: 4096,
      fetch: Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => { const request = new Request(input, init); return fetch(api.url.href, {
        method: request.method, headers: request.headers, body: await request.text(), signal: request.signal }) }, { preconnect: fetch.preconnect }),
    }).result()
    assert.equal(response.stopReason, 'stop')
    assert.equal(requests[2].headers['x-opencode-session'], 'stable-native-control')
    if (process.env.PHANERIS_VERIFY_THINKING === '1') {
      holdStream = true
      const handle = runtime.execution.begin(scope)
      runtime.execution.accept(handle, { operationId: 'run-cancel', userMessageId: 'cancel', userMessage: 'Fixture cancellation' })
      const cancelled = runtime.execution.drive(handle, driver, { message: 'Fixture cancellation', options: { inputId: 'cancel' } })
      for (let tick = 0; tick < 500 && !clientEvents.some(event => event.type === 'thinking_delta' && event.at > (requests[3]?.at ?? Infinity)); tick++) await Bun.sleep(10)
      assert(clientEvents.some(event => event.type === 'thinking_delta' && event.at > requests[3]?.at), 'Cancellation must happen during actual thinking')
      await manager.cancelProcessing(id)
      await cancelled
      holdStream = false
      for (let tick = 0; tick < 100 && !managed.messages.some((message: any) => message.id.startsWith('thinking-')); tick++) await Bun.sleep(10)
      await manager.productRepository.flush(id)
      const restored = loadSession(workspace, id)!
      const cancelledTurn = hostEvents.find(event => event.type === 'thinking_delta' && event.at > requests[3].at)?.turnId
      assert(cancelledTurn)
      assert(restored.messages.some(message => message.turnId === cancelledTurn && message.outputBlocks?.some(block => block.type === 'thinking' && block.content?.includes('Fixture reasoning'))), 'This cancelled thinking must survive storage and reload')
      assert(managed.messages.some((message: any) => message.id.startsWith('thinking-') || message.assistantMetrics?.timingUnavailableReason === 'aborted'), 'Cancelled thinking must be materialized')
    }
    const facts = runtime.queries.events(workspace, { sessionId: id })
    assert.equal(facts.filter((event: any) => event.type === 'model_dispatch_committed').length, process.env.PHANERIS_VERIFY_THINKING === '1' ? 3 : 2)
    assert.equal(facts.filter((event: any) => event.type === 'model_outcome_committed').length, process.env.PHANERIS_VERIFY_THINKING === '1' ? 3 : 2)
    evidence.json('diagnostic.json', { scope: 'Current-code diagnostic; synthetic delays are not live latency estimates', requests, turns, wire,
      findings: { customRouteOmitsOpenCodeSession: !requests[0].headers['x-opencode-session'],
        customOffHasNoExplicitDisable: !requests[1].body.thinking && !requests[1].body.reasoning_effort,
        thinkingPeriodHasNoVisibleHostFeedback: turns.every(turn => !turn.hostVisibleDuringThinking) },
      facts: facts.map((event: any) => ({ type: event.type, at: event.createdAt })) })
    const scenes = ['real Pi cold and warm requests captured', 'thinking-only interval measured against host events',
      'actual custom endpoint max/off body captured', 'native OpenCode control preserves stable session header', 'real model T1/T2 paired']
    if (process.env.PHANERIS_VERIFY_THINKING === '1') scenes.push('actual SessionManager batches thinking before text', 'thinking cancellation settles model request', 'cancelled thinking survives storage reload')
    evidence.complete(scenes, ['Live provider latency or causal speedup', 'native renderer rendering', 'actual SessionManager cold-start decomposition'])
    console.log(JSON.stringify({ output: evidence.directory, turns, requests: requests.map(r => ({ headers: r.headers, body: r.body })) }))
  } finally { holdStream = false; evidence.json('trace.json', { requests, chunks, hostEvents, clientEvents, wire, debug }); await manager.productRepository.flushAll(); await runtime.close(); api.stop(true) }
})
