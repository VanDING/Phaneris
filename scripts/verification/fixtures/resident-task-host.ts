import { isDirectUserSource } from '../../../packages/server-core/src/sessions/input-contracts'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AssistantDispatch } from '@phaneris/session-tools-core/delegation-contracts'

export interface TaskModelRequest {
  model: string; messages: Array<{ role: string; content?: unknown }>
  tools?: Array<{ function: { name: string } }>
}
export function taskModelResponse(body: TaskModelRequest, content: string, call?: { name: string; args: unknown }): Response {
  const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'task-management-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return new Response(chunk({ role: 'assistant' }) + (call
    ? chunk({ tool_calls: [{ index: 0, id: `call-${crypto.randomUUID()}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, 'tool_calls')
    : chunk({ content }) + chunk({}, 'stop')) + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Disposable real Host/RPC/Pi/Runtime. Imported before config owners, with no
 * dependency on the installed app, existing Work tasks or paid credentials. */
export async function createResidentTaskHost(directory: string,
  respond: (body: TaskModelRequest, request: Request) => Response | Promise<Response>, options: { concurrency?: number; model?: string; initialGoal?: string } = {}) {
  const config = join(directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => respond(await request.json() as TaskModelRequest, request) })
  const model = options.model ?? 'fixture'
  const workspace = { id: 'alpha', name: 'Task management fixture', rootPath: root, createdAt: 1 }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture', llmConnections: [{
    slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1,
    baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: model, models: [{ id: model, name: model, shortName: model, description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }],
  }] }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantTasks: options.concurrency ? { concurrency: options.concurrency } : undefined,
    assistantMemory: { version: 1, learning: 'explicit', use: true }, defaults: { permissionMode: 'allow-all', defaultLlmConnection: 'fixture', model } }))
  mkdirSync(join(root, 'sources', 'shared'), { recursive: true })
  writeFileSync(join(root, 'sources', 'shared', 'config.json'), JSON.stringify({ id: 'shared', slug: 'shared', name: 'Shared fixture resource', type: 'local', provider: 'local', enabled: true, local: { path: root }, createdAt: 1, updatedAt: 1 }))
  writeFileSync(join(root, 'sources', 'shared', 'guide.md'), 'Synthetic shared resource. No external service.')
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  let manager!: InstanceType<typeof SessionManager>
  const boot = () => bootstrapServer({ serverToken: 'task-management-fixture-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  let host = await boot()
  const connect = async () => { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'task-management-fixture-token', autoReconnect: false }); await client.connect(); return client }
  let client = await connect()
  const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
  const until = async (condition: () => boolean | Promise<boolean>, timeout = 30000) => {
    const deadline = Date.now() + timeout
    while (!await condition()) { assert(Date.now() < deadline, 'Task management condition did not settle'); await Bun.sleep(25) }
  }
  const sendMain = async (text: string) => {
    await manager.submitInput(assistant.id, { text }, { kind: 'direct_user', channel: 'host' }).finished
    await until(async () => { const value = (await manager.getSession(assistant.id))!; return !value.isProcessing && !value.messages.some(m => m.role === 'user' && isDirectUserSource(m.inputSource) && m.isQueued) })
  }
  const goal = options.initialGoal ?? '完成各项独立报告，按前置依赖推进；可以修订、复核和继续原目标内未完成的工作。'
  await sendMain(goal)
  return {
    workspace, root, config, assistant, goal, until, sendMain,
    get manager() { return manager }, get client() { return client },
    dispatch: (id: string, extra: Partial<AssistantDispatch> = {}) => client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', {
      requestId: id, title: id, instructions: id, goalQuote: goal,
      config: { llmConnection: 'fixture', model, thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' }, ...extra,
    }),
    work: async (id: string) => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id })).items[0]!,
    page: () => client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'current' }),
    control: (command: unknown) => client.invoke('residentAssistant:control', 'alpha', command),
    cancel: (id: string) => client.invoke(RPC_CHANNELS.residentAssistant.CANCEL_WORK, 'alpha', id),
    async restart() { client.destroy(); await host.stop(); host = await boot(); client = await connect(); await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha') },
    async close() { client.destroy(); await host.stop(); api.stop(true) },
  }
}
