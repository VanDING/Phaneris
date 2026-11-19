import { isDirectUserSource } from '../../packages/server-core/src/sessions/input-contracts'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure scenarios are fixed before implementation in the 0.6.4 matrix.
// Exercise the real Host, RPC, Session storage, Pi tool calls and Runtime;
// deterministic loopback responses do not establish model management quality.
await verificationWorkflow('resident-assistant-tasks', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Task lifecycle', rootPath: root, createdAt: 1 }
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  const { loadSession, saveSession } = await import('@phaneris/shared/sessions')
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  await saveSession({ id: 'tasks-resident', workspaceRootPath: root, sessionKind: 'resident_assistant', hidden: true, createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: usage })
  for (const [id, name, handoff] of [['legacy-work', 'Legacy assistant work', false], ['legacy-handoff', 'Legacy handoff continuation', true]] as const)
    await saveSession({ id, name, workspaceRootPath: root, parentSessionId: 'tasks-resident', createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: usage,
      ...(handoff ? { handoffFromSessionId: 'legacy-work', handoffRootSessionId: 'legacy-work', handoffSequence: 1 } : {}) })
  type Call = { name: string; arguments: Record<string, unknown> }
  const calls: Call[] = [], requests: Array<{ main: boolean; at: number }> = []
  /** Which scripted call each main turn took, so an ordering fault names itself. */
  const consumed: Array<{ main: boolean; call: string | null; internal: boolean }> = []
  let workerStatusIssued = false
  let hold: ReturnType<typeof Promise.withResolvers<void>> | undefined
  /**
   * A Host wakeup is not a scripted model turn.
   *
   * The resident Session is also woken by the Host itself: material refresh,
   * memory maintenance and inbox delivery all reach the same provider carrying
   * `resident_assistant_role`. Treating those as scripted turns shifted `calls`
   * for a turn the test never asked for, so later assertions waited 30 s for
   * tools that had been spent early — the source of this workflow's flake.
   *
   * The trustworthy discriminator is the committed input identity. A scripted
   * turn always carries the `msg-…` user message the test just sent, while the
   * Host's own wakeups carry `resident-refresh:…` / `resident-event:…` /
   * `memory-maintenance:…`.
   *
   * Memory maintenance is the case that must not be missed: its context text is
   * a fixed sentence with no `currentInputId` at all, so matching only on that
   * field silently classified maintenance as a scripted turn and consumed a
   * scripted call for it. Treating "no `msg-` input" as internal covers all three
   * shapes, including the field-less one.
   *
   * Do not match on `<resident_inbox>` / `<resident_memory_maintenance>` either:
   * a genuine user turn's context carries pending inbox events too, so that
   * check would misclassify scripted turns.
   */
  const isInternalWakeup = (messages: Array<{ role: string; content: unknown }>): boolean => {
    // Read the raw message content, never `JSON.stringify(messages)`: inside the
    // stringified array every quote of the embedded context is escaped, so a
    // regex for `"currentInputId":"…"` cannot match there.
    const context = messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n')
    const inputId = context.match(/"currentInputId":"((?:[^"\\]|\\.)*)"/)?.[1] ?? ''
    return !/^msg-/.test(inputId)
  }
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { model: string; messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> }
    const text = JSON.stringify(body.messages)
    const resident = text.includes('resident_assistant_role'), internal = resident && isInternalWakeup(body.messages)
    const main = resident && !internal
    requests.push({ main, at: Date.now() })
    assert(requests.length < 100, 'Bounded inference budget')
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'tasks-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    // An internal Host wakeup answers as plain prose: it must neither consume a
    // scripted call nor issue worker tools. Its own turn is not under test here.
    if (internal) return new Response(chunk({ role: 'assistant' }) + chunk({ content: 'INTERNAL_WAKEUP_ACK' }) + chunk({}, 'stop') + 'data: [DONE]\n\n',      { headers: { 'Content-Type': 'text/event-stream' } })
    if (!main && text.includes('TM_FAILURE'))
      return Response.json({ error: { message: 'TM_FAILURE: controlled provider rejection', type: 'invalid_request_error' } }, { status: 400 })
    if (!main && hold) await hold.promise
    const call = main ? calls.shift() : undefined
    consumed.push({ main, call: call?.name ?? null, internal })
    let workerStatus: Call | undefined
    if (!main && text.includes('TM_OPEN_STATUS') && !workerStatusIssued) {
      const available = body.tools?.some(tool => tool.function.name === 'mcp__session__set_session_status')
      workerStatus = available ? { name: 'set_session_status', arguments: { status: 'needs-review' } }
        : { name: 'tool_search', arguments: { query: 'set_session_status' } }
      workerStatusIssued = !!available
    }
    const selected = call ?? workerStatus
    const result = selected ? chunk({ tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: {
      name: selected.name === 'tool_search' ? 'tool_search' : `mcp__session__${selected.name}`, arguments: JSON.stringify(selected.arguments) } }] }, 'tool_calls')
      : chunk({ content: main ? 'TASK_REVIEW_DELIVERY' : 'VERIFIED_TEXT_RESULT' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + result + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true,
    defaultLlmConnection: 'fixture', llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai',
      authType: 'api_key', createdAt: 1, baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture',
      models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }] }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantTasks: { concurrency: 1 }, assistantMemory: { version: 1, learning: 'explicit', use: true },
    defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  let manager!: InstanceType<typeof SessionManager>
  const boot = () => bootstrapServer({ serverToken: 'tasks-fixture-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  let host = await boot()
  const connect = async () => { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'tasks-fixture-token', autoReconnect: false }); await client.connect(); return client }
  let client = await connect()
  const until = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 30000
    while (!await condition()) { assert(Date.now() < deadline, 'Task lifecycle did not settle'); await Bun.sleep(25) }
  }
  const scenes: string[] = [], evidence: unknown[] = []
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    const mainTurns = () => requests.filter(request => request.main).length
    const consumedCalls = () => consumed.filter(entry => entry.main && entry.call !== null).length
    /**
     * Send one scripted input and wait until its turn has both completed and
     * consumed every call it was given.
     *
     * Two races made this workflow flaky. First, polling only `isProcessing`
     * could return before the submitted input had started, so one send's turn ran
     * during a later send. Second, a tool call issued late in a turn continues in
     * the same run, so a queued call can still be pending when the turn looks
     * settled. Waiting for the call consumption as well as the idle flag pairs
     * each assertion with its own turn.
     */
    const sendMain = async (text: string, expectedConsumed?: number) => {
      const before = mainTurns(), consumedBefore = consumedCalls()
      await manager.sendMessage(assistant.id, text)
      await until(async () => {
        const session = (await manager.getSession(assistant.id))!
        if (session.isProcessing) return false
        if (session.messages.some(message => message.role === 'user' && isDirectUserSource(message.inputSource) && message.isQueued)) return false
        if (mainTurns() <= before) return false
        return expectedConsumed === undefined || consumedCalls() - consumedBefore >= expectedConsumed
      })
    }
    /** Send a turn that must consume exactly the next `count` scripted calls. */
    const scripted = (text: string, count: number) => sendMain(text, count)
    const goal = '按要求交付任务报告，并由助手复核完成；需要修改时继续原会话。'
    await sendMain(goal)
    const dispatch = async (requestId: string, extra: Record<string, unknown> = {}) => {
      await sendMain(goal)
      return client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', {
      requestId, title: requestId, instructions: 'Produce the requested text report.', goalQuote: goal, acceptanceCriteria: ['Text report satisfies the original goal.'],
      config: { llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' }, ...extra,
      })
    }
    const current = async (id: string) => (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id })).items[0]!
    const board = () => client.invoke(RPC_CHANNELS.workItems.LIST, 'alpha')
    const status = async (id: string) => (await manager.getSession(id))!.sessionStatus
    const work = await dispatch('review-pass')
    await until(async () => (await current(work.id)).state === 'result_ready')
    const result = await current(work.id)
    const items = await board(), tile = items.find(item => item.id === work.sessionId)!
    assert(tile, 'Assistant work must be present in the Board projection')
    assert.equal(tile.parentId, undefined, 'A direct assistant child must be a root Board card')
    assert.equal((await manager.getSession(work.sessionId!))!.parentSessionId, assistant.id, 'Persisted relationship is preserved')
    assert.equal(tile.description, 'Produce the requested text report.')
    assert.equal(tile.acceptanceCriteria, 'Text report satisfies the original goal.')
    scenes.push('TM01-assistant-work-is-root-card-with-original-parent', 'TM04-planning-fields-match-new-assignment')
    const parent = await manager.createSession('alpha', { name: 'Ordinary parent' })
    const child = await manager.createSession('alpha', { name: 'Ordinary child', parentSessionId: parent.id })
    const nested = await manager.createSession('alpha', { name: 'Nested worker', parentSessionId: work.sessionId })
    assert.equal((await board()).find(item => item.id === child.id)?.parentId, parent.id)
    assert.equal((await board()).find(item => item.id === nested.id)?.parentId, work.sessionId)
    await manager.archiveSession(parent.id)
    assert.equal((await board()).find(item => item.id === child.id)?.parentId, parent.id, 'An archived parent does not release an ordinary child')
    scenes.push('TM02-ordinary-and-nested-subtasks-retain-parent-through-archive')
    assert.equal(await status(work.sessionId!), 'needs-review')
    const review = { delegationId: work.id, expectedSeq: result.seq, result: result.result!, outcome: 'accepted', reason: 'Read the text result and checked the original text-report criterion.' }
    calls.push({ name: 'assistant_delivery_ack', arguments: { eventIds: [], reviews: [review] } })
    await scripted('按原要求核对已有结果。', 1)
    assert.equal(await status(work.sessionId!), 'needs-review', 'Result references alone do not prove the assistant read the result')
    calls.push({ name: 'assistant_memory_read', arguments: review.result },
      { name: 'assistant_delivery_ack', arguments: { eventIds: [], reviews: [{ ...review, expectedSeq: result.seq - 1 }] } })
    await scripted('检查已有任务的复核依据。', 2)
    assert.equal(await status(work.sessionId!), 'needs-review', 'A stale receipt cannot close a task')
    scenes.push('TM09-unread-result-and-stale-sequence-cannot-close-work')
    const acknowledge = async (input: typeof review, includeReview = true) => {
      calls.push({ name: 'assistant_memory_read', arguments: input.result },
        { name: 'assistant_delivery_ack', arguments: { eventIds: [`${input.delegationId}:result_ready:${input.result.messageId}`],
          deliverables: [{ delegationId: input.delegationId, expectedRevision: 1, keys: [] }], ...(includeReview ? { reviews: [input] } : {}) } })
      await scripted('复核并交付已有报告，沿用原任务要求。', 2)
      assert.equal(calls.length, 0, `Scripted calls left unconsumed: ${JSON.stringify(calls.map(call => call.name))}\nconsumed=${JSON.stringify(consumed)}`)
      const session = (await manager.getSession(assistant.id))!
      evidence.push(session.messages.filter(message => message.role === 'tool').slice(-2).map(message => ({ content: message.content, toolName: message.toolName })))
    }
    await acknowledge(review, false)
    assert.notEqual((await manager.getSession(assistant.id))!.messages.findLast(message => message.role === 'tool')?.isError, true)
    await until(async () => (await manager.assistantEvents('alpha', { limit: 100 })).items.some(event => event.delegationId === work.id && event.phase === 'delivered'))
    assert(!(await manager.getAssistantWork('alpha', { view: 'deliverables' })).deliverables?.some(item => item.delegationId === work.id))
    scenes.push('TM06-text-only-without-manifest-selects-no-files-and-delivers')
    assert.equal(await status(work.sessionId!), 'needs-review', 'An ACK alone cannot mark work complete')
    // Read and review in a fresh turn after delivery; no second delivery is required.
    calls.push({ name: 'assistant_memory_read', arguments: review.result }, { name: 'assistant_delivery_ack', arguments: { eventIds: [], reviews: [review] } })
    await sendMain('已授权助手验收，通过后完成原工作。')
    assert.equal(await status(work.sessionId!), 'done')
    assert.equal((await board()).find(item => item.id === work.sessionId)?.statusId, 'done')
    scenes.push('TM06-result-needs-review-ack-alone-preserves-state-explicit-review-closes-session')
    calls.push({ name: 'assistant_memory_read', arguments: review.result }, { name: 'assistant_delivery_ack', arguments: { eventIds: [], reviews: [{ ...review, reason: 'Equivalent accepted conclusion with regenerated wording.' }] } })
    await sendMain('确认已有复核回执。')
    assert.equal(await status(work.sessionId!), 'done')
    assert.notEqual((await manager.getSession(assistant.id))!.messages.findLast(message => message.role === 'tool')?.isError, true)
    assert.equal((await current(work.id)).review?.reason, review.reason, 'A semantic replay preserves the first review reason')
    scenes.push('TM10-review-replay-is-idempotent')
    const changes = await dispatch('review-rework')
    await until(async () => (await current(changes.id)).state === 'result_ready')
    const changesResult = await current(changes.id)
    await acknowledge({ ...review, delegationId: changes.id, expectedSeq: changesResult.seq, result: changesResult.result!, outcome: 'rework', reason: 'The original criterion needs a correction.' })
    assert.equal(await status(changes.sessionId!), 'todo')
    await acknowledge({ ...review, delegationId: changes.id, expectedSeq: changesResult.seq, result: changesResult.result! })
    assert.equal(await status(changes.sessionId!), 'todo', 'A rejected result cannot be accepted later without revised work')
    scenes.push('TM07-explicit-rework-reopens-same-session')
    const personal = await dispatch('personal-review', { completionPolicy: 'user_review' })
    await until(async () => (await current(personal.id)).state === 'result_ready')
    const personalResult = await current(personal.id)
    await acknowledge({ ...review, delegationId: personal.id, expectedSeq: personalResult.seq, result: personalResult.result! })
    assert.equal(await status(personal.sessionId!), 'needs-review', 'A personal review requirement cannot be closed by the assistant')
    scenes.push('TM06-personal-review-policy-cannot-be-overridden')
    const manual = await dispatch('manual-status')
    await until(async () => (await current(manual.id)).state === 'result_ready')
    const manualResult = await current(manual.id)
    await manager.setSessionStatus(manual.sessionId!, 'cancelled')
    await acknowledge({ ...review, delegationId: manual.id, expectedSeq: manualResult.seq, result: manualResult.result! })
    assert.equal(await status(manual.sessionId!), 'cancelled', 'Assistant review cannot overwrite a manual status change')
    const followup = await dispatch('human-followup')
    await until(async () => (await current(followup.id)).state === 'result_ready')
    const old = await current(followup.id)
    await manager.sendMessage(followup.sessionId!, 'A new direct user requirement owns this Session.')
    await manager.setSessionStatus(followup.sessionId!, 'todo')
    await acknowledge({ ...review, delegationId: followup.id, expectedSeq: old.seq, result: old.result! })
    assert.equal(await status(followup.sessionId!), 'todo')
    scenes.push('TM09-manual-status-and-later-human-input-fence-old-review')
    const failed = await dispatch('provider-failure', { instructions: 'TM_FAILURE' })
    await until(async () => (await current(failed.id)).state === 'failed')
    await until(async () => await status(failed.sessionId!) === 'needs-review')
    scenes.push('TM06-failed-execution-needs-review-with-original-error')
    await manager.setAssistantExecutionMode('alpha', 'allow-all')
    const workerStatus = await dispatch('worker-open-status', { instructions: 'TM_OPEN_STATUS: report ready for review before returning the final report.',
      config: { permissionMode: 'allow-all', thinkingLevel: 'off', workingDirectory: 'none' } })
    await until(async () => (await current(workerStatus.id)).state === 'result_ready')
    const ready = await current(workerStatus.id)
    assert((await manager.getSession(ready.sessionId!))!.messages.some(message => message.toolName === 'mcp__session__set_session_status' && !message.isError && message.toolResult?.includes('Status set')))
    await acknowledge({ ...review, delegationId: ready.id, expectedSeq: ready.seq, result: ready.result! })
    assert.equal(await status(ready.sessionId!), 'done', 'A Worker open-status update does not withdraw assistant review ownership')
    await manager.setAssistantExecutionMode('alpha', 'safe')
    scenes.push('TM06-worker-open-status-preserves-managed-review-ownership')
    hold = Promise.withResolvers<void>()
    const cancel = await dispatch('cancel-settled')
    await until(async () => (await current(cancel.id)).state === 'submitted')
    await client.invoke(RPC_CHANNELS.residentAssistant.CANCEL_WORK, 'alpha', cancel.id)
    hold.resolve(); hold = undefined
    await until(async () => (await current(cancel.id)).state === 'cancelled')
    await until(async () => await status(cancel.sessionId!) === 'cancelled')
    scenes.push('TM08-cancelled-session-after-runtime-settlement')
    const beforeRestart = loadSession(root, work.sessionId!)
    assert.equal(beforeRestart?.sessionStatus, 'done')
    client.destroy(); await host.stop(); host = await boot(); client = await connect()
    assert.equal(await status(work.sessionId!), 'done')
    assert.equal((await board()).find(item => item.id === work.sessionId)?.parentId, undefined)
    scenes.push('TM10-session-state-and-board-projection-survive-restart')
    const boardParent = await manager.createSession('alpha', { name: 'Board parent' })
    const boardChild = await manager.createSession('alpha', { name: 'Saved queued child', parentSessionId: boardParent.id,
      llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'safe', workingDirectory: 'none' })
    hold = Promise.withResolvers<void>()
    const blocker = await dispatch('board-blocker')
    await until(async () => (await current(blocker.id)).state === 'submitted')
    const queuedWork = await dispatch('board-queued', { targetSessionId: boardChild.id, config: {} })
    assert.equal((await current(queuedWork.id)).state, 'accepted')
    const renderedBoard = { sessions: manager.getSessions('alpha'), items: await board() }
    run.json('board-input.json', renderedBoard)
    const { verifyTaskBoard } = await import('./resident-assistant-tasks-board')
    scenes.push(...await verifyTaskBoard(run.directory, renderedBoard))
    await client.invoke(RPC_CHANNELS.residentAssistant.CANCEL_WORK, 'alpha', queuedWork.id)
    assert.equal(await status(queuedWork.sessionId!), 'cancelled')
    await client.invoke(RPC_CHANNELS.residentAssistant.CANCEL_WORK, 'alpha', blocker.id)
    hold.resolve(); hold = undefined
    run.json('task-evidence.json', { scenes, requests, evidence, work: await current(work.id), board: await board() })
    run.complete(scenes, ['Real model management quality', 'Bounded concurrency and resource leases (P2)', 'Worker permission/context changes (P2)', 'Original-goal continuation and multi-turn communication (P3/P4)', 'Installed Electron application; Board verified in Chromium'])
  } finally { hold?.resolve(); client.destroy(); await host.stop(); api.stop(true) }
})
