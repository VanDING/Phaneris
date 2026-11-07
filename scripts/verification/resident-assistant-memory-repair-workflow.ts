import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure contracts before production changes: real workspace creation must share
// identity; registered legacy aliases must preserve policy choices without granting
// forged identities; unassessed memories remain readable but are never invented
// preferences; a resident Session larger than one RPC frame must load losslessly
// through the actual client proxy, including snapshots, after a Host restart.
await verificationWorkflow('resident-assistant-memory-repair', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'legacy')
  mkdirSync(root, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [], setupDeferred: true, llmConnections: [] }))
  const { addWorkspace } = await import('@phaneris/shared/config/workspace-selection')
  const { createWorkspaceAtPath, loadWorkspaceConfig } = await import('@phaneris/shared/workspaces/storage')
  const { readAssistantMemoryPolicy, initializeAssistantMemoryPolicy } = await import('@phaneris/shared/workspaces')
  const { saveSession, loadSession, listSessions, getSessionPath, resolveSessionWorkingDirectory } = await import('@phaneris/shared/sessions')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { buildClientApi } = await import('../../apps/electron/src/transport/build-api')
  const { RPC_CHANNELS, MAX_MESSAGE_PAYLOAD_BYTES } = await import('@phaneris/shared/protocol')
  const { serializeEnvelope } = await import('../../packages/server-core/src/transport/codec')
  const scenes: string[] = [], failures: Array<{ scene: string; error: string }> = []
  const check = async (scene: string, work: () => unknown | Promise<unknown>) => {
    try { await work(); scenes.push(scene) }
    catch (error) { failures.push({ scene, error: error instanceof Error ? error.message : String(error) }) }
    run.json('repair-progress.json', { scenes, failures })
  }
  const created = addWorkspace({ name: 'New workspace', rootPath: join(config, 'new') })
  await check('MR01-real-workspace-creation-shares-one-id', () => assert.equal(created.id, loadWorkspaceConfig(created.rootPath)?.id))
  const local = createWorkspaceAtPath(root, 'Legacy workspace')
  local.defaults = { ...local.defaults, workingDirectory: 'none' }
  const workspace = { id: 'registered-legacy', name: 'Legacy workspace', rootPath: root, createdAt: 1 }
  const foreign = { id: 'foreign', name: 'Foreign', rootPath: join(config, 'foreign'), createdAt: 1 }
  mkdirSync(foreign.rootPath, { recursive: true })
  writeFileSync(join(foreign.rootPath, 'config.json'), JSON.stringify({ id: foreign.id, name: foreign.name, assistantMemory: false }))
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace, foreign, created], activeWorkspaceId: workspace.id, setupDeferred: true, llmConnections: [] }))
  const persist = (assistantMemory?: unknown) => writeFileSync(join(root, 'config.json'), JSON.stringify({ ...local, ...(assistantMemory === undefined ? {} : { assistantMemory }) }))
  persist()
  await check('MR02-registered-legacy-id-initializes-automatic-learning', () => {
    initializeAssistantMemoryPolicy(workspace)
    const policy = readAssistantMemoryPolicy(workspace)
    assert.equal(policy.valid, true); assert.equal(policy.learning, 'automatic'); assert.equal(policy.use, true)
    assert.equal(loadWorkspaceConfig(root)?.id, local.id, 'Legacy local references must not be renamed')
  })
  await check('MR03-forged-workspace-id-remains-rejected', () => assert.equal(readAssistantMemoryPolicy({ ...workspace, id: 'forged' }).valid, false))
  await check('MR04-all-explicit-policy-choices-survive-legacy-compatibility', () => {
    for (const value of [false, { version: 1, learning: 'paused', use: true }, { version: 1, learning: 'explicit', use: true }, { version: 1, learning: 'automatic', use: false }] as const) {
      persist(value); initializeAssistantMemoryPolicy(workspace)
      assert.deepEqual(loadWorkspaceConfig(root)?.assistantMemory, value)
      const actual = readAssistantMemoryPolicy(workspace)
      assert.equal(actual.valid, true)
      assert.equal(actual.learning, value === false ? 'paused' : value.learning)
      assert.equal(actual.use, value === false ? false : value.use)
    }
  })
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  await saveSession({ id: 'memory-source', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    messages: [{ id: 'user', type: 'user', timestamp: 1, content: 'Explain unfamiliar ideas with a concrete example first.' }] })
  await saveSession({ id: 'sentinel-source', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, workingDirectory: 'none', tokenUsage: usage,
    messages: [{ id: 'user', type: 'user', timestamp: 1, content: 'NO_PROJECT_WORKING_DIRECTORY' }] })
  await check('MR14-no-project-directory-never-expands-the-none-sentinel', () => {
    assert.equal(loadWorkspaceConfig(root)?.defaults?.workingDirectory, 'none')
    assert.equal(loadSession(root, 'sentinel-source')?.workingDirectory, 'none')
    assert.equal(listSessions(root).find(session => session.id === 'sentinel-source')?.workingDirectory, 'none')
    assert.equal(resolveSessionWorkingDirectory(root, 'sentinel-source', 'none'), getSessionPath(root, 'sentinel-source'))
  })
  const hugeSource = 'SOURCE_PAGE_'.repeat(1500000)
  await saveSession({ id: 'huge-source', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    messages: [{ id: 'original', type: 'user', timestamp: 1, content: hugeSource }] })
  persist({ version: 1, learning: 'automatic', use: true })
  const memory = new AssistantMemoryStore(workspace)
  const remembered = memory.mutate({ action: 'remember', requestId: 'legacy-seed', key: 'legacy-example', content: 'Use a concrete example when explaining unfamiliar ideas.',
    kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'memory-source', messageId: 'user' }] })
  await check('MR05-legacy-records-are-visible-without-invented-classification', () => {
    assert(memory.lookup({ query: 'concrete' }).items.some(item => item.id === remembered.record.id))
    const profile = memory.profile({})
    assert.equal(profile.items.length, 0)
    assert.equal((profile.coverage as typeof profile.coverage & { unassessedRecords?: number }).unassessedRecords, 1)
  })
  await check('MR06-policy-errors-distinguish-explicit-paused-and-invalid', () => {
    const command = { action: 'remember' as const, requestId: 'blocked', key: 'blocked', content: 'Use examples.', kind: 'fact' as const, basis: 'inferred' as const,
      assessment: { domain: 'collaboration' as const, confidence: 'supported' as const, durability: 'durable' as const, reason: 'Exact original user preference.' },
      sources: [{ sessionId: 'memory-source', messageId: 'user' }] }
    persist({ version: 1, learning: 'explicit', use: true })
    assert.throws(() => memory.mutate(command, 'automatic'), /explicit.*request/i)
    persist({ version: 1, learning: 'paused', use: true })
    assert.throws(() => memory.mutate(command, 'user_request'), /learning is paused/i)
    persist({ version: 1, learning: 'broken', use: true })
    assert.throws(() => memory.mutate(command, 'automatic'), /configuration.*invalid/i)
  })
  await check('MR07-legacy-record-can-be-reassessed-from-its-source', () => {
    persist({ version: 1, learning: 'automatic', use: true })
    memory.mutate({ action: 'revise', requestId: 'reassess', id: remembered.record.id, expectedRevision: 1, content: remembered.record.content!,
      sources: [{ sessionId: 'memory-source', messageId: 'user' }], assessment: { domain: 'collaboration', confidence: 'supported', durability: 'durable', reason: 'Exact original user preference.' } }, 'automatic')
    assert(memory.profile({}).items.some(item => item.id === remembered.record.id))
  })
  memory.close()
  // Explicit-only suppresses unrelated background work during transport checks.
  persist({ version: 1, learning: 'explicit', use: true })
  const prompt = 'DIAGNOSTIC_PROMPT_'.repeat(9000)
  const messages = Array.from({ length: 120 }, (_, index) => ({ id: `reply-${index}`, type: 'assistant' as const, timestamp: index + 1,
    content: `ORIGINAL_REPLY_${index}`, promptSnapshot: prompt,
    contextSnapshot: { version: 1 as const, capturedAt: index, provider: 'fixture', model: 'fixture', system: { hash: 'a'.repeat(64), chars: prompt.length },
      messages: [], tools: [{ name: 'read', hash: 'b'.repeat(64), schemaChars: 1000, description: 'TOOL_DESCRIPTION_'.repeat(1000) }] } }))
  const expectedBytes = Buffer.byteLength(JSON.stringify(messages))
  assert(expectedBytes > MAX_MESSAGE_PAYLOAD_BYTES, 'The fixture must exceed a single frame')
  await saveSession({ id: 'resident-large', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    sessionKind: 'resident_assistant', hidden: true, permissionMode: 'safe', messages })
  let manager!: InstanceType<typeof SessionManager>
  const boot = () => bootstrapServer({ serverToken: 'memory-repair-fixture-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps, registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps),
    initializeSessionManager: manager => manager.initialize(), bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  let host = await boot()
  const connect = async (workspaceId: string) => { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId, token: 'memory-repair-fixture-token', autoReconnect: false }); await client.connect(); return client }
  let client = await connect(workspace.id)
  const frames: Array<{ channel: string; bytes: number }> = []
  const proxy = () => buildClientApi({ invoke: async (channel: string, ...args: unknown[]) => {
    const result = await client.invoke(channel, ...args)
    const bytes = Buffer.byteLength(serializeEnvelope({ id: 'verification', type: 'response', channel, result }))
    frames.push({ channel, bytes }); assert(bytes < MAX_MESSAGE_PAYLOAD_BYTES)
    return result
  } } as import('../../packages/server-core/src/transport/types').RpcClient,
  { getResidentAssistant: { type: 'invoke', channel: RPC_CHANNELS.residentAssistant.GET },
    setAssistantExecutionMode: { type: 'invoke', channel: RPC_CHANNELS.residentAssistant.EXECUTION_MODE } }, () => true)
  try {
    await check('MR13-management-source-read-is-bounded-and-versioned', async () => {
      const first = await client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, workspace.id, { sessionId: 'huge-source', messageId: 'original' })
      assert.equal(first.content, hugeSource.slice(0, 5000))
      const range = first as typeof first & { range: { offset: number; end: number; fullChars: number }; nextOffset: number }
      assert.equal(range.range.fullChars, hugeSource.length); assert.equal(range.nextOffset, 5000)
      const next = await client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, workspace.id, { sessionId: 'huge-source', messageId: 'original',
        expectedContentHash: first.contentHash, offset: range.nextOffset, maxChars: 1000 })
      assert.equal(next.content, hugeSource.slice(5000, 6000))
      await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, workspace.id,
        { sessionId: 'huge-source', messageId: 'original', expectedContentHash: '0'.repeat(64) }), /changed|hash/i)
    })
    await check('MR08-resident-metadata-never-returns-the-whole-timeline', async () => {
      const result = await client.invoke(RPC_CHANNELS.residentAssistant.GET, workspace.id)
      assert.equal(result.id, 'resident-large'); assert.equal(result.messages.length, 0)
    })
    await check('MR09-large-resident-loads-through-real-proxy-with-snapshots', async () => {
      const session = await proxy().getResidentAssistant(workspace.id)
      assert.equal(session.messages.length, messages.length)
      for (const [index, message] of session.messages.entries()) {
        assert.equal(message.content, messages[index]!.content); assert.equal(message.promptSnapshot, prompt)
        assert.deepEqual(message.contextSnapshot, messages[index]!.contextSnapshot)
      }
      assert(frames.some(frame => frame.channel === RPC_CHANNELS.sessions.READ_MESSAGES))
    })
    await check('MR12-changing-execution-mode-also-uses-bounded-session-reads', async () => {
      const updated = await proxy().setAssistantExecutionMode(workspace.id, 'ask')
      assert.equal(updated.workerPermissionMode, 'ask')
      assert.equal(updated.messages.length, messages.length)
      assert.equal(updated.messages.at(-1)?.promptSnapshot, prompt)
    })
    const other = await connect(foreign.id)
    await check('MR10-resident-and-chunks-preserve-workspace-isolation', async () => {
      await assert.rejects(other.invoke(RPC_CHANNELS.residentAssistant.GET, workspace.id), /workspace/i)
      await assert.rejects(other.invoke(RPC_CHANNELS.sessions.READ_MESSAGES, 'resident-large'), /workspace|not found/i)
    })
    other.destroy(); client.destroy(); await host.stop()
    host = await boot(); client = await connect(workspace.id)
    await check('MR11-large-resident-remains-readable-after-restart', async () => {
      const session = await proxy().getResidentAssistant(workspace.id)
      assert.equal(session.messages.length, messages.length); assert.equal(session.messages.at(-1)?.promptSnapshot, prompt)
    })
    run.json('repair-evidence.json', { scenes, failures, expectedBytes, frames, workspacePolicy: readAssistantMemoryPolicy(workspace), sourceBytes: readFileSync(join(root, 'assistant/sessions/resident-large/session.jsonl')).length })
  } finally { client.destroy(); await host.stop() }
  assert.equal(failures.length, 0, JSON.stringify(failures))
  run.complete(scenes, ['Installed user data and installed desktop replacement', 'Paid model quality'])
})
