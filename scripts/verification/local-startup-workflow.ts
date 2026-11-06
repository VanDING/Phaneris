/** Failure matrix predates implementation: local-startup-failure-matrix-2026-11-06.md. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('local-startup', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { writeSessionJsonl } = await import('../../packages/shared/src/sessions/jsonl')
  const { ensureDefaultIconFiles } = await import('../../packages/shared/src/statuses/storage')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { SessionManager, setSessionPlatform } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const { AutomationSystem } = await import('../../packages/shared/src/automations/automation-system')
  const { createPage, updatePage } = await import('../../packages/shared/src/pages/storage')
  const workspaces = ['history', 'other'].map(id => ({ id, slug: id, name: id,
    rootPath: join(run.directory, id), createdAt: 1 }))
  for (const workspace of workspaces) {
    createWorkspaceAtPath(workspace.rootPath, workspace.name)
    ensureDefaultIconFiles(workspace.rootPath)
    const location = join(workspace.rootPath, 'assistant')
    mkdirSync(location, { recursive: true })
    writeFileSync(join(location, 'session-location.json'), JSON.stringify({ version: 1, sessionId: `${workspace.id}-assistant` }))
    // The location exists without a live assistant Session; a directory listing must remain cold.
  }
  saveConfig({ workspaces, activeWorkspaceId: workspaces[0]!.id, activeSessionId: null })
  const legacyBackup = join(process.env.PHANERIS_CONFIG_DIR!, 'config.json.bak-2000-01-01')
  writeFileSync(legacyBackup, 'preserved historical config')
  const configInit = Bun.spawnSync([process.execPath, '-e', `import { ensureConfigDir } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, '../../packages/shared/src/config/repository.ts')).href)}; ensureConfigDir()`],
    { env: process.env, stdout: 'pipe', stderr: 'pipe' })
  assert.equal(configInit.exitCode, 0, configInit.stderr.toString())
  assert.deepEqual(readdirSync(process.env.PHANERIS_CONFIG_DIR!).filter(name => name.startsWith('config.json.bak-')), ['config.json.bak-2000-01-01'])
  const sessions = Array.from({ length: 640 }, (_, index) => ({
    id: `history-${index}`, workspaceRootPath: workspaces[0]!.rootPath, createdAt: 1, lastUsedAt: index + 1,
    name: `History ${index}`, sessionStatus: index % 3 ? 'done' : 'cancelled', isArchived: index % 5 === 0,
    permissionMode: index === 0 ? 'allow-all' as const : 'ask' as const,
    messages: [{ id: `user-${index}`, type: 'user' as const, timestamp: 1, content: 'Preserved historical message' }],
    tokenUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, contextTokens: 100, costUsd: 0.01 },
  }))
  for (const session of sessions) {
    const directory = join(session.workspaceRootPath, 'sessions', session.id)
    mkdirSync(directory, { recursive: true }); writeSessionJsonl(join(directory, 'session.jsonl'), session)
  }
  const platform = createHeadlessPlatform(); setSessionPlatform(platform)
  const runtime = createDurableRuntime()
  let usageReads = 0
  const observed = { ...runtime, queries: { ...runtime.queries, usage: (...args: Parameters<typeof runtime.queries.usage>) => {
    usageReads++; return runtime.queries.usage(...args)
  } } }
  const manager = new SessionManager(observed), server = new WsRpcServer({ host: '127.0.0.1', port: 0 })
  const checks: string[] = [], failures: Array<{ id: string; message: string }> = []
  const scene = async (id: string, verify: () => void | Promise<void>) => {
    try { await verify(); checks.push(id) } catch (error) { failures.push({ id, message: String(error) }) }
  }
  let client: InstanceType<typeof WsRpcClient> | undefined
  const oauthFlowStore = new OAuthFlowStore()
  let cleaned = false
  const internals = manager as unknown as { sessions: Map<string, { messagesLoaded: boolean; runtime: { agent: unknown } }> }
  const slots = (runtime.execution as unknown as { slots: Map<string, unknown> }).slots
  try {
    const started = performance.now(); await manager.initialize(); const initializeMs = performance.now() - started
    await scene('LS06-LS14-history-is-cold', () => {
      assert.equal(slots.size, 0)
      assert.equal(usageReads, 0)
      assert([...internals.sessions.values()].every(session => !session.messagesLoaded && !session.runtime.agent))
    })
    await scene('LS18-scheduler-follows-configured-work', () => {
      assert.equal(manager.getWorkspaceAutomationSummary(workspaces[0]!.id).schedulerRunning, false)
      const systems = (manager as unknown as { automationSystems: Map<string, { reloadConfig(): { success: boolean } }> }).automationSystems
      const system = systems.get(workspaces[0]!.rootPath)!
      const path = join(workspaces[0]!.rootPath, 'automations.json')
      const config = { version: 1, automations: { SchedulerTick: [{ id: 'fixture-clock', enabled: true,
        cron: '0 0 1 1 *', actions: [{ type: 'prompt', prompt: 'Fixture schedule' }] }] } }
      writeFileSync(path, JSON.stringify(config)); assert(system.reloadConfig().success)
      assert.equal(manager.getWorkspaceAutomationSummary(workspaces[0]!.id).schedulerRunning, true)
      config.automations.SchedulerTick[0]!.enabled = false
      writeFileSync(path, JSON.stringify(config)); assert(system.reloadConfig().success)
      assert.equal(manager.getWorkspaceAutomationSummary(workspaces[0]!.id).schedulerRunning, false)
    })
    await scene('LS18-LS19-headless-events-and-page-refresh-remain-enabled', async () => {
      const root = join(run.directory, 'headless-automations'), prompts: string[] = []
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'automations.json'), JSON.stringify({ version: 1, automations: {
        SessionStatusChange: [{ id: 'headless-event', actions: [{ type: 'prompt', prompt: 'Configured event' }] }],
      } }))
      const system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'headless', enableScheduler: true,
        onPromptsReady: ready => { prompts.push(...ready.map(prompt => prompt.prompt)) } })
      try {
        assert.equal(system.isSchedulerRunning(), false)
        await system.eventBus.emit('SessionStatusChange', { workspaceId: 'headless', timestamp: Date.now(), oldState: 'todo', newState: 'done' })
        assert.deepEqual(prompts, ['Configured event'])
        const page = createPage(root, { name: 'Refresh acceptance', refresh: { enabled: true, cron: '0 0 1 1 *', script: 'scripts/refresh.py' } })
        assert.equal(system.reloadPageRefreshMatchers(), 1)
        assert.equal(system.isSchedulerRunning(), true)
        updatePage(root, page.slug, { refresh: null })
        assert.equal(system.reloadPageRefreshMatchers(), 0)
        assert.equal(system.isSchedulerRunning(), false)
      } finally { await system.dispose() }
    })
    await scene('LS02-LS03-no-automatic-backups', async () => {
      await new Promise(resolve => setTimeout(resolve, 1200))
      assert(workspaces.every(workspace => !existsSync(join(workspace.rootPath, 'runtime/backups'))))
      assert.equal(readFileSync(legacyBackup, 'utf8'), 'preserved historical config')
    })
    let lists = 0
    const getSessions = manager.getSessions.bind(manager)
    manager.getSessions = workspaceId => { lists++; return getSessions(workspaceId) }
    registerSessionsHandlers(server, { sessionManager: manager, platform, oauthFlowStore })
    await server.listen()
    client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: workspaces[0]!.id, autoReconnect: false })
    await client.connect()
    const listed = await client.invoke(RPC_CHANNELS.sessions.GET)
    await scene('LS13-list-snapshot-does-not-reread-location-file', () => {
      const path = join(workspaces[0]!.rootPath, 'assistant/session-location.json'), original = readFileSync(path)
      writeFileSync(path, 'unreadable mapping during list serialization')
      try { assert.equal(manager.getSessions(workspaces[0]!.id).length, sessions.length) }
      finally { writeFileSync(path, original) }
    })
    await scene('LS14-saved-summary-without-transcript', () => {
      assert.equal(listed.length, sessions.length)
      assert.equal(listed[0]!.tokenUsage?.totalTokens, 110)
      assert(listed.every(session => session.messages.length === 0))
    })
    lists = 0
    const ownershipStart = performance.now()
    await Promise.all(sessions.map(session => client!.invoke(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, session.id)))
    const ownershipMs = performance.now() - ownershipStart
    await scene('LS11-linear-real-rpc-ownership', () => { assert.equal(lists, 0); assert.equal(slots.size, 0) })
    await scene('LS11-workspace-isolation', async () => {
      const otherClient = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: workspaces[1]!.id, autoReconnect: false })
      try {
        await otherClient.connect()
        await assert.rejects(otherClient.invoke(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, sessions[0]!.id), /does not belong/)
        await assert.rejects(otherClient.invoke(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, '../invalid'), /Invalid session/)
      } finally { otherClient.destroy() }
    })
    await scene('LS08-one-history-session-activates', async () => {
      const session = await manager.getSession(sessions[0]!.id)
      assert.equal(session?.messages[0]?.content, 'Preserved historical message')
      assert.equal(session?.permissionMode, 'allow-all')
      assert.equal(slots.size, 1)
      assert.equal([...internals.sessions.values()].filter(item => item.messagesLoaded).length, 1)
    })
    const beforeClose = slots.size
    await manager.cleanup()
    cleaned = true
    await scene('LS23-close-does-not-activate-history', () => { assert.equal(beforeClose, 1); assert.equal(slots.size, 0) })
    await scene('LS07-done-session-with-unsettled-effect-still-recovers', async () => {
      const workspace = workspaces[0]!, sessionId = sessions[1]!.id, seed = createDurableRuntime()
      seed.commands.acceptRun({ workspaceRootPath: workspace.rootPath, sessionId, operationId: 'unsettled-run',
        turnId: 'unsettled-turn', userMessageId: 'unsettled-input', userMessage: 'Accepted before restart' })
      await seed.effects.prepareTool(workspace.rootPath, { sessionId, runOperationId: 'unsettled-run',
        providerToolCallId: 'unknown-write', toolName: 'Write', args: { path: 'never-replay.txt' } })
      await seed.close()
      const restarted = createDurableRuntime(), restartedManager = new SessionManager(restarted)
      try {
        await restartedManager.initialize()
        const active = (restarted.execution as unknown as { slots: Map<string, unknown> }).slots
        assert.equal(active.size, 1); assert(active.has(sessionId))
        assert.equal(restartedManager.getSessions(workspace.id).find(session => session.id === sessionId)?.sessionStatus, 'done')
        assert.equal(restarted.queries.unsettledTools(workspace.rootPath).length, 1)
        assert(!existsSync(join(workspace.rootPath, 'never-replay.txt')))
      } finally { await restartedManager.cleanup() }
    })
    run.json('local-startup.json', { checks, failures, sessions: sessions.length, initializeMs, ownershipMs, lists, usageReads })
    assert.deepEqual(failures, [])
    run.complete(checks, ['Paid model inference', 'Signed installer', 'Desktop first-paint is verified separately'])
    console.log(JSON.stringify({ passed: checks.length, output: run.directory, initializeMs, ownershipMs }))
  } finally { client?.destroy(); server.close(); oauthFlowStore.dispose(); if (!cleaned) await manager.cleanup() }
})
