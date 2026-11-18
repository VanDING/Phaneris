import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Stage 2 acceptance: a ready definition becomes a real ordinary Session run
 * through the Host's single scheduling owner, the runtime's own receipt drives
 * the assignment state, the Worker's real `write` tool call is recovered into an
 * Artifact revision, rework keeps the Task identity in a new Session, and the
 * whole record survives a restart.
 *
 * The Worker is an ordinary Session whose real `write` tool runs: the recovered
 * Artifact therefore comes from the product's own completion path
 * (`registerDelegatedDeliverables`), not from a fixture that mimics it. See
 * docs/verification/assistant-refactor-2026-11-18-failure-matrix.md (M10/M15).
 */
await verificationWorkflow('assistant-task-delivery', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Delivery', rootPath: root, createdAt: 1 }

  // The Worker's real `write` tool resolves a relative path against its own
  // working directory, which for this workspace is the Session folder (the
  // workspace default is `none`). Writing a relative name is what a real Worker
  // does, and keeps the file inside the roots the completion path may recover.
  const outputName = 'pelican.html'
  const html = '<!doctype html><html><body><h1>Pelican on a bicycle</h1><svg role="img" aria-label="pelican riding a bicycle"></svg></body></html>'
  // The Worker is an ordinary Session: the loopback drives its real tools so the
  // produced file is a genuine write-tool result, not a fixture assertion.
  let workerWrote = false
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { model: string; messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> }
    const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'delivery-fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const toolNames = body.tools?.map(tool => tool.function.name) ?? []
    const writeTool = toolNames.find(name => /(^|__)write$/i.test(name))
    if (!workerWrote && writeTool) {
      workerWrote = true
      // `path` is the real write-tool parameter. Sending `file_path` here made the
      // tool reject its own arguments, so no file ever existed and Artifact
      // recovery had nothing to find — a fixture that proved nothing.
      return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: 'call-write-pelican', type: 'function',
        function: { name: writeTool, arguments: JSON.stringify({ path: outputName, content: html }) } }] }, 'tool_calls') + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(chunk({ role: 'assistant' }) + chunk({ content: 'DELIVERY_WORKER_TEXT' }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
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
  const boot = () => bootstrapServer({ serverToken: 'delivery-fixture-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
    cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  const connect = async (target: { port: number }) => {
    const client = new WsRpcClient(`ws://127.0.0.1:${target.port}`, { workspaceId: 'alpha', token: 'delivery-fixture-token', autoReconnect: false })
    await client.connect()
    return client
  }
  const until = async (condition: () => boolean | Promise<boolean>, label: string) => {
    const deadline = Date.now() + 45000
    while (!await condition()) { assert(Date.now() < deadline, `Did not settle: ${label}`); await Bun.sleep(30) }
  }
  const scenes: string[] = [], evidence: unknown[] = []
  let host = await boot(), client = await connect(host)
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    // The Host-bound dispatch path requires a direct user instruction as the
    // trusted origin, so the user really types the request first.
    await manager.sendMessage(assistant.id, '请做一个鹈鹕骑自行车的自包含 HTML，文件名 pelican.html。')
    await until(async () => !(await manager.getSession(assistant.id))!.isProcessing, 'assistant turn')
    // Record the delegation through the Host-bound service (the model tool path is
    // verified separately by assistant-task-desktop-entry).
    const tasks = (manager as unknown as { residentService(w: typeof workspace): { tasks(h: unknown): {
      create(i: unknown, m?: string, a?: unknown): { task: { id: string }; definitionVersion: number; stage: string }
      store: { list(q: unknown): { items: Array<{ task: { id: string } }> } } } } })
      .residentService(workspace).tasks({ readyFacts: async () => ({ permissionMode: 'safe', workingDirectory: root }), changed: () => {} })
    const created = tasks.create({ requestId: 'delivery-pelican', goalTitle: 'Deliver a pelican HTML', title: 'Pelican on a bicycle HTML',
      scopeIn: ['one self-contained pelican.html'], requirements: [{ statement: 'A pelican rides a bicycle', scope: 'task' }],
      acceptance: ['pelican.html exists', 'The file opens and shows a pelican on a bicycle'], deliverable: 'self-contained HTML' }, 'msg-delivery', { directUser: true })
    const taskId = created.task.id
    assert.equal(created.stage, 'intake')
    scenes.push('B01-definition-exists-before-any-session')

    // M10 · Dispatch through the Host's single scheduling owner.
    //
    // Producing a file is a write, so the Workspace's execution ceiling must allow
    // one. This is the real authority path (`setAssistantExecutionMode`), not a
    // fixture flag: with the default `safe` ceiling the Worker's own write tool is
    // refused as "Explore mode" and no deliverable can exist at all.
    await manager.setAssistantExecutionMode('alpha', 'allow-all')
    const readyCheck = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId, checkReady: true })
    assert(readyCheck.items[0]!.ready!.ready, `Expected ready: ${readyCheck.items[0]!.ready!.missing.join(', ')}`)
    const dispatched = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS_DISPATCH, 'alpha', taskId, { requestId: 'dispatch-1', config: {} })
    assert.equal(dispatched.assignment.taskId, taskId)
    assert.equal(dispatched.assignment.definitionVersion, readyCheck.items[0]!.definitionVersion, 'The assignment must pin the version it was admitted under')
    assert(dispatched.receipt.sessionId, 'A real ordinary Session must own the execution')
    assert.deepEqual(dispatched.assignment.requirementIds, readyCheck.items[0]!.activeRequirements.map((item: { id: string }) => item.id),
      'The assignment must carry the requirement ids it was admitted with')
    evidence.push({ taskId, sessionId: dispatched.receipt.sessionId, assignmentId: dispatched.assignment.id })
    scenes.push('B02-dispatch-binds-assignment-to-a-real-session')

    // M10 · The runtime's own receipt settles the assignment.
    await until(async () => {
      const page = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId })
      return !['admitted', 'queued', 'running'].includes(page.items[0]!.assignments.at(-1)!.state)
    }, 'worker settlement')
    const settled = (await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId })).items[0]!
    assert.equal(settled.assignments.at(-1)!.state, 'completed', `Worker must complete: ${JSON.stringify(settled.assignments.at(-1))}`)
    assert.equal(settled.stage, 'candidate_result', 'A finished run is a candidate result, not an accepted one')
    evidence.push({ settledStage: settled.stage, assignment: settled.assignments.at(-1) })
    scenes.push('B03-runtime-receipt-settles-the-assignment')

    // M10/M15 · The file the Worker actually wrote is recovered into an Artifact
    // revision by the product's own completion path, and that revision is what a
    // user opening the deliverable reads. Nothing here re-registers the file.
    const { listArtifacts, getArtifact } = await import('@phaneris/shared/artifacts')
    const { getSessionPath } = await import('@phaneris/shared/sessions')
    const workerSessionId = dispatched.receipt.sessionId!
    const expectedPath = join(getSessionPath(root, workerSessionId), outputName)
    assert(existsSync(expectedPath), `The Worker's write tool must have produced ${expectedPath}`)
    assert.equal(readFileSync(expectedPath, 'utf8'), html, 'The recovered file must be the Worker write result')
    const artifacts = listArtifacts({ workspaceRootPath: root }, { sessionId: workerSessionId })
    const recovered = artifacts.find(({ artifact }) => resolve(artifact.sourcePath) === resolve(expectedPath))
    assert(recovered, `Completion must recover the Worker's file as an Artifact; found ${JSON.stringify(artifacts.map(a => a.artifact.sourcePath))}`)
    const revision = recovered.artifact.currentRevision
    assert(revision, 'A recovered Artifact must carry a version')
    const version = recovered.artifact.revisions.find(item => item.id === revision)!
    assert.equal(version.size, Buffer.byteLength(html), 'The Artifact version must describe the file actually written')
    // M15: opening the exact version yields the real file, not a copy or a path
    // that no longer exists.
    const opened = getArtifact({ workspaceRootPath: root }, recovered.artifact.id, revision)
    assert.equal(readFileSync(opened.activePath!, 'utf8'), html, 'The versioned Artifact must open the real file content')
    evidence.push({ artifactId: recovered.artifact.id, revision, sourcePath: recovered.artifact.sourcePath,
      size: version.size, openedPath: opened.activePath })
    scenes.push('B08-worker-write-is-recovered-as-a-versioned-artifact', 'B09-opening-the-artifact-revision-reads-the-real-file')

    // M16 · Acceptance binds the reviewed version and cites real evidence.
    const tasksApi = (manager as unknown as { residentService(w: typeof workspace): { tasks(h: unknown): {
      verify(i: unknown, a?: string): { verification?: { definitionVersion: number; verdict: string }; stage: string; task: { id: string } } } } })
      .residentService(workspace).tasks({ readyFacts: async () => ({ permissionMode: 'safe', workingDirectory: root }), changed: () => {} })
    const reviewed = tasksApi.verify({ requestId: 'verify-1', taskId, verdict: 'accepted',
      results: [{ criterionId: 'ac-1', outcome: 'met', evidence: 'worker produced text result' }] }, settled.assignments.at(-1)!.id)
    assert.equal(reviewed.verification!.verdict, 'accepted')
    assert.equal(reviewed.verification!.definitionVersion, settled.task.definitionVersion)
    assert.equal(reviewed.stage, 'accepted')
    scenes.push('B04-acceptance-binds-version-and-evidence')

    // M11 · Rework keeps the Task identity and runs in a different Session.
    const reworked = tasksApi.verify({ requestId: 'verify-rework', taskId, verdict: 'rework',
      results: [{ criterionId: 'ac-1', outcome: 'gap', evidence: 'bicycle spokes missing' }] }, settled.assignments.at(-1)!.id)
    assert.equal(reworked.task.id, taskId, 'Rework must preserve the Task identity')
    assert.equal(reworked.stage, 'rework')
    const priorCount = settled.assignments.length
    const redispatched = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS_DISPATCH, 'alpha', taskId, { requestId: 'dispatch-2', config: {} })
    assert.equal(redispatched.assignment.taskId, taskId)
    assert.notEqual(redispatched.receipt.sessionId, dispatched.receipt.sessionId, 'Rework runs in a new Session')
    const afterRework = (await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId })).items[0]!
    assert(afterRework.assignments.length > priorCount, 'The prior assignment must stay readable beside the new one')
    assert(afterRework.assignments.some(assignment => assignment.sessionId === dispatched.receipt.sessionId), 'The original execution must stay readable')
    scenes.push('B05-rework-preserves-task-identity-across-sessions')

    // M12 · A restart preserves identity, versions and assignments without replay.
    await until(async () => {
      const page = await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId })
      return !['admitted', 'queued', 'running'].includes(page.items[0]!.assignments.at(-1)!.state)
    }, 'rework settlement')
    const beforeRestart = (await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId })).items[0]!
    client.destroy()
    await host.stop()
    host = await boot()
    client = await connect(host)
    const restored = (await client.invoke(RPC_CHANNELS.residentAssistant.TASKS, 'alpha', { taskId })).items[0]!
    assert.equal(restored.task.id, beforeRestart.task.id)
    assert.equal(restored.definitionVersion, beforeRestart.definitionVersion)
    assert.equal(restored.assignments.length, beforeRestart.assignments.length, 'Restart must not replay or drop assignments')
    assert(restored.assignments.some(assignment => assignment.sessionId === dispatched.receipt.sessionId), 'The original execution must survive restart')
    assert.equal(restored.requirements.length, beforeRestart.requirements.length, 'Requirement history must survive restart')
    evidence.push({ afterRestart: { stage: restored.stage, assignments: restored.assignments.length, version: restored.definitionVersion } })
    scenes.push('B06-restart-preserves-identity-versions-and-assignments')

    // M19 · A terminated task refuses further dispatch instead of running again.
    await client.invoke(RPC_CHANNELS.residentAssistant.TASKS_CONTROL, 'alpha', { requestId: 'delivery-stop', taskIds: [taskId], action: 'terminate' })
    await assert.rejects(() => client.invoke(RPC_CHANNELS.residentAssistant.TASKS_DISPATCH, 'alpha', taskId, { requestId: 'dispatch-3', config: {} }),
      /terminated|readiness|not ready/i)
    scenes.push('B07-termination-refuses-further-dispatch')

    run.json('delivery-evidence.json', { scenes, evidence })
  } finally {
    client.destroy()
    await host.stop()
    provider.stop(true)
  }
  run.complete(scenes, [
    'Electron panel rendering of the delivery (separate Electron workflow)',
    'A real model choosing the file content and path',
    'Real paid model file quality',
  ])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
