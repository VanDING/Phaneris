#!/usr/bin/env bun
/** Real Pi + Runtime + SessionManager, deterministic loopback inference and T2 delays. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { AgentEvent } from '../../packages/core/src/types'
import type { DurableModelOutcomeRequest } from '../../packages/shared/src/durable-runtime/types'

await verificationWorkflow('source-activation-settlement', async evidence => {
  const root = evidence.directory
  const config = join(root, 'config')
  mkdirSync(config)
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.NODE_ENV = 'test'
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [], llmConnections: [], setupDeferred: true }))
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { SessionManager, createManagedSession, setSessionPlatform } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { mergeSessionScopedToolCallbacks } = await import('../../packages/shared/src/agent/session-scoped-tool-callback-registry')
  const { loadSource } = await import('../../packages/shared/src/sources/storage')
  const { buildServersFromSources } = await import('../../packages/server-core/src/sources/build-servers')
  const { prepareSessionSourceResources } = await import('../../packages/server-core/src/sessions/source-resources')
  const platform = createHeadlessPlatform()
  platform.logger = { info() {}, warn() {}, debug() {}, error() {} }
  setSessionPlatform(platform)
  const checks: Array<{ id: string; passed: boolean; error?: string }> = []
  const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
  async function until(predicate: () => boolean, label: string, timeout = 20_000) {
    const start = Date.now()
    while (!predicate()) {
      assert(Date.now() - start < timeout, `Timed out: ${label}`)
      await pause(10)
    }
  }
  async function check(id: string, action: () => Promise<void>) {
    try { await action(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: String(error) }) }
    evidence.json('checks.json', checks)
  }

  async function fixture(id: string, mode: 'activation' | 'parallel' | 'before-dispatch' | 'legacy-first' | 'legacy-last' | 'plain' | 'exit' | 'missing-ack' | 'user-stop' = 'plain') {
    const workspace = join(root, id)
    const sessionId = id
    mkdirSync(join(workspace, 'sessions', id), { recursive: true })
    const runtime = createDurableRuntime()
    const manager = new SessionManager(runtime)
    const ws = { id: `ws-${id}`, name: id, slug: id, rootPath: workspace, createdAt: 1 }
    const managed = createManagedSession({ id, name: id, model: 'pi/fixture', permissionMode: 'allow-all' }, ws, { messagesLoaded: true })
    const internal = manager as unknown as {
      registerManagedSession(m: typeof managed): void
      getOrCreateAgent(m: typeof managed): Promise<unknown>
      processEvent(m: typeof managed, e: AgentEvent): Promise<void>
    }
    internal.registerManagedSession(managed)
    const ui: Array<Record<string, unknown>> = []
    manager.setEventSink((_channel, _target, ...args) => { for (const e of args) if (e && typeof e === 'object') ui.push(e as Record<string, unknown>) })
    const trace: Array<{ at: number; kind: string; detail?: unknown }> = []
    const note = (kind: string, detail?: unknown) => trace.push({ at: Date.now(), kind, detail })
    const requests: Array<Record<string, any>> = []
    const toolEffects: string[] = []
    let activated = false
    let delayedT2 = false
    const t2Started = Promise.withResolvers<void>()
    const t2Release = Promise.withResolvers<void>()
    const stopSent = Promise.withResolvers<void>()
    const buffered: string[] = []
    let holdEvents = mode !== 'plain'
    let flushEvents = () => {}
    const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      if (new URL(req.url).pathname.startsWith('/source/')) {
        toolEffects.push(new URL(req.url).pathname)
        return Response.json({ evidence: 'ACTIVATED_API_RESULT' })
      }
      const body = await req.json() as Record<string, any>
      requests.push(body)
      note('provider-request', requests.length)
      const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({
        id: `${id}-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture',
        choices: [{ index: 0, delta, finish_reason }],
        ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}),
      })}\n\n`
      const tools = (body.tools ?? []).map((t: any) => t.function.name) as string[]
      const call = (name: string, args: unknown, index = 0) => ({ index, id: `${id}-call-${requests.length}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
      let reply: string
      if (mode !== 'plain' && requests.length === 1) {
        const name = tools.find(t => t.endsWith('source_test'))
        assert(name, 'Real source_test is missing')
        const slugs = mode === 'parallel' ? ['alpha', 'beta'] : ['alpha']
        reply = chunk({ tool_calls: slugs.map((sourceSlug, index) => call(name, { sourceSlug }, index)) }, 'tool_calls')
      } else if (mode !== 'plain' && !JSON.stringify(body.messages).includes('activated]')) {
        // Force the real next request to be in flight before releasing tool results
        // to PiAgent's drain controller. Its cancellation produces a real T2.
        holdEvents = false
        flushEvents()
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk({ role: 'assistant' }) + chunk({ content: 'CANCELLED_FRAGMENT' })))
          req.signal.addEventListener('abort', () => { try { controller.close() } catch {} }, { once: true })
        } }), { headers: { 'Content-Type': 'text/event-stream' } })
      } else if (mode !== 'plain' && !JSON.stringify(body.messages).includes('ACTIVATED_API_RESULT')) {
        const name = tools.find(t => t.includes('alpha') && !t.endsWith('source_test'))
        if (name) reply = chunk({ tool_calls: [call(name, { path: 'evidence', method: 'GET' })] }, 'tool_calls')
        else {
          assert(!body.messages.some((m: any) => m.role === 'tool' && m.name === 'tool_search'), 'Activated tool must be discoverable')
          reply = chunk({ tool_calls: [call('tool_search', { query: 'alpha', limit: 1 })] }, 'tool_calls')
        }
      } else reply = chunk({ content: 'SOURCE_RESTART_COMPLETE' }) + chunk({}, 'stop')
      return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    for (const slug of ['alpha', 'beta']) {
      const folder = join(workspace, 'sources', slug)
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'config.json'), JSON.stringify({
        id: `${slug}-fixture`, slug, name: slug, provider: 'fixture', type: 'api', enabled: true,
        api: { baseUrl: `${api.url.href}source/${slug}/`, authType: 'none', testEndpoint: { method: 'GET', path: 'health' } },
        createdAt: 1, updatedAt: 1,
      }))
      writeFileSync(join(folder, 'guide.md'), `# ${slug}\nUse GET evidence.\n`)
    }
    const resources = bindPiRuntime(runtime, { workspaceRootPath: workspace, sessionId })
    const sourceResources = await prepareSessionSourceResources({ workspaceRootPath: workspace,
      sessionPath: join(workspace, 'sessions', id), servers: {}, needsHttpServer: true })
    const boundary = resources.durableModelBoundary!
    const agent = assembleSessionAgent({
      context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
        connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
          baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback fixture', provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
      hostRuntime: { appRootPath: resolve(import.meta.dir, '../..'), isPackaged: false, nodeRuntimePath: process.execPath },
      config: { model: 'pi/fixture', miniModel: 'pi/fixture', workspace: ws,
        session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, isHeadless: true,
        envOverrides: { PHANERIS_CONFIG_DIR: config, HOME: root, USERPROFILE: root, NODE_ENV: 'test' } },
      callbacks: {}, resources: { ...resources, mcpPool: sourceResources.pool, poolServerUrl: sourceResources.url,
        durableModelBoundary: { ...boundary, prepare: async request => {
          const prepared = await boundary.prepare(request)
          if (mode === 'before-dispatch' && activated && request.providerRequestId === '2') {
            // T1 exists, but the SDK still awaits permission to call the provider.
            holdEvents = false
            flushEvents()
            await stopSent.promise
          }
          return prepared
        }, commitOutcome: async request => {
        if (mode !== 'plain' && activated && request.providerRequestId === '2') {
          delayedT2 = true
          note('t2-held')
          t2Started.resolve()
          await t2Release.promise
        }
        const result = await boundary.commitOutcome(request)
        note('t2-committed', request.providerRequestId)
        return result
      } } },
    })
    const transport = agent as unknown as {
      handleLine(line: string): void
      send(message: { type: string; id?: string }): void
      subprocess: { kill(signal?: string): void } | null
      sourceActivationStopTimeoutMs: number
    }
    transport.sourceActivationStopTimeoutMs = mode === 'missing-ack' ? 300 : 5_000
    const originalLine = transport.handleLine.bind(agent)
    transport.handleLine = line => {
      const msg = JSON.parse(line) as Record<string, any>
      if (msg.type === 'abort_result') {
        note('abort-ack', msg.id)
        if (mode === 'missing-ack') return
      }
      if (msg.type === 'sdk_observation' && msg.observation?.event === 'agent_settled') note('sdk-settled')
      if (holdEvents && activated && msg.type === 'event') { buffered.push(line); return }
      originalLine(line)
    }
    flushEvents = () => { for (const line of buffered.splice(0)) originalLine(line) }
    const originalSend = transport.send.bind(agent)
    transport.send = message => {
      note(`send:${message.type}`, message.id)
      originalSend(message)
      if (message.type === 'abort') stopSent.resolve()
      if (message.type === 'abort' && mode === 'exit') transport.subprocess?.kill('SIGKILL')
    }
    mergeSessionScopedToolCallbacks(id, { activateSourceInSessionFn: async slug => {
      managed.enabledSourceSlugs = [...new Set([...(managed.enabledSourceSlugs ?? []), slug])]
      const sources = managed.enabledSourceSlugs.map(s => loadSource(workspace, s)!)
      const built = await buildServersFromSources(sources, join(workspace, 'sessions', id))
      assert.deepEqual(built.errors, [])
      await agent.setSourceServers(built.mcpServers, built.apiServers, managed.enabledSourceSlugs)
      agent.setPendingSourceActivationRestart?.({ sourceSlug: slug, userMessage: agent.getCurrentTurnUserMessage?.() ?? '' })
      activated = true
      return { ok: true, availability: 'next-turn' }
    } })
    const driver = new PiRuntimeDriver(agent, sourceResources.release)
    agent.setPermissionMode('allow-all')
    runtime.execution.installDriver(id, driver)
    // Construction/auth are fixture-owned; send/admission/events/retry/SQLite stay real.
    internal.getOrCreateAgent = async () => driver.controls
    return { manager, managed, runtime, ui, trace, requests, toolEffects, api, agent, transport, internal,
      t2Started, t2Release, delayedT2: () => delayedT2, note,
      async close() {
        holdEvents = false; flushEvents(); t2Release.resolve()
        evidence.json(`${id}.json`, { mode, trace, ui, toolEffects, requests,
          facts: runtime.queries.events(workspace, { sessionId }), operations: runtime.queries.operations(workspace, id) })
        await manager.cleanup(); api.stop(true)
      } }
  }

  for (const mode of ['activation', 'parallel', 'before-dispatch', 'legacy-first', 'legacy-last'] as const) await check({
    activation: 'A01-dispatched-request-drains-before-retry', parallel: 'A02-parallel-source-results',
    'before-dispatch': 'A03-cancel-before-provider-dispatch', 'legacy-first': 'A04-legacy-resend-wins', 'legacy-last': 'A04-server-resend-wins',
  }[mode], async () => {
    const f = await fixture(mode, mode)
    const task = 'Use the configured source and report its evidence'
    const attachmentPath = join(f.managed.workspace.rootPath, 'sessions', f.managed.id, 'evidence.txt')
    writeFileSync(attachmentPath, 'ATTACHED_EVIDENCE')
    const attachment = { type: 'text' as const, name: 'evidence.txt', mimeType: 'text/plain', size: 17, storedPath: attachmentPath }
    const stored = { ...attachment, id: 'original-attachment' }
    const first = f.manager.sendMessage(f.managed.id, task, [{ ...attachment, path: attachmentPath }], [stored])
    try {
      await until(() => f.delayedT2() || f.ui.some(e => e.type === 'source_activated'), 'activation or T2')
      await pause(150)
      assert(f.delayedT2(), 'Race did not reach a dispatched request T2')
      assert(!f.ui.some(e => e.type === 'source_activated'), 'Restart was published before the real T2 settled')
      assert(f.managed.runtime.isProcessing, 'Runtime released the turn before T2')
      // Retention check for an already accepted steer, including a legacy caller
      // whose payload contains only the original task and activation suffix.
      if (mode.startsWith('legacy-')) f.managed.turnSteers = ['CORRECTION_FOR_ACTIVATION_RETRY']
      f.t2Release.resolve()
      await first
      if (mode === 'legacy-first') await f.manager.sendMessage(f.managed.id, `${task}\n\n[alpha activated]`)
      if (mode === 'legacy-last') {
        await until(() => f.managed.messages.some(m => m.role === 'user' && m.content.includes('activated]')), 'server retry admission')
        await f.manager.sendMessage(f.managed.id, `${task}\n\n[alpha activated]`)
      }
      await until(() => f.managed.messages.some(m => m.content === 'SOURCE_RESTART_COMPLETE') && !f.managed.runtime.isProcessing, 'automatic source continuation')
      assert.equal(f.ui.filter(e => e.type === 'source_activated').length, 1)
      assert.equal(f.managed.messages.filter(m => m.role === 'user' && m.content.includes('activated]')).length, 1)
      const retry = f.managed.messages.find(m => m.role === 'user' && m.content.includes('activated]'))!
      assert(retry.hidden)
      assert.deepEqual(retry.attachments, [stored])
      if (mode.startsWith('legacy-')) assert(retry.content.includes('CORRECTION_FOR_ACTIVATION_RETRY'))
      assert(!f.managed.messages.some(m => m.content.includes('CANCELLED_FRAGMENT')))
      assert(f.toolEffects.some(path => path.endsWith('/evidence')), 'The real newly activated API tool must execute')
      if (mode === 'before-dispatch') assert(!f.trace.some(e => e.kind === 'provider-request' && e.at < f.trace.find(e => e.kind === 'abort-ack')!.at && e.detail === 2), 'Cancellation before provider dispatch must not call the provider')
      const facts = f.runtime.queries.events(f.managed.workspace.rootPath, { sessionId: f.managed.id })
      assert.equal(facts.filter(e => e.type === 'model_recovery_decided').length, 0)
      assert.equal(facts.filter(e => e.type === 'tool_outcome_committed' && (e.payload as { toolName?: string }).toolName?.endsWith('source_test')).length, mode === 'parallel' ? 2 : 1)
      assert.equal(f.runtime.queries.unsettledTools(f.managed.workspace.rootPath).length, 0)
      assert.equal(f.runtime.execution.view(f.managed.id).blocked, false)
      await f.manager.sendMessage(f.managed.id, 'Continue in the same session')
      assert.equal(f.runtime.execution.view(f.managed.id).blocked, false)
    } finally { f.t2Release.resolve(); await f.close(); await first.catch(() => {}) }
  })

  for (const kind of ['late-model', 'unknown-model', 'unknown-tool'] as const) await check(`R-${kind}`, async () => {
    const f = await fixture(kind)
    try {
      const ws = f.managed.workspace.rootPath, id = f.managed.id
      const handle = f.runtime.execution.begin({ sessionId: id, workspaceRootPath: ws })
      f.runtime.execution.accept(handle, { operationId: 'old-run', userMessageId: 'old-message', userMessage: 'Interrupted source task' })
      const request = { sessionId: id, runOperationId: 'old-run', turnId: 'old-message', providerRequestId: 'late-request', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'fixture' }
      const model = await f.runtime.effects.prepareModel(ws, request)
      assert.equal((await f.runtime.execution.finish(handle, 'interrupted')).kind, 'parked')
      if (kind !== 'unknown-model') {
        await f.runtime.effects.commitModelOutcome(ws, { ...request, operationId: model.operationId, stopReason: 'aborted', content: [] } satisfies DurableModelOutcomeRequest)
        if (kind === 'unknown-tool') await f.runtime.effects.prepareTool(ws, { sessionId: id, runOperationId: 'old-run', providerToolCallId: 'unknown-write', toolName: 'Write', args: { path: 'unknown.txt' } })
      }
      if (kind === 'late-model') {
        await f.manager.sendMessage(id, 'Continue after the real late T2')
        assert.equal(f.runtime.execution.view(id).blocked, false)
        assert.equal(f.runtime.queries.operations(ws, id).length, 0)
        assert(f.managed.messages.some(m => m.content === 'SOURCE_RESTART_COMPLETE'))
      } else {
        await assert.rejects(f.manager.sendMessage(id, 'Do not replay unknown effects'), /reconciliation/)
        assert.equal(f.runtime.execution.view(id).blocked, true)
        assert.equal(f.requests.length, 0)
      }
    } finally { await f.close() }
  })

  await check('E01-auto-resend-failure-visible', async () => {
    const f = await fixture('retry-failure')
    try {
      const id = f.managed.id
      const h = f.runtime.execution.begin({ sessionId: id, workspaceRootPath: f.managed.workspace.rootPath })
      f.runtime.execution.accept(h, { operationId: 'unknown-run', userMessageId: 'original', userMessage: 'Original task' })
      await f.runtime.effects.prepareModel(f.managed.workspace.rootPath, { sessionId: id, runOperationId: 'unknown-run', providerRequestId: 'unknown', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'fixture' })
      await f.runtime.execution.finish(h, 'interrupted')
      await f.internal.processEvent(f.managed, { type: 'source_activated', sourceSlug: 'alpha', originalMessage: 'Original task' })
      await pause(250)
      assert(f.ui.some(e => e.type === 'error'), 'Failed auto-resend must reach the UI')
      assert(f.managed.messages.some(m => m.role === 'error'), 'Failed auto-resend must persist an error message')
      assert.equal(f.managed.autoRetryPending, undefined, 'Failed retry must release its dedup slot')
    } finally { await f.close() }
  })

  for (const mode of ['exit', 'missing-ack', 'user-stop'] as const) await check(`E-${mode}`, async () => {
    const f = await fixture(mode, mode)
    const pending = f.manager.sendMessage(f.managed.id, 'Activate the source')
    try {
      if (mode === 'exit') {
        await until(() => f.trace.some(e => e.kind === 'send:abort'), 'stop request')
        f.t2Release.resolve()
      } else {
        await until(() => f.delayedT2(), 'held T2')
        if (mode === 'user-stop') f.runtime.execution.requestStop(f.managed.id, 'user_stop')
        f.t2Release.resolve()
      }
      await pending
      await pause(200)
      assert(!f.ui.some(e => e.type === 'source_activated'), 'Failed or user-cancelled activation must not auto-resend')
      if (mode !== 'user-stop') assert(f.ui.some(e => e.type === 'error' || e.type === 'typed_error'), 'Subprocess stop failure must be visible')
    } finally { f.t2Release.resolve(); await f.close(); await pending.catch(() => {}) }
  })

  assert(checks.every(c => c.passed), JSON.stringify(checks.filter(c => !c.passed)))
  evidence.complete(checks.map(c => c.id), ['Live provider services and packaged installer; source assembly/auth use a fixture-owned agent factory.'])
  console.log(JSON.stringify({ passed: checks.length, output: root }))
})
