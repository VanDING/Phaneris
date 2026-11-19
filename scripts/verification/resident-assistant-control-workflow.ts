import { isDirectUserSource } from '../../packages/server-core/src/sessions/input-contracts'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Written before controls: requests are CAS/idempotent, pause is a real Runtime
// stop, survives restart, and does not cancel a later human input. Configuration
// applies only at an idle boundary, original input aliases preserve ownership,
// and resume never replays an unknown tool effect. Existing grants cap execution.
await verificationWorkflow('resident-assistant-control', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Worker control', rootPath: root, createdAt: 1 }
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  const requests: Array<{ model: string; messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function: { name: string } }> }> = []
  let nativeControl: import('@phaneris/session-tools-core/worker-control-contracts').WorkerControl | undefined
  let nativePreparation: { requestId: string; branchIds: string[] } | undefined
  let catalogMismatch = false
  let holding = true, workerStarted = false
  let release = Promise.withResolvers<void>()
  let effectRelease = Promise.withResolvers<void>()
  let effectStarted = false, effectWrites = 0
  const executionOrder: string[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname.startsWith('/effect/')) {
      effectStarted = true; effectWrites++
      await effectRelease.promise
      return Response.json({ result: new URL(request.url).pathname.endsWith('followup') ? 'CONTROL_FOLLOWUP_COMMITTED' : 'CONTROL_EFFECT_COMMITTED' })
    }
    const body = await request.json() as typeof requests[number]; requests.push(body)
    assert(requests.length < 90, 'Control verification inference budget')
    const main = JSON.stringify(body.messages).includes('resident_assistant_role')
    if (main && !body.tools?.some(tool => tool.function.name === 'mcp__session__assistant_worker_control')) catalogMismatch = true
    if (!main && holding) {
      workerStarted = true
      await Promise.race([release.promise, new Promise<void>(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true }) })])
      if (request.signal.aborted) return new Response(null, { status: 499 })
    }
    const content = main ? 'CONTROL_GOAL_ACKNOWLEDGED' : 'CONTROL_WORKER_COMPLETED'
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'control-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const all = JSON.stringify(body.messages)
    if (!main && all.includes('Finish independent read-only task.')) return new Response(chunk({ role: 'assistant' }) + chunk({ content: 'INDEPENDENT_READ_ONLY_COMPLETE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    for (const name of ['PRIORITY_HIGH', 'PRIORITY_LOW']) if (!main && all.includes(name)) executionOrder.push(name)
    if (!main && all.includes('CONTROL_UNKNOWN_EFFECT') && !body.messages.some(message => message.role === 'tool' && JSON.stringify(message).includes('CONTROL_EFFECT_COMMITTED'))) {
      const name = body.tools?.find(tool => tool.function.name.startsWith('mcp__effect__') && tool.function.name.includes('api_'))?.function.name
      const call = name ? { name, args: { method: 'POST', path: 'write', params: { once: true } } } : { name: 'tool_search', args: { query: 'effect', limit: 5 } }
      return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: `effect-${requests.length}`, type: 'function', function: {
        name: call.name, arguments: JSON.stringify(call.args) } }] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (!main && all.includes('CONTROL_UNKNOWN_EFFECT') && !all.includes('<worker_control>') && !all.includes('later direct user requirements') && !all.includes('CONTROL_FOLLOWUP_COMMITTED')) {
      const name = body.tools?.find(tool => tool.function.name.startsWith('mcp__effect__') && tool.function.name.includes('api_'))?.function.name
      assert(name, 'The original effect tool remains discoverable')
      return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: `followup-${requests.length}`, type: 'function', function: {
        name, arguments: JSON.stringify({ method: 'POST', path: 'followup', params: { mustNotRunAfterPause: true } }) } }] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (main && nativeControl) {
      // The retired preparation generation is gone; material selection is the
      // retained way to name the work a management call refers to.
      if (nativePreparation) {
        const preparation = nativePreparation; nativePreparation = undefined
        return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: 'native-control-prepare', type: 'function', function: {
          name: 'mcp__session__assistant_context', arguments: JSON.stringify({ command: { action: 'select', branchIds: preparation.branchIds } }) } }] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      }
      const command = nativeControl; nativeControl = undefined
      return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: 'native-worker-control', type: 'function', function: {
        name: 'mcp__session__assistant_worker_control', arguments: JSON.stringify({ command }) } }] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(chunk({ role: 'assistant' }) + chunk({ content }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture', llmConnections: [{
    slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
    customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: ['fixture', 'fixture-b'].map(id => ({ id, name: id, shortName: id, description: 'Test', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false })),
  }] }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'explicit', use: true },
    defaults: { permissionMode: 'allow-all', defaultLlmConnection: 'fixture', model: 'fixture' } }))
  mkdirSync(join(root, 'sources/effect'), { recursive: true })
  writeFileSync(join(root, 'sources/effect/config.json'), JSON.stringify({ id: 'effect', slug: 'effect', name: 'Controlled effect', provider: 'fixture', type: 'api', enabled: true,
    api: { baseUrl: `${api.url.href}effect/`, authType: 'none' }, createdAt: 1, updatedAt: 1 }))
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  let manager!: InstanceType<typeof SessionManager>
  const boot = () => bootstrapServer({ serverToken: 'worker-control-fixture-v062-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  let host = await boot()
  const connect = async () => { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'worker-control-fixture-v062-token', autoReconnect: false }); await client.connect(); return client }
  let client = await connect()
  const until = async (condition: () => boolean | Promise<boolean>) => { const end = Date.now() + 25000; while (!await condition()) { assert(Date.now() < end, 'Control state did not settle'); await Bun.sleep(25) } }
  const scenes: string[] = [], commands: unknown[] = []
  let activeWorkId: string | undefined
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    const sendMain = async (message: string) => {
      await manager.sendMessage(assistant.id, message)
      await until(async () => { const current = (await manager.getSession(assistant.id))!; return !current.isProcessing && !current.messages.some(input => input.role === 'user' && isDirectUserSource(input.inputSource) && input.isQueued) })
    }
    const goal = 'CONTROL_TARGET：完成授权报告，可以按原目标调整执行方式。'
    await sendMain(goal)
    assert(!catalogMismatch, 'Published main capabilities must exist in the actual Pi model tool catalog')
    const work = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'control-target', title: 'CONTROL_TARGET', goalQuote: goal,
      instructions: goal, config: { llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' } })
    activeWorkId = work.id
    const latest = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: work.id })).items[0]!
    await until(async () => workerStarted && (await latest()).state === 'submitted')
    let original = await latest()
    await assert.rejects(client.invoke('residentAssistant:control', 'alpha', { commandId: 'invalid-running-config', id: work.id, expectedSeq: original.seq,
      action: 'configure', config: { model: 'model-with-no-catalog-entry' } }), /model|catalog|configured/i)
    assert((await manager.getSession(original.sessionId!))!.isProcessing, 'Invalid settings must not stop the existing inference')
    assert.equal((await latest()).state, 'submitted')
    scenes.push('C07-invalid-settings-preserve-the-running-worker-and-original-configuration')
    original = await latest()
    const pause = { commandId: 'pause-original', id: work.id, expectedSeq: original.seq, action: 'pause' }
    const paused = await client.invoke('residentAssistant:control', 'alpha', pause) as { command: { phase: string }; work: { state: string } }
    assert.equal(paused.command.phase, 'applied'); assert.equal(paused.work.state, 'paused')
    assert(!(await manager.getSession(original.sessionId!))!.isProcessing)
    commands.push(paused)
    scenes.push('W02-pause-waits-for-real-runtime-stop')
    assert.equal((await client.invoke('residentAssistant:control', 'alpha', pause) as typeof paused).command.phase, 'applied')
    await assert.rejects(client.invoke('residentAssistant:control', 'alpha', { ...pause, action: 'resume' }), /identity|different|fingerprint/i)
    await assert.rejects(client.invoke('residentAssistant:control', 'alpha', { ...pause, commandId: 'stale-seq', action: 'message', message: 'stale' }), /changed|sequence|revision|conflict/i)
    scenes.push('W07-management-idempotency-and-payload-fence', 'W13-stale-command-cannot-overwrite-new-state')
    client.destroy(); await host.stop(); host = await boot(); client = await connect()
    assert.equal((await latest()).state as string, 'paused')
    assert(!(await manager.getSession(original.sessionId!))!.isProcessing)
    scenes.push('W02-explicit-pause-survives-host-restart')
    // Simulate a crash after the Session mutation was flushed but before the
    // command ACK was persisted. Recovery must settle the same intent once.
    const recoveryCommand = { commandId: 'recover-config-ack', id: work.id, expectedSeq: (await latest()).seq,
      action: 'configure' as const, config: { model: 'fixture-b' } }
    await client.invoke('residentAssistant:control', 'alpha', recoveryCommand)
    client.destroy(); await host.stop()
    const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
    const commandsDb = openSqliteDatabase(join(root, 'assistant/delegations.db'))
    commandsDb.prepare("UPDATE worker_commands SET receipt=json_set(receipt,'$.phase','accepted') WHERE id=?").run(recoveryCommand.commandId)
    commandsDb.prepare("UPDATE work SET body=json_set(body,'$.pendingControlId',?) WHERE id=?").run(recoveryCommand.commandId, work.id)
    commandsDb.close()
    const beforeRecoveryCalls = requests.length
    host = await boot(); client = await connect()
    await until(async () => (await latest()).controls?.find(command => command.commandId === recoveryCommand.commandId)?.phase === 'applied')
    assert.equal((await latest()).state, 'paused'); assert.equal(requests.length, beforeRecoveryCalls)
    assert.equal((await client.invoke('residentAssistant:control', 'alpha', recoveryCommand)).command.phase, 'applied')
    scenes.push('W11-session-applied-command-ack-loss-recovers-without-model-replay')
    const change = await client.invoke('residentAssistant:control', 'alpha', { commandId: 'configure-paused', id: work.id, expectedSeq: (await latest()).seq,
      action: 'configure', config: { model: 'fixture-b' } }) as typeof paused
    assert.equal(change.command.phase, 'applied'); commands.push(change)
    assert.equal((await latest()).effectiveConfig!.model, 'fixture-b')
    scenes.push('W05-controlled-configuration-applies-at-idle-boundary')
    const supplement = await client.invoke('residentAssistant:control', 'alpha', { commandId: 'supplement-paused', id: work.id, expectedSeq: (await latest()).seq,
      action: 'message', message: 'CONTROL_SUPPLEMENT_FROM_ASSISTANT：结论先行。' }) as typeof paused
    assert.equal(supplement.work.state, 'paused')
    scenes.push('W01-paused-supplement-is-not-a-direct-user-turn')
    nativeControl = { commandId: 'native-supplement', id: work.id, expectedSeq: (await latest()).seq, action: 'message', message: 'CONTROL_NATIVE_SUPPLEMENT：保留来源。' }
    nativePreparation = { requestId: 'prepare-native-supplement', branchIds: (await latest()).branchIds! }
    await sendMain('向当前 CONTROL_TARGET 补充：保留来源。')
    assert((await latest()).controls?.some(command => command.commandId === 'native-supplement' && command.phase === 'applied' && command.actor === 'assistant'))
    scenes.push('C01-native-model-catalog-and-management-call-match-host-capabilities')
    holding = false
    const resumed = await client.invoke('residentAssistant:control', 'alpha', { commandId: 'resume-paused', id: work.id, expectedSeq: (await latest()).seq, action: 'resume' }) as typeof paused
    commands.push(resumed)
    await until(async () => (await latest()).state === 'result_ready')
    const completed = await latest()
    assert.equal(completed.sessionId, original.sessionId)
    assert.equal(completed.inputMessageId, original.inputMessageId)
    assert(completed.execution!.totalAttempts >= 2)
    assert(requests.some(request => request.model === 'fixture-b' && JSON.stringify(request.messages).includes('CONTROL_SUPPLEMENT_FROM_ASSISTANT')))
    const target = (await manager.getSession(original.sessionId!))!
    assert(target.messages.some(message => message.inputSource?.kind === 'runtime_continuation' && message.inputSource.reason === 'worker_control'))
    scenes.push('W04-resume-preserves-original-work-and-attributed-attempts')
    await assert.rejects(client.invoke('residentAssistant:control', 'alpha', { commandId: 'repeat-completed', id: work.id, expectedSeq: completed.seq, action: 'retry' }), /completed|result|finished/i)
    scenes.push('W10-completed-work-is-not-silently-replayed')
    await sendMain(goal)
    manager.setSessionPermissionMode(assistant.id, 'safe')
    await client.invoke('residentAssistant:executionMode', 'alpha', 'allow-all')
    assert.equal((await manager.getSession(assistant.id))!.permissionMode, 'safe')
    assert.equal((await manager.getSession(assistant.id))!.workerPermissionMode, 'allow-all')
    const authorized = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'separate-execution-policy', title: 'Authorized execution mode', goalQuote: goal,
      instructions: goal, config: { llmConnection: 'fixture', model: 'fixture', permissionMode: 'allow-all', workingDirectory: 'none' } })
    assert.equal(authorized.effectiveConfig!.permissionMode, 'allow-all')
    await until(async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: authorized.id })).items[0]!.state === 'result_ready')
    scenes.push('P03-worker-execution-policy-is-independent-from-main-tool-mode')
    await client.invoke('residentAssistant:executionMode', 'alpha', 'safe')
    const explored = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'explicit-explore-policy', title: 'Explicit explore ceiling', goalQuote: goal,
      instructions: goal, config: { llmConnection: 'fixture', model: 'fixture', permissionMode: 'allow-all', workingDirectory: 'none' } })
    assert.equal(explored.effectiveConfig!.permissionMode, 'safe')
    await until(async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: explored.id })).items[0]!.state === 'result_ready')
    scenes.push('P04-explicit-explore-ceiling-still-caps-worker-effects')
    client.destroy(); await host.stop(); host = await boot(); client = await connect()
    assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).workerPermissionMode, 'safe')
    scenes.push('R05-execution-policy-survives-restart-without-widening')
    await client.invoke('residentAssistant:executionMode', 'alpha', 'allow-all')
    const effectGoal = 'CONTROL_UNKNOWN_EFFECT：执行一次受控写入，保存已发生效果，不重复发送。'
    await sendMain(effectGoal)
    const effected = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'external-effect', title: 'External effect', goalQuote: effectGoal,
      instructions: effectGoal, config: { llmConnection: 'fixture', model: 'fixture', permissionMode: 'allow-all', enabledSourceSlugs: ['effect'], workingDirectory: 'none' } })
    const effectWork = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: effected.id })).items[0]!
    await until(() => effectStarted)
    const waiting = await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-external-effect', id: effected.id, expectedSeq: (await effectWork()).seq, action: 'pause' }) as typeof paused
    assert.equal(waiting.command.phase, 'waiting'); assert.equal(waiting.work.state, 'pause_requested')
    assert((await manager.getSession(effected.sessionId!))!.isProcessing)
    await assert.rejects(client.invoke('residentAssistant:control', 'alpha', { commandId: 'unsafe-resume', id: effected.id, expectedSeq: (await effectWork()).seq, action: 'resume' }), /pending|effect|paused/i)
    assert.equal(effectWrites, 1)
    const independent = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'independent-effect-wait', title: 'Independent task during effect settlement',
      instructions: 'Finish independent read-only task.', goalQuote: effectGoal, config: { permissionMode: 'safe', workingDirectory: 'none' } })
    await until(async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: independent.id })).items[0]?.state === 'result_ready')
    assert.equal(effectWrites, 1)
    effectRelease.resolve()
    await until(async () => { const work = await effectWork(); return work.state === 'paused' && work.controls?.find(command => command.commandId === 'pause-external-effect')?.phase === 'applied' })
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'resume-external-effect', id: effected.id, expectedSeq: (await effectWork()).seq, action: 'resume' })
    await until(async () => (await effectWork()).state === 'result_ready')
    assert.equal(effectWrites, 1)
    scenes.push('W03-pause-fences-new-admission-after-existing-external-effect-settles', 'W04-resume-does-not-repeat-a-committed-external-write')
    effectRelease = Promise.withResolvers<void>(); effectStarted = false
    const ackGoal = 'CONTROL_UNKNOWN_EFFECT: settle the existing effect before its management ACK; later direct user requirements remain separate.'
    await sendMain(ackGoal)
    const ackWork = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'effect-before-management-ack', title: 'Settlement before management ACK', goalQuote: ackGoal,
      instructions: ackGoal, config: { permissionMode: 'allow-all', enabledSourceSlugs: ['effect'], workingDirectory: 'none' } })
    const ackLatest = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: ackWork.id })).items[0]!
    await until(() => effectStarted)
    const controlHost = manager as unknown as { applyWorkerControl(...args: unknown[]): Promise<import('@phaneris/session-tools-core/worker-control-contracts').WorkerControlApplication> }
    const applyControl = controlHost.applyWorkerControl.bind(manager)
    controlHost.applyWorkerControl = async (...args) => {
      const application = await applyControl(...args)
      if ((args[2] as { commandId: string }).commandId === 'pause-before-waiting-ack' && application.phase === 'waiting') {
        effectRelease.resolve()
        await until(async () => (await ackLatest()).state === 'paused')
      }
      return application
    }
    try {
      await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-before-waiting-ack', id: ackWork.id, expectedSeq: (await ackLatest()).seq, action: 'pause' })
      await until(async () => { const current = await ackLatest(); return current.state === 'paused' && current.controls?.find(command => command.commandId === 'pause-before-waiting-ack')?.phase === 'applied' })
    } finally { controlHost.applyWorkerControl = applyControl }
    assert(!(await manager.getSession(ackWork.sessionId!))!.isProcessing)
    scenes.push('W11-effect-settlement-before-the-first-waiting-ack-does-not-strand-a-command')
    const humanGoal = 'CONTROL_HUMAN_PRIORITY：准备核对人工续作归属。'
    await sendMain(humanGoal)
    holding = true; workerStarted = false
    const humanTarget = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'human-priority', title: 'Human priority', goalQuote: humanGoal,
      instructions: humanGoal, config: { llmConnection: 'fixture', model: 'fixture', permissionMode: 'safe', workingDirectory: 'none' } })
    const humanWork = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: humanTarget.id })).items[0]!
    await until(async () => workerStarted && (await humanWork()).state === 'submitted')
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-before-human', id: humanTarget.id, expectedSeq: (await humanWork()).seq, action: 'pause' })
    workerStarted = false
    const humanInput = manager.sendMessage(humanTarget.sessionId!, 'HUMAN_ACTIVE_NEW_WORK')
    await until(() => workerStarted)
    await assert.rejects(client.invoke('residentAssistant:control', 'alpha', { commandId: 'old-work-must-not-stop-human', id: humanTarget.id, expectedSeq: (await humanWork()).seq, action: 'pause' }), /human|direct user|owns|take it over/i)
    assert((await manager.getSession(humanTarget.sessionId!))!.isProcessing)
    holding = false; release.resolve(); await humanInput
    assert.equal((await humanWork()).state as string, 'paused')
    scenes.push('W08-old-assignment-controls-do-not-cancel-new-human-work')
    const priorityGoal = 'CONTROL_PRIORITY：分别执行 HOLD、LOW、HIGH 三项，允许调整排队顺序。'
    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@phaneris/shared/workspaces')
    const priorityConfig = loadWorkspaceConfig(root)!
    saveWorkspaceConfig(root, { ...priorityConfig, assistantTasks: { concurrency: 1 } })
    await sendMain(priorityGoal)
    holding = true; workerStarted = false; release = Promise.withResolvers<void>()
    const queue = (requestId: string, marker: string) => client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId, title: marker, goalQuote: priorityGoal,
      instructions: `${priorityGoal}\n${marker}`, config: { llmConnection: 'fixture', model: 'fixture', permissionMode: 'safe' as const, workingDirectory: 'none' } })
    const hold = await queue('priority-hold', 'PRIORITY_HOLD')
    await until(() => workerStarted)
    const low = await queue('priority-low', 'PRIORITY_LOW'), high = await queue('priority-high', 'PRIORITY_HIGH')
    const highWork = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: high.id })).items[0]!
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'prioritize-high', id: high.id, expectedSeq: highWork.seq, action: 'plan', priority: 90, title: 'Renamed high task', progress: 20 })
    const planned = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: high.id })).items[0]!
    assert.equal(planned.title, 'Renamed high task')
    assert.equal(planned.priority, 90)
    assert.equal((await manager.getSession(high.sessionId!))!.progress, 20)
    holding = false; release.resolve()
    await client.invoke(RPC_CHANNELS.residentAssistant.CANCEL_WORK, 'alpha', hold.id)
    await until(async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: low.id })).items[0]!.state === 'result_ready')
    assert.equal(executionOrder[0], 'PRIORITY_HIGH')
    scenes.push('W06-priority-uses-existing-queue-and-planning-owner')
    saveWorkspaceConfig(root, priorityConfig)
    const supportSession = await manager.createSession('alpha', { name: 'Material support', permissionMode: 'safe', workingDirectory: 'none' })
    await manager.sendMessage(supportSession.id, 'CONTROL_WITHDRAWN_SUPPORT_ONLY')
    const supportInput = (await manager.getSession(supportSession.id))!.messages.find(message => message.role === 'user')!
    const materialGoal = 'CONTROL_REFRESH_GOAL: finish the authorized report from current original requirements.'
    await sendMain(materialGoal)
    const memory = manager.getAssistantMemoryStore('alpha')
    const support = memory.mutate({ action: 'remember', requestId: 'control-support', key: 'control-support', content: 'CONTROL_WITHDRAWN_SUPPORT_ONLY',
      kind: 'fact', basis: 'user_stated', sources: [{ sessionId: supportSession.id, messageId: supportInput.id }] }, 'user_request')
    const { AssistantContextStore } = await import('../../packages/server-core/src/resident-assistant/context-store')
    const context = new AssistantContextStore(workspace, assistant.id, memory)
    context.track({ memories: [{ id: support.record.id, revision: support.record.revision, observedState: support.record.state }], sources: support.record.sources }); context.close()
    holding = true; workerStarted = false; release = Promise.withResolvers<void>()
    const materials = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'withdraw-materials', title: 'Material refresh',
      context: { branchIds: [], sources: support.record.sources.map(source => ({ sessionId: source.sessionId, messageId: source.messageId, expectedContentHash: source.contentHash })) },
      goalQuote: materialGoal, instructions: `${materialGoal}\nCONTROL_WITHDRAWN_SUPPORT_ONLY`, config: { permissionMode: 'safe', workingDirectory: 'none' } })
    const materialsWork = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: materials.id })).items[0]!
    await until(() => workerStarted)
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-materials', id: materials.id, expectedSeq: (await materialsWork()).seq, action: 'pause' })
    const { getSessionScopedToolCallbacks } = await import('../../packages/shared/src/agent/session-scoped-tool-callback-registry')
    // The new context contract deliberately does not inherit a previous global
    // view. Bind the source actually used for this supplement at its boundary.
    const supplementContext = new AssistantContextStore(workspace, assistant.id, memory)
    supplementContext.track({ memories: [{ id: support.record.id, revision: support.record.revision, observedState: support.record.state }], sources: support.record.sources }); supplementContext.close()
    await getSessionScopedToolCallbacks(assistant.id)!.assistantWorkerControlFn!({ commandId: 'derived-support-message', id: materials.id, expectedSeq: (await materialsWork()).seq,
      action: 'message', message: 'CONTROL_WITHDRAWN_SUPPORT_ONLY: a supplement derived from the recalled support.' })
    memory.mutate({ action: 'transition', requestId: 'forget-control-support', id: support.record.id, expectedRevision: support.record.revision, state: 'forgotten' }, 'user_request')
    const refreshRequest = requests.length
    holding = false; release.resolve()
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'resume-current-materials', id: materials.id, expectedSeq: (await materialsWork()).seq, action: 'resume' })
    await until(async () => (await materialsWork()).state === 'result_ready')
    assert(!JSON.stringify(requests.slice(refreshRequest)).includes('CONTROL_WITHDRAWN_SUPPORT_ONLY'))
    scenes.push('W04-paused-resume-rebuilds-withdrawn-materials-from-original-human-scope')
    const handoffGoal = 'CONTROL_HANDOFF_GOAL: continue the original task through a saved handoff.'
    await sendMain(handoffGoal)
    await until(async () => !(await manager.getSession(assistant.id))!.isProcessing)
    holding = true; workerStarted = false; release = Promise.withResolvers<void>()
    const handed = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'control-handoff', title: 'Handoff control',
      goalQuote: handoffGoal, instructions: 'CONTROL_HANDOFF_WORKER', config: { permissionMode: 'safe', workingDirectory: 'none' } })
    const handoffWork = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: handed.id })).items[0]!
    await until(() => workerStarted)
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-for-handoff', id: handed.id, expectedSeq: (await handoffWork()).seq, action: 'pause' })
    const document = join(run.directory, 'control-handoff.md')
    writeFileSync(document, '# Goal\nContinue CONTROL_HANDOFF_WORKER in the original authorized scope.\n# Completed\nNo external effects have been dispatched. The first inference was paused.\n# State\nThe original Session and its exact input remain available.\n# Next\nFinish the report without repeating completed work.\n# References\nRead the original Session when evidence is required.')
    // A flushed handoff checkpoint models restart at the document-ready boundary;
    // the real successor owner and Pi driver perform every subsequent operation.
    const handoffHost = manager as unknown as { sessions: Map<string, { contextHandoff?: import('@phaneris/shared/agent/context-policy').ContextHandoffState }>; persistSession(session: unknown): void }
    const handoffRoot = handoffHost.sessions.get(handed.sessionId!)!
    handoffRoot.contextHandoff = { id: 'control-handoff-checkpoint', phase: 'ready', documentPath: document }
    handoffHost.persistSession(handoffRoot); await manager.flushAllSessions()
    workerStarted = false
    await manager.retryContextHandoff(handed.sessionId!)
    await until(() => workerStarted)
    const childId = handoffRoot.contextHandoff!.childSessionId!
    assert((await manager.getSession(childId))!.messages.some(message => message.inputSource?.kind === 'runtime_continuation'), 'Host handoff seed must retain non-human provenance')
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-handoff-child', id: handed.id, expectedSeq: (await handoffWork()).seq, action: 'pause' })
    assert(!(await manager.getSession(childId))!.isProcessing)
    holding = false; release.resolve()
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'resume-handoff-child', id: handed.id, expectedSeq: (await handoffWork()).seq, action: 'resume' })
    await until(async () => (await handoffWork()).state === 'result_ready')
    assert.equal((await handoffWork()).result!.sessionId, childId)
    scenes.push('W05-handoff-child-controls-preserve-root-receipt-and-internal-provenance')
    const handedResult = (await handoffWork()).result
    client.destroy(); await host.stop()
    const handoffDb = openSqliteDatabase(join(root, 'assistant/delegations.db'))
    handoffDb.prepare("UPDATE work SET body=json_remove(json_set(body,'$.state','submitted','$.pendingControlId','resume-handoff-child'),'$.result') WHERE id=?").run(handed.id)
    handoffDb.prepare("UPDATE worker_commands SET receipt=json_set(receipt,'$.phase','accepted') WHERE id='resume-handoff-child'").run()
    handoffDb.close()
    const beforeHandoffRecovery = requests.length
    host = await boot(); client = await connect()
    assert.equal((await handoffWork()).state, 'result_ready')
    assert.deepEqual((await handoffWork()).result, handedResult)
    assert.equal(requests.length, beforeHandoffRecovery)
    scenes.push('W11-handoff-result-and-control-ack-recover-from-the-exact-child-attempt')
    effectRelease = Promise.withResolvers<void>(); effectStarted = false
    const beforePreemptWrites = effectWrites
    const preemptGoal = 'CONTROL_UNKNOWN_EFFECT: preserve this single effect; later direct user requirements take priority.'
    await sendMain(preemptGoal)
    const preempted = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: 'preempt-pending-command', title: 'Human preemption', goalQuote: preemptGoal,
      instructions: preemptGoal, config: { permissionMode: 'allow-all', enabledSourceSlugs: ['effect'], workingDirectory: 'none' } })
    const preemptWork = async () => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: preempted.id })).items[0]!
    await until(() => effectStarted)
    await client.invoke('residentAssistant:control', 'alpha', { commandId: 'pause-before-direct-user', id: preempted.id, expectedSeq: (await preemptWork()).seq, action: 'pause' })
    const direct = manager.sendMessage(preempted.sessionId!, 'DIRECT_USER_SUPERSEDES_PENDING_PAUSE')
    await until(async () => (await manager.getSession(preempted.sessionId!))!.messages.some(message => message.content === 'DIRECT_USER_SUPERSEDES_PENDING_PAUSE'))
    await until(async () => (await preemptWork()).controls?.find(command => command.commandId === 'pause-before-direct-user')?.phase === 'rejected')
    effectRelease.resolve(); await direct
    await until(async () => (await preemptWork()).controls?.find(command => command.commandId === 'pause-before-direct-user')?.phase === 'rejected')
    assert.equal((await preemptWork()).pendingControlId, undefined)
    assert.notEqual((await preemptWork()).state, 'pause_requested', 'A rejected stale command cannot leave a fictional pending pause')
    assert.notEqual((await preemptWork()).state, 'paused', 'A superseded pause is not proof of an applied pause')
    assert.equal(effectWrites, beforePreemptWrites + 1)
    scenes.push('W12-direct-user-preempts-a-waiting-command-without-claiming-a-false-pause')
    run.json('control-evidence.json', { scenes, commands, completed, executionOrder, effectWrites })
    run.complete(scenes, ['Paid model quality', 'Installed user data'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally {
    if (activeWorkId) run.json('last-work.json', await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: activeWorkId }).catch(error => ({ error: String(error) })))
    release.resolve(); effectRelease.resolve(); run.json('provider-requests.json', requests); client.destroy(); await host.stop(); api.stop(true)
  }
})
