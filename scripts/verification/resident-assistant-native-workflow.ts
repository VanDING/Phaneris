/** Real Pi child + loopback provider + Runtime/SQLite. No paid model calls. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-native', async run => {
  const cache = resolve('.cache/verification')
  mkdirSync(cache, { recursive: true })
  const fixture = mkdtempSync(join(cache, 'resident-native-'))
  process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
  process.env.NODE_ENV = 'test'
  const workspace = { id: 'resident-native', name: 'Resident native fixture', slug: 'resident-native', createdAt: 1, rootPath: join(fixture, 'workspace') }
  const sessionId = 'resident-native-session'
  mkdirSync(join(workspace.rootPath, 'sessions', sessionId), { recursive: true })
  const { isResidentAssistantToolAllowed } = await import('../../packages/shared/src/agent/resident-role')
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const { mergeSessionScopedToolCallbacks } = await import('../../packages/shared/src/agent/session-scoped-tool-callback-registry')
  const { buildResidentMemoryCallbacks } = await import('../../packages/server-core/src/resident-assistant/memory-callbacks')
  const { AssistantContextStore } = await import('../../packages/server-core/src/resident-assistant/context-store')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { saveSession } = await import('@phaneris/shared/sessions')
  await saveSession({ id: 'source-session', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'source-user', type: 'user', content: '采用季度口径', timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const memory = new AssistantMemoryStore(workspace)
  const remembered = memory.mutate({ action: 'remember', requestId: 'native-remember', key: 'definition', content: 'NATIVE_QUARTERLY_MEMORY',
    basis: 'user_stated', kind: 'decision', sources: [{ sessionId: 'source-session', messageId: 'source-user' }] })
  const forbiddenPath = join(fixture, 'must-not-be-written.txt')
  const requests: Array<{ tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }> = []
  const violations: string[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as typeof requests[number]
    requests.push(body)
    const names = (body.tools ?? []).map(tool => tool.function.name)
    if (names.some(name => !isResidentAssistantToolAllowed('resident_assistant', name))) violations.push('forbidden tool exposed')
    if (!JSON.stringify(body.messages.filter(message => ['system', 'developer'].includes(message.role))).includes('resident_assistant_role')) violations.push('resident prompt missing')
    if (requests.length > 6 || violations.length) return Response.json({ error: { message: violations.join(', ') || 'Unexpected extra inference', type: 'invalid_request_error' } }, { status: 400 })
    const index = requests.length
    const search = names.find(name => name.endsWith('__assistant_memory_search'))
    if (!search) return Response.json({ error: { message: 'Memory tool missing' } }, { status: 400 })
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `resident-${index}`, object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
    const call = index % 2 === 1
    const tool = index === 5 ? 'write' : search
    const args = index === 5 ? { path: forbiddenPath, content: 'FORBIDDEN_EFFECT' } : { query: 'NATIVE_QUARTERLY_MEMORY' }
    const reply = call ? chunk({ tool_calls: [{ index: 0, id: `resident-call-${index}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }, 'tool_calls')
      : chunk({ content: 'RESIDENT_NATIVE_TURN_DONE' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const runtime = createDurableRuntime()
  const scope = { sessionId, workspaceRootPath: workspace.rootPath }
  const contextStore = new AssistantContextStore(workspace, sessionId, memory)
  const agent = assembleSessionAgent({
    context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
      connection: { slug: 'fixture', name: 'Loopback fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
        baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback only', provider: 'pi', contextWindow: 64000, maxTokens: 4096 }] } },
    hostRuntime: { appRootPath: resolve('.'), isPackaged: false, nodeRuntimePath: process.execPath },
    config: { model: 'pi/fixture', workspace, systemPromptPreset: 'resident_assistant',
      session: { id: sessionId, sessionKind: 'resident_assistant', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1 },
      isHeadless: true, envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, NODE_ENV: 'test' } },
    callbacks: {}, resources: bindPiRuntime(runtime, scope, { modelContext: {
      select: operationId => contextStore.prepare(runtime.queries.getCanonicalModelContext(workspace.rootPath, sessionId, operationId), [], operationId!, ''),
      assert: request => contextStore.assertRequest(request), entered: request => contextStore.entered(request),
      valid: request => request ? contextStore.outcome(request) : !!contextStore.get().activeSegment && contextStore.valid(contextStore.get().activeSegment!), committed: (request, valid) => contextStore.committed(request, valid),
    } }),
  })
  mergeSessionScopedToolCallbacks(sessionId, buildResidentMemoryCallbacks({ workspace, memory, assertResidentRole: () => {}, track: dependencies => contextStore.track(dependencies) }))
  const scenes: string[] = []
  try {
    const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
    for (const [index, message] of ['Recall the memory', 'Recall it after forgetting', 'Reject a forged write call'].entries()) {
      if (index === 1) {
        memory.mutate({ action: 'transition', requestId: 'native-forget', id: remembered.record.id, expectedRevision: 1, state: 'forgotten' })
        agent.updateBrowserToolEnabled?.(true)
      }
      const handle = runtime.execution.begin(scope)
      runtime.execution.accept(handle, { operationId: `resident-run-${index}`, userMessageId: `resident-user-${index}`, userMessage: message })
      assert.equal((await runtime.execution.drive(handle, driver, { message, options: { inputId: `resident-user-${index}` } })).kind, 'terminal')
    }
    assert.equal(violations.length, 0, violations.join(', '))
    assert.equal(requests.length, 6)
    assert(JSON.stringify(requests[1]!.messages.filter(message => message.role === 'tool').at(-1)).includes('NATIVE_QUARTERLY_MEMORY'))
    assert(!JSON.stringify(requests[3]!.messages.filter(message => message.role === 'tool').at(-1)).includes('NATIVE_QUARTERLY_MEMORY'))
    assert(!existsSync(forbiddenPath), 'SDK must not execute a forged tool call absent from the role catalog')
    assert.deepEqual(requests[0]!.tools?.map(tool => tool.function.name).sort(), requests[2]!.tools?.map(tool => tool.function.name).sort())
    const facts = runtime.queries.events(workspace.rootPath, { sessionId })
    assert(facts.some(event => event.type === 'tool_outcome_committed' && JSON.stringify(event.payload).includes('NATIVE_QUARTERLY_MEMORY')))
    scenes.push('RA07-native-model-catalog', 'RA08-native-independent-prompt', 'RA09-native-memory-recall',
      'RA09-fresh-search-after-forgetting', 'RA07-native-dynamic-rebuild', 'RA05-native-forged-write-rejected', 'RA09-durable-memory-outcome')
    run.json('native-evidence.json', { scenes, providerCalls: requests.length, requests, facts,
      limitation: 'Deterministic loopback verifies SDK boundaries, not paid model quality.' })
    run.complete(scenes, ['Paid model quality', 'Frontend and full delegation'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { await runtime.close(); contextStore.close(); memory.close(); api.stop(true) }
})
