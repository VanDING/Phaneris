import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Stage 1 through the real desktop entry.
 *
 * A loopback OpenAI-compatible provider plays the resident model: the user types
 * natural language into the resident assistant Session, and the model's only job
 * is to call `task_create` / `task_amend` / `task_query` / `task_control`.
 * Every identity, version, authority decision and receipt is produced by the real
 * Host. Failure conditions are M01-M09 in
 * docs/verification/assistant-refactor-2026-11-18-failure-matrix.md.
 */
await verificationWorkflow('assistant-task-desktop-entry', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Delegation entry', rootPath: root, createdAt: 1 }

  type Call = { name: string; arguments: Record<string, unknown> }
  const script: Call[] = [], requests: Array<{ main: boolean; toolNames: string[] }> = []
  let assistantTurns = 0
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { model: string; messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> }
    const resident = JSON.stringify(body.messages).includes('resident_assistant_role')
    requests.push({ main: resident, toolNames: body.tools?.map(tool => tool.function.name) ?? [] })
    assert(requests.length < 60, 'Bounded inference budget')
    const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'entry-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const next = resident ? script.shift() : undefined
    const result = next
      ? chunk({ tool_calls: [{ index: 0, id: `call-${assistantTurns++}`, type: 'function', function: { name: `mcp__session__${next.name}`, arguments: JSON.stringify(next.arguments) } }] }, 'tool_calls')
      : chunk({ content: resident ? 'DELEGATION_RECORDED' : 'WORKER_TEXT' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + result + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true,
    defaultLlmConnection: 'fixture', llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai',
      authType: 'api_key', createdAt: 1, baseUrl: provider.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture',
      models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test-only loopback', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }] }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  let manager!: InstanceType<typeof SessionManager>
  const host = await bootstrapServer({ serverToken: 'entry-fixture-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'entry-fixture-token', autoReconnect: false })
  await client.connect()
  const until = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 30000
    while (!await condition()) { assert(Date.now() < deadline, 'Delegation turn did not settle'); await Bun.sleep(25) }
  }
  const scenes: string[] = [], evidence: unknown[] = []
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    const send = async (text: string) => {
      await manager.sendMessage(assistant.id, text)
      await until(async () => !(await manager.getSession(assistant.id))!.isProcessing)
    }
    const tasks = async (query: Record<string, unknown> = {}) => client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', query)

    // M01 · A greeting records no delegation and reads no task history.
    script.push({ name: 'task_query', arguments: {} })
    await send('你好')
    assert.equal((await tasks()).total, 0, 'A greeting must not create a Task')
    const mainTools = requests.find(request => request.main)?.toolNames ?? []
    for (const name of ['task_create', 'task_amend', 'task_query', 'task_control', 'task_verify'])
      assert(mainTools.includes(`mcp__session__${name}`), `The resident catalog must expose ${name}`)
    scenes.push('D01-greeting-creates-no-task')

    // M02 · One clear request becomes one Goal + Task + requirement version + Change.
    script.push({ name: 'task_create', arguments: { requestId: 'entry-pelican', goalTitle: 'Deliver a pelican HTML',
      title: 'Pelican on a bicycle HTML', scopeIn: ['one self-contained HTML file'], requirements: [
        { statement: 'A pelican rides a bicycle', scope: 'task', quote: '做个鹈鹕骑自行车的HTML' },
        { statement: 'One self-contained file', scope: 'task' }],
      acceptance: ['The file opens in a browser', 'The pelican and bicycle are visible'], deliverable: 'self-contained HTML' } })
    await send('做个鹈鹕骑自行车的HTML')
    const created = await tasks()
    assert.equal(created.total, 1)
    const task = created.items[0]!
    assert.equal(task.definitionVersion, 1)
    assert.equal(task.activeRequirements.length, 2)
    assert.equal(task.changes.length, 1)
    assert.equal(task.changes[0]!.inputMessageId !== undefined, true, 'The Change must cite the trusted input')
    evidence.push({ created: task.task.id, version: task.definitionVersion, stage: task.stage })
    scenes.push('D02-clear-request-becomes-versioned-task')

    // M06 · Replaying the same request id returns the original Task instead of a second one.
    script.push({ name: 'task_create', arguments: { requestId: 'entry-pelican', goalTitle: 'other', title: 'other' } })
    await send('再登记一次同样的委托')
    assert.equal((await tasks()).total, 1, 'A replayed request must not create a second Task')
    scenes.push('D03-replayed-request-is-idempotent')

    // M04 · A correction appends a requirement version and keeps the old one readable.
    const first = task.activeRequirements[0]!.id
    script.push({ name: 'task_amend', arguments: { requestId: 'entry-dark', taskId: task.task.id,
      requirements: [{ supersedes: first, statement: 'A dark-background pelican rides a bicycle', scope: 'task' }] } })
    await send('改成深色背景')
    const amended = (await tasks({ taskId: task.task.id })).items[0]!
    assert.equal(amended.definitionVersion, 2)
    assert.equal(amended.requirements.filter(item => item.state === 'superseded').length, 1)
    assert.equal(amended.requirements.find(item => item.state === 'superseded')!.statement, 'A pelican rides a bicycle')
    assert(amended.activeRequirements.some(item => item.statement.includes('dark-background')))
    scenes.push('D04-correction-appends-version')

    // M08 · Readiness answers with concrete facts and binds the version it checked.
    script.push({ name: 'task_query', arguments: { taskId: task.task.id, checkReady: true } })
    await send('这个任务可以开始了吗')
    const checked = (await tasks({ taskId: task.task.id, checkReady: true })).items[0]!
    assert.equal(checked.ready!.definitionVersion, 2)
    assert(checked.ready!.ready, `Expected ready: ${checked.ready!.missing.join(', ')}`)
    assert.deepEqual(checked.ready!.missing, [])
    scenes.push('D05-readiness-binds-version-and-authority')

    // M05 · Control is a durable receipt independent of any model turn.
    const paused = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS_CONTROL, 'alpha',
      { requestId: 'entry-pause', taskIds: [task.task.id], action: 'pause' })
    assert.equal(paused.receipts[0]!.action, 'pause')
    assert.equal((await tasks({ taskId: task.task.id })).items[0]!.stage, 'paused')
    const terminated = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS_CONTROL, 'alpha',
      { requestId: 'entry-stop', taskIds: [task.task.id], action: 'terminate' })
    assert.equal(terminated.receipts[0]!.previousAction, 'pause')
    assert.equal((await tasks({ taskId: task.task.id })).items[0]!.stage, 'cancelled')
    await assert.rejects(() => client.invoke(RPC_CHANNELS.residentAssistant.TASKS_CONTROL, 'alpha',
      { requestId: 'entry-revive', taskIds: [task.task.id], action: 'resume' }), /terminated/)
    scenes.push('D06-control-receipts-and-final-termination')

    // M07 · An unknown task is refused by the Host, not answered with a fake projection.
    script.push({ name: 'task_amend', arguments: { requestId: 'entry-ghost', taskId: 'task-does-not-exist', keep: [] } })
    await send('把不存在的任务改一下')
    const ghost = (await manager.getSession(assistant.id))!.messages.findLast(message => message.role === 'tool')
    assert.equal(ghost?.isError, true, 'An unknown task id must surface as a tool error')
    evidence.push({ ghostError: ghost?.content?.slice(0, 200) })
    scenes.push('D07-unknown-task-is-refused')

    // M33 · A business dispatch must not require a separate preparation pass.
    //
    // The model records the delegation and then dispatches in the very next
    // inference. No `assistant_context prepare` runs in between: the trusted
    // input on this turn plus the Task it established are the authority, so the
    // old "Select alone is not preparation" gate must not appear at all.
    script.push({ name: 'task_create', arguments: { requestId: 'entry-direct', goalTitle: 'Direct dispatch goal',
      title: 'Direct dispatch without preparation', scopeIn: ['one isolated text result'],
      requirements: [{ statement: 'Return a short text result', scope: 'task' }],
      acceptance: ['A text result is returned'] } },
    { name: 'assistant_delegate', arguments: { requestId: 'entry-direct-dispatch', title: 'Direct dispatch without preparation',
      instructions: 'Return DIRECT_DISPATCH_TEXT as the result.', config: { permissionMode: 'safe' } } })
    await send('直接派工，不需要先准备。')
    const directTask = (await tasks()).items.find(item => item.task.id !== task.task.id)
    assert(directTask, 'The direct dispatch must have recorded its own Task')
    const directWork = await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'current', limit: 20 })
    const dispatched = directWork.items.find(item => item.title === 'Direct dispatch without preparation')
    assert(dispatched, 'The delegation must be accepted without a preparation pass')
    assert.notEqual(dispatched.state, 'failed', `Direct dispatch failed: ${dispatched.error ?? 'unknown'}`)
    const directErrors = (await manager.getSession(assistant.id))!.messages
      .filter(message => message.role === 'tool' && message.isError).map(message => message.content)
    assert(!directErrors.some(text => /work_not_prepared|Select alone is not preparation/.test(text ?? '')),
      `A direct dispatch must not be gated on preparation: ${directErrors.join(' | ').slice(0, 500)}`)
    evidence.push({ directTask: directTask.task.id, directDelegation: dispatched.id, directState: dispatched.state })
    scenes.push('D09-business-dispatch-requires-no-preparation-pass')

    // The board projection keeps definition, execution and acceptance as separate facts.
    const final = await tasks({ taskId: task.task.id })
    assert.equal(final.items[0]!.definitionVersion, 2)
    assert.equal(final.items[0]!.executedVersion, undefined, 'No assignment ran, so nothing is executed')
    assert.equal(final.items[0]!.definitionAheadOfExecution, false)
    evidence.push({ finalStage: final.items[0]!.stage, counts: final.counts })
    scenes.push('D08-definition-execution-and-acceptance-stay-separate')

    run.json('desktop-entry-evidence.json', { scenes, evidence, requests: requests.length })
  } finally {
    // The Host owns the shutdown order; flushing and cleaning it by hand leaves
    // detached work that never settles in a fixture process.
    client.destroy()
    await host.stop()
    provider.stop(true)
  }
  run.complete(scenes, ['Real paid model intent quality', 'Worker dispatch to a real Session', 'Electron renderer pixels (separate UI workflow)'])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
