import assert from 'node:assert/strict'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS, REMOTE_ELIGIBLE_CHANNELS, type HistoryQuery } from '@phaneris/shared/protocol'
import { getSessionFilePath, loadSession, saveSession, type StoredMessage } from '@phaneris/shared/sessions'
import { openSqliteDatabase } from '../../../packages/server-core/src/runtime/sqlite'

const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
assert(RPC_CHANNELS.assistantMemory.HISTORY, 'P4a requires a workspace history query boundary')
const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, rootPath: join(config, id), createdAt: 1 }))
const workspace = workspaces[0]!
for (const item of workspaces) mkdirSync(item.rootPath, { recursive: true })
const requests: Array<Record<string, unknown>> = []
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const body = await request.json() as Record<string, unknown>
  requests.push(body)
  const messages = body.messages as Array<{ role: string; content?: unknown }>
  const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'history-model', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  const name = 'mcp__session__assistant_history_search'
  assert(JSON.stringify(body.tools).includes(name), 'History must be available in the actual model tool catalog')
  let delta: object, finish: string
  if (!messages.some(message => message.role === 'tool')) {
    delta = { tool_calls: [{ index: 0, id: 'history-native-call', type: 'function', function: { name, arguments: JSON.stringify({ query: 'NATIVE_HISTORY_EVIDENCE' }) } }] }; finish = 'tool_calls'
  } else if (!messages.some(message => message.role === 'tool' && JSON.stringify(message).includes('nextOffset'))) {
    const search = messages.filter(message => message.role === 'tool').at(-1)!
    const text = typeof search.content === 'string' ? search.content : JSON.stringify(search.content)
    const match = JSON.parse(text) as { items: Array<{ sessionId: string; messageId: string; contentHash: string }> }
    const source = match.items[0]!
    delta = { tool_calls: [{ index: 0, id: 'history-native-read', type: 'function', function: { name: 'mcp__session__assistant_memory_read',
      arguments: JSON.stringify({ sessionId: source.sessionId, messageId: source.messageId, expectedContentHash: source.contentHash, maxChars: 100 }) } }] }; finish = 'tool_calls'
  } else { delta = { content: 'HISTORY_REVIEW_DONE' }; finish = 'stop' }
  return new Response(chunk({ role: 'assistant' }) + chunk(delta, finish) + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture',
  llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: provider.url.href,
    customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }] }))
writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
async function source(id: string, messages: StoredMessage[], extra: Record<string, unknown> = {}, target = workspace) {
  await saveSession({ id, workspaceRootPath: target.rootPath, createdAt: 1, lastUsedAt: 1, messages, tokenUsage: usage, ...extra })
}
const user = (id: string, content: string): StoredMessage => ({ id, type: 'user', content, timestamp: 1 })
await source('a-history', [user('one', '季度口径 NATIVE_HISTORY_EVIDENCE'), { id: 'guess', type: 'assistant', content: '季度口径是模型推测', timestamp: 2 },
  { ...user('delegated', '季度口径 内部委派'), inputSource: { kind: 'delegation', delegationId: 'd', assistantSessionId: 'a', originMessageId: 'o' } },
  user('forwarded', '[Message from session "x"] 季度口径'),
  { ...user('attachment', '季度口径 附件入口'), attachments: [{ id: 'attachment', type: 'pdf', name: 'unparsed.pdf', mimeType: 'application/pdf', size: 10, storedPath: 'missing.pdf' }] },
  user('literal', "100%_ '季度")], { projectId: 'project-a', isArchived: true })
await source('b-hidden', [user('one', '季度口径 隐藏普通历史')], { projectId: 'project-b', hidden: true })
await source('resident-history-assistant', [user('one', 'ASSISTANT_HISTORY_EXCLUDED')], { sessionKind: 'resident_assistant', hidden: true, permissionMode: 'safe' })
await source('beta-history', [user('one', '季度口径 OTHER_WORKSPACE_SECRET')], { projectId: 'project-a' }, workspaces[1]!)
for (let i = 0; i < 12; i++) await source(`old-${i.toString().padStart(2, '0')}`, [user('one', `OLDER_HISTORY_${i} 季度口径`)])
const original = readFileSync(getSessionFilePath(workspace.rootPath, 'a-history'), 'utf8')
const { getCredentialManager } = await import('@phaneris/shared/credentials')
await getCredentialManager().setLlmApiKey('fixture', 'loopback-only-key')
const scenes: string[] = [], pages: unknown[] = []
let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
  bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
async function connect(id: string) { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: id, token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false }); await client.connect(); return client }
let client = await connect('alpha')
const query = (input: HistoryQuery = {}) => client.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'alpha', input)
try {
  assert(REMOTE_ELIGIBLE_CHANNELS.has(RPC_CHANNELS.assistantMemory.HISTORY))
  const first = await query({ query: '季度' })
  assert(first.coverage.pendingSessions > 0)
  assert(first.coverage.refreshedSessions <= 8)
  pages.push(first)
  let settled = first
  for (let i = 0; settled.coverage.pendingSessions && i < 10; i++) settled = await query({ query: '季度' })
  assert.equal(settled.coverage.pendingSessions, 0)
  assert.equal(settled.coverage.excludedAssistantSessions, 1)
  assert(settled.items.some(item => item.sessionId === 'a-history'), 'Archived ordinary sessions are included')
  assert(settled.items.some(item => item.sessionId === 'b-hidden'), 'Hidden ordinary sessions are included')
  assert.equal((await query()).coverage.refreshedSessions, 0)
  assert(!JSON.stringify(settled).includes('OTHER_WORKSPACE_SECRET'))
  const foreign = await connect('beta')
  try {
    await assert.rejects(foreign.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'alpha', {}), /workspace/i)
    assert(JSON.stringify(await foreign.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'beta', {})).includes('OTHER_WORKSPACE_SECRET'))
  } finally { foreign.destroy() }
  await assert.rejects(query({ ...{}, path: workspace.rootPath } as HistoryQuery))
  scenes.push('RH01-workspace-boundary', 'RH02-bounded-coverage', 'RH03-all-ordinary-history', 'RH06-unchanged-no-reindex')
  const scoped = await query({ query: '季度', projectId: 'project-a', limit: 20 })
  assert(scoped.items.every(item => item.sessionId === 'a-history'))
  assert.equal(scoped.items.find(item => item.messageId === 'one')?.directUser, true)
  for (const id of ['guess', 'delegated', 'forwarded']) assert.equal(scoped.items.find(item => item.messageId === id)?.directUser, false)
  assert.equal(scoped.items.find(item => item.messageId === 'delegated')?.inputSource?.kind, 'delegation')
  assert.equal(scoped.items.find(item => item.messageId === 'attachment')?.attachmentCount, 1)
  assert.equal(scoped.items.find(item => item.messageId === 'attachment')?.attachmentContentIndexed, false)
  assert.equal((await query({ query: "100%_ '" })).items.length, 1)
  assert.equal((await query({ sessionId: 'b-hidden' })).items.length, 1)
  assert.equal((await query({ query: 'ASSISTANT_HISTORY_EXCLUDED' })).items.length, 0)
  assert.equal(readFileSync(getSessionFilePath(workspace.rootPath, 'a-history'), 'utf8'), original, 'Indexing must not rewrite the source JSONL')
  scenes.push('RH04-provenance-not-user-authority', 'RH05-scope-and-literal-search', 'RH11-attachment-coverage')
  const toolMessage: StoredMessage = { id: 'tool-result', type: 'tool', content: '', toolName: 'file_read', toolUseId: 'call-1',
    toolInput: { path: 'TOOL_INPUT_EVIDENCE.txt' }, toolResult: 'TOOL_RESULT_EVIDENCE', toolStatus: 'completed' }
  await source('tool-history', [toolMessage])
  const toolHit = (await query({ query: 'TOOL_RESULT_EVIDENCE' })).items[0]!
  assert.equal(toolHit?.role, 'tool')
  assert.equal(toolHit.directUser, false)
  assert.equal((await query({ query: 'TOOL_INPUT_EVIDENCE' })).items.length, 1)
  const toolRead = await client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: toolHit.sessionId, messageId: toolHit.messageId, expectedContentHash: toolHit.contentHash })
  assert(toolRead.content.includes('TOOL_RESULT_EVIDENCE') && toolRead.content.includes('TOOL_INPUT_EVIDENCE'))
  await source('tool-history', [{ ...toolMessage, toolResult: 'TOOL_RESULT_REVISED' }])
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: toolHit.sessionId, messageId: toolHit.messageId, expectedContentHash: toolHit.contentHash }), /hash|changed/i)
  assert.equal((await query({ query: 'TOOL_RESULT_EVIDENCE' })).items.length, 0)
  assert.equal((await query({ query: 'TOOL_RESULT_REVISED' })).items.length, 1)
  scenes.push('RH15-tool-input-result-source', 'RH15-tool-result-change-invalidates-hash')
  const page = await query({ query: '季度', limit: 2 })
  assert(page.nextCursor)
  const next = await query({ query: '季度', limit: 2, cursor: page.nextCursor })
  assert(!next.items.some(item => page.items.some(previous => previous.sessionId === item.sessionId && previous.messageId === item.messageId)))
  await assert.rejects(query({ query: 'different', limit: 2, cursor: page.nextCursor }), /cursor|query/i)
  pages.push(page, next, scoped)
  const stale = scoped.items.find(item => item.messageId === 'one')!
  const record = loadSession(workspace.rootPath, 'a-history')!
  await source(record.id, [...record.messages.filter(message => message.id !== 'one'), user('one', '月度口径 CHANGED_HISTORY'), user('new', 'NEW_HISTORY_MESSAGE')], { projectId: 'project-c', isArchived: true })
  await assert.rejects(query({ query: '季度', limit: 2, cursor: page.nextCursor }), /cursor|version/i)
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: stale.sessionId, messageId: stale.messageId, expectedContentHash: stale.contentHash }), /changed|version|hash/i)
  assert.equal((await query({ query: 'NATIVE_HISTORY_EVIDENCE' })).items.length, 0)
  assert.equal((await query({ query: 'CHANGED_HISTORY', projectId: 'project-c' })).items.length, 1)
  assert.equal((await query({ query: 'NEW_HISTORY_MESSAGE' })).items.length, 1)
  scenes.push('RH06-rewrite-append-and-project-change', 'RH09-pagination-and-query-binding', 'RH10-source-version-check')
  const remembered = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'history-remember', key: 'temporary', content: 'CHANGED_HISTORY', kind: 'decision', basis: 'user_stated', sources: [{ sessionId: 'a-history', messageId: 'one' }] })
  const beforeForget = await query({ limit: 2 })
  await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'history-forget', id: remembered.record.id, expectedRevision: 1, state: 'forgotten' })
  await assert.rejects(query({ limit: 2, cursor: beforeForget.nextCursor! }), /cursor|version/i)
  assert.equal((await query({ query: 'CHANGED_HISTORY' })).items.length, 0)
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: 'a-history', messageId: 'one' }), /suppress|forgot/i)
  scenes.push('RH08-suppression-on-history', 'RH09-suppression-invalidates-cursor')
  // Restore this fixture's new source for native retrieval; the forgotten message stays suppressed.
  const updated = loadSession(workspace.rootPath, 'a-history')!
  await source(updated.id, [...updated.messages, user('native', 'NATIVE_HISTORY_EVIDENCE')], { projectId: 'project-c', isArchived: true })
  await query()
  unlinkSync(getSessionFilePath(workspace.rootPath, 'b-hidden'))
  assert.equal((await query({ sessionId: 'b-hidden' })).items.length, 0)
  const broken = getSessionFilePath(workspace.rootPath, 'old-00')
  writeFileSync(broken, '{broken header\n')
  const bad = await query({ query: 'OLDER_HISTORY_0' })
  assert.equal(bad.items.length, 0)
  assert.equal(bad.coverage.unreadableSessions, 1)
  await source('bad-lines', [user('valid', 'VALID_ROW_WITH_BAD_LINE')])
  appendFileSync(getSessionFilePath(workspace.rootPath, 'bad-lines'), '{broken message\n')
  const partial = await query({ query: 'VALID_ROW_WITH_BAD_LINE' })
  assert.equal(partial.items.length, 0, 'Partial source must not claim complete indexing')
  assert.equal(partial.coverage.unreadableSessions, 2)
  pages.push(bad, partial)
  scenes.push('RH07-deleted-and-corrupt-source-retracted', 'RH11-corrupt-line-coverage')
  await source('role-variants', [{ id: 'plan', type: 'plan', content: 'PLAN_SOURCE_EVIDENCE' },
    { id: 'auth', type: 'auth-request', content: 'AUTH_SOURCE_EVIDENCE' }])
  assert.equal((await query({ query: 'PLAN_SOURCE_EVIDENCE' })).items[0]?.role, 'plan')
  assert.equal((await query({ query: 'AUTH_SOURCE_EVIDENCE' })).items[0]?.role, 'auth-request')
  await source('bad-snapshot', [])
  appendFileSync(getSessionFilePath(workspace.rootPath, 'bad-snapshot'), JSON.stringify({ id: 'bad-ref', type: 'assistant', content: 'BAD_REF_EVIDENCE',
    __craftSnapshotRefs: { version: 1, prompt: 'a'.repeat(64) } }) + '\n')
  const brokenReference = await query({ query: 'NATIVE_HISTORY_EVIDENCE' })
  assert.equal(brokenReference.coverage.unreadableSessions, 3)
  assert.equal(brokenReference.items.length, 1)
  scenes.push('RH14-normal-role-variants', 'RH14-broken-reference-isolated')
  client.destroy(); await host.stop()
  const db = openSqliteDatabase(join(workspace.rootPath, 'memory/memory.db'))
  // Disposable index rebuild must never delete the authority's suppression rows.
  db.exec('DELETE FROM history_messages; DELETE FROM history_sessions;')
  db.close()
  host = await boot(); client = await connect('alpha')
  let rebuilt = await query({ query: 'CHANGED_HISTORY' })
  for (let i = 0; rebuilt.coverage.pendingSessions && i < 10; i++) rebuilt = await query({ query: 'CHANGED_HISTORY' })
  assert.equal(rebuilt.items.length, 0)
  scenes.push('RH08-rebuild-and-host-restart')
  await manager.sendMessage('resident-history-assistant', 'Find the ordinary historical evidence.')
  assert.equal(requests.length, 3)
  const delivered = JSON.stringify((requests[1]!.messages as Array<{ role: string }>).filter(message => message.role === 'tool'))
  assert(delivered.includes('NATIVE_HISTORY_EVIDENCE') && delivered.includes('contentHash') && delivered.includes('a-history') && delivered.includes('native'))
  assert(!delivered.includes('CHANGED_HISTORY') && !delivered.includes('OTHER_WORKSPACE_SECRET'))
  assert(JSON.stringify(requests[2]!.messages).includes('nextOffset'), 'The real read tool must receive and validate the selected source hash')
  scenes.push('RH12-production-host-native-pi-request')
  const { getSessionToolProxyDefs } = await import('../../../packages/shared/src/agent/backend/pi/session-tool-defs')
  assert(!getSessionToolProxyDefs(workspace.rootPath).some(tool => tool.name.endsWith('assistant_history_search')))
  // The only edits of this fixture source were the explicit source() writes above.
  assert(original.includes('NATIVE_HISTORY_EVIDENCE'))
  assert.equal(readFileSync(getSessionFilePath(workspace.rootPath, 'old-01'), 'utf8').includes('OLDER_HISTORY_1'), true)
  copyFileSync(getSessionFilePath(workspace.rootPath, 'a-history'), join(output, 'source-session.jsonl'))
  copyFileSync(getSessionFilePath(workspace.rootPath, 'resident-history-assistant'), join(output, 'assistant-session.jsonl'))
  scenes.push('RH13-ordinary-catalog-and-source-preservation')
  writeFileSync(join(output, 'history-evidence.json'), JSON.stringify({ scenes, pages, rebuilt, requests }, null, 2))
} finally { client.destroy(); await host.stop(); provider.stop(true) }
