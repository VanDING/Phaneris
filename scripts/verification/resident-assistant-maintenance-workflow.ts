import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure contract, written before the queue implementation:
// automatic: real Runtime extraction -> active memory without manual promotion;
// paused/explicit: no background model admission; use=false is independent;
// internal scope: no delegation, forgetting, source widening or file effects;
// bounded: persistent model/tool/day counters, exact checkpoint, no self-feedback;
// foreground: a direct user cancels maintenance before admission, preserving progress;
// context: foreground topic changes also preempt hidden maintenance, never a user response;
// restart: pending work resumes through the same resident Session and checkpoints.
await verificationWorkflow('resident-assistant-maintenance', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const privateToJob = join(root, 'unselected-document.txt'); writeFileSync(privateToJob, 'UNSELECTED_SOURCE_MUST_NOT_BE_READ')
  const workspace = { id: 'alpha', name: 'Maintenance fixture', rootPath: root, createdAt: 1 }
  type Request = { messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function: { name: string } }> }
  const requests: Request[] = [], checkpoints: string[] = []
  let blockMaintenance = false, blocked = false, blockForeground = false, foregroundStarted = false
  const foregroundRelease = Promise.withResolvers<void>()
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as Request; requests.push(body)
    if (requests.length > 65) return Response.json({ error: { message: 'Maintenance fixture model budget exceeded' } }, { status: 400 })
    const all = JSON.stringify(body.messages), marker = all.includes('<resident_memory_maintenance>')
    if (marker && blockMaintenance) { blocked = true; await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true })); return new Response(null, { status: 499 }) }
    if (!marker && blockForeground) { foregroundStarted = true; await foregroundRelease.promise }
    const toolResults = body.messages.filter(message => message.role === 'tool').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
    const sourceText = toolResults.findLast(text => text.includes('"checkpointId"') && text.includes('"requestIdPrefix"'))
    const sourceMatch = sourceText?.replaceAll('\\"', '"').match(/"checkpointId"\s*:\s*"([a-f0-9]{64})"/)
    const source = sourceMatch ? sourceMatch[1]! : undefined
    let call: { name: string; args: object } | undefined
    if (marker) {
      const sourceResult = toolResults.findLast(text => text.includes('requestIdPrefix'))
      const decoded = sourceResult?.replaceAll('\\"', '"')
      const sessionId = decoded?.match(/"sessionId"\s*:\s*"([^"]+)"/)?.[1]
      const messageId = decoded?.match(/"messageId"\s*:\s*"([^"]+)"/)?.[1]
      const projectId = decoded?.match(/"projectId"\s*:\s*"([^"]+)"/)?.[1]
      if (!toolResults.length) call = { name: 'read', args: { path: privateToJob } }
      else if (!sourceResult && !toolResults.some(text => text.includes('budget_exhausted') || text.includes('"idle"'))) {
        call = { name: 'mcp__session__assistant_memory_maintenance', args: { action: 'next' } }
      } else if (source && decoded?.includes('PROJECT_DECISION_PERSONAL_ONLY') && !toolResults.some(text => text.includes('"entryId"'))) {
        const metadata = toolResults.findLast(text => text.includes('"reference"'))
        const contentHash = metadata?.match(/"contentHash"\s*:\s*"([a-f0-9]{64})"/)?.[1]
        call = contentHash ? { name: 'mcp__session__project_memory_append', args: { requestId: `extract:${source}:project`, projectId, expectedContentHash: contentHash,
          note: 'PROJECT_DECISION_PERSONAL_ONLY：首期只做个人使用，不增加团队功能。', evidence: { source: { sessionId, messageId }, quote: '首期只做个人使用，不增加团队功能' },
          assessment: { confidence: 'supported', durability: 'durable', domain: 'project_fact', reason: 'Explicit durable project decision in this source fragment.' } } }
          : { name: 'mcp__session__project_memory_read', args: {} }
      } else if (source && toolResults.some(text => text.includes('"entryId"')) && !toolResults.some(text => text.includes('acknowledged'))) {
        const entry = JSON.parse(toolResults.findLast(text => text.includes('"entryId"'))!) as { entryId: string }
        call = { name: 'mcp__session__assistant_memory_maintenance', args: { action: 'acknowledge', checkpointId: source, conclusion: 'project_recorded',
          projectEntries: [{ projectId, entryId: entry.entryId }], reason: 'Stored this exact source in the existing Project owner.' } }
      } else if (source && !decoded?.includes('PROJECT_DECISION_PERSONAL_ONLY') && !toolResults.some(text => text.includes('"record"'))) {
        checkpoints.push(source)
        call = { name: 'mcp__session__assistant_memory_update', args: { action: 'remember', requestId: `extract:${source}:fixture`, key: `fixture:${messageId}`,
          kind: 'fact', basis: 'inferred', projectId, content: '用户希望默认使用中文并采用简明表达。', sources: [{ sessionId, messageId }],
          assessment: { confidence: 'supported', durability: 'durable', domain: 'collaboration', reason: 'The source explicitly requests a durable communication preference.' } } }
      } else if (source && !toolResults.some(text => text.includes('acknowledged'))) {
        const memoryText = toolResults.findLast(text => text.includes('"record"'))?.replaceAll('\\"', '"')
        const candidateId = memoryText?.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
        call = { name: 'mcp__session__assistant_memory_maintenance', args: { action: 'acknowledge', checkpointId: source,
          conclusion: candidateId ? 'candidates' : 'no_candidate', ...(candidateId ? { candidateIds: [candidateId] } : {}), reason: 'Reviewed the exact supplied fragment.' } }
      }
    }
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'maintenance', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const reply = call ? chunk({ tool_calls: [{ index: 0, id: `maintenance-${requests.length}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.name === 'read' || call.name.includes('project_memory_') ? call.args : { command: call.args }) } }] }, 'tool_calls')
      : chunk({ content: marker ? 'MAINTENANCE_FRAGMENT_COMPLETE' : 'FOREGROUND_REPLIED' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture',
    llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
      customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Fixture', provider: 'pi', contextWindow: 64000, maxTokens: 4096 }] }] }))
  const workspaceConfig = join(root, 'config.json')
  writeFileSync(workspaceConfig, JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'paused', use: true }, defaults: { permissionMode: 'allow-all', defaultLlmConnection: 'fixture', model: 'fixture' } }))
  const { getCredentialManager } = await import('@phaneris/shared/credentials'); await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  let manager!: InstanceType<typeof SessionManager>
  const start = () => bootstrapServer({ serverToken: 'maintenance-fixture', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  let host = await start(), client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'maintenance-fixture', autoReconnect: false }); await client.connect()
  const until = async (condition: () => boolean | Promise<boolean>) => { const end = Date.now() + 25000; while (!await condition()) { assert(Date.now() < end, 'Timed out waiting for actual maintenance state'); await Bun.sleep(25) } }
  const policy = (learning: string, use = true) => { const value = JSON.parse(readFileSync(workspaceConfig, 'utf8')); value.assistantMemory = { version: 1, learning, use }; writeFileSync(workspaceConfig, JSON.stringify(value)) }
  const scenes: string[] = []
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    await manager.sendMessage(assistant.id, '请长期记住我的交流偏好：默认中文，表达简明。')
    await Bun.sleep(1400)
    assert(!requests.some(body => JSON.stringify(body).includes('<resident_memory_maintenance>')))
    assert(manager.getAssistantMemoryStore('alpha').maintenanceStatus().pending > 0)
    const { createProject } = await import('@phaneris/shared/projects')
    const switchedProject = createProject(root, { name: 'Later project', details: 'UNRELATED_PROJECT_MUST_NOT_ENTER_MAINTENANCE' })
    await manager.setSessionProjectId(assistant.id, switchedProject.id)
    scenes.push('Paused learning retains pending references without calling a model')
    const { loadSession, getSessionPath } = await import('@phaneris/shared/sessions')
    client.destroy(); await host.stop()
    const sdkId = loadSession(root, assistant.id)?.sdkSessionId
    assert(sdkId, 'The first real Pi turn must populate SDK identity before migration')
    const nativeSession = getSessionPath(root, assistant.id)
    assert(readdirSync(join(nativeSession, '.pi-sessions')).length > 0)
    const moveFixturePath = (from: string, to: string) => {
      for (const path of [from, to]) { const part = relative(resolve(run.directory), resolve(path)); assert(part && !part.startsWith('..') && !isAbsolute(part), 'Fixture moves stay inside the verification workspace') }
      renameSync(from, to)
    }
    mkdirSync(join(root, 'sessions'), { recursive: true })
    moveFixturePath(nativeSession, join(root, 'sessions', assistant.id))
    moveFixturePath(join(root, 'assistant', 'session-location.json'), join(run.directory, 'previous-location.json'))
    moveFixturePath(join(root, 'assistant', 'memory'), join(root, 'memory'))
    policy('automatic', false); host = await start()
    client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'maintenance-fixture', autoReconnect: false }); await client.connect()
    assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, assistant.id)
    assert.equal(loadSession(root, assistant.id)?.sdkSessionId, sdkId)
    assert(readdirSync(join(getSessionPath(root, assistant.id), '.pi-sessions')).length > 0)
    scenes.push('Cold legacy-layout migration retains a populated real SDK journal and resumes the same assistant')
    await until(() => manager.getAssistantMemoryStore('alpha').maintenanceStatus().done > 0)
    const memory = manager.getAssistantMemoryStore('alpha'), records = memory.query({ limit: 20 }).items
    assert(records.some(record => record.state === 'active'), 'The real Runtime must admit supported extracted memory without manual promotion')
    assert.equal(memory.lookup({ query: '中文' }).items.length, 0, 'use=false does not pause learning or permit injection')
    const status = memory.maintenanceStatus()
    assert(status.modelCalls > 0 && status.modelCalls <= 6 && status.toolCalls > 0 && status.toolCalls <= 16)
    assert.equal(new Set(checkpoints).size, 1)
    assert(requests.filter(body => JSON.stringify(body).includes('<resident_memory_maintenance>')).every(body => !JSON.stringify(body).includes('UNRELATED_PROJECT_MUST_NOT_ENTER_MAINTENANCE')))
    assert(requests.some(body => JSON.stringify(body).includes('Background maintenance cannot perform this tool effect')))
    assert(!requests.some(body => JSON.stringify(body).includes('UNSELECTED_SOURCE_MUST_NOT_BE_READ')))
    const timeline = (await manager.getSession(assistant.id))!.messages
    assert(timeline.filter(message => message.content === 'MAINTENANCE_FRAGMENT_COMPLETE').every(message => message.hidden), 'Background review cannot create visible chat replies')
    scenes.push('Restart resumes pending extraction through the same resident identity; independent use switch and durable budgets')
    await manager.sendMessage(assistant.id, 'PROJECT_DECISION_PERSONAL_ONLY：首期只做个人使用，不增加团队功能。')
    const { getProjectMemoryPath } = await import('@phaneris/shared/projects')
    const projectFile = getProjectMemoryPath(root, switchedProject.slug)
    await until(() => memory.maintenanceStatus().done >= 2)
    assert(readFileSync(projectFile, 'utf8').includes('PROJECT_DECISION_PERSONAL_ONLY'))
    assert(!memory.query({ text: 'PROJECT_DECISION_PERSONAL_ONLY', includeRetired: true }).items.length, 'Project fact must not be duplicated as a global atom')
    assert(requests.some(body => JSON.stringify(body).includes('project_recorded')))
    scenes.push('Background Project decision is appended to its sole file owner with a verified checkpoint, even while memory use is off')
    blockMaintenance = true; policy('automatic')
    await manager.sendMessage(assistant.id, '补充一个长期交流偏好：先给结论，再给依据。')
    await until(() => blocked)
    const focused = await Promise.race([
      client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Foreground topic takes priority', anchors: [] }),
      Bun.sleep(10000).then(() => { throw new Error('Foreground topic change did not preempt maintenance') }),
    ])
    assert.equal(focused.focus.label, 'Foreground topic takes priority')
    scenes.push('Foreground topic changes preempt hidden maintenance without requiring the user to stop it')
    blocked = false
    await manager.sendMessage(assistant.id, '再补充一个长期交流偏好：适当使用表格。')
    await until(() => blocked)
    const foreground = manager.sendMessage(assistant.id, '现在优先处理我的消息。')
    await Promise.race([foreground, Bun.sleep(10000).then(() => { throw new Error('Foreground input did not preempt maintenance') })])
    blockMaintenance = false
    await until(async () => (await manager.getSession(assistant.id))!.messages.findLast(message => message.role === 'assistant' && !message.isIntermediate)?.content === 'FOREGROUND_REPLIED')
    scenes.push('Direct user input preempts background work without waiting for the model response')
    policy('paused'); await Bun.sleep(1400)
    blockForeground = true
    const userResponse = manager.sendMessage(assistant.id, '继续处理本轮用户任务。')
    await until(() => foregroundStarted)
    await assert.rejects(client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Must not interrupt user work', anchors: [] }), /Stop the current assistant response/)
    assert((await manager.getSession(assistant.id))!.isProcessing)
    foregroundRelease.resolve(); await userResponse
    scenes.push('A topic change cannot silently cancel an active direct user response')
    run.json('maintenance-evidence.json', { scenes, status: memory.maintenanceStatus(), records, checkpoints })
    run.complete(scenes, ['Paid model extraction quality', 'OS process isolation'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { foregroundRelease.resolve(); run.json('provider-requests.json', requests); client.destroy(); await host.stop(); api.stop(true) }
})
