import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { getSessionFilePath, saveSession, type StoredMessage } from '@phaneris/shared/sessions'
import { getSessionToolProxyDefs } from '../../../packages/shared/src/agent/backend/pi/session-tool-defs'

assert(getSessionToolProxyDefs(undefined, 'resident_assistant').some(tool => tool.name.endsWith('assistant_memory_maintenance')), 'P4c requires the resident incremental extraction tool')
assert(!getSessionToolProxyDefs().some(tool => tool.name.endsWith('assistant_memory_maintenance')))
const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, rootPath: join(config, id), createdAt: 1 }))
const workspace = workspaces[0]!
for (const item of workspaces) mkdirSync(item.rootPath, { recursive: true })
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
async function source(id: string, content: string, extra: Record<string, unknown> = {}, target = workspace) {
  await saveSession({ id, workspaceRootPath: target.rootPath, createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    messages: [{ id: 'input', type: 'user', content, timestamp: 1 } as StoredMessage], ...extra })
}
type Page = { status: string; checkpointId?: string; requestIdPrefix?: string; source?: { sessionId: string; messageId: string; contentHash: string; projectId?: string; directUser: boolean; attachmentContentIndexed: boolean }; content?: string; range?: { offset: number; end: number; fullChars: number } }
interface Plan { sessionId?: string; projectId?: string; ack?: boolean; candidate?: boolean; badCandidate?: boolean; repeat?: boolean; conflictAck?: boolean; checkpointOnly?: string; onPage?: (page: Page) => Promise<void> }
let plan: Plan = {}, step = 0, page: Page, candidateId: string | undefined, repeatedAck = false
let lastAcknowledgement: object
let responses: Array<Record<string, unknown>> = []
const requests: Array<Record<string, unknown>> = [], turns: unknown[] = [], scenes: string[] = []
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const body = await request.json() as Record<string, unknown>; requests.push(body)
  writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2))
  assert(requests.length < 95, 'Extraction stays within a bounded main Runtime budget')
  const messages = body.messages as Array<{ role: string; content?: unknown }>
  const last = messages.filter(message => message.role === 'tool').at(-1)
  const text = last ? typeof last.content === 'string' ? last.content : JSON.stringify(last.content) : undefined
  const result = text ? text.startsWith('{') ? JSON.parse(text) as Record<string, unknown> : { error: text } : undefined
  if (result) responses.push(result)
  let call: { name: string; args: object } | undefined
  if (step === 0) call = { name: 'assistant_memory_maintenance', args: { command: plan.checkpointOnly
    ? { action: 'acknowledge', checkpointId: plan.checkpointOnly, conclusion: 'no_candidate', reason: 'No durable observation.' }
    : { action: 'next', sessionId: plan.sessionId, projectId: plan.projectId } } }
  else if (step === 1 && !plan.checkpointOnly && result?.status === 'source') {
    page = result as unknown as Page
    await plan.onPage?.(page)
    if (plan.candidate) call = { name: 'assistant_memory_update', args: { command: { action: 'remember', requestId: `${page.requestIdPrefix}:observation`, key: `${page.requestIdPrefix}:observation`,
      content: 'EXTRACTED_DURABLE_CANDIDATE', kind: 'experience', basis: 'inferred', projectId: page.source!.projectId,
      sources: [{ sessionId: page.source!.sessionId, messageId: page.source!.messageId }] } } }
    else if (plan.ack) call = { name: 'assistant_memory_maintenance', args: { command: { action: 'acknowledge', checkpointId: page.checkpointId,
      conclusion: plan.badCandidate ? 'candidates' : 'no_candidate', candidateIds: plan.badCandidate ? ['missing-memory'] : undefined, reason: 'No durable observation in this fragment.' } } }
  } else if (step === 2 && plan.candidate && plan.ack) {
    candidateId = (result?.record as { id?: string } | undefined)?.id
    call = { name: 'assistant_memory_maintenance', args: { command: { action: 'acknowledge', checkpointId: page.checkpointId, conclusion: 'candidates', candidateIds: [candidateId], reason: 'Saved an inferred observation for review.' } } }
  } else if (plan.repeat && result?.status === 'acknowledged') {
    call = { name: 'assistant_memory_maintenance', args: { command: repeatedAck ? { action: 'next', sessionId: plan.sessionId } : lastAcknowledgement } }
    repeatedAck = true
  } else if (plan.conflictAck && result?.status === 'acknowledged') {
    call = { name: 'assistant_memory_maintenance', args: { command: { ...lastAcknowledgement, reason: 'Changed acknowledgement payload.' } } }
  }
  if (call?.name === 'assistant_memory_maintenance' && (call.args as { command: { action: string } }).command.action === 'acknowledge') lastAcknowledgement = (call.args as { command: object }).command
  step++
  const delta = call ? { tool_calls: [{ index: 0, id: `extract-${requests.length}`, type: 'function', function: { name: `mcp__session__${call.name}`, arguments: JSON.stringify(call.args) } }] } : { content: 'EXTRACTION_TURN_DONE' }
  const chunk = (value: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'extraction-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`
  return new Response(chunk({ role: 'assistant' }) + chunk(delta, call ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture',
  llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: provider.url.href,
    customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }] }))
writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, defaults: { permissionMode: 'safe', defaultLlmConnection: 'fixture', model: 'fixture' } }))
const { getCredentialManager } = await import('@phaneris/shared/credentials')
await getCredentialManager().setLlmApiKey('fixture', 'loopback-only-key')
await source('a-slices', 'BOUNDED_HISTORY_FRAGMENT '.repeat(400), { projectId: 'project-a', isArchived: true })
await source('b-hidden', 'HIDDEN_ORDINARY_SOURCE', { projectId: 'project-b', hidden: true })
await source('c-internal', 'ATTRIBUTED_EXECUTION_SOURCE', { messages: [{ id: 'input', type: 'user', content: 'ATTRIBUTED_EXECUTION_SOURCE', timestamp: 1,
  inputSource: { kind: 'delegation', delegationId: 'test', assistantSessionId: 'resident', originMessageId: 'request' } }] })
await source('d-attachment', 'ATTACHMENT_REFERENCE', { messages: [{ id: 'input', type: 'user', content: 'ATTACHMENT_REFERENCE', timestamp: 1,
  attachments: [{ id: 'pdf', type: 'pdf', name: 'unparsed.pdf', mimeType: 'application/pdf', size: 1, storedPath: 'missing.pdf' }] }] })
await source('foreign', 'OTHER_WORKSPACE_EXTRACTION_SECRET', {}, workspaces[1]!)
let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
  bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
async function connect(id = 'alpha') { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: id, token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false }); await client.connect(); return client }
let client = await connect()
const history = () => client.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'alpha', {})
let assistantId = ''
async function turn(next: Plan) {
  plan = next; step = 0; responses = []; candidateId = undefined; repeatedAck = false
  await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: 'Extraction verification', anchors: [] })
  await manager.sendMessage(assistantId, `EXTRACTION_MAIN_TURN_${turns.length}`)
  turns.push({ plan: { ...next, onPage: undefined }, responses })
  return responses
}
try {
  assert.equal(requests.length, 0, 'Host startup does not invoke a maintenance model')
  assistantId = (await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id
  const initial = await history()
  assert.equal(initial.extraction.processedMessages, 0)
  assert(initial.extraction.pendingMessages >= 4)
  scenes.push('RX01-resident-only-catalog', 'RX02-indexed-is-not-extracted-and-no-startup-loop')
  const first = await turn({ sessionId: 'a-slices', ack: true, candidate: true, repeat: true })
  const slice = first[0] as unknown as Page
  assert.equal(slice.range!.offset, 0); assert(slice.content!.length <= 6000)
  assert(slice.range!.end < slice.range!.fullChars)
  assert.equal(first.at(-1)?.status, 'budget_exhausted')
  assert.equal(first.filter(response => response.status === 'acknowledged').length, 2, 'Repeated identical ACK is idempotent in the original run')
  assert.equal((await client.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'alpha', {})).items.length, 0)
  assert(JSON.stringify(requests).includes('EXTRACTED_DURABLE_CANDIDATE'))
  scenes.push('RX03-bounded-slice-and-one-per-run', 'RX09-real-pi-candidate-and-ack')
  const unacked = await turn({ sessionId: 'a-slices', candidate: true })
  const second = unacked[0] as unknown as Page
  const interruptedCandidateId = (unacked[1]?.record as { id: string }).id
  assert.equal(second.range!.offset, slice.range!.end)
  client.destroy(); await host.stop(); host = await boot(); client = await connect()
  assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, assistantId)
  const resumed = await turn({ sessionId: 'a-slices', candidate: true, ack: true })
  assert.equal(resumed[0]?.checkpointId, second.checkpointId)
  assert.equal((resumed[1]?.record as { id: string }).id, interruptedCandidateId, 'Candidate write interrupted before ACK must replay without duplication')
  assert.equal(resumed.at(-1)?.status, 'acknowledged')
  assert.equal((await turn({ sessionId: 'a-slices' }))[0]?.status, 'idle')
  scenes.push('RX04-interrupted-fragment-resumes-after-host-restart', 'RX02-unchanged-source-not-reextracted')
  const forged = await turn({ checkpointOnly: second.checkpointId })
  assert(/read|turn|run/i.test(JSON.stringify(forged)))
  const wrongCandidate = await turn({ sessionId: 'b-hidden', ack: true, badCandidate: true })
  assert(/candidate|memory/i.test(JSON.stringify(wrongCandidate.at(-1))))
  const scoped = await turn({ sessionId: 'b-hidden', projectId: 'project-a' })
  assert.equal(scoped[0]?.status, 'idle')
  const hidden = await turn({ sessionId: 'b-hidden', projectId: 'project-b', ack: true })
  assert.equal((hidden[0] as unknown as Page).source?.projectId, 'project-b')
  assert.equal(hidden.at(-1)?.status, 'acknowledged')
  scenes.push('RX05-unread-and-unrelated-candidate-rejected', 'RX07-hidden-archived-and-project-scope')
  const internal = await turn({ sessionId: 'c-internal', ack: true })
  assert.equal((internal[0] as unknown as Page).source?.directUser, false)
  const attachment = await turn({ sessionId: 'd-attachment', ack: true })
  assert.equal((attachment[0] as unknown as Page).source?.attachmentContentIndexed, false)
  scenes.push('RX07-attributed-input-is-not-direct-user', 'RX08-no-candidate-and-unparsed-attachment')
  await source('e-changing', 'ORIGINAL_SOURCE_VERSION', { projectId: 'old-project' })
  await turn({ sessionId: 'e-changing', ack: true, onPage: async () => { await source('e-changing', 'REWRITTEN_SOURCE_VERSION', { projectId: 'new-project' }) } })
  assert(!responses.some(response => response.status === 'acknowledged'))
  const rewritten = await turn({ sessionId: 'e-changing', projectId: 'new-project', ack: true })
  assert.equal((rewritten[0] as unknown as Page).content, 'REWRITTEN_SOURCE_VERSION')
  scenes.push('RX06-changed-version-and-project-requeued')
  await source('e-scope-only', 'SAME_CONTENT_MOVED', { projectId: 'before-move' })
  const moved = await turn({ sessionId: 'e-scope-only', ack: true, onPage: async () => { await source('e-scope-only', 'SAME_CONTENT_MOVED', { projectId: 'after-move' }) } })
  assert(/scope|project/i.test(JSON.stringify(moved.at(-1))))
  assert(!moved.some(response => response.status === 'acknowledged'))
  assert.equal((await turn({ sessionId: 'e-scope-only', projectId: 'after-move', ack: true })).at(-1)?.status, 'acknowledged')
  scenes.push('RX06-unchanged-content-project-move-rejects-old-ack')
  await source('f-deleted', 'DELETED_BEFORE_ACK')
  await turn({ sessionId: 'f-deleted', ack: true, onPage: async () => { unlinkSync(getSessionFilePath(workspace.rootPath, 'f-deleted')) } })
  assert(!responses.some(response => response.status === 'acknowledged'))
  scenes.push('RX06-deleted-source-not-confirmed')
  await source('g-forgotten', 'FORGOTTEN_BEFORE_ACK')
  await turn({ sessionId: 'g-forgotten', ack: true, onPage: async () => {
    const record = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'remember', requestId: 'forget-me', key: 'forget-me', content: 'FORGOTTEN_BEFORE_ACK', kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'g-forgotten', messageId: 'input' }] })
    await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', { action: 'transition', requestId: 'forget-now', id: record.record.id, expectedRevision: 1, state: 'forgotten' })
  } })
  assert(!responses.some(response => response.status === 'acknowledged'))
  const afterForget = requests.length
  assert.equal((await turn({ sessionId: 'g-forgotten' }))[0]?.status, 'idle')
  assert(!JSON.stringify(requests.slice(afterForget)).includes('FORGOTTEN_BEFORE_ACK'))
  scenes.push('RX06-forgotten-ack-rejected', 'RX10-forgotten-fragment-exits-actual-provider-context')
  await source('h-unicode', '\uD83E\uDDED'.repeat(4500))
  const unicode = await turn({ sessionId: 'h-unicode', ack: true })
  assert.equal((unicode[0] as unknown as Page).range!.end, 6000)
  assert((await history()).extraction.partialMessages >= 1)
  const unicodeTail = await turn({ sessionId: 'h-unicode', ack: true })
  assert.equal((unicodeTail[0] as unknown as Page).range!.offset, 6000)
  assert.equal((await turn({ sessionId: 'h-unicode' }))[0]?.status, 'idle')
  scenes.push('RX03-utf16-progress-not-sqlite-codepoint-length')
  await source('i-conflict', 'ACKNOWLEDGEMENT_PAYLOAD')
  const conflicting = await turn({ sessionId: 'i-conflict', ack: true, conflictAck: true })
  assert.equal(conflicting[1]?.status, 'acknowledged')
  assert(/conflict/i.test(JSON.stringify(conflicting.at(-1))))
  scenes.push('RX04-acknowledgement-payload-conflict')
  const foreign = await connect('beta')
  try { await assert.rejects(foreign.invoke(RPC_CHANNELS.assistantMemory.HISTORY, 'alpha', {}), /workspace/i) } finally { foreign.destroy() }
  assert(!JSON.stringify(requests).includes('OTHER_WORKSPACE_EXTRACTION_SECRET'))
  const final = await history()
  assert(final.extraction.processedMessages >= 5)
  scenes.push('RX07-workspace-isolation', 'RX02-durable-extraction-coverage')
  await manager.flushAllSessions()
  writeFileSync(join(output, 'assistant-session.jsonl'), await Bun.file(getSessionFilePath(workspace.rootPath, assistantId)).text())
  writeFileSync(join(output, 'extraction-evidence.json'), JSON.stringify({ scenes, initial, final, turns, requests }, null, 2))
} finally { client.destroy(); await host.stop(); provider.stop(true) }
