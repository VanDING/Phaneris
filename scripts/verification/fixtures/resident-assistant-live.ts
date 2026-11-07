import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [directory, proxy, model] = process.argv.slice(2) as [string, string, string]
assert(directory && proxy && model)
const config = join(directory, 'config'), root = join(config, 'live')
mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
const workspace = { id: 'live', name: 'Synthetic assistant verification', rootPath: root, createdAt: 1 }
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'live', setupDeferred: true, defaultLlmConnection: 'sample', llmConnections: [{
  slug: 'sample', name: 'Configured live sample', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: proxy,
  customEndpoint: { api: 'openai-completions' }, defaultModel: model, models: [{ id: model, name: model, shortName: model, description: 'Live sample', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }],
}] }))
writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'explicit', use: false }, defaults: { permissionMode: 'safe', defaultLlmConnection: 'sample', model, workingDirectory: 'none' } }))
const { saveSession } = await import('@phaneris/shared/sessions')
await saveSession({ id: 'live-originals', workspaceRootPath: root, name: 'Synthetic original record', isArchived: true, createdAt: 1, lastUsedAt: 1,
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }, messages: [
    { id: 'decision', type: 'user', timestamp: 1, content: 'LIVE_SYNTHETIC_ONLY: 最终采用方案 B，因为只保留本地原始记录。' },
    { id: 'step', type: 'tool', timestamp: 2, content: '', toolName: 'fixture_import', toolUseId: 'import-proof', toolInput: { file: 'synthetic.txt' }, toolStatus: 'error', toolResult: 'LIVE_FAILURE_STEP: 导入阶段找不到 synthetic.txt；尚未发生写入。' },
  ] })
const { getCredentialManager } = await import('@phaneris/shared/credentials'); await getCredentialManager().setLlmApiKey('sample', 'proxy-only-no-provider-credential')
const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
let manager!: InstanceType<typeof SessionManager>
const host = await bootstrapServer({ serverToken: 'assistant-live-synthetic-fixture-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps, registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps),
  initializeSessionManager: manager => manager.initialize(), bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
const scenes: string[] = []
const until = async (condition: () => Promise<boolean>) => { const end = Date.now() + 25000; while (!await condition()) { assert(Date.now() < end, 'Live sample state did not settle'); await Bun.sleep(50) } }
try {
  const assistant = await manager.getOrCreateResidentAssistant('live')
  await manager.sendMessage(assistant.id, '请直接查看会话 live-originals 的原始记录（并未提炼成记忆），说明最终采用了哪套方案、失败发生在哪一步。引用原始证据，并说明接下来合法的处理方式。本轮只检查，不创建任务。')
  const inspected = (await manager.getSession(assistant.id))!
  assert(inspected.messages.some(message => message.role === 'tool' && (message.toolResult ?? '').includes('LIVE_FAILURE_STEP')), 'Live model must actually recover the unmemorized failure evidence')
  assert(inspected.messages.findLast(message => message.role === 'assistant' && !message.isIntermediate)?.content.includes('B'))
  scenes.push('R04-live-model-selects-original-history-and-diagnoses-the-real-recorded-failure')
  const goal = '我授权一个只读 Worker 完成合成校对报告，保持权限为探索。Host 会根据这段授权预置任务；你当前只回复收到，不另行派发。'
  await manager.sendMessage(assistant.id, goal)
  const work = await manager.dispatchAssistantWork('live', { requestId: 'live-held-worker', title: 'Synthetic live management task', goalQuote: goal, instructions: 'Compile the synthetic read-only report.', config: { permissionMode: 'safe', workingDirectory: 'none' } })
  const latest = async () => (await manager.getAssistantWork('live', { id: work.id })).items[0]!
  await until(async () => !!(await latest()).execution?.totalAttempts)
  await manager.sendMessage(assistant.id, `请检查现有任务 ${work.id} 的真实进展，并暂停它当前的模型推理。保留原任务和执行证据，不要取消，也不要另建任务。`)
  assert.equal((await latest()).state, 'paused', 'Live model must choose the published pause capability')
  scenes.push('R04-live-model-inspects-and-pauses-the-existing-runtime-owned-worker')
  await fetch(new URL('/release-worker', proxy), { method: 'POST' })
  await manager.sendMessage(assistant.id, `给现有任务 ${work.id} 补充要求：报告结论先行，标记 LIVE_SUMMARY_FIRST。然后恢复原任务。沿用原会话和授权；完成管理请求后回复，无须循环等待。`)
  await until(async () => (await latest()).state === 'result_ready')
  const controlled = await latest()
  assert(controlled.controls?.some(command => command.actor === 'assistant' && command.action === 'message' && command.phase === 'applied'))
  assert(controlled.controls?.some(command => command.actor === 'assistant' && command.action === 'resume' && command.phase === 'applied'))
  assert.equal(controlled.sessionId, work.sessionId)
  scenes.push('R04-live-model-supplements-and-resumes-without-second-worker-or-expanded-permission')
  writeFileSync(join(directory, 'live-evidence.json'), JSON.stringify({ scenes, work: controlled, assistant: await manager.getSession(assistant.id) }, null, 2))
} finally { await host.stop() }
