#!/usr/bin/env bun
/** Real admission/persistence + SQLite/Host + Pi subprocess + loopback SSE. */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('pi-interruption-recovery', async evidence => {
  const repo = resolve(import.meta.dir, '../..')
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-pi-recovery-'))
  const config = join(fixture, 'config'), workspace = join(fixture, 'workspace')
  mkdirSync(join(config, 'permissions'), { recursive: true }); mkdirSync(workspace)
  copyFileSync(join(repo, 'apps/electron/resources/permissions/default.json'), join(config, 'permissions/default.json'))
  process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createSession, getSessionFilePath } = await import('../../packages/shared/src/sessions/storage')
  const { handleSendAgentMessage } = await import('../../packages/session-tools-core/src/handlers/send-agent-message')
  const { readSessionReliabilityReport } = await import('../../packages/server-core/src/observability/reliability-report')
  const manager = new SessionManager() as any
  manager.eventSink = () => {}
  const target = await createSession(workspace, { name: 'Delivery target' })
  const managed = createManagedSession(target, { id: 'fixture', name: 'Fixture', rootPath: workspace, createdAt: 1 } as any, { messagesLoaded: true })
  manager.registerManagedSession(managed)
  const gate = Promise.withResolvers<void>()
  let currentTurnGate = gate
  let targetRuns = 0
  // Admission is production code; replace only the target's model execution.
  manager.runSessionTurn = async (current: any, _message: unknown, _attachments: unknown, _stored: unknown, _options: unknown, input: any) => {
    const operationId = `fixture-target-${++targetRuns}`
    manager.durableRuntime.commands.acceptRun({ workspaceRootPath: workspace, sessionId: current.id, operationId, turnId: input.id, userMessageId: input.id, userMessage: input.content })
    await currentTurnGate.promise
    manager.durableRuntime.commands.completeRun(workspace, operationId, 'complete')
  }
  const checks: string[] = []
  const observations: any[] = []
  const deadline = async <T>(promise: Promise<T>, milliseconds = 2000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Bounded operation did not settle')), milliseconds) })]) }
    finally { clearTimeout(timer!) }
  }
  const readInputs = () => readFileSync(getSessionFilePath(workspace, target.id), 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line)).filter(row => row.type === 'user')
  try {
    const result = await deadline(handleSendAgentMessage({ sessionId: 'fixture-sender', toolExecutionId: 'delivery-one', sendAgentMessage: manager.deliverMessage.bind(manager) } as any,
      { sessionId: target.id, message: 'DELIVERY_FIXTURE' }))
    assert(!result.isError, JSON.stringify(result)); assert.equal(targetRuns, 1); assert.equal(readInputs().length, 1)
    const duplicates = await deadline(Promise.all(Array.from({ length: 3 }, () => handleSendAgentMessage({ sessionId: 'fixture-sender', toolExecutionId: 'delivery-one', sendAgentMessage: manager.deliverMessage.bind(manager) } as any,
      { sessionId: target.id, message: 'DELIVERY_FIXTURE' }))))
    assert(duplicates.every(receipt => !receipt.isError)); assert.equal(targetRuns, 1); assert.equal(readInputs().length, 1)
    checks.push('durable-delivery-before-target-completion', 'stable-delivery-identity-no-duplicate')
    await assert.rejects(manager.deliverMessage(target.id, 'different content', undefined, 'delivery-one'), /identity|different|content/i)
    await assert.rejects(manager.deliverMessage('missing-session', 'fixture'), /not found/)
    checks.push('delivery-identity-conflict-and-missing-target')
    let wholeTurnCompleted = false
    const wholeTurn = manager.sendMessage(target.id, 'WAIT_FOR_TURN').then(() => { wholeTurnCompleted = true })
    await new Promise(r => setTimeout(r, 75)); assert.equal(wholeTurnCompleted, false)
    gate.resolve(); await wholeTurn; assert.equal(wholeTurnCompleted, true)
    checks.push('sendMessage-whole-turn-contract')
    const handle = manager.execution.begin({ sessionId: target.id, workspaceRootPath: workspace })
    const queued: any = await deadline(manager.deliverMessage(target.id, 'QUEUED_FIXTURE', undefined, 'delivery-queued'))
    assert.equal(queued.delivery, 'queued'); assert(readInputs().some(row => row.content === 'QUEUED_FIXTURE'))
    await manager.execution.finish(handle, 'interrupted', { advanceQueue: false })
    checks.push('busy-target-persisted-before-receipt')

    const parent = await createSession(workspace, { name: 'Forwarding parent' })
    const parentManaged = createManagedSession(parent, managed.workspace, { messagesLoaded: true }) as any
    parentManaged.contextHandoff = { phase: 'complete', childSessionId: target.id }
    manager.registerManagedSession(parentManaged)
    const successorGate = Promise.withResolvers<void>()
    currentTurnGate = successorGate
    const forwarded: any = await deadline(manager.deliverMessage(parent.id, 'FORWARDED_FIXTURE', undefined, 'forwarded-delivery'))
    assert(readInputs().some(row => row.id === forwarded.messageId && row.content === 'FORWARDED_FIXTURE'))
    successorGate.resolve()
    checks.push('handoff-successor-admission-receipt')

    const flush = manager.flushSession.bind(manager)
    manager.flushSession = async () => { throw new Error('fixture disk failure') }
    await assert.rejects(manager.deliverMessage(target.id, 'PERSISTENCE_FAILURE', undefined, 'failed-flush'), /disk failure/)
    manager.flushSession = flush
    const originalRun = targetRuns
    await deadline(manager.deliverMessage(target.id, 'PERSISTENCE_FAILURE', undefined, 'failed-flush'))
    assert(readInputs().some(row => row.content === 'PERSISTENCE_FAILURE'))
    assert.equal(targetRuns, originalRun + 1)
    checks.push('persistence-failure-no-false-receipt')

    const sender = await createSession(workspace, { name: 'Parked sender' })
    const senderManaged = createManagedSession(sender, managed.workspace, { messagesLoaded: true })
    manager.registerManagedSession(senderManaged)
    const senderScope = { sessionId: sender.id, workspaceRootPath: workspace }
    const senderHandle = manager.execution.begin(senderScope)
    manager.execution.accept(senderHandle, { operationId: 'lost-send-result', userMessageId: 'sender-input', userMessage: 'Send fixture' })
    const pendingSend = await manager.durableRuntime.effects.prepareTool(workspace, { sessionId: sender.id, runOperationId: 'lost-send-result', providerToolCallId: 'lost-send-call', toolName: 'mcp__session__send_agent_message', args: { sessionId: target.id, message: 'RECEIPT_RECOVERY_FIXTURE' } })
    await manager.deliverMessage(target.id, 'RECEIPT_RECOVERY_FIXTURE', undefined, pendingSend.operationId)
    await manager.execution.finish(senderHandle, 'interrupted')
    assert(manager.execution.view(sender.id).blocked)
    await deadline(manager.deliverMessage(sender.id, 'CONTINUE_AFTER_KNOWN_DELIVERY'))
    assert.equal(manager.execution.view(sender.id).blocked, false)
    assert.equal(manager.durableRuntime.queries.unsettledTools(workspace, 'lost-send-result').length, 0)
    assert.equal(readInputs().filter(row => row.content === 'RECEIPT_RECOVERY_FIXTURE').length, 1)
    checks.push('exact-durable-message-receipt-reconciliation')

    const legacy = await createSession(workspace, { name: 'Unverified legacy sender' })
    manager.registerManagedSession(createManagedSession(legacy, managed.workspace, { messagesLoaded: true }))
    const legacyHandle = manager.execution.begin({ sessionId: legacy.id, workspaceRootPath: workspace })
    manager.execution.accept(legacyHandle, { operationId: 'unverified-send', userMessageId: 'legacy-input', userMessage: 'fixture' })
    await manager.durableRuntime.effects.prepareTool(workspace, { sessionId: legacy.id, runOperationId: 'unverified-send', providerToolCallId: 'legacy-send-call', toolName: 'mcp__session__send_agent_message', args: { sessionId: target.id, message: 'RECEIPT_RECOVERY_FIXTURE' } })
    await manager.execution.finish(legacyHandle, 'interrupted')
    await assert.rejects(manager.deliverMessage(legacy.id, 'DO_NOT_REPLAY_UNVERIFIED_SEND'), /reconciliation/)
    assert.equal(manager.durableRuntime.queries.unsettledTools(workspace, 'unverified-send').length, 1)
    checks.push('matching-text-without-operation-receipt-stays-blocked')
  } finally { gate.resolve(); await manager.cleanup() }

  let runtime = createDurableRuntime()
  const modelSession = 'model-interruption', modelRun = 'interrupted-run'
  const openModel = async (sessionId: string, runOperationId: string) => {
    runtime.commands.acceptRun({ workspaceRootPath: workspace, sessionId, operationId: runOperationId, turnId: runOperationId, userMessageId: runOperationId, userMessage: 'fixture' })
    return runtime.effects.prepareModel(workspace, { sessionId, runOperationId, providerRequestId: 'one', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'fixture' })
  }
  const model = await openModel(modelSession, modelRun)
  assert.equal(runtime.commands.completeRun(workspace, modelRun, 'interrupted').kind, 'parked')
  await runtime.close(); runtime = createDurableRuntime()
  runtime.execution.recoverSession({ sessionId: modelSession, workspaceRootPath: workspace })
  assert(runtime.execution.view(modelSession).blocked)
  runtime.execution.refreshRecovery(modelSession)
  assert.equal(runtime.execution.view(modelSession).blocked, false)
  const next = runtime.execution.begin({ sessionId: modelSession, workspaceRootPath: workspace })
  runtime.execution.accept(next, { operationId: 'new-user-run', userMessageId: 'new-user-message', userMessage: 'New user input' })
  await runtime.execution.finish(next, 'interrupted')
  const facts = runtime.queries.events(workspace, { sessionId: modelSession })
  assert.equal(facts.filter(e => e.type === 'model_dispatch_committed').length, 1, 'Never replay the interrupted request')
  assert(facts.some(e => e.type === 'model_recovery_decided' && (e.payload as any).verdict === 'interrupted_response_unavailable'))
  const reliability = readSessionReliabilityReport(runtime, workspace, modelSession)
  assert.equal(reliability.unsettled.modelCount, 0); assert.equal(reliability.unknownCostRequests, 1)
  observations.push({ scene: 'model-recovery', model: model.operationId, reliability, facts })
  checks.push('parked-model-recovery-after-reopen', 'no-implicit-model-replay', 'unknown-model-cost-preserved')

  const unsafeSession = 'unknown-external-effect', unsafeRun = 'unsafe-run'
  await openModel(unsafeSession, unsafeRun)
  await runtime.effects.prepareTool(workspace, { sessionId: unsafeSession, runOperationId: unsafeRun, providerToolCallId: 'external-write', toolName: 'Write', args: { path: 'unknown.txt' } })
  runtime.commands.completeRun(workspace, unsafeRun, 'interrupted')
  runtime.execution.recoverSession({ sessionId: unsafeSession, workspaceRootPath: workspace })
  runtime.execution.refreshRecovery(unsafeSession)
  assert(runtime.execution.view(unsafeSession).blocked)
  checks.push('unknown-external-effect-remains-blocked')
  await runtime.close()

  // Real Pi client and child. The first provider turn sends a session proxy
  // inside codemode; its deadline expires while the host holds a real result.
  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const { registerSessionScopedToolCallbacks } = await import('../../packages/shared/src/agent/session-scoped-tools')
  runtime = createDurableRuntime()
  let providerRequests = 0, mode: 'late-tool' | 'normal-tool' | 'exit' | 'reply' = 'late-tool'
  let releaseTool: (() => void) | undefined
  const toolGate = new Promise<void>(resolve => { releaseTool = resolve })
  let activeToolGate = toolGate
  let streamStarted: (() => void) | undefined
  let activeStream: ReadableStreamDefaultController<Uint8Array> | undefined
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json() as any; providerRequests++
    const chunk = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: `fixture-${providerRequests}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
    if (mode === 'exit') return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      activeStream = controller; controller.enqueue(new TextEncoder().encode(chunk({ role: 'assistant', content: 'partial' }))); streamStarted?.()
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
    if (mode === 'late-tool') {
      mode = 'reply'
      const code = '// @options: {"timeout_ms": 2000, "max_output_tokens": 1000}\nawait tools.mcp__session__send_agent_message({sessionId:"fake-target",message:"fixture"});'
      return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: 'late-send', type: 'function', function: { name: 'codemode', arguments: JSON.stringify({ code }) } }] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (mode === 'normal-tool') {
      mode = 'reply'
      const code = 'await tools.mcp__session__send_agent_message({sessionId:"fake-target",message:"fixture-normal"});'
      return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: 'normal-session-tool', type: 'function', function: { name: 'codemode', arguments: JSON.stringify({ code }) } }] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(chunk({ role: 'assistant', content: 'RECOVERED_REPLY' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const piSession = 'pi-recovery', scope = { sessionId: piSession, workspaceRootPath: workspace }
  mkdirSync(join(workspace, 'sessions', piSession), { recursive: true })
  const resources = bindPiRuntime(runtime, scope)
  const agent = new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', workspace: { id: 'fixture', slug: 'fixture', name: 'Fixture', rootPath: workspace, createdAt: 1 },
    session: { id: piSession, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, model: 'pi/fixture', isHeadless: true,
    ...resources,
    runtime: { provider: 'pi', authType: 'api_key', paths: { piServer: join(repo, 'packages/pi-agent-server/dist/index.js'), node: process.execPath },
      piAuthProvider: 'custom-endpoint', baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
  } as any)
  agent.setPermissionMode('allow-all')
  const wire: any[] = []
  const receive = (agent as any).handleLine.bind(agent)
  ;(agent as any).handleLine = (line: string) => {
    try { const m = JSON.parse(line); wire.push({ type: m.type, event: m.event, toolName: m.toolName, message: m.message }) } catch {}
    return receive(line)
  }
  const deliveryIdentities: string[] = []
  registerSessionScopedToolCallbacks(piSession, { sendAgentMessageFn: async (_target, _message, _attachments, deliveryId) => {
    assert(typeof deliveryId === 'string' && deliveryId.startsWith('toolop_')); deliveryIdentities.push(deliveryId)
    await activeToolGate; return { delivery: 'delivered', targetBusy: false }
  } })
  const driver = await runtime.execution.ensureDriver(piSession, async () => new PiRuntimeDriver(agent))
  const events: any[] = []
  let finalPiFacts: unknown
  runtime.execution.subscribe(piSession, { event: event => { events.push(event) } })
  async function turn(id: string) {
    const handle = runtime.execution.begin(scope)
    runtime.execution.accept(handle, { operationId: id, userMessageId: id, userMessage: id })
    return runtime.execution.drive(handle, driver, { message: id, options: { inputId: id } })
  }
  try {
    const late = await deadline(turn('late-run'), 15000)
    assert.equal(late.kind, 'parked'); assert.equal(runtime.queries.unsettledTools(workspace, 'late-run').length, 1)
    releaseTool!()
    for (let i = 0; i < 100 && runtime.queries.unsettledTools(workspace, 'late-run').length; i++) await new Promise(r => setTimeout(r, 20))
    assert.equal(runtime.queries.unsettledTools(workspace, 'late-run').length, 0)
    runtime.execution.refreshRecovery(piSession)
    assert.equal(runtime.execution.view(piSession).blocked, false)
    assert.equal((await deadline(turn('after-late'), 15000)).kind, 'terminal')
    checks.push('real-pi-cancelled-proxy-late-T2', 'next-turn-after-late-T2')
    mode = 'normal-tool'
    assert.equal((await deadline(turn('normal-tool-run'), 15000)).kind, 'terminal')
    assert.equal((agent as any).knownHostToolOutcomes.size, 0)
    assert(runtime.queries.events(workspace, { operationId: 'normal-tool-run' }).some(event => event.type === 'tool_outcome_committed'
      && (event.payload as any).toolName === 'mcp__session__send_agent_message' && !(event.payload as any).isError))
    assert.equal(new Set(deliveryIdentities).size, 2)
    checks.push('normal-proxy-outcome-no-duplicate-or-cache-leak')
    const replacementGate = Promise.withResolvers<void>()
    activeToolGate = replacementGate.promise
    mode = 'late-tool'
    assert.equal((await deadline(turn('old-child-late-run'), 15000)).kind, 'parked')
    await agent.reconnect()
    replacementGate.resolve()
    for (let i = 0; i < 100 && runtime.queries.unsettledTools(workspace, 'old-child-late-run').length; i++) await new Promise(r => setTimeout(r, 20))
    assert.equal(runtime.queries.unsettledTools(workspace, 'old-child-late-run').length, 0)
    runtime.execution.refreshRecovery(piSession)
    assert.equal((await deadline(turn('replacement-child-run'), 15000)).kind, 'terminal')
    assert.equal(runtime.queries.events(workspace, { operationId: 'replacement-child-run' }).filter(event => event.type === 'tool_outcome_committed').length, 0)
    checks.push('old-child-late-outcome-stays-on-original-run')
    mode = 'exit'
    const streaming = new Promise<void>(resolve => { streamStarted = resolve })
    const crashing = turn('exit-run')
    await deadline(streaming, 15000)
    const child = (agent as any).subprocess
    child.stderr?.emit('data', Buffer.from('DIAGNOSTIC_FIXTURE api_key=PRIVATE_API_FIXTURE Authorization: Bearer PRIVATE_BEARER_FIXTURE {"access_token":"PRIVATE_TOKEN_FIXTURE"}'))
    child.kill('SIGKILL')
    assert.equal((await deadline(crashing, 10000)).kind, 'parked')
    await new Promise(r => setTimeout(r, 200))
    const diagnostics = join(workspace, 'sessions', piSession, 'diagnostics')
    assert(existsSync(diagnostics)); const crashFiles = readdirSync(diagnostics).filter(name => name.startsWith('pi-exit-'))
    assert(crashFiles.length > 0)
    const crash = JSON.parse(readFileSync(join(diagnostics, crashFiles.at(-1)!), 'utf8'))
    assert.equal(crash.pid, child.pid); assert(crash.stderr.includes('DIAGNOSTIC_FIXTURE')); assert(crash.lastModelRequest)
    assert(!JSON.stringify(crash).includes('PRIVATE_'))
    runtime.execution.refreshRecovery(piSession); assert.equal(runtime.execution.view(piSession).blocked, false)
    mode = 'reply'
    assert.equal((await deadline(turn('after-exit'), 15000)).kind, 'terminal')
    checks.push('real-child-exit-diagnostic', 'real-child-exit-next-turn', 'crash-diagnostic-credential-redaction')
    finalPiFacts = runtime.queries.events(workspace, { sessionId: piSession })
    await runtime.close(); await new Promise(r => setTimeout(r, 150))
    assert.equal(readdirSync(diagnostics).filter(name => name.startsWith('pi-exit-')).length, crashFiles.length)
    checks.push('expected-shutdown-does-not-produce-crash-report')
    observations.push({ scene: 'pi-wire', providerRequests, events, crash, facts: finalPiFacts })
  } finally {
    evidence.json('pi-protocol.json', { providerRequests, events, wire, stderr: agent.getRecentStderr(), facts: finalPiFacts ?? runtime.queries.events(workspace, { sessionId: piSession }) })
    releaseTool!(); try { activeStream?.close() } catch {} await runtime.close(); api.stop(true)
  }
  evidence.json('recovery-evidence.json', { fixture, checks, observations })
  evidence.complete(checks, ['Live remote provider APIs', 'Signed installer / release deployment', 'Historical native exit trigger'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
