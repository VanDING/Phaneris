import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { openSqliteDatabase } from '../../../packages/server-core/src/runtime/sqlite'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { loadSession, saveSession } from '@phaneris/shared/sessions'

assert(RPC_CHANNELS.residentAssistant.CONTEXT, 'Resident contexts require a Host-owned boundary')
const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
const workspace = { id: 'alpha', name: 'Alpha', rootPath: join(config, 'alpha'), createdAt: 1 }
mkdirSync(workspace.rootPath, { recursive: true })
const requests: Array<Record<string, unknown>> = []
let held!: () => void, started!: () => void
let barrier: Promise<void> | undefined
let ready: Promise<void> | undefined
let workerRelease!: () => void, workerStarted!: () => void
let workerBarrier: Promise<void> | undefined
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const body = await request.json() as Record<string, unknown>; requests.push(body)
  writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2))
  const messages = body.messages as Array<{ role: string; content?: unknown }>
  const latestText = messages.filter(message => message.role === 'user').map(message =>
    (typeof message.content === 'string' ? message.content : (message.content as Array<{ text?: string }> ?? []).map(part => part.text ?? '').join('\n'))
      .replace(/<resident_context_segment>[\s\S]*?<\/resident_context_segment>/g, '').trim()).filter(Boolean).at(-1) ?? ''
  const latest = latestText
  if (latest.includes('HOLD_STALE')) { started(); await barrier }
  if (latest.includes('HOLD_QUEUE')) { started(); await barrier }
  if (latest.includes('HOLD_WORKER')) { workerStarted(); await workerBarrier }
  if (requests.length > 60) return Response.json({ error: { message: 'Fixture exceeded the bounded inference budget' } }, { status: 400 })
  const tool = messages.some(message => message.role === 'tool')
  const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'context-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  const recall = latest.includes('RECALL_MEMORY') && !tool
  const asking = latest.includes('ASK_ORIGINAL_DECISION') && !tool && !JSON.stringify(messages).includes('resident_assistant_role')
  const priorTopic = latest.includes('LOOKUP_PRIOR_TOPIC') && !tool
  const proposing = latest.includes('PROPOSE_MEMORY') && !tool
  const inbox = latestText.match(/<resident_inbox>\n([\s\S]*?)\n<\/resident_inbox>/)
  const event = inbox ? (JSON.parse(inbox[1]!) as Array<{ result?: { sessionId: string; messageId: string } }>).find(event => event.result) : undefined
  const readingResult = !!event?.result && !tool
  const acknowledging = !!inbox && (!event?.result || tool) && !JSON.stringify(messages).includes('mcp__session__assistant_delivery_ack')
  const resident = JSON.stringify(messages).includes('resident_assistant_role')
  const delta = asking ? { tool_calls: [{ index: 0, id: `original-question-${requests.length}`, type: 'function', function: { name: 'mcp__session__ask_user', arguments: JSON.stringify({ questions: [{ id: 'choose', question: 'ORIGINAL_DECISION_CONTENT', options: [{ label: 'First' }, { label: 'Second' }] }] }) } }] }
    : readingResult ? { tool_calls: [{ index: 0, id: `inbox-read-${requests.length}`, type: 'function', function: { name: 'mcp__session__assistant_memory_read', arguments: JSON.stringify(event!.result) } }] }
    : acknowledging ? { tool_calls: [{ index: 0, id: `inbox-ack-${requests.length}`, type: 'function', function: { name: 'mcp__session__assistant_delivery_ack', arguments: JSON.stringify({ eventIds: (JSON.parse(inbox![1]!) as Array<{ eventId: string }>).map(event => event.eventId) }) } }] }
    : priorTopic ? { tool_calls: [{ index: 0, id: `prior-${requests.length}`, type: 'function', function: { name: 'mcp__session__assistant_context_history', arguments: JSON.stringify({ query: 'ORIGINAL_REQUIREMENT' }) } }] }
    : proposing ? { tool_calls: [{ index: 0, id: `propose-${requests.length}`, type: 'function', function: { name: 'mcp__session__assistant_memory_update', arguments: JSON.stringify({ command: { action: 'remember', requestId: 'candidate-from-source', key: 'candidate-from-source', content: 'INFERRED_CANDIDATE', kind: 'experience', basis: 'inferred', sources: [{ sessionId: 'candidate-source', messageId: 'candidate-input' }] } }) } }] }
    : recall ? { tool_calls: [{ index: 0, id: `recall-${requests.length}`, type: 'function', function: { name: 'mcp__session__assistant_memory_search', arguments: JSON.stringify({ query: 'PRIVATE_MEMORY', ...(latest.includes('WORKSPACE') ? { scope: 'workspace' } : {}) }) } }] }
    : { content: !resident ? 'WORKER_EVENT_RESULT' : inbox ? 'INBOX_DELIVERY_CONFIRMED' : latest.includes('HOLD_STALE') ? 'MUST_NOT_DELIVER_STALE' : tool ? 'DERIVED_PRIVATE_MEMORY' : 'FRESH_CONTEXT_REPLY' }
  return new Response(chunk({ role: 'assistant' }) + chunk(delta, recall || readingResult || acknowledging || proposing ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture',
  llmConnections: [{ slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: provider.url.href,
    customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Fixture', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }] }))
writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
await saveSession({ id: 'source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
  messages: [{ id: 'one', type: 'user', content: 'PRIVATE_MEMORY_SOURCE', timestamp: 1 }], tokenUsage: usage })
const { getCredentialManager } = await import('@phaneris/shared/credentials')
await getCredentialManager().setLlmApiKey('fixture', 'loopback-key')
let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
  bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
const connect = async () => { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false }); await client.connect(); return client }
let client = await connect()
const scenes: string[] = [], contexts: unknown[] = []
try {
  const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
  const memory = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'remember', key: 'private', content: 'PRIVATE_MEMORY_VALUE', kind: 'decision', basis: 'user_stated', sources: [{ sessionId: 'source', messageId: 'one' }] })
  await manager.sendMessage(assistant.id, 'ORIGINAL_REQUIREMENT RECALL_MEMORY')
  assert(JSON.stringify(requests.at(-1)).includes('PRIVATE_MEMORY_VALUE'))
  const recallManifest = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' })
  assert.equal(recallManifest.activeSegment?.requests[0]?.dependencies?.memories.length, 0)
  assert.equal(recallManifest.activeSegment?.requests[1]?.dependencies?.memories.length, 1)
  contexts.push(recallManifest)
  scenes.push('RC08-per-request-material-snapshot-does-not-backfill-earlier-request')
  const derived = (await manager.getSession(assistant.id))!.messages.findLast(message => message.role === 'assistant' && message.content.includes('DERIVED_PRIVATE_MEMORY'))!
  await manager.flushAllSessions()
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget', id: memory.record.id, expectedRevision: 1, state: 'forgotten' })
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: assistant.id, messageId: derived.id }), /unavailable|derived|suppress|forgot/i)
  await saveSession({ id: 'unindexed-context-only', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'untouched', type: 'user', content: 'UNINDEXED_CONTEXT_SOURCE', timestamp: 1 }], tokenUsage: usage })
  await manager.sendMessage(assistant.id, 'CHECK_FRESH_CONTEXT')
  const projectionDb = openSqliteDatabase(join(workspace.rootPath, 'memory/memory.db'))
  try { assert.equal(projectionDb.prepare('SELECT 1 FROM history_sessions WHERE id=?').get('unindexed-context-only'), null, 'Context preparation must not refresh the history catalogue') }
  finally { projectionDb.close() }
  assert.equal((await client.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'alpha', { query: 'UNINDEXED_CONTEXT_SOURCE' })).items.length, 1)
  scenes.push('RZ03-context-preparation-has-no-history-index-side-effect')
  assert(!JSON.stringify(requests.at(-1)).includes('PRIVATE_MEMORY_VALUE'))
  assert(!JSON.stringify(requests.at(-1)).includes('DERIVED_PRIVATE_MEMORY'))
  assert(JSON.stringify(requests.at(-1)).includes('ORIGINAL_REQUIREMENT'))
  let context = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' })
  assert(context.activeSegment?.id)
  contexts.push(context)
  scenes.push('RC01-actual-provider-forgetting-and-derived-exit', 'RC01-derived-source-cannot-resurrect-memory', 'RC05-original-requirements-stable-identity')
  const oldSegment = context.activeSegment.id
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Second topic', anchors: [] })
  await manager.sendMessage(assistant.id, 'SECOND_TOPIC_REQUIREMENT')
  assert(!JSON.stringify(requests.at(-1)).includes('ORIGINAL_REQUIREMENT'))
  context = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' })
  assert.notEqual(context.activeSegment?.id, oldSegment)
  assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, assistant.id)
  contexts.push(context)
  scenes.push('RC05-explicit-focus-rotates-logical-context')
  await manager.sendMessage(assistant.id, 'LOOKUP_PRIOR_TOPIC')
  assert(JSON.stringify(requests.at(-1)).includes('ORIGINAL_REQUIREMENT'), 'A new logical context must retain a bounded path back to original assistant history')
  scenes.push('RC05-main-original-history-recall-after-focus')
  await saveSession({ id: 'source-two', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'two', type: 'user', content: 'SECOND_PRIVATE_MEMORY_SOURCE', timestamp: 1 }], tokenUsage: usage })
  const second = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'remember-second', key: 'second-private', content: 'PRIVATE_MEMORY_SECOND', kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'source-two', messageId: 'two' }] })
  await manager.sendMessage(assistant.id, 'RECALL_MEMORY')
  barrier = new Promise(resolve => { held = resolve }); ready = new Promise(resolve => { started = resolve })
  const pending = manager.sendMessage(assistant.id, 'HOLD_STALE')
  await ready
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget-second', id: second.record.id, expectedRevision: 1, state: 'forgotten' })
  held(); await pending
  assert(!loadSession(workspace.rootPath, assistant.id)?.messages.some(message => message.type === 'assistant' && message.content.includes('MUST_NOT_DELIVER_STALE')))
  scenes.push('RC03-inflight-stale-result-not-delivered')
  client.destroy(); await host.stop()
  const legacyContextDb = openSqliteDatabase(join(workspace.rootPath, 'assistant/context.db'))
  try {
    const state = JSON.parse((legacyContextDb.prepare('SELECT body FROM context_state WHERE session_id=?').get(assistant.id) as { body: string }).body)
    const segment = JSON.parse((legacyContextDb.prepare('SELECT body FROM segments WHERE id=?').get(state.activeSegmentId) as { body: string }).body)
    segment.dependencies.sources.push(...segment.dependencies.sources)
    delete state.activeSegmentId
    legacyContextDb.prepare('UPDATE context_state SET body=? WHERE session_id=?').run(JSON.stringify({ ...state, activeSegment: segment }), assistant.id)
    legacyContextDb.exec('PRAGMA user_version=0')
  } finally { legacyContextDb.close() }
  host = await boot(); client = await connect()
  const migrated = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' })
  assert(migrated.activeSegment)
  scenes.push('RZ02-old-embedded-context-state-migrates-without-new-inference')
  assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, assistant.id)
  await manager.sendMessage(assistant.id, 'AFTER_RESTART')
  assert(!JSON.stringify(requests.at(-1)).includes('PRIVATE_MEMORY_SECOND'))
  assert(!JSON.stringify(requests.at(-1)).includes('DERIVED_PRIVATE_MEMORY'))
  context = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' })
  assert(context.activeSegment?.requests?.length)
  contexts.push(context)
  scenes.push('RC02-restart-preserves-context-exits', 'RC08-actual-request-manifest')
  const originalUsers = (await manager.getSession(assistant.id))!.messages.filter(message => message.role === 'user').length
  const delegated = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'event-delivery', title: 'Event delivery', instructions: 'Return the worker event evidence.',
    config: { llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' } })
  let events = await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', {})
  const until = Date.now() + 30000
  while (!events.items.some(event => event.delegationId === delegated.id && event.kind === 'result_ready' && event.phase === 'delivered') && Date.now() < until) {
    await Bun.sleep(50); events = await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', {})
  }
  const delivered = events.items.find(event => event.delegationId === delegated.id && event.kind === 'result_ready')
  assert.equal(delivered?.phase, 'delivered', JSON.stringify(events))
  assert(delivered.delivery?.messageId)
  const timeline = (await manager.getSession(assistant.id))!.messages
  assert.equal(timeline.filter(message => message.role === 'user').length, originalUsers)
  assert(timeline.some(message => message.role === 'info' && message.inputSource?.kind === 'resident_event'))
  assert(timeline.some(message => message.id === delivered.delivery!.messageId && message.content.includes('INBOX_DELIVERY_CONFIRMED')))
  const resultRequests = requests.filter(request => JSON.stringify(request).includes('WORKER_EVENT_RESULT'))
  assert(resultRequests.some(request => JSON.stringify(request).includes('resident_inbox')))
  assert.equal(events.items.filter(event => event.delegationId === delegated.id && event.kind === 'result_ready').length, 1)
  contexts.push(events)
  scenes.push('RE01-automatic-runtime-delivery', 'RE02-consumption-bound-to-result', 'RE04-deduplicated-event-log', 'RE01-internal-events-not-user-messages')
  await saveSession({ id: 'worker-memory-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'worker-memory', type: 'user', content: 'WORKER_PRIVATE_ORIGIN', timestamp: 1 }], tokenUsage: usage })
  const workerMemory = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'worker-memory', key: 'worker-memory', content: 'PRIVATE_MEMORY_WORKER', kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'worker-memory-source', messageId: 'worker-memory' }] })
  while ((await manager.getSession(assistant.id))?.isProcessing) await Bun.sleep(25)
  await manager.sendMessage(assistant.id, 'RECALL_MEMORY')
  workerBarrier = new Promise(resolve => { workerRelease = resolve })
  const workerReady = new Promise<void>(resolve => { workerStarted = resolve })
  const guarded = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'fenced-worker', title: 'Fenced worker', instructions: 'HOLD_WORKER PRIVATE_MEMORY_WORKER',
    config: { llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' } })
  await workerReady
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget-worker-material', id: workerMemory.record.id, expectedRevision: 1, state: 'forgotten' })
  workerRelease()
  let receipt = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: guarded.id })).items[0]!
  const end = Date.now() + 20000
  while (['accepted', 'submitting', 'submitted'].includes(receipt.state) && Date.now() < end) {
    await Bun.sleep(25); receipt = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: guarded.id })).items[0]!
  }
  assert.equal(receipt.result, undefined)
  assert(!loadSession(workspace.rootPath, receipt.sessionId!)?.messages.some(message => message.type === 'assistant' && message.content === 'WORKER_EVENT_RESULT'))
  const hiddenAssignment = await client.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'alpha', { query: 'PRIVATE_MEMORY_WORKER' })
  assert.equal(hiddenAssignment.items.length, 0, 'History must not bypass dependency retirement through the original delegated input')
  await manager.sendMessage(receipt.sessionId!, 'INDEPENDENT_USER_CONTINUATION')
  assert(!JSON.stringify(requests.at(-1)).includes('PRIVATE_MEMORY_WORKER'))
  await client.invoke(RPC_CHANNELS.residentAssistant.CANCEL_WORK, 'alpha', guarded.id)
  scenes.push('RC03-worker-inflight-material-fence', 'RC02-worker-original-input-recall-guard', 'RC02-ordinary-user-can-continue-with-safe-history')
  await saveSession({ id: 'candidate-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'candidate-input', type: 'user', content: 'A useful observation, not a confirmed general rule.', timestamp: 1 }], tokenUsage: usage })
  while ((await manager.getSession(assistant.id))?.isProcessing) await Bun.sleep(25)
  await manager.sendMessage(assistant.id, 'PROPOSE_MEMORY')
  const candidates = await client.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'alpha', { text: 'INFERRED_CANDIDATE', includeRetired: true })
  assert.equal(candidates.items[0]?.state, 'candidate')
  assert.equal((await client.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'alpha', { text: 'INFERRED_CANDIDATE' })).items.length, 0)
  scenes.push('RC09-model-extraction-stays-candidate')
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget-candidate', id: candidates.items[0]!.id, expectedRevision: 1, state: 'forgotten' })
  await manager.sendMessage(assistant.id, 'AFTER_CANDIDATE_FORGET')
  assert(!JSON.stringify(requests.at(-1)).includes('INFERRED_CANDIDATE'))
  assert(!JSON.stringify(requests.at(-1)).includes('DERIVED_PRIVATE_MEMORY'))
  scenes.push('RC09-extraction-observation-also-obeys-material-retirement')
  barrier = new Promise(resolve => { held = resolve }); ready = new Promise(resolve => { started = resolve })
  const queuedTurn = manager.sendMessage(assistant.id, 'HOLD_QUEUE')
  await ready
  await manager.sendMessage(assistant.id, 'QUEUED_NEW_REQUIREMENT')
  held(); await queuedTurn
  const queuedEnd = Date.now() + 20000
  while ((!JSON.stringify(requests.at(-1)).includes('QUEUED_NEW_REQUIREMENT') || (await manager.getSession(assistant.id))?.isProcessing) && Date.now() < queuedEnd) await Bun.sleep(25)
  assert(JSON.stringify(requests.at(-1)).includes('QUEUED_NEW_REQUIREMENT'))
  assert.equal((await manager.getSession(assistant.id))!.messages.filter(message => message.role === 'user' && message.content === 'QUEUED_NEW_REQUIREMENT').length, 1)
  scenes.push('RC07-input-during-context-turn-survives-once')
  const decisionWork = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'original-decision-work', title: 'Original decision', instructions: 'ASK_ORIGINAL_DECISION', config: { llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' } })
  let decisionEvents = await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', { limit: 100 })
  const decisionEnd = Date.now() + 20000
  while (!decisionEvents.items.some(event => event.delegationId === decisionWork.id && event.request && event.phase === 'delivered') && Date.now() < decisionEnd) {
    await Bun.sleep(50); decisionEvents = await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', { limit: 100 })
  }
  const decision = decisionEvents.items.find(event => event.delegationId === decisionWork.id && event.request)
  assert(decision?.request)
  assert.equal(decision.phase, 'delivered')
  assert.equal(decision.request.sessionId, decisionWork.sessionId)
  assert.equal((await manager.getSession(decisionWork.sessionId!))!.isProcessing, true, 'Assistant delivery must leave original question pending')
  assert(!requests.some(request => JSON.stringify(request).includes('ORIGINAL_DECISION_CONTENT') && JSON.stringify(request).includes('INBOX_DELIVERY_CONFIRMED')))
  assert.equal(manager.respondToAskUser(assistant.id, decision.request.requestId, { cancelled: true, answers: [] }), false)
  assert.equal(manager.respondToAskUser(decision.request.sessionId, decision.request.requestId, { cancelled: true, answers: [] }), true)
  scenes.push('RE05-original-decision-pointer-and-answer-ownership')
  const decisionDeliveryEnd = Date.now() + 20000
  while (Date.now() < decisionDeliveryEnd) {
    const page = await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', { limit: 100 })
    if (page.items.some(event => event.delegationId === decisionWork.id && event.kind === 'result_ready' && event.phase === 'delivered') && !(await manager.getSession(assistant.id))?.isProcessing) break
    await Bun.sleep(25)
  }
  await saveSession({ id: 'revision-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'revision', type: 'user', content: 'REVISION_SOURCE', timestamp: 1 }], tokenUsage: usage })
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'anchors', anchors: [{ sessionId: 'revision-source', messageId: 'revision' }] })
  await manager.sendMessage(assistant.id, 'CHECK_PINNED_WORKING_SET')
  assert(JSON.stringify(requests.at(-1)).includes('REVISION_SOURCE'))
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'anchors', anchors: [] })
  await manager.sendMessage(assistant.id, 'CHECK_UNPINNED_WORKING_SET')
  assert(!JSON.stringify(requests.at(-1)).includes('REVISION_SOURCE'))
  scenes.push('RC05-pin-and-retire-explicit-source-working-set')
  const revision = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'revision-first', key: 'revision-key', content: 'PRIVATE_MEMORY_OLD_REVISION', kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'revision-source', messageId: 'revision' }] })
  await manager.sendMessage(assistant.id, 'RECALL_MEMORY')
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'revise', requestId: 'revision-second', id: revision.record.id, expectedRevision: 1, content: 'PRIVATE_MEMORY_NEW_REVISION', sources: [{ sessionId: 'revision-source', messageId: 'revision' }] })
  await manager.sendMessage(assistant.id, 'CHECK_REVISION')
  assert(!JSON.stringify(requests.at(-1)).includes('PRIVATE_MEMORY_OLD_REVISION'))
  scenes.push('RC01-revision-retires-actual-provider-material')
  const { createProject } = await import('@phaneris/shared/projects')
  const projectA = createProject(workspace.rootPath, { name: 'Project A', details: 'TOPIC_A_PROJECT_RULE' }), projectB = createProject(workspace.rootPath, { name: 'Project B', details: 'TOPIC_B_PROJECT_RULE' })
  for (const [suffix, projectId] of [['GLOBAL', undefined], ['A', projectA.id], ['B', projectB.id]] as const) await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', {
    action: 'remember', requestId: `scope-memory-${suffix}`, key: `scope-memory-${suffix}`, content: `PRIVATE_MEMORY_SCOPE_${suffix}`, kind: 'fact', basis: 'user_stated', projectId,
    sources: [{ sessionId: 'revision-source', messageId: 'revision' }] })
  await manager.setSessionProjectId(assistant.id, projectA.id)
  const topicA = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Project A topic', projectId: projectA.id, anchors: [] })
  assert(topicA.focus.topicId, 'A stable saved workset identity is required')
  await manager.sendMessage(assistant.id, 'TOPIC_A_ORIGINAL_REQUIREMENT')
  await manager.sendMessage(assistant.id, 'TOPIC_A_SECOND_REQUIREMENT')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_PROJECT_RULE'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_B_PROJECT_RULE'))
  await manager.sendMessage(assistant.id, 'RECALL_MEMORY_SCOPE_A')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_A'))
  assert(JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_GLOBAL'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_B'))
  await manager.setSessionProjectId(assistant.id, projectB.id)
  const topicB = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Project B topic', projectId: projectB.id, anchors: [] })
  await manager.sendMessage(assistant.id, 'TOPIC_B_ORIGINAL_REQUIREMENT')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_B_PROJECT_RULE'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_PROJECT_RULE'))
  await manager.sendMessage(assistant.id, 'RECALL_MEMORY_SCOPE_B')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_B'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_A'))
  const topics = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'topics', limit: 1 })
  assert.equal(topics.topics!.items.length, 1); assert(topics.topics!.nextOffset !== null)
  await assert.rejects(client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: 'unknown-topic' }), /topic|exist/i)
  await assert.rejects(client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: topicA.focus.topicId! }), /project/i)
  await manager.setSessionProjectId(assistant.id, projectA.id)
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: topicA.focus.topicId! })
  await manager.sendMessage(assistant.id, 'RESUME_A_AFTER_B')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_ORIGINAL_REQUIREMENT'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_B_ORIGINAL_REQUIREMENT'))
  assert(JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_PROJECT_RULE'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_B_PROJECT_RULE'))
  await manager.sendMessage(assistant.id, 'RECALL_MEMORY_WORKSPACE_COMPARE')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_A'))
  assert(JSON.stringify(requests.at(-1)?.messages).includes('PRIVATE_MEMORY_SCOPE_B'))
  scenes.push('RK05-real-pi-default-project-scope-and-explicit-workspace-comparison')
  contexts.push(await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' }))
  scenes.push('RQ01-saved-topic-restores-original-requirements-without-other-project', 'RQ05-bounded-topic-metadata-and-unknown-identity-rejection')
  await saveSession({ id: 'topic-anchor-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'anchor', type: 'user', content: 'TOPIC_ANCHOR_REQUIREMENT', timestamp: 1 }], tokenUsage: usage })
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'anchors', anchors: [{ sessionId: 'topic-anchor-source', messageId: 'anchor' }] })
  await manager.setSessionProjectId(assistant.id, projectB.id)
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: topicB.focus.topicId! })
  const anchorMemory = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'topic-anchor-memory', key: 'topic-anchor', content: 'TOPIC_ANCHOR_REQUIREMENT', kind: 'decision', basis: 'user_stated', sources: [{ sessionId: 'topic-anchor-source', messageId: 'anchor' }] })
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget-topic-anchor', id: anchorMemory.record.id, expectedRevision: 1, state: 'forgotten' })
  await manager.setSessionProjectId(assistant.id, projectA.id)
  await assert.rejects(client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: topicA.focus.topicId! }), /forgot|suppress|source/i)
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: topicA.focus.topicId!, anchors: [] })
  const originalA = (await manager.getSession(assistant.id))!.messages.find(message => message.content === 'TOPIC_A_ORIGINAL_REQUIREMENT')!
  const originalMemory = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'topic-original-memory', key: 'topic-original', content: 'TOPIC_A_ORIGINAL_REQUIREMENT', kind: 'decision', basis: 'user_stated', sources: [{ sessionId: assistant.id, messageId: originalA.id }] })
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget-topic-original', id: originalMemory.record.id, expectedRevision: 1, state: 'forgotten' })
  await manager.sendMessage(assistant.id, 'AFTER_EXPLICIT_TOPIC_FORGETTING')
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_ORIGINAL_REQUIREMENT'))
  assert(JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_SECOND_REQUIREMENT'))
  scenes.push('RQ02-invalid-anchor-needs-explicit-override', 'RQ03-forgotten-topic-original-exits-with-other-requirements-intact')
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Capacity test', anchors: [] })
  const requestCount = requests.length
  await manager.sendMessage(assistant.id, 'REQUIRED_CAPACITY_MATERIAL '.repeat(30000))
  assert.equal(requests.length, requestCount, 'Capacity failure must stop before provider inference')
  assert((await manager.getSession(assistant.id))!.messages.some(message => /capacity|scope|capacity|context.*budget/i.test(message.content)))
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'After capacity block', anchors: [] })
  await manager.sendMessage(assistant.id, 'AFTER_CAPACITY_RESCOPE')
  assert(JSON.stringify(requests.at(-1)).includes('AFTER_CAPACITY_RESCOPE'))
  assert(!JSON.stringify(requests.at(-1)).includes('REQUIRED_CAPACITY_MATERIAL'))
  scenes.push('RC06-required-input-overflow-blocks-before-provider', 'RC06-explicit-rescope-recovers-stable-session')
  await manager.flushAllSessions()
  const beforeRecovery = requests.length
  client.destroy(); await host.stop()
  const inboxDb = openSqliteDatabase(join(workspace.rootPath, 'assistant', 'delegations.db'))
  inboxDb.prepare("UPDATE inbox_consumption SET phase='handled',delivery=NULL WHERE event_id=?").run(delivered!.eventId)
  inboxDb.close()
  host = await boot(); client = await connect()
  const recoveredEvents = await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', { limit: 100 })
  const recoveredDelivery = recoveredEvents.items.find(event => event.eventId === delivered!.eventId)
  assert.equal(recoveredDelivery?.phase, 'delivered', 'Recover persisted successful delivery rather than leaving an unconfirmed crash gap')
  assert.equal(recoveredDelivery.delivery?.messageId, delivered!.delivery!.messageId)
  assert.equal(requests.length, beforeRecovery, 'Recovery must not issue duplicate inference or repeat work')
  scenes.push('RE03-restart-reconciles-persisted-delivery-without-replay')
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'resume', topicId: topicA.focus.topicId! })
  await manager.sendMessage(assistant.id, 'RESUME_A_AFTER_RESTART_AND_CAPACITY_FAILURE')
  const restoredTopic = await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'get' })
  assert.equal(restoredTopic.focus.topicId, topicA.focus.topicId)
  assert.equal(restoredTopic.focus.projectId, projectA.id)
  assert(JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_A_SECOND_REQUIREMENT'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('REQUIRED_CAPACITY_MATERIAL'))
  assert(!JSON.stringify(requests.at(-1)?.messages).includes('TOPIC_B_ORIGINAL_REQUIREMENT'))
  assert.equal(restoredTopic.sessionId, assistant.id)
  scenes.push('RQ04-restart-and-other-topic-capacity-failure-preserve-stable-identity')
  client.destroy(); await host.stop()
  const topicDb = openSqliteDatabase(join(workspace.rootPath, 'assistant/context.db'))
  const dangling = JSON.parse((topicDb.prepare('SELECT body FROM topics WHERE session_id=? AND id=?').get(assistant.id, topicA.focus.topicId!) as { body: string }).body)
  dangling.originalInputIds.push('missing-original-reference')
  topicDb.prepare('UPDATE topics SET body=? WHERE session_id=? AND id=?').run(JSON.stringify(dangling), assistant.id, topicA.focus.topicId!)
  topicDb.close()
  host = await boot(); client = await connect()
  const beforeMissing = requests.length
  await manager.sendMessage(assistant.id, 'MISSING_TOPIC_ORIGINAL_CANNOT_BE_GUESSED')
  assert.equal(requests.length, beforeMissing)
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Explicit recovery scope', anchors: [] })
  await manager.sendMessage(assistant.id, 'RECOVERY_WITH_NEW_TOPIC_SCOPE')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('RECOVERY_WITH_NEW_TOPIC_SCOPE'))
  scenes.push('RQ03-missing-original-blocks-provider-and-explicit-new-scope-recovers')
  await manager.flushAllSessions()
  writeFileSync(join(output, 'assistant-session.jsonl'), await Bun.file(join(workspace.rootPath, 'sessions', assistant.id, 'session.jsonl')).text())
  const structureDb = openSqliteDatabase(join(workspace.rootPath, 'assistant/context.db'))
  try {
    const states = structureDb.prepare('SELECT body FROM context_state').all() as Array<{ body: string }>
    const segments = structureDb.prepare('SELECT body FROM segments').all() as Array<{ body: string }>
    for (const { body } of states) {
      const state = JSON.parse(body)
      assert.equal(state.activeSegment, undefined, 'Persist only the active segment identity')
      assert(state.activeSegmentId)
      assert(structureDb.prepare('SELECT 1 FROM segments WHERE id=?').get(state.activeSegmentId))
    }
    for (const { body } of segments) {
      const segment = JSON.parse(body)
      for (const dependencies of [segment.dependencies, ...segment.requests.map((request: { dependencies: unknown }) => request.dependencies)]) {
        assert.equal(dependencies.sources.length, new Set(dependencies.sources.map((source: { sessionId: string; messageId: string; contentHash: string }) => JSON.stringify([source.sessionId, source.messageId, source.contentHash]))).size)
      }
    }
    scenes.push('RZ01-context-dependencies-unique-across-turns-and-requests', 'RZ02-context-state-holds-only-active-segment-reference')
  } finally { structureDb.close() }
  writeFileSync(join(output, 'context-evidence.json'), JSON.stringify({ scenes, requests, contexts }, null, 2))
} finally { writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2)); held?.(); workerRelease?.(); client.destroy(); await host.stop(); provider.stop(true) }
