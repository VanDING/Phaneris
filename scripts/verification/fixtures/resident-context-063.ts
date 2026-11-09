import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { getSessionFilePath, saveSession } from '@phaneris/shared/sessions'
import { openSqliteDatabase } from '../../../packages/server-core/src/runtime/sqlite'

const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
const workspace = { id: 'alpha', name: 'Context isolated', rootPath: join(config, 'alpha'), createdAt: 1 }
mkdirSync(workspace.rootPath, { recursive: true })
const requests: any[] = [], scenes: string[] = [], views: any[] = []
let route: any, routed = false, readOwnHistory = false
let largeResponseChars = 0
let holdWorker = false
let workerStarted = Promise.withResolvers<void>(), workerRelease = Promise.withResolvers<void>()
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async req => {
  const body = await req.json() as any; requests.push(body)
  const resident = JSON.stringify(body.messages).includes('resident_assistant_role')
  const worker = !resident && JSON.stringify(body.messages).includes('[Delegated work')
  if (worker && holdWorker) { workerStarted.resolve(); await workerRelease.promise }
  const tool = resident && (route || readOwnHistory) && !routed
  if (tool) routed = true
  let delta: any = tool ? { tool_calls: [{ index: 0, id: `route-${requests.length}`, type: 'function', function: {
    name: readOwnHistory ? 'mcp__session__get_session_info' : 'mcp__session__assistant_context', arguments: JSON.stringify(readOwnHistory ? { history: { fromEnd: true, limit: 20 } } : { command: route }),
  } }] } : { content: worker ? 'A_WORKER_RESULT' : 'ISOLATED_RESULT' }
  if (!tool && !worker && largeResponseChars) delta = { content: 'NATIVE_LONG_PROCESS_'.repeat(Math.ceil(largeResponseChars / 20)) }
  if (worker && !body.messages.some((m: any) => m.role === 'assistant' && m.tool_calls?.some((t: any) => t.function?.name.endsWith('report_task_result')))) {
    delta = { tool_calls: [{ index: 0, id: `report-${requests.length}`, type: 'function', function: { name: 'mcp__session__report_task_result', arguments: JSON.stringify({ requestId: 'report-a', summary: 'A_WORKER_RESULT', outputs: [] }) } }] }
  }
  const strings = body.messages.map((m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).map((part: any) => part.text ?? '').join('\n'))
  const inboxIndex = strings.findLastIndex((s: string) => s?.includes('<resident_inbox>'))
  const inbox = inboxIndex < 0 ? undefined : strings[inboxIndex].match(/<resident_inbox>\n([\s\S]*?)\n<\/resident_inbox>/)
  if (resident && inbox && !tool) {
    const events = JSON.parse(inbox[1]), event = events.find((e: any) => e.result), tail = body.messages.slice(inboxIndex + 1)
    const called = (name: string) => JSON.stringify(tail).includes(`mcp__session__${name}`)
    const call = !called('assistant_context') && event?.branchIds?.length ? { name: 'assistant_context', args: { command: { action: 'select', branchIds: event.branchIds, temporary: true } } }
      : event && !called('assistant_memory_read') ? { name: 'assistant_memory_read', args: event.result }
      : !called('assistant_delivery_ack') ? { name: 'assistant_delivery_ack', args: { eventIds: events.map((e: any) => e.eventId) } } : undefined
    if (call) delta = { tool_calls: [{ index: 0, id: `inbox-${requests.length}`, type: 'function', function: { name: `mcp__session__${call.name}`, arguments: JSON.stringify(call.args) } }] }
  }
  const chunk = (delta: any, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: '063', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return new Response(chunk({ role: 'assistant' }) + chunk(delta, delta.tool_calls ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
} })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true,
  defaultLlmConnection: 'fixture', llmConnections: [{ slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1,
    baseUrl: provider.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false },
      { id: 'fixture-small', name: 'Small window', shortName: 'Small', provider: 'pi', contextWindow: 16000, maxTokens: 1024, supportsThinking: false }] }] }))
writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'explicit', use: false }, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
const { getCredentialManager } = await import('@phaneris/shared/credentials')
await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps, registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps),
  initializeSessionManager: manager => manager.initialize(), bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
const context = async (command: any) => manager.assistantContext('alpha', command)
try {
  const assistant = await manager.getOrCreateResidentAssistant('alpha')
  route = { action: 'create', requestId: 'A', label: 'Report A' }; routed = false
  await manager.sendMessage(assistant.id, 'A_SECRET_REQUIREMENT use blue ink')
  let state = await context({ action: 'get' }); views.push(state)
  const a = state.focus.topicId
  assert(a, 'Model tool must create a branch in the same turn')
  route = { action: 'create', requestId: 'B', label: 'Report B' }; routed = false
  await manager.sendMessage(assistant.id, 'B_SECRET_REQUIREMENT use red ink')
  state = await context({ action: 'get' }); const b = state.focus.topicId; views.push(state)
  assert(a !== b)
  assert(!JSON.stringify(requests.at(-1)).includes('A_SECRET_REQUIREMENT'))
  route = { action: 'select', branchIds: [a] }; routed = false
  await manager.sendMessage(assistant.id, 'Continue report A')
  assert(JSON.stringify(requests.at(-1)).includes('A_SECRET_REQUIREMENT'))
  assert(!JSON.stringify(requests.at(-1)).includes('B_SECRET_REQUIREMENT'))
  scenes.push('C03-same-turn-provider-A-B-A-isolation')
  route = undefined
  readOwnHistory = true; routed = false
  await manager.sendMessage(assistant.id, 'Read this Session history without turning the executing history tool into a source')
  assert.equal((await manager.getSession(assistant.id))!.messages.findLast(m => m.role === 'assistant' && !m.isIntermediate)?.content, 'ISOLATED_RESULT')
  const selfHistory = (await manager.getSession(assistant.id))!.messages.findLast(m => m.role === 'tool' && m.toolName?.endsWith('get_session_info'))!
  assert(selfHistory.toolResult?.includes('source_not_committed'))
  readOwnHistory = false
  scenes.push('C06-inflight-history-tool-is-not-its-own-committed-source')
  await context({ action: 'select', branchIds: [a, b] })
  await manager.sendMessage(assistant.id, 'SHARED_INPUT revise both reports')
  const shared = (await manager.getSession(assistant.id))!.messages.findLast(m => m.role === 'user')!
  await context({ action: 'associate', branchIds: [a, b], source: { sessionId: assistant.id, messageId: shared.id }, role: 'shared' })
  const page = await context({ action: 'branches', limit: 1 })
  assert(page.branches)
  assert.equal(page.branches.items.length, 1); assert.equal(page.branches.total, 2); assert(page.branches.nextOffset !== null)
  scenes.push('C04-multiple-associations-and-bounded-directory')
  const cpDb = openSqliteDatabase(join(workspace.rootPath, 'context.db'))
  const checkpointCount = () => (cpDb.prepare('SELECT count(*) AS n FROM checkpoints').get() as { n: number }).n
  const beforeUnread = checkpointCount()
  route = { action: 'checkpoint', requestId: 'unread-cp', branchId: a, conclusions: 'Unverified', unresolved: [], next: [],
    sources: [{ sessionId: assistant.id, messageId: shared.id }] }; routed = false
  await manager.sendMessage(assistant.id, 'Do not claim unread source coverage')
  assert.equal(checkpointCount(), beforeUnread)
  assert((await manager.getSession(assistant.id))!.messages.some(m => m.role === 'tool' && m.toolResult?.includes('context_checkpoint_unread')))
  scenes.push('C09-provider-reference-does-not-prove-checkpoint-source-read')
  await context({ action: 'select', branchIds: [a] })
  route = { action: 'checkpoint', requestId: 'cp-a', branchId: a, conclusions: 'Use source requirements', unresolved: ['Review'], next: ['Continue'] }; routed = false
  await manager.sendMessage(assistant.id, 'Save the selected A recovery point')
  assert(checkpointCount() > beforeUnread); cpDb.close(); route = undefined
  await context({ action: 'hibernate', branchIds: [a] })
  await manager.flushAllSessions()
  const count = requests.length
  await host.stop(); host = await boot()
  await context({ action: 'select', branchIds: [a] })
  await manager.sendMessage(assistant.id, 'Resume saved report')
  assert(JSON.stringify(requests.at(-1)).includes('A_SECRET_REQUIREMENT'))
  assert(!JSON.stringify(requests.at(-1)).includes('B_SECRET_REQUIREMENT'))
  assert.equal(requests.length, count + 1)
  assert.equal((await manager.getOrCreateResidentAssistant('alpha')).id, assistant.id)
  scenes.push('C09-C10-checkpoint-sleep-restart-no-inference-replay')
  const normal = await manager.createSession('alpha', { name: 'Linear control' })
  await manager.sendMessage(normal.id, 'NORMAL_LINEAR_FIRST')
  await manager.sendMessage(normal.id, 'Refer to previous')
  assert(JSON.stringify(requests.at(-1)).includes('NORMAL_LINEAR_FIRST'))
  assert(!JSON.stringify(requests.at(-1)).includes('A_SECRET_REQUIREMENT'))
  assert(!JSON.stringify(requests.at(-1)).includes('resident_context_segment'))
  scenes.push('C01-normal-linear-no-assistant-directory')
  largeResponseChars = 40000
  for (let index = 0; index < 4; index++) await manager.sendMessage(normal.id, `Long native process ${index}`)
  largeResponseChars = 0
  await manager.sendMessage(normal.id, '/compact')
  assert(requests.some(r => JSON.stringify(r.messages[0]).includes('context summarization assistant')), 'The real Pi native compactor must call its provider')
  await manager.sendMessage(normal.id, 'Continue after native compaction')
  assert(!JSON.stringify(requests.at(-1)).includes('resident_context_segment'))
  assert((await manager.getSession(normal.id))!.messages.some(m => m.content === 'NORMAL_LINEAR_FIRST'))
  scenes.push('C01-real-Pi-native-compact-preserves-original-history')
  // Real Session/Runtime/Pi Worker; only provider decisions are controlled here.
  await context({ action: 'select', branchIds: [a] })
  await manager.sendMessage(assistant.id, 'Authorize read-only Worker A using the saved report A requirements')
  holdWorker = true
  const work = await manager.dispatchAssistantWork('alpha', { requestId: 'worker-a', title: 'Report A worker',
    instructions: 'Use the task materials to report the report A ink requirement.', context: { branchIds: [a] }, config: { permissionMode: 'safe', workingDirectory: 'none' } })
  await Promise.race([workerStarted.promise, Bun.sleep(15000).then(() => { throw new Error('Worker did not reach actual provider') })])
  const workerInput = (await manager.getSession(work.sessionId!))!.messages.find(m => m.id === work.inputMessageId)!
  assert(workerInput.delegationInput?.contextBinding?.branchRevisions[a])
  assert(!JSON.stringify(workerInput).includes('B_SECRET_REQUIREMENT'))
  await context({ action: 'select', branchIds: [b] })
  await context({ action: 'hibernate', branchIds: [a] })
  largeResponseChars = 300000
  await manager.sendMessage(assistant.id, 'Continue report B while A Worker is active')
  largeResponseChars = 0
  const summariesBefore = requests.filter(r => JSON.stringify(r.messages[0]).includes('context summarization assistant')).length
  await manager.sendMessage(assistant.id, '/compact')
  assert(requests.filter(r => JSON.stringify(r.messages[0]).includes('context summarization assistant')).length > summariesBefore)
  workerRelease.resolve()
  let latest
  const deadline = Date.now() + 25000
  do { latest = (await manager.getAssistantWork('alpha', { id: work.id })).items[0]!; if (latest.state === 'result_ready') break; await Bun.sleep(50) } while (Date.now() < deadline)
  assert.equal(latest.state, 'result_ready', latest.error)
  let event
  do { event = (await manager.assistantEvents('alpha', { limit: 100 })).items.find(e => e.delegationId === work.id && e.kind === 'result_ready'); if (event?.phase === 'delivered') break; await Bun.sleep(50) } while (Date.now() < deadline)
  assert(event?.branchIds?.includes(a)); assert.equal(event?.originMessageId, work.originMessageId)
  assert.equal(event?.phase, 'delivered')
  assert.equal((await context({ action: 'get' })).focus.topicId, b)
  assert.equal((await manager.getSession(work.sessionId!))!.parentSessionId, assistant.id)
  assert.equal((await manager.getSession(work.sessionId!))!.messages.filter(m => m.role === 'tool' && m.toolName?.endsWith('report_task_result')).length, 1)
  scenes.push('C07-real-worker-ordinary-session-task-material-isolation', 'C12-late-result-original-branch-preserves-B-focus')
  scenes.push('C03-native-compaction-and-branch-retirement-do-not-repeat-Worker-tool')
  await context({ action: 'select', branchIds: [a] })
  await manager.sendMessage(assistant.id, 'Authorize another read-only A validation')
  workerStarted = Promise.withResolvers<void>(); workerRelease = Promise.withResolvers<void>()
  const revoked = await manager.dispatchAssistantWork('alpha', { requestId: 'worker-a-revoked', title: 'A revision fence', instructions: 'Read A materials once.', context: { branchIds: [a] }, config: { permissionMode: 'safe', workingDirectory: 'none' } })
  await Promise.race([workerStarted.promise, Bun.sleep(15000).then(() => { throw new Error('Revision Worker did not reach provider') })])
  const originalA = (await manager.getSession(assistant.id))!.messages.find(m => m.content === 'A_SECRET_REQUIREMENT use blue ink')!
  const originalGrant = (await manager.getSession(assistant.id))!.messages.findLast(m => m.role === 'user')!
  await context({ action: 'associate', branchIds: [a], source: { sessionId: assistant.id, messageId: originalGrant.id }, role: 'requirement', supersedes: [{ sessionId: assistant.id, messageId: originalA.id }] })
  workerRelease.resolve()
  let invalidated
  const invalidDeadline = Date.now() + 20000
  do { invalidated = (await manager.getAssistantWork('alpha', { id: revoked.id })).items[0]!; if (['failed', 'needs_attention'].includes(invalidated.state)) break; await Bun.sleep(50) } while (Date.now() < invalidDeadline)
  assert(['failed', 'needs_attention'].includes(invalidated.state), invalidated.state)
  assert(!(await manager.getSession(revoked.sessionId!))!.messages.some(m => m.role === 'tool' && m.toolName?.endsWith('report_task_result')))
  scenes.push('C08-related-requirement-revision-fences-actual-inflight-Worker-before-tool')
  await context({ action: 'focus', label: 'Capacity boundary', anchors: [] })
  const beforeCapacity = requests.length
  await manager.sendMessage(assistant.id, 'REQUIRED_CAPACITY_MATERIAL '.repeat(30000))
  assert.equal(requests.length, beforeCapacity)
  assert((await manager.getSession(assistant.id))!.messages.some(m => /capacity|scope|budget/i.test(m.content)))
  await context({ action: 'focus', label: 'After capacity failure', anchors: [] })
  await manager.sendMessage(assistant.id, 'AFTER_CAPACITY_VALID_INPUT')
  assert(!JSON.stringify(requests.at(-1)).includes('REQUIRED_CAPACITY_MATERIAL'))
  scenes.push('C11-required-overflow-blocks-provider-and-explicit-rescope-recovers')
  await manager.updateSessionModel(assistant.id, 'alpha', 'fixture-small')
  await manager.sendMessage(assistant.id, 'CHECK_SMALL_MODEL_CAPACITY')
  assert(!requests.some(request => request.model === 'fixture-small'), 'An insufficient fixed-rule/tool window cannot enter the provider')
  await manager.updateSessionModel(assistant.id, 'alpha', 'fixture')
  await manager.sendMessage(assistant.id, 'AFTER_MODEL_WINDOW_RESTORED')
  assert.equal((await context({ action: 'get' })).activeSegment?.requests.at(-1)?.snapshot?.capacity?.windowTokens, 64000)
  scenes.push('C11-model-switch-recalculates-effective-window')
  const { createProject } = await import('@phaneris/shared/projects')
  const projectA = createProject(workspace.rootPath, { name: 'Scoped A', details: 'SCOPED_PROJECT_A_RULE' })
  const projectB = createProject(workspace.rootPath, { name: 'Scoped B', details: 'SCOPED_PROJECT_B_RULE' })
  await manager.setSessionProjectId(assistant.id, projectA.id)
  route = { action: 'create', requestId: 'scoped-a', label: 'Project work A' }; routed = false
  await manager.sendMessage(assistant.id, 'SCOPED_A_REQUIREMENT authorize a read-only validation')
  const scopedA = (await context({ action: 'get' })).focus.topicId!
  route = undefined; workerStarted = Promise.withResolvers<void>(); workerRelease = Promise.withResolvers<void>()
  const scoped = await manager.dispatchAssistantWork('alpha', { requestId: 'scoped-worker', title: 'Scoped worker', context: { branchIds: [scopedA] }, instructions: 'Validate scoped A only.', config: { permissionMode: 'safe', workingDirectory: 'none' } })
  await Promise.race([workerStarted.promise, Bun.sleep(15000).then(() => { throw new Error('Scoped Worker did not reach provider') })])
  await manager.setSessionProjectId(assistant.id, projectB.id)
  route = { action: 'create', requestId: 'scoped-b', label: 'Project work B' }; routed = false
  await manager.sendMessage(assistant.id, 'SCOPED_B_REQUIREMENT')
  const scopedB = (await context({ action: 'get' })).focus.topicId!
  route = undefined; workerRelease.resolve()
  let scopedEvent
  const scopedDeadline = Date.now() + 25000
  do { scopedEvent = (await manager.assistantEvents('alpha', { limit: 100 })).items.find(e => e.delegationId === scoped.id && e.kind === 'result_ready'); if (scopedEvent?.phase === 'delivered') break; await Bun.sleep(50) } while (Date.now() < scopedDeadline)
  assert.equal(scopedEvent?.phase, 'delivered'); assert.equal(scopedEvent.projectId, projectA.id)
  assert.equal((await context({ action: 'get' })).focus.topicId, scopedB)
  assert.equal((await manager.getSession(assistant.id))!.projectId, projectB.id)
  assert(JSON.stringify(requests.at(-1)).includes('SCOPED_PROJECT_A_RULE'))
  assert(!JSON.stringify(requests.at(-1)).includes('SCOPED_PROJECT_B_RULE'))
  assert(!JSON.stringify(requests.at(-1)).includes('SCOPED_B_REQUIREMENT'))
  scenes.push('C12-late-event-applies-original-project-without-changing-foreground-project')
  const { getSourceReader } = await import('../../../packages/server-core/src/context/source-reader')
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  await saveSession({ id: 'long', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    messages: Array.from({ length: 1200 }, (_, i) => ({ id: `m${i}`, type: 'user' as const, timestamp: i, content: `record-${i}:` + '原文'.repeat(200) })) })
  const reader = getSourceReader(workspace.rootPath)
  const longPath = getSessionFilePath(workspace.rootPath, 'long')
  writeFileSync(longPath, readFileSync(longPath)) // Simulate an external rewrite in this isolated sample.
  const first = reader.read('long', 'm600'), before = reader.metrics()
  const second = reader.read('long', 'm600'), after = reader.metrics()
  assert.equal(first.message.content, second.message.content)
  assert.equal(after.indexScanBytes, before.indexScanBytes)
  assert.equal(after.decodedRecords - before.decodedRecords, 1)
  assert(after.bytesRead - before.bytesRead < 4000)
  writeFileSync(join(output, 'source-io.json'), JSON.stringify({ before, after, range: second.bytes, version: second.version }, null, 2))
  scenes.push('C06-exact-read-one-record-after-index-scan')
  const db = openSqliteDatabase(join(workspace.rootPath, 'context.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  assert(!JSON.stringify(tables).includes('messages'))
  assert(!tables.some(table => /message|transcript|execution|attempt/i.test(table.name)), 'Context metadata must not own message bodies or execution state')
  assert(!JSON.stringify(db.prepare('SELECT body FROM associations').all()).includes('A_SECRET_REQUIREMENT'), 'Associations must store references, not original text')
  assert(!JSON.stringify(db.prepare('SELECT body FROM views').all()).includes('A_SECRET_REQUIREMENT'), 'Request views must store references, not original text')
  const metadata = db.prepare('SELECT body FROM branches').all(); db.close()
  await manager.flushAllSessions()
  for (const id of [assistant.id, normal.id, work.sessionId!]) {
    assert(existsSync(getSessionFilePath(workspace.rootPath, id)), `Session ${id} must use the shared JSONL repository`)
    assert((await manager.getSession(id))!.messages.length > 0, `Session ${id} must retain its own original messages`)
  }
  assert((await manager.getSession(work.sessionId!))!.messages.some(message => message.id === work.inputMessageId), 'Worker task package must remain in its ordinary Session history')
  scenes.push('C02-three-session-kinds-share-originals-without-duplicate-state')
  writeFileSync(join(output, 'evidence.json'), JSON.stringify({ scenes, views, metadata, tables, config, requests: requests.length }, null, 2))
} finally { workerRelease.resolve(); writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2)); await host.stop(); provider.stop(true) }
