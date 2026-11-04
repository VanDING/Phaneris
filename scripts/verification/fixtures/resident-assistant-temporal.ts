import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS, type MemoryMutation, type MemoryQuery } from '@phaneris/shared/protocol'
import { saveSession } from '@phaneris/shared/sessions'

const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
const workspace = { id: 'alpha', name: 'Alpha', rootPath: join(config, 'alpha'), createdAt: 1 }
mkdirSync(workspace.rootPath, { recursive: true })
const requests: Array<Record<string, unknown>> = [], scenes: string[] = []
let currentQuery = 'TIMED_TOPIC', includeRetired = false, relationCommand: MemoryMutation | undefined
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const body = await request.json() as Record<string, unknown>; requests.push(body)
  writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2))
  const messages = body.messages as Array<{ role: string; content?: unknown }>
  const hasTool = messages.some(message => message.role === 'tool')
  const lastTool = messages.filter(message => message.role === 'tool').at(-1)
  const lastText = lastTool ? typeof lastTool.content === 'string' ? lastTool.content : JSON.stringify(lastTool.content) : ''
  const navigation = lastText.startsWith('{') ? JSON.parse(lastText) as { items?: Array<{ id: string; revision: number; disputed?: boolean }> } : undefined
  const disputedItem = includeRetired && !relationCommand ? navigation?.items?.find(item => item.disputed) : undefined
  const delta = disputedItem ? { tool_calls: [{ index: 0, id: `inspect-${requests.length}`, type: 'function',
    function: { name: 'mcp__session__assistant_memory_inspect', arguments: JSON.stringify({ id: disputedItem.id, expectedRevision: disputedItem.revision }) } }] }
    : hasTool ? { content: 'TIMED_MEMORY_REVIEW_DONE' } : { tool_calls: [{ index: 0, id: `timed-${requests.length}`, type: 'function',
    function: { name: `mcp__session__${relationCommand ? 'assistant_memory_update' : 'assistant_memory_search'}`, arguments: JSON.stringify(relationCommand ? { command: relationCommand } : { query: currentQuery, includeRetired }) } }] }
  const chunk = (value: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'temporal-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`
  return new Response(chunk({ role: 'assistant' }) + chunk(delta, hasTool ? 'stop' : 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture',
  llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: provider.url.href,
    customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }] }))
writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
const { getCredentialManager } = await import('@phaneris/shared/credentials')
await getCredentialManager().setLlmApiKey('fixture', 'loopback-only-key')
await saveSession({ id: 'temporal-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
  messages: [{ id: 'input', type: 'user', content: 'TEMPORAL_SOURCE_EVIDENCE', timestamp: 1 }],
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
  bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
async function connect() { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false }); await client.connect(); return client }
let client = await connect(), sequence = 0
const query = (input: MemoryQuery = {}) => client.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'alpha', input)
const mutate = (input: MemoryMutation) => client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', input)
const remember = (extra: Record<string, unknown> = {}) => mutate({ action: 'remember', requestId: `time-${++sequence}`, key: `time-key-${sequence}`,
  content: 'Temporal fact', kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'temporal-source', messageId: 'input' }], ...extra } as MemoryMutation)
try {
  const futureTime = Date.now() + 700
  const future = await remember({ key: 'future', validFrom: futureTime, validUntil: futureTime + 100000 })
  assert.equal(future.record.state, 'scheduled')
  assert(future.record.createdAt < futureTime)
  assert.equal(future.record.validFrom, futureTime)
  assert(!(await query()).items.some(record => record.id === future.record.id))
  await assert.rejects(remember({ validFrom: 20, validUntil: 10 }), /time|interval|valid/i)
  await assert.rejects(remember({ validFrom: 20, validUntil: 20 }), /time|interval|valid/i)
  scenes.push('RT01-scheduled-not-current-and-invalid-intervals', 'RT02-valid-time-separate-from-record-time')
  await remember({ key: 'ordinary' }); await remember({ key: 'ordinary-two' })
  const beforeStart = await query({ includeRetired: true, limit: 1 })
  await Bun.sleep(Math.max(0, futureTime - Date.now()) + 20)
  await assert.rejects(query({ includeRetired: true, limit: 1, cursor: beforeStart.nextCursor! }), /cursor|time|expir/i)
  assert((await query()).items.some(record => record.id === future.record.id))
  scenes.push('RT03-crossing-valid-from-invalidates-cursor')
  const revise = await mutate({ action: 'revise', requestId: `time-${++sequence}`, id: future.record.id, expectedRevision: 1,
    content: 'Revised temporal fact', validFrom: null, validUntil: null, sources: [{ sessionId: 'temporal-source', messageId: 'input' }] })
  assert.equal(revise.record.validFrom, undefined); assert.equal(revise.record.validUntil, undefined)
  await assert.rejects(mutate({ action: 'revise', requestId: `time-${++sequence}`, id: future.record.id, expectedRevision: 1,
    content: 'Late stale revision', sources: [{ sessionId: 'temporal-source', messageId: 'input' }] }), /revision|conflict/i)
  const conditional = await remember({ key: 'same-name', projectId: 'project-a', condition: 'production', validFrom: 10 })
  const alternate = await remember({ key: 'same-name', projectId: 'project-a', condition: 'test', validFrom: 20 })
  const sibling = await remember({ key: 'same-name', projectId: 'project-b', condition: 'production' })
  await assert.rejects(remember({ key: 'same-name', projectId: 'project-a', condition: 'production' }), /key|exist|conflict/i)
  assert.notEqual(conditional.record.id, alternate.record.id)
  const filtered = await query({ projectId: 'project-a', condition: 'production' })
  assert.deepEqual(filtered.items.map(record => record.id), [conditional.record.id])
  assert(!filtered.items.some(record => record.id === sibling.record.id))
  await assert.rejects(remember({ key: 'ordinary' }), /key|exist|conflict/i)
  scenes.push('RT04-clear-time-and-stale-revision', 'RT05-conditions-coexist-without-overwrite', 'RT06-legacy-scope-and-literal-condition-filter')
  const page = await query({ limit: 1 })
  for (const changed of [{ text: 'different' }, { projectId: 'project-b' }, { condition: 'production' }, { limit: 2 }, { includeRetired: true }]) {
    await assert.rejects(query({ limit: 1, ...changed, cursor: page.nextCursor! }), /cursor|query/i)
  }
  scenes.push('RT07-cursor-binds-normalized-filter-and-page-size')
  await assert.rejects(mutate({ action: 'revise', requestId: `time-${++sequence}`, id: conditional.record.id, expectedRevision: 1,
    content: 'Invalid merged interval', validUntil: 5, sources: [{ sessionId: 'temporal-source', messageId: 'input' }] }), /time|interval|valid/i)
  const kept = await mutate({ action: 'revise', requestId: `time-${++sequence}`, id: conditional.record.id, expectedRevision: 1,
    content: 'Condition and time preserved', sources: [{ sessionId: 'temporal-source', messageId: 'input' }] })
  assert.equal(kept.record.validFrom, 10); assert.equal(kept.record.condition, 'production')
  scenes.push('RT04-partial-time-merge-remains-valid')
  const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
  const timed = await remember({ key: 'timed-provider', content: 'TIMED_TOPIC CURRENT_FACT_MATERIAL', validUntil: Date.now() + 10000 })
  await manager.sendMessage(assistant.id, 'REVIEW_TIMED_FACT')
  assert(JSON.stringify(requests).includes('CURRENT_FACT_MATERIAL'))
  await Bun.sleep(Math.max(0, timed.record.validUntil! - Date.now()) + 20)
  const boundary = requests.length
  await manager.sendMessage(assistant.id, 'AFTER_VALIDITY_END')
  assert(!JSON.stringify(requests.slice(boundary).map(request => request.messages)).includes('CURRENT_FACT_MATERIAL'))
  scenes.push('RT09-expired-memory-exits-real-provider-history')
  currentQuery = 'CONFLICT_TOPIC'
  const one = (await remember({ key: 'conflict-one', content: 'CONFLICT_TOPIC DISPUTED_FACT_MATERIAL_A' })).record
  const two = (await remember({ key: 'conflict-two', content: 'CONFLICT_TOPIC DISPUTED_FACT_MATERIAL_B' })).record
  await manager.sendMessage(assistant.id, 'REVIEW_CONFLICT')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('DISPUTED_FACT_MATERIAL_A'))
  await mutate({ action: 'dispute', requestId: 'native-dispute', id: one.id, expectedRevision: 1, related: [{ id: two.id, expectedRevision: 1 }],
    reason: 'Review conflicting observations.', sources: [{ sessionId: 'temporal-source', messageId: 'input' }] })
  const disputedBoundary = requests.length
  await manager.sendMessage(assistant.id, 'AFTER_CONFLICT')
  assert(!JSON.stringify(requests.slice(disputedBoundary).map(request => request.messages)).includes('DISPUTED_FACT_MATERIAL'))
  scenes.push('RL01-dispute-exits-real-provider-history')
  includeRetired = true
  await manager.sendMessage(assistant.id, 'REVIEW_DISPUTED_EVIDENCE_AS_HISTORY')
  assert(JSON.stringify(requests.at(-1)?.messages).includes('DISPUTED_FACT_MATERIAL_A'))
  assert(JSON.stringify(requests.at(-1)?.messages).includes('relatedMemoryIds'))
  scenes.push('RL01-purposeful-disputed-review-keeps-historical-state')
  relationCommand = { action: 'resolve', requestId: 'native-resolve', id: two.id, expectedRevision: 2, related: [{ id: one.id, expectedRevision: 2 }],
    winnerId: two.id, reason: 'Use the second observation as explicitly requested.', sources: [{ sessionId: 'temporal-source', messageId: 'input' }] }
  const internalBoundary = requests.length
  await manager.sendMessage(assistant.id, 'RESOLVE_CONFLICT_INTERNAL', undefined, undefined, { hidden: true })
  assert(JSON.stringify(requests.slice(internalBoundary).map(request => request.messages)).includes('direct current user turn'))
  assert((await query({ includeRetired: true, ids: [one.id, two.id] })).items.every(record => record.dispute))
  scenes.push('RL09-internal-input-cannot-confirm-a-memory-resolution')
  await manager.sendMessage(assistant.id, 'RESOLVE_CONFLICT_DIRECT_USER')
  assert.equal((await query({ ids: [two.id] })).items[0]?.lastValidatedAt !== undefined, true)
  scenes.push('RL04-real-pi-resolves-with-explicit-direct-user-turn')
  relationCommand = undefined
  client.destroy(); await host.stop(); host = await boot(); client = await connect()
  assert.equal((await query({ condition: 'production', projectId: 'project-a' })).items[0]?.condition, 'production')
  assert.equal((await query({ includeRetired: true, text: 'CURRENT_FACT_MATERIAL' })).items[0]?.state, 'expired')
  const forgotten = await mutate({ action: 'transition', requestId: `time-${++sequence}`, id: alternate.record.id, expectedRevision: 1, state: 'forgotten' })
  assert.equal(forgotten.record.content, null)
  assert.equal(forgotten.record.condition, undefined, 'Forgotten conditions must be redacted with the statement')
  assert.equal((await query({ condition: 'production' })).items.length, 0, 'Whole-source suppression still wins over condition/time selection')
  scenes.push('RT08-restart-and-suppression-priority')
  writeFileSync(join(output, 'temporal-evidence.json'), JSON.stringify({ scenes, future, conditional, alternate, final: await query({ includeRetired: true }), requests }, null, 2))
} finally { client.destroy(); await host.stop(); provider.stop(true) }
