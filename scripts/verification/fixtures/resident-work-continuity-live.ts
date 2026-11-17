import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [output, proxy, model] = process.argv.slice(2) as [string, string, string]
const config = join(output, 'config'), root = join(config, 'workspace')
mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
const workspace = { id: 'continuity-live', name: 'Synthetic work continuity', rootPath: root, createdAt: 1 }
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id, setupDeferred: true,
  defaultLlmConnection: 'synthetic-live', llmConnections: [{ slug: 'synthetic-live', name: 'Fixture proxy', providerType: 'pi_compat',
    piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: proxy, customEndpoint: { api: 'openai-completions' }, defaultModel: model,
    models: [{ id: model, name: model, shortName: model, provider: 'pi', contextWindow: 1000000, maxTokens: 4096, supportsThinking: false }] }] }))
writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'explicit', use: false },
  defaults: { permissionMode: 'safe', defaultLlmConnection: 'synthetic-live', model, workingDirectory: 'none' } }))
const { getCredentialManager } = await import('@phaneris/shared/credentials')
await getCredentialManager().setLlmApiKey('synthetic-live', 'fixture-proxy-only')
const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
let manager!: InstanceType<typeof SessionManager>
const host = await bootstrapServer({ serverToken: 'isolated-continuity-live', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: value => value.initialize(),
  bindRpcServer: (value, server) => value.setRpcServer(server), setSessionEventSink: (value, sink) => value.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async value => { await value.flushAllSessions(); await value.cleanup() } })
const turns: unknown[] = [], scenes: string[] = []
try {
  const assistant = await manager.getOrCreateResidentAssistant(workspace.id)
  const send = async (text: string) => {
    const before = (await manager.getSession(assistant.id))!.messages.length
    const turn = manager.submitInput(assistant.id, { text }, { kind: 'direct_user', channel: 'host' })
    const accepted = await turn.accepted
    await turn.finished
    const deadline = Date.now() + 180000
    while (true) {
      const current = (await manager.getSession(assistant.id))!
      if (!current.isProcessing && !current.messages.find(message => message.id === accepted.messageId)?.isQueued) break
      assert(Date.now() < deadline, 'Accepted foreground input did not finish after the inbox turn')
      await Bun.sleep(200)
    }
    const session = (await manager.getSession(assistant.id))!, added = session.messages.slice(before)
    const reply = added.findLast(message => message.role === 'assistant' && !message.isIntermediate)?.content
    const state = await manager.assistantContext(workspace.id, { action: 'get' })
    turns.push({ text, reply, state, errors: added.filter(message => message.role === 'error'), tools: added.filter(message => message.role === 'tool') })
    writeFileSync(join(output, 'turns.json'), JSON.stringify(turns, null, 2))
    assert(reply, `No final reply: ${JSON.stringify(added.filter(message => message.role === 'error'))}`)
    return { reply, state }
  }
  const first = await send('登记一项持续工作：每日双联知识核对，固定代号 CONTINUITY_8173，默认招呼语为“早上好”。这些规则持续适用。当前这轮只登记和确认，不派发 Worker、不执行核对。请保存工作连续性，以便以后继续。')
  const branch = first.state.focus.topicId
  assert(branch)
  assert(first.state.preparation?.state === 'ready' && first.state.preparation.requirements.some(requirement => requirement.scope === 'work' && requirement.workScopeQuote),
    'Registration must retain sourced work-level requirements, not merely create a label or invocation-only note')
  scenes.push('WC11-real-model-registers-recurring-work-with-sourced-requirements')
  const today = await send('手动做今天这一次双联知识核对，注意招呼语改成“下午好”。现在授权派发一个只读 Worker：只核对固定代号和本次招呼语，用一句话输出，不查网络、不操作文件、不发外部消息。使用本会话同一连接和模型、thinking off；其余规则照旧。')
  assert.equal(today.state.focus.topicId, branch, 'Recurring work must not branch solely because the date changed')
  assert(today.state.preparation?.state === 'ready')
  assert(today.state.preparation.requirements.some(requirement => requirement.scope === 'input'))
  assert(today.state.preparation.requirements.every(requirement => requirement.source.messageId !== today.state.preparation!.inputId || requirement.scope === 'input'),
    'Every clause of this invocation must remain input scoped; a one-time greeting must never replace the standing definition')
  let work = (await manager.getAssistantWork(workspace.id, { limit: 20 })).items
  assert.equal(work.length, 1, 'The real model must dispatch exactly one Worker through its own producer admission')
  const id = work[0]!.id, deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    const current = (await manager.getAssistantWork(workspace.id, { id })).items[0]!
    if (current.state === 'result_ready') break
    assert(!['failed', 'needs_attention'].includes(current.state), current.error)
    await Bun.sleep(200)
  }
  const completed = (await manager.getAssistantWork(workspace.id, { id })).items[0]!
  assert.equal(completed.state, 'result_ready', completed.error)
  const worker = (await manager.getSession(completed.sessionId!))!
  const result = worker.messages.findLast(message => message.role === 'assistant' && !message.isIntermediate)?.content ?? ''
  assert(result.includes('CONTINUITY_8173') && result.includes('下午好'), result)
  const taskInput = worker.messages.find(message => message.delegationInput)!
  assert(taskInput.content.includes('下午好') && taskInput.content.includes('CONTINUITY_8173'))
  writeFileSync(join(output, 'worker.json'), JSON.stringify({ work: completed, input: taskInput, result }, null, 2))
  scenes.push('WC02-real-producer-to-Worker-current-input-scope', 'WC11-real-model-reuses-recurring-branch-for-new-execution')

  await send('这次我已经自行处理，不要再派发任何核对。现在仅解释：前台工作指向、当前要求和实际执行结果是否是一回事？')
  work = (await manager.getAssistantWork(workspace.id, { limit: 20 })).items
  assert.equal(work.length, 1, 'Diagnostic follow-up must not dispatch another execution')
  scenes.push('WC08-real-diagnostic-followup-does-not-repeat-business')
  const single = await send('另外登记一项独立的一次性交付：只针对 Day 72 的简报，代号 SINGLE_72。这个工作不代表以后每天的任务；本轮只登记，不执行。')
  const singleBranch = single.state.focus.topicId
  assert(singleBranch && singleBranch !== branch)
  const next = await send('按照刚才那份单日简报的通用格式，另准备今天的交付，代号 SINGLE_TODAY。Day 72 已结束，本轮仍只确认要求，不执行。')
  assert(next.state.focus.topicId && next.state.focus.topicId !== singleBranch, 'An explicitly independent single-day goal must not silently resume Day 72')
  assert.equal((await manager.getAssistantWork(workspace.id, { limit: 20 })).items.length, 1, 'Registration-only work must not create another execution')
  scenes.push('WC11-real-model-distinguishes-single-delivery-from-recurring-definition')
  writeFileSync(join(output, 'live-evidence.json'), JSON.stringify({ scenes, assistantId: assistant.id, turns, workerResult: result }, null, 2))
} finally { await host.stop() }
