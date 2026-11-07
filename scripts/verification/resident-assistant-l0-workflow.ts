import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// V0 failure contracts before implementation: advertised history arguments must
// work for the resident; unmemorized archived/hidden L0 includes tools and errors;
// stable snapshot cursors survive append, reject edit, and never bypass suppression;
// caller-owned scope excludes other workspaces and internal wakeup grants.
await verificationWorkflow('resident-assistant-l0', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, rootPath: join(config, id), createdAt: 1 }))
  const { saveSession, loadSession } = await import('@phaneris/shared/sessions')
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { getSessionScopedToolCallbacks } = await import('../../packages/shared/src/agent/session-scoped-tool-callback-registry')
  const requests: Array<{ messages: Array<{ role: string; content?: unknown }>; tools?: unknown[] }> = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as typeof requests[number]; requests.push(body)
    assert(requests.length <= 12, 'L0 verification model calls must remain bounded')
    const called = body.messages.some(message => message.role === 'tool')
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'l0-fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const reply = called ? chunk({ content: 'L0_INSPECTION_FINISHED' }) + chunk({}, 'stop')
      : chunk({ tool_calls: [{ index: 0, id: `l0-${requests.length}`, type: 'function', function: { name: 'mcp__session__get_session_info',
        arguments: JSON.stringify({ sessionId: 'archived-l0', history: { limit: 10, maxCharacters: 8192 } }) } }] }, 'tool_calls')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture', llmConnections: [{
    slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
    customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }],
  }] }))
  for (const workspace of workspaces) { mkdirSync(workspace.rootPath, { recursive: true }); writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace,
    assistantMemory: { version: 1, learning: 'explicit', use: false }, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } })) }
  const seed = { id: 'archived-l0', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, isArchived: true, hidden: true,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }, messages: [
      { id: 'original', type: 'user' as const, content: 'ORIGINAL_L0_NOT_A_MEMORY：原始决定，仅存对话。', timestamp: 1 },
      { id: 'reply', type: 'assistant' as const, content: 'A_HISTORICAL_PROPOSAL', timestamp: 2 },
      { id: 'tool', type: 'tool' as const, content: '', toolName: 'read', toolUseId: 'read-one', toolInput: { path: 'evidence.txt' }, toolResult: 'L0_TOOL_EFFECT_RESULT', toolStatus: 'completed' as const, timestamp: 3 },
      { id: 'error', type: 'error' as const, content: 'L0_FAILURE_EVIDENCE', timestamp: 4 },
      { id: 'internal', type: 'user' as const, hidden: true, inputSource: { kind: 'session_message' as const }, content: 'INTERNAL_IS_NOT_NEW_AUTHORITY', timestamp: 5 },
      { id: 'long', type: 'user' as const, content: 'LONG_L0_'.repeat(1800), timestamp: 6 },
    ] }
  await saveSession(seed)
  await saveSession({ ...seed, id: 'foreign-l0', workspaceRootPath: workspaces[1]!.rootPath, messages: [{ id: 'foreign', type: 'user', content: 'FOREIGN_L0_SECRET', timestamp: 1 }] })
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  let manager!: InstanceType<typeof SessionManager>
  const host = await bootstrapServer({ serverToken: 'resident-l0-fixture-token-v062', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'resident-l0-fixture-token-v062', autoReconnect: false }); await client.connect()
  const scenes: string[] = []
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    await manager.sendMessage(assistant.id, 'READ_ORIGINAL_L0：直接检查 archived-l0 的原文与失败。')
    const results = requests.flatMap(request => request.messages.filter(message => message.role === 'tool')).map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
    assert(results.some(text => text.includes('ORIGINAL_L0_NOT_A_MEMORY') && text.includes('L0_TOOL_EFFECT_RESULT') && text.includes('L0_FAILURE_EVIDENCE')),
      `The advertised resident history operation must return actual unmemorized original records; got ${JSON.stringify(results).slice(-1000)}`)
    scenes.push('C01-advertised-history-contract-is-callable', 'H01-unmemorized-original-read', 'H02-archived-hidden-sessions', 'H03-tools-errors-internal-provenance', 'H10-explicit-L0-works-with-memory-use-off')
    const callbacks = getSessionScopedToolCallbacks(assistant.id)!
    const info = callbacks.getSessionInfoFn!(assistant.id)!
    assert.equal(info.sessionKind, 'resident_assistant')
    assert.equal(info.capabilities?.role, 'resident_assistant')
    assert(info.capabilities?.tools.includes('get_session_info'))
    assert(!info.capabilities?.tools.includes('write'))
    assert.match(info.capabilities!.revision, /^[a-f0-9]{64}$/)
    scenes.push('C03-host-owned-role-and-capability-view', 'P02-main-role-does-not-gain-business-write')
    const ordinary = await manager.createSession('alpha', { name: 'Ordinary reader', permissionMode: 'safe', workingDirectory: 'none' })
    await manager.sendMessage(ordinary.id, 'Read ordinary history using the published contract.')
    const workerTools = getSessionScopedToolCallbacks(ordinary.id)!
    assert(JSON.stringify(await workerTools.readSessionMessagesFn!('archived-l0', { limit: 10 })).includes('L0_TOOL_EFFECT_RESULT'))
    await assert.rejects(workerTools.readSessionMessagesFn!(assistant.id, {}), /private|assistant history/i)
    scenes.push('C02-ordinary-history-remains-readable-and-main-history-stays-private')
    const read = async (history: import('@phaneris/session-tools-core').SessionHistoryQuery) => await callbacks.readSessionMessagesFn!('archived-l0', history) as {
      messages: Array<{ id: string; role: string; content: string; inputSource?: { kind: string }; nextCharacter: number | null; unavailable?: string }>;
      nextCursor: NonNullable<import('@phaneris/session-tools-core').SessionHistoryQuery['cursor']> | null; snapshot: string;
    }
    const first = await read({ limit: 2 })
    const desktopOriginals = await client.invoke('residentAssistant:originals', 'alpha', 'archived-l0', { limit: 2 }) as typeof first
    assert.deepEqual(desktopOriginals.messages, JSON.parse(JSON.stringify(first.messages)))
    await assert.rejects(client.invoke('residentAssistant:originals', 'alpha', 'foreign-l0', {}), /workspace|not available|not found/i)
    scenes.push('H09-desktop-originals-share-model-access-boundary')
    assert(first.nextCursor)
    await saveSession({ ...loadSession(root, seed.id)!, messages: [...loadSession(root, seed.id)!.messages, { id: 'late', type: 'user', content: 'APPENDED_AFTER_SNAPSHOT', timestamp: 7 }] })
    const next = await read({ cursor: first.nextCursor!, limit: 20 })
    assert(!JSON.stringify(next).includes('APPENDED_AFTER_SNAPSHOT'))
    assert(next.messages.some(message => message.role === 'tool'))
    assert(next.messages.some(message => message.inputSource?.kind === 'session_message'))
    scenes.push('H05-append-does-not-change-cursor-snapshot')
    const long = await read({ messageId: 'long', maxCharacters: 100 })
    assert.equal(long.messages[0]!.content.length, 100)
    assert.equal(long.messages[0]!.nextCharacter, 100)
    scenes.push('H04-bounded-original-character-ranges')
    await assert.rejects(callbacks.readSessionMessagesFn!('foreign-l0', {}), /workspace|not available|not found/i)
    scenes.push('P07-source-workspace-is-host-owned')
    const beforeEdit = await read({ limit: 1 })
    const current = loadSession(root, seed.id)!
    await saveSession({ ...current, messages: current.messages.map(message => message.id === 'original' ? { ...message, content: 'REVISED_ORIGINAL' } : message) })
    await assert.rejects(read({ cursor: beforeEdit.nextCursor! }), /changed|snapshot|conflict/i)
    scenes.push('H06-edit-fences-an-old-snapshot')
    const memory = manager.getAssistantMemoryStore('alpha')
    const originalHash = memory.readSource({ sessionId: seed.id, messageId: 'original' }).contentHash
    const remembered = memory.mutate({ action: 'remember', requestId: 'l0-original', key: 'l0-test', kind: 'fact', basis: 'user_stated', content: 'Temporary source for lifecycle verification',
      sources: [{ sessionId: seed.id, messageId: 'original' }] }, 'user_request')
    memory.registerDerivedSources([{ sessionId: seed.id, messageId: 'reply' }], { sources: [{ sessionId: seed.id, messageId: 'original', contentHash: originalHash }],
      memories: [{ id: remembered.record.id, revision: remembered.record.revision, observedState: remembered.record.state }] })
    memory.mutate({ action: 'transition', requestId: 'l0-cool', id: remembered.record.id, expectedRevision: remembered.record.revision, state: 'dormant' }, 'user_request')
    assert((await read({ messageId: 'reply' })).messages[0]!.content.includes('A_HISTORICAL_PROPOSAL'))
    scenes.push('H08-corrected-or-cooled-memory-does-not-erase-original-history')
    const cooled = memory.query({ includeRetired: true }).items.find(record => record.id === remembered.record.id)!
    memory.mutate({ action: 'transition', requestId: 'l0-forget', id: cooled.id, expectedRevision: cooled.revision, state: 'forgotten' }, 'user_request')
    const forgotten = await read({ limit: 10 })
    assert(!JSON.stringify(forgotten.messages).includes('REVISED_ORIGINAL'))
    assert(!JSON.stringify(forgotten.messages).includes('A_HISTORICAL_PROPOSAL'))
    assert(forgotten.messages.filter(message => ['original', 'reply'].includes(message.id)).every(message => message.unavailable))
    const forgottenDesktop = await client.invoke('residentAssistant:originals', 'alpha', 'archived-l0', { limit: 10 })
    assert(!JSON.stringify(forgottenDesktop).includes('REVISED_ORIGINAL'))
    scenes.push('H07-forgetting-is-shared-by-original-and-derived-L0-reads')
    run.json('l0-evidence.json', { scenes, first, next, long, info })
    run.complete(scenes, ['Paid model routing quality', 'Worker controls are verified in their own workflow', 'Installed user data'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { run.json('provider-requests.json', requests); client.destroy(); await host.stop(); api.stop(true) }
})
