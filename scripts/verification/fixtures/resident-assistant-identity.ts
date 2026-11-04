import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '@phaneris/shared/protocol'
import { loadSession, saveSession } from '@phaneris/shared/sessions'

const config = process.env.PHANERIS_CONFIG_DIR!
const root = process.argv[2]!
if (!config || !root) throw new Error('An isolated config and evidence root are required')
const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, rootPath: join(config, id), createdAt: 1 }))
for (const workspace of workspaces) mkdirSync(workspace.rootPath, { recursive: true })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'alpha', setupDeferred: true, llmConnections: [] }))
let callbackMemory: import('../../../packages/server-core/src/resident-assistant/memory-store').AssistantMemoryStore | undefined
const scenes: string[] = []
const boot = () => bootstrapServer({
  serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0,
  bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) {
    setSessionPlatform(platform)
    setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) })
  },
  createSessionManager: runtime => new SessionManager(runtime), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps),
  initializeSessionManager: manager => manager.initialize(), bindRpcServer: (manager, server) => manager.setRpcServer(server),
  setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
  cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  cleanupClientResources: cleanupSessionFileWatchForClient,
})
let instance = await boot()
let alpha = new WsRpcClient(`ws://127.0.0.1:${instance.port}`, { workspaceId: 'alpha', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false })
let beta = new WsRpcClient(`ws://127.0.0.1:${instance.port}`, { workspaceId: 'beta', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false })
try {
  await Promise.all([alpha.connect(), beta.connect()])
  assert(REMOTE_ELIGIBLE_CHANNELS.has(RPC_CHANNELS.residentAssistant.GET))
  const results = await Promise.all(Array.from({ length: 10 }, () => alpha.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')))
  const assistant = results[0]!
  assert(results.every(result => result.id === assistant.id))
  assert.equal(assistant.sessionKind, 'resident_assistant')
  assert.equal(assistant.hidden, true)
  assert.equal(loadSession(workspaces[0]!.rootPath, assistant.id)?.sessionKind, 'resident_assistant')
  const second = await beta.invoke(RPC_CHANNELS.residentAssistant.GET, 'beta')
  assert.notEqual(assistant.id, second.id)
  await assert.rejects(beta.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha'), /workspace/i)
  scenes.push('RA01-concurrent-singleton', 'RA02-workspace-identity')
  const ordinary = await alpha.invoke(RPC_CHANNELS.sessions.CREATE, 'alpha', { name: 'Assistant' })
  assert.equal(ordinary.sessionKind, undefined)
  const forged = await alpha.invoke(RPC_CHANNELS.sessions.CREATE, 'alpha', { sessionKind: 'resident_assistant' })
  assert.equal(forged.sessionKind, undefined)
  await assert.rejects(alpha.invoke(RPC_CHANNELS.sessions.CREATE, 'alpha', { systemPromptPreset: 'resident_assistant' }), /reserved|resident/i)
  assert.equal((await alpha.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, assistant.id)
  const bundle = await alpha.invoke(RPC_CHANNELS.sessions.EXPORT, assistant.id)
  const imported = await alpha.invoke(RPC_CHANNELS.sessions.IMPORT, 'alpha', bundle, 'fork') as { sessionId: string }
  assert.equal((await alpha.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, imported.sessionId))?.sessionKind, undefined)
  assert.notEqual(loadSession(workspaces[0]!.rootPath, imported.sessionId)?.systemPromptPreset, 'resident_assistant')
  scenes.push('RA03-role-forgery')
  await assert.rejects(alpha.invoke(RPC_CHANNELS.sessions.DELETE, assistant.id), /resident|assistant/i)
  await assert.rejects(alpha.invoke(RPC_CHANNELS.sessions.COMMAND, assistant.id, { type: 'archive' }), /resident|assistant/i)
  await assert.rejects(alpha.invoke(RPC_CHANNELS.sessions.COMMAND, assistant.id, { type: 'setSessionStatus', state: 'done' }), /resident|assistant/i)
  await alpha.invoke(RPC_CHANNELS.sessions.COMMAND, ordinary.id, { type: 'archive' })
  await alpha.invoke(RPC_CHANNELS.sessions.DELETE, forged.id)
  scenes.push('RA04-lifecycle-protection', 'RA11-ordinary-session-compatibility')
  alpha.destroy(); beta.destroy(); await instance.stop()
  instance = await boot()
  alpha = new WsRpcClient(`ws://127.0.0.1:${instance.port}`, { workspaceId: 'alpha', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false })
  beta = new WsRpcClient(`ws://127.0.0.1:${instance.port}`, { workspaceId: 'beta', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false })
  await Promise.all([alpha.connect(), beta.connect()])
  assert.equal((await alpha.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, assistant.id)
  scenes.push('RA02-host-restart')

  const { isResidentAssistantToolAllowed } = await import('../../../packages/shared/src/agent/resident-role')
  const { PiAgent } = await import('../../../packages/shared/src/agent/pi-agent')
  const { compileSystemPrompt } = await import('../../../packages/shared/src/prompts/system')
  const { getSessionToolProxyDefs } = await import('../../../packages/shared/src/agent/backend/pi/session-tool-defs')
  const { buildResidentMemoryCallbacks } = await import('../../../packages/server-core/src/resident-assistant/memory-callbacks')
  const { mergeSessionScopedToolCallbacks } = await import('../../../packages/shared/src/agent/session-scoped-tool-callback-registry')
  const { attachSessionSelfManagementBindings } = await import('../../../packages/shared/src/agent/session-self-management-bindings')
  const { SESSION_TOOL_REGISTRY } = await import('@phaneris/session-tools-core')
  const denied = ['bash', 'powershell', 'write', 'edit', 'read', 'codemode', 'mcp__session__update_user_preferences', 'mcp__session__send_agent_message', 'mcp__external__anything']
  const responses: Array<Record<string, unknown>> = []
  let effects = 0
  const bridge = { config: { systemPromptPreset: 'resident_assistant', workspace: workspaces[0],
    durableToolBoundary: { prepare: () => { effects++; throw new Error('Forbidden effect') } } }, send: (response: Record<string, unknown>) => responses.push(response) }
  const port = PiAgent.prototype as unknown as {
    handlePreToolUseRequest: (this: unknown, request: unknown) => Promise<void>
    routeToolCall: (this: unknown, name: string, args: object) => Promise<{ isError: boolean }>
    handleDurableToolPrepareRequest: (this: unknown, request: unknown) => Promise<void>
  }
  for (const name of denied) {
    assert(!isResidentAssistantToolAllowed('resident_assistant', name))
    await port.handlePreToolUseRequest.call(bridge, { requestId: name, toolName: name, input: {}, permissionMode: 'allow-all' })
    assert.equal(responses.at(-1)?.action, 'block')
    assert.equal((await port.routeToolCall.call(bridge, name, {})).isError, true)
    await port.handleDurableToolPrepareRequest.call(bridge, { requestId: name, toolName: name })
    assert.equal(responses.at(-1)?.ok, false)
  }
  assert.equal(effects, 0)
  assert(isResidentAssistantToolAllowed(undefined, 'bash'))
  const tools = getSessionToolProxyDefs(workspaces[0]!.rootPath, 'resident_assistant')
  assert(tools.every(tool => isResidentAssistantToolAllowed('resident_assistant', tool.name)))
  assert(tools.some(tool => tool.name.endsWith('assistant_memory_search')))
  assert(!getSessionToolProxyDefs(workspaces[0]!.rootPath).some(tool => tool.name.includes('assistant_memory_')))
  const prompt = compileSystemPrompt({ preset: 'resident_assistant', workspaceRootPath: workspaces[0]!.rootPath, pinnedPreferencesPrompt: '\nUSER-COLLABORATION-RULE\n' })
  assert(prompt.sections.some(section => section.id === 'resident-role'))
  assert(!prompt.sections.some(section => section.id === 'execution-contract'), 'Resident role must use its own prompt rather than the ordinary executor contract')
  assert(prompt.text.includes('USER-COLLABORATION-RULE'))
  assert(!compileSystemPrompt({ pinnedPreferencesPrompt: '' }).sections.some(section => section.id === 'resident-role'))
  scenes.push('RA05-role-over-permission', 'RA06-host-double-boundary', 'RA07-catalog-filtering', 'RA08-role-prompt', 'RA10-ordinary-catalog')

  const sourceId = '261103-role-proof'
  await saveSession({ id: sourceId, workspaceRootPath: workspaces[0]!.rootPath, createdAt: 1, lastUsedAt: 1,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    messages: [{ id: 'source-user', type: 'user', content: '本项目采用季度口径。', timestamp: 1 }] })
  const memory = await alpha.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'role-remember',
    key: 'quarterly', content: '本项目采用季度口径', kind: 'decision', basis: 'user_stated', sources: [{ sessionId: sourceId, messageId: 'source-user' }] })
  mergeSessionScopedToolCallbacks(assistant.id, buildResidentMemoryCallbacks({ workspace: workspaces[0]!, memory: callbackMemory = new (await import('../../../packages/server-core/src/resident-assistant/memory-store')).AssistantMemoryStore(workspaces[0]!), assertResidentRole: () => {} }))
  const context = { sessionId: assistant.id } as import('@phaneris/session-tools-core').SessionToolContext
  attachSessionSelfManagementBindings(context, assistant.id)
  const search = SESSION_TOOL_REGISTRY.get('assistant_memory_search')
  const read = SESSION_TOOL_REGISTRY.get('assistant_memory_read')
  assert(search?.executionMode === 'registry' && read?.executionMode === 'registry')
  assert(search.handler && read.handler)
  const recalled = await search.handler(context, search.inputSchema.parse({ query: '季度' }))
  assert(JSON.stringify(recalled).includes('季度口径'))
  await alpha.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'role-forget', id: memory.record.id, expectedRevision: 1, state: 'forgotten' })
  assert(!JSON.stringify(await search.handler(context, search.inputSchema.parse({ query: '季度' }))).includes('季度口径'))
  assert.equal((await read.handler(context, read.inputSchema.parse({ sessionId: sourceId, messageId: 'source-user' }))).isError, true)
  scenes.push('RA09-live-memory-tool-bindings')
  writeFileSync(join(root, 'resident-prompt.txt'), prompt.text)
  writeFileSync(join(root, 'identity-result.json'), JSON.stringify({ scenes, assistantId: assistant.id, otherAssistantId: second.id, tools: tools.map(tool => tool.name), effects }))
} finally { callbackMemory?.close(); alpha.destroy(); beta.destroy(); await instance.stop() }
