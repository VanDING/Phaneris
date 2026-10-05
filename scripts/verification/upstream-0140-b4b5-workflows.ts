/** Real host, durable journal, task scheduler and authenticated RPC workflows.
 * Failure matrix: docs/process/upstream-0.14.0-b4-b5.md (written before product edits).
 * Loopback providers and inert agent transport only; no external effects or account calls.
 */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-b4b5-workflows-'))
const configRoot = join(fixture, 'config'), workspaceRoot = join(fixture, 'workspace')
mkdirSync(join(configRoot, 'permissions'), { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot
process.env.NODE_ENV = 'test'
const decisions = await import('../../packages/shared/src/decisions/index.ts')
const config = await import('../../packages/shared/src/config/storage.ts')
const host = await import('../../packages/server-core/src/sessions/SessionManager.ts')
const sessions = await import('../../packages/shared/src/sessions/storage.ts')
const tasks = await import('../../packages/shared/src/tasks/index.ts')
const { TaskRunner } = await import('../../packages/server-core/src/tasks/TaskRunner.ts')
const modes = await import('../../packages/shared/src/agent/mode-manager.ts')
const guard = await import('../../packages/shared/src/agent/core/guarded-mode.ts')
const { buildGuardedModeCheck } = await import('../../packages/server-core/src/decisions/guarded-mode.ts')
const { PermissionManager } = await import('../../packages/shared/src/agent/core/permission-manager.ts')
const { runPreToolUseChecks } = await import('../../packages/shared/src/agent/core/pre-tool-use.ts')
const { setLargeResultSummaryGate, handleLargeResponse } = await import('../../packages/shared/src/utils/large-response.ts')
const { buildLargeResultSummaryGate } = await import('../../packages/server-core/src/decisions/large-results.ts')
const { createLargeResultGateClient } = await import('../../packages/pi-agent-server/src/large-result-gate.ts')
const { buildRepairScopePicker } = await import('../../packages/server-core/src/decisions/task-repairs.ts')
const { buildTaskVerdictDecider } = await import('../../packages/server-core/src/decisions/task-verdict.ts')
const { buildNodeOutcomeClassifier } = await import('../../packages/server-core/src/decisions/turn-outcome.ts')
const { saveLabelConfig } = await import('../../packages/shared/src/labels/storage.ts')
const readAutomationHistory = (workspace: string) => readFileSync(join(workspace, 'automations-history.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
const records: any[] = [], network: any[] = []
async function check(id: string, action: () => any | Promise<any>) {
  try { records.push({ id, pass: true, observation: await action() }) }
  catch (error) { records.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }) }
}
async function until(predicate: () => boolean, timeout = 5_000) {
  const end = Date.now() + timeout
  while (!predicate()) { if (Date.now() >= end) throw Error('Workflow did not converge'); await Bun.sleep(10) }
}
const noul = (noul: number) => ({ type: 'noul', noul })
const choice = (value: string, options: string[], confidence = .95) => ({ type: 'choice', choice: value, confidence,
  probabilities: Object.fromEntries(options.map(key => [key, key === value ? .98 : .02 / (options.length - 1)])) })
let answers: Record<string, any> = {}, delay = 0, fail = false
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  if (req.method === 'GET') return Response.json({ status: 'ok', model: 'fixture' })
  const body = await req.json() as any
  const snapshot = { ...answers }, pause = delay, failing = fail
  network.push({ questions: Object.keys(body.questions), state: body.state })
  if (pause) await Bun.sleep(pause)
  if (failing) return new Response('fixture failure', { status: 503 })
  const result = Object.fromEntries(Object.entries(body.questions).map(([key, q]: any) => [key, snapshot[key]
    ?? (q.type === 'noul' ? noul(.98) : q.type === 'choice' ? choice(Object.keys(q.criteria)[0]!, Object.keys(q.criteria))
      : { type: 'score', score: 0, confidence: .95, probabilities: Object.fromEntries(q.criteria.map((_: unknown, i: number) => [i, i === 0 ? .98 : .02 / (q.criteria.length - 1)])) })]))
  return Response.json({ model: 'fixture', answers: result, usage: { input_tokens: 7, output_tokens: 3 } })
} })
const workspace = { id: 'fixture-workspace', name: 'Fixture', rootPath: workspaceRoot, createdAt: Date.now() }
const featureSettings = decisions.normalizeDecisionLayerSettings({ enabled: true, provider: 'custom', baseUrl: api.url.href,
  model: 'fixture', deadlineMs: 500, features: Object.fromEntries(decisions.DECISION_LAYER_FEATURES.map(key => [key, true])) })
function settings(features: Record<string, boolean> = {}) {
  writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id,
    llmConnections: [], activeSessionId: null, decisionLayer: { ...featureSettings, features: { ...featureSettings.features, smartTitles: false, suggestions: false, ...features } } }))
}
settings()
const managers: any[] = [], runners: any[] = []
async function makeSession(hold = false, toolEvents: any[] = []) {
  const session = await sessions.createSession(workspaceRoot, { name: 'Workflow fixture', thinkingLevel: 'max' })
  const manager = new host.SessionManager() as any
  const managed = host.createManagedSession({ ...session, thinkingLevel: 'max' }, workspace as any, { messagesLoaded: true }) as any
  managers.push(manager)
  const events: any[] = [], chats: any[] = [], redirects: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const agent = new Proxy({
    getModel: () => 'pi/gpt-5-mini', getSessionId: () => null, getBackendProvider: () => 'pi',
    canSteerNow: () => managed.isProcessing, isCompactionInFlight: () => false,
    redirect: (text: string) => { redirects.push(text); return true },
    generateTitle: async () => 'Generated fixture title', regenerateTitle: async () => 'Refreshed fixture title',
    chat: async function* (content: string, attachments: unknown, options: unknown) {
      chats.push({ content, attachments, options })
      if (hold && chats.length === 1) await gate
      for (const event of toolEvents) yield event
      yield { type: 'text_complete', text: 'Which account should I use?' }
      yield { type: 'complete' }
    },
  }, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key as keyof typeof target] : () => undefined })
  managed.agent = agent
  manager.sessions.set(managed.id, managed)
  manager.eventSink = (_channel: string, _target: unknown, event: any) => events.push(event)
  manager.getOrCreateAgent = async () => agent
  return { manager, managed, events, chats, redirects, release }
}
try {
  await check('Host turn applies lowered thinking, persists original setting, classifies Needs Review', async () => {
    settings({ midTurnMessages: false, semanticLabels: false })
    answers = { outcome: choice('needs_input', ['finished', 'needs_input', 'blocked']) }
    const f = await makeSession()
    await f.manager.sendMessage(f.managed.id, 'Implement feature')
    await until(() => f.managed.sessionStatus === 'needs-review')
    assert.equal(f.chats[0].options.thinkingOverride, 'low')
    assert.equal(f.managed.thinkingLevel, 'max')
    await f.manager.flushSession(f.managed.id)
    assert.equal(sessions.loadSession(workspaceRoot, f.managed.id)?.thinkingLevel, 'max')
    return { status: f.managed.sessionStatus, thinking: f.chats[0].options.thinkingOverride }
  })
  await check('A lowered user preference wins over an adaptive decision still in flight', async () => {
    settings({ adaptiveThinking: true, semanticLabels: false, turnOutcome: false })
    const f = await makeSession()
    f.managed.isProcessing = true
    delay = 100
    const pending = f.manager.startPreTurnDecisions(f.managed, 'Simple request')
    f.manager.setSessionThinkingLevel(f.managed.id, 'off')
    const result = await pending
    assert.equal(result.thinkingOverride, null)
    assert.equal(f.managed.thinkingLevel, 'off')
    delay = 0; settings()
  })
  await check('Stop during a foreground decision cannot start a model turn or attach a late suggestion', async () => {
    settings({ adaptiveThinking: true, semanticLabels: false, turnOutcome: false })
    const f = await makeSession(), before = network.length
    delay = 100
    const pending = f.manager.sendMessage(f.managed.id, 'Simple request')
    await until(() => network.length > before)
    await f.manager.cancelProcessing(f.managed.id, true)
    await pending
    assert.equal(f.chats.length, 0)
    assert.equal(f.managed.suggestionTrace, undefined)
    assert.equal(f.managed.isProcessing, false)
    delay = 0; settings()
  })
  await check('Approving a plan returns Explore to its previous Guarded mode on the real host', async () => {
    const f = await makeSession(), sent: string[] = []
    f.manager.setSessionPermissionMode(f.managed.id, 'guarded')
    f.manager.setSessionPermissionMode(f.managed.id, 'safe')
    f.manager.sendMessage = async (_: string, text: string) => { sent.push(text) }
    await f.manager.acceptPlan(f.managed.id)
    assert.equal(f.managed.permissionMode, 'guarded')
    assert.equal(sent.length, 1)
    const { SpawnSessionSchema } = await import('../../packages/session-tools-core/src/tool-defs.ts')
    assert(SpawnSessionSchema.safeParse({ prompt: 'fixture', permissionMode: 'guarded' }).success)
    return { executionMode: f.managed.permissionMode, acceptedChildSchema: true }
  })
  await check('The real host preserves unattended admission and excludes unattended, hidden, mini and task sessions from interactive decisions', async () => {
    settings({ adaptiveThinking: true, suggestions: true, guardedMode: true })
    const f = await makeSession()
    const created = await f.manager.createSession(workspace.id, { unattended: true, permissionMode: 'guarded', thinkingLevel: 'max' })
    const managed = f.manager.sessions.get(created.id)
    assert.equal(managed.unattended, true)
    const before = network.length
    managed.isProcessing = true
    assert.equal(f.manager.startPreTurnDecisions(managed, 'Implement the feature'), null)
    const riskCheck = buildGuardedModeCheck({ sessionId: created.id, isInteractive: () => host.isAttendedSession(managed) })
    assert.equal(riskCheck.canPrompt?.(), false)
    assert.equal(await riskCheck.check({ toolName: 'Bash', promptType: 'bash', description: 'unattended mutation', command: 'touch file' }), null)
    managed.isProcessing = false
    const boundaries = [{ hidden: true }, { systemPromptPreset: 'mini' }, { taskRunId: 'fixture-run' }, { taskSlug: 'fixture-task' }, { triggeredBy: 'automation' }]
    assert(boundaries.every(flags => !host.isAttendedSession({ ...f.managed, ...flags })))
    assert(host.isAttendedSession(f.managed))
    assert.equal(network.length, before)
    settings()
    return { unattended: managed.unattended, excludedContexts: boundaries.length + 1, decisionRequests: 0 }
  })
  await check('Late turn outcome cannot override a manually chosen status or newer generation', async () => {
    const f = await makeSession()
    f.managed.messages = [{ id: 'u', role: 'user', content: 'Work', timestamp: 1 }, { id: 'a', role: 'assistant', content: 'Need account', timestamp: 2 }]
    f.managed.sessionStatus = 'todo'
    delay = 100
    const pending = f.manager.applyTurnOutcome(f.managed, 'a')
    await Bun.sleep(25)
    f.managed.sessionStatus = 'in-progress'
    f.managed.processingGeneration++
    await pending
    delay = 0
    assert.equal(f.managed.sessionStatus, 'in-progress')
  })
  await check('Semantic and regex labels persist together; manual removal blocks a late result', async () => {
    settings({ semanticLabels: true, midTurnMessages: false, turnOutcome: false })
    const tree = [{ id: 'ticket', name: 'Ticket', autoRules: [{ pattern: 'BUG-(\\d+)', valueTemplate: '$1' }] },
      { id: 'billing', name: 'Billing', autoRules: [{ semantic: 'Billing request?', threshold: .9, value: 'invoice' }] }]
    saveLabelConfig(workspaceRoot, { version: 1, labels: tree } as any)
    answers = {}
    const f = await makeSession()
    await f.manager.sendMessage(f.managed.id, 'BUG-123 billing invoice')
    await until(() => f.managed.labels?.includes('billing::invoice'))
    assert(f.managed.labels.includes('ticket::123'))
    await f.manager.flushSession(f.managed.id)
    assert(sessions.loadSession(workspaceRoot, f.managed.id)?.labels?.includes('billing::invoice'))
    f.managed.labels = []
    delay = 100
    const pending = f.manager.applySemanticAutoLabels(f.managed, 'billing', tree)
    await Bun.sleep(25)
    await f.manager.setSessionLabels(f.managed.id, ['ticket::manual'])
    await pending
    delay = 0
    assert.deepEqual(f.managed.labels, ['ticket::manual'])
  })
  await check('Queued continuations replay once while preserving all ACKs, bubbles and durable originals', async () => {
    settings({ midTurnMessages: true, semanticLabels: false, turnOutcome: false, adaptiveThinking: false })
    answers = { delivery: choice('queue', ['steer', 'queue']), same_request: noul(.99) }
    const f = await makeSession(true), acks: string[] = []
    const running = f.manager.sendMessage(f.managed.id, 'Initial request', undefined, undefined, undefined, undefined, false, (id: string) => acks.push(id))
    await until(() => f.chats.length === 1)
    await f.manager.sendMessage(f.managed.id, 'Next request', undefined, undefined, undefined, undefined, false, (id: string) => acks.push(id))
    await f.manager.sendMessage(f.managed.id, 'Keep original exports', undefined, undefined, undefined, undefined, false, (id: string) => acks.push(id))
    await until(() => f.managed.messageQueue[1]?.mergeWith === f.managed.messageQueue[0])
    f.release(); await running
    await until(() => f.chats.length === 2 && !f.managed.isProcessing)
    assert.equal(f.chats[1].content, 'Next request\n\nKeep original exports')
    assert.equal(new Set(acks).size, 3)
    const bubbles = f.managed.messages.filter((m: any) => m.role === 'user')
    assert.deepEqual(bubbles.map((m: any) => m.content), ['Initial request', 'Next request', 'Keep original exports'])
    assert(bubbles.every((m: any) => !m.isQueued))
    const journal = f.manager.durableRuntime.storeFor(workspaceRoot).listAllEvents({ sessionId: f.managed.id })
    assert.equal(journal.filter((e: any) => e.type === 'user_input_admitted').length, 3)
    assert.deepEqual(journal.filter((e: any) => e.type === 'user_message_committed' && e.modelVisible).map((e: any) => e.payload.content), bubbles.map((m: any) => m.content))
    await f.manager.flushSession(f.managed.id)
    assert.equal(sessions.loadSession(workspaceRoot, f.managed.id)?.messages.filter(m => m.type === 'user').length, 3)
    return { acks: acks.length, turns: f.chats.length, originalInputs: bubbles.length }
  })
  await check('Correction steers within its running generation; attachments always take full queue path', async () => {
    answers = { delivery: choice('steer', ['steer', 'queue']), same_request: noul(.01) }
    const f = await makeSession(true)
    const running = f.manager.sendMessage(f.managed.id, 'Build')
    await until(() => f.chats.length === 1)
    await f.manager.sendMessage(f.managed.id, 'Keep exports')
    await until(() => f.redirects.length === 1)
    const attachment = { id: 'file', name: 'fixture.txt', type: 'text', mimeType: 'text/plain', storedPath: join(fixture, 'fixture.txt') }
    await f.manager.sendMessage(f.managed.id, 'Read attached', [attachment], [attachment])
    assert.equal(f.redirects.length, 1)
    assert.equal(f.managed.messageQueue.length, 1)
    f.release(); await running
    await until(() => f.chats.length === 2 && !f.managed.isProcessing)
    assert.equal(f.chats[1].attachments[0].id, 'file')
  })
  await check('Late delivery decisions cannot steer a newer turn; compaction and handoff retain queued inputs', async () => {
    settings({ midTurnMessages: true, adaptiveThinking: false, semanticLabels: false, turnOutcome: false })
    answers = { delivery: choice('steer', ['steer', 'queue']), same_request: noul(.01) }
    const f = await makeSession(true)
    const running = f.manager.sendMessage(f.managed.id, 'Initial request')
    await until(() => f.chats.length === 1)
    delay = 150
    await f.manager.sendMessage(f.managed.id, 'A new request')
    f.release(); await running
    await until(() => f.chats.length === 2 && !f.managed.isProcessing)
    await Bun.sleep(200); delay = 0
    assert.deepEqual(f.redirects, [])
    const held = await makeSession(true), turn = held.manager.sendMessage(held.managed.id, 'Initial request')
    await until(() => held.chats.length === 1)
    const before = network.length
    held.managed.agent.isCompactionInFlight = () => true
    await held.manager.sendMessage(held.managed.id, 'During compaction')
    held.managed.agent.isCompactionInFlight = () => false
    held.managed.contextHandoff = { phase: 'generating' }
    await held.manager.sendMessage(held.managed.id, 'During handoff')
    await Promise.all(held.managed.messageQueue.map((item: any) => item.continuationCheck))
    assert.equal(network.length, before)
    assert.equal(held.managed.messageQueue.length, 2)
    assert.deepEqual(held.redirects, [])
    held.managed.contextHandoff = undefined
    held.release(); await turn
    await until(() => held.chats.length === 3 && !held.managed.isProcessing)
    return { lateRedirects: f.redirects.length, blockedDecisionCalls: network.length - before, queuedInputs: 2 }
  })
  await check('Existing native steering admits and commits the original input before its ACK', async () => {
    settings({ midTurnMessages: false, adaptiveThinking: false, semanticLabels: false, turnOutcome: false })
    const f = await makeSession(true)
    const running = f.manager.sendMessage(f.managed.id, 'Initial native turn')
    await until(() => f.chats.length === 1)
    await f.manager.sendMessage(f.managed.id, 'Native correction', undefined, undefined, undefined, undefined, false, (id: string) => {
      const rows = f.manager.durableRuntime.storeFor(workspaceRoot).listEvents({ sessionId: f.managed.id, limit: 100 })
      assert(rows.some((row: any) => row.type === 'user_input_admitted' && row.payload.messageId === id))
      assert(rows.some((row: any) => row.type === 'user_message_committed' && row.payload.messageId === id))
    })
    assert.deepEqual(f.redirects, ['Native correction'])
    f.release(); await running
  })
  await check('Suggestions reach only the current model turn and record actual use without changing the original input', async () => {
    settings({ suggestions: true, adaptiveThinking: false, midTurnMessages: false, semanticLabels: false, turnOutcome: false })
    const folder = join(workspaceRoot, 'skills', 'workflow-skill'), path = join(folder, 'SKILL.md')
    mkdirSync(folder, { recursive: true })
    const content = '---\nname: Workflow skill\ndescription: Workflow fixture policy\n---\nUse fixture policy.\n'
    writeFileSync(path, content)
    answers = { needed: choice('skill:workflow-skill', ['none', 'skill:workflow-skill']) }
    const f = await makeSession(false, [
      { type: 'tool_start', toolName: 'Read', toolUseId: 'skill-read', input: { file_path: path } },
      { type: 'tool_result', toolName: 'Read', toolUseId: 'skill-read', result: 'Fixture policy', isError: false },
    ])
    await f.manager.sendMessage(f.managed.id, 'Use the workflow fixture policy')
    assert(f.chats[0].options.turnContext.includes('workflow-skill'))
    assert.equal(f.managed.messages.find((message: any) => message.role === 'user').content, 'Use the workflow fixture policy')
    assert.equal(readFileSync(path, 'utf8'), content)
    assert.deepEqual(f.managed.enabledSourceSlugs ?? [], [])
    await decisions.getDecisionRecorder().flush()
    const log = decisions.getDecisionRecorder().path
    await until(() => readFileSync(log, 'utf8').includes('"result":"hint_used"'))
    const rows = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const followup = rows.find((row: any) => row.kind === 'followup' && row.result === 'hint_used')
    assert(rows.some((row: any) => row.feature === 'suggestions' && row.id === followup.decisionId))
    settings()
    return { transientHint: true, implicitActivation: false, linkedFollowup: true }
  })
  await check('Smart titles defer greeting, generate substantive title, preserve manual rename', async () => {
    settings({ smartTitles: true })
    const f = await makeSession()
    f.managed.autoTitle = f.managed.name
    answers = { asks_for_something: noul(.01) }
    await f.manager.generateTitleUnlessSmallTalk(f.managed, 'hello')
    assert.equal(f.managed.titleDeferred, true)
    answers = { asks_for_something: noul(.99) }
    await f.manager.generateTitleUnlessSmallTalk(f.managed, 'Implement')
    assert.equal(f.managed.name, 'Generated fixture title')
    delay = 100
    const pending = f.manager.generateTitleUnlessSmallTalk(f.managed, 'Implement again')
    await Bun.sleep(20)
    await f.manager.renameSession(f.managed.id, 'My manual title')
    await pending
    delay = 0
    assert.equal(f.managed.name, 'My manual title')
    assert.equal(f.managed.autoTitle, undefined)
  })
  await check('Automation loop guard precedes semantic cost; false condition records skipped history once', async () => {
    settings({ automationConditions: true })
    answers = { condition: noul(.01) }
    const f = await makeSession()
    const created: any[] = []
    f.manager.executePromptAutomation = async (input: any) => { created.push(input); return { sessionId: 'inert-automation' } }
    const count = network.length
    await f.manager.runPromptAutomations(workspace.id, workspaceRoot, [{ prompt: 'Work', matcherId: 'semantic-fixture', semanticCondition: { question: 'Needed?' }, event: 'SessionCompleted' }])
    assert.equal(created.length, 0)
    assert(readAutomationHistory(workspaceRoot).some((entry: any) => entry.id === 'semantic-fixture' && entry.skipped))
    f.managed.triggeredBy = { automationId: 'loop-fixture', depth: 1 }
    await f.manager.runPromptAutomations(workspace.id, workspaceRoot, [{ prompt: 'Work', matcherId: 'loop-fixture', semanticCondition: { question: 'Needed?' }, eventPayload: { sessionId: f.managed.id } }])
    assert.equal(network.length, count + 1)
    fail = true
    await f.manager.runPromptAutomations(workspace.id, workspaceRoot, [{ prompt: 'Fallback', matcherId: 'fallback-fixture', semanticCondition: { question: 'Needed?' } }])
    fail = false
    assert.equal(created.length, 1)
  })
  await check('Guarded adds risk prompts, outside writes always prompt, failure prompts; mode changes and cancellation win', async () => {
    settings({ guardedMode: true })
    modes.setGuardedModeActiveResolver(() => decisions.isDecisionFeatureActive('guardedMode'))
    const sessionId = 'guarded-fixture'
    modes.setPermissionMode(sessionId, 'guarded')
    const input: any = { sessionId, permissionMode: 'guarded', toolName: 'Bash', input: { command: 'git push origin HEAD' }, workspaceRootPath: workspaceRoot,
      workspaceId: workspace.id, workingDirectory: workspaceRoot, activeSourceSlugs: [], allSourceSlugs: [], hasSourceActivation: false,
      permissionManager: new PermissionManager({ sessionId }), hasPermissionHandler: true }
    const checker = buildGuardedModeCheck({ sessionId, isInteractive: () => true })
    const allowed = await runPreToolUseChecks(input)
    assert.equal(allowed.type, 'allow')
    answers = { external: noul(.99), irreversible: noul(.01), outside_workspace: noul(.01) }
    const prompted: any = await guard.applyGuardedModeCheck(allowed, input, checker)
    assert.equal(prompted.type, 'prompt'); assert.equal(prompted.rememberKey, undefined)
    fail = true
    assert.equal((await guard.applyGuardedModeCheck(allowed, input, checker)).type, 'prompt')
    fail = false
    const outside: any = { ...input, toolName: 'Write', input: { file_path: join(fixture, 'outside.txt'), content: 'never executed' } }
    assert.equal((await guard.applyGuardedModeCheck({ type: 'allow' } as any, outside, checker)).type, 'prompt')
    const outsideDir = join(fixture, 'outside-write-target'), junction = join(workspaceRoot, 'outside-junction')
    mkdirSync(outsideDir)
    symlinkSync(outsideDir, junction, process.platform === 'win32' ? 'junction' : 'dir')
    const escaped = { ...outside, input: { file_path: join(junction, 'new', 'file.txt'), content: 'never executed' } }
    assert.equal((await guard.applyGuardedModeCheck({ type: 'allow' } as any, escaped, checker)).type, 'prompt')
    delay = 100
    const pending = guard.applyGuardedModeCheck(allowed, input, checker)
    await Bun.sleep(20); modes.setPermissionMode(sessionId, 'safe'); await pending.then(result => assert.equal(result.type, 'block'))
    modes.setPermissionMode(sessionId, 'guarded')
    answers = { external: noul(.01), irreversible: noul(.01), outside_workspace: noul(.01) }
    const disabled = guard.applyGuardedModeCheck(allowed, input, checker)
    await Bun.sleep(20); config.setDecisionLayerSettings({ enabled: false })
    assert.equal((await disabled).type, 'prompt')
    settings()
    const ctrl = new AbortController(), cancelled = guard.applyGuardedModeCheck(allowed, input, checker, { signal: ctrl.signal })
    ctrl.abort(); assert.equal((await cancelled).type, 'block'); delay = 0
    config.setDecisionLayerSettings({ enabled: false }); assert.equal(modes.resolveEffectivePermissionMode('guarded'), 'ask'); settings()
  })
  await check('Large-result host/Pi exchange preserves original file and bounds lost/invalid responses', async () => {
    answers = { handling: choice('preview', ['summary', 'preview']) }
    setLargeResultSummaryGate(buildLargeResultSummaryGate())
    let summaryCalls = 0
    const text = 'Result at top\n'.repeat(10_000)
    const result = await handleLargeResponse({ text, sessionPath: fixture, context: { toolName: 'fixture' }, summarize: async () => { summaryCalls++; return 'summary' } })
    assert.equal(summaryCalls, 0)
    assert(readFileSync((result as any).filePath, 'utf8').includes(text))
    const sent: any[] = [], gate = createLargeResultGateClient(request => sent.push(request), 30)
    const pending = gate.gate({ text, context: { toolName: 'fixture' }, estimatedTokens: 40_000 })
    assert(sent[0].text.length <= 8_000)
    gate.handleResponse('foreign-id', false)
    assert.equal(await pending, null)
    const completed = gate.gate({ text, context: { toolName: 'fixture' }, estimatedTokens: 40_000 })
    gate.handleResponse(sent[1].requestId, false); assert.equal(await completed, false)
    const cancelled = gate.gate({ text, context: { toolName: 'fixture' }, estimatedTokens: 40_000 })
    gate.cancelAll(); assert.equal(await cancelled, null)
    const broken = createLargeResultGateClient(() => { throw Error('fixture transport closed') }, 30)
    assert.equal(await broken.gate({ text, context: { toolName: 'fixture' }, estimatedTokens: 40_000 }), null)
    setLargeResultSummaryGate(null)
  })
  await check('Task scheduler infers verdict, scopes dependency repair once, then falls back to whole DAG within budget', async () => {
    settings({ turnOutcome: false })
    const spec: any = { id: 'workflow-task', title: 'Workflow', goal: 'Validate repairs', max_iterations: 3, nodes: [
      { id: 'a', kind: 'session', prompt: 'A' }, { id: 'b', kind: 'session', prompt: 'B', depends_on: ['a'] }, { id: 'c', kind: 'session', prompt: 'C' }] }
    tasks.saveTaskSpec(workspaceRoot, spec)
    const children: any[] = [], listeners = new Set<any>(), facts: any[] = []
    const inert: any = { createSession: async (_: string, opts: any) => { const id = `child-${children.length}`; children.push({ id, opts }); return { id } },
      sendMessage: async () => {}, setSessionStatus: async () => {}, setKanbanColumn: async () => {}, setTaskNodeCount: async () => {}, cancelProcessing: async () => {},
      getSessionWorkingDirectory: () => workspaceRoot, getSessionFinalText: () => undefined,
      onSessionComplete: (listener: any) => { listeners.add(listener); return () => listeners.delete(listener) }, commitTaskRunFact: ({ entry }: any) => facts.push(entry) }
    const runner = new TaskRunner({ workspaceRoot, workspaceId: workspace.id, host: inert,
      decide: buildTaskVerdictDecider(), pickRepairNodes: buildRepairScopePicker(), classifyNodeOutcome: buildNodeOutcomeClassifier() } as any) as any
    runners.push(runner)
    runner.run('workflow-task', { runId: 'workflow-run', orchestratorSessionId: 'orchestrator' })
    const active: any = runner.runs.get('workflow-task:workflow-run')
    await until(() => children.length >= 2)
    for (const [id, st] of active.state) { st.state = 'done'; st.sessionId = 'completed-' + id }
    active.inFlight = 0; active.runStatus = 'verifying'
    answers = { verdict: choice('pass', ['pass', 'fail', 'unclear']) }
    await active.classifyUnparsedVerdict('The result meets every criterion')
    assert(facts.some(e => e.kind === 'verdict' && e.via === 'decision'))
    // A separate real run exercises repair dependency closure and the unchanged repair budget.
    runner.run('workflow-task', { runId: 'repair-run', orchestratorSessionId: 'repair-orchestrator' })
    const repair: any = runner.runs.get('workflow-task:repair-run')
    await until(() => children.length >= 4)
    repair.scheduleReady = () => {} // freeze dispatch so reset frontier is inspectable
    for (const st of repair.state.values()) st.state = 'done'
    repair.inFlight = 0; repair.runStatus = 'verifying'
    answers = { 'implicated:a': noul(.99), 'implicated:b': noul(.01), 'implicated:c': noul(.01), 'implicated:foreign': noul(.99) }
    repair.handleVerdict('VERDICT: FAIL — A is wrong')
    await until(() => repair.runStatus === 'running')
    assert.deepEqual([...repair.state].filter(([, st]: any) => st.state === 'pending').map(([id]: any) => id).sort(), ['a', 'b'])
    for (const st of repair.state.values()) st.state = 'done'
    repair.runStatus = 'verifying'; repair.handleVerdict('VERDICT: FAIL — Still wrong')
    assert([...repair.state.values()].every((st: any) => st.state === 'pending'))
    for (const st of repair.state.values()) st.state = 'done'
    const costBeforeThird = network.length
    repair.runStatus = 'verifying'; repair.handleVerdict('VERDICT: FAIL — Third repair still needs the whole DAG')
    assert([...repair.state.values()].every((st: any) => st.state === 'pending'))
    assert.equal(network.length, costBeforeThird)
    for (const st of repair.state.values()) st.state = 'done'
    repair.runStatus = 'verifying'; repair.handleVerdict('VERDICT: FAIL — Exhausted')
    assert.equal(repair.runStatus, 'failed')
    return { facts: facts.length, repairs: repair.repairsUsed, laterRepairDecisionCalls: network.length - costBeforeThird }
  })
  await check('Actual task child completion classifies needs-input as failure and preserves the normal completion fallback', async () => {
    settings({ turnOutcome: true })
    const spec: any = { id: 'outcome-task', title: 'Outcome task', goal: 'Deliver output', nodes: [{ id: 'step', kind: 'session', prompt: 'Finish the step' }] }
    tasks.saveTaskSpec(workspaceRoot, spec)
    const children: string[] = [], listeners = new Set<any>(), facts: any[] = []
    const inert: any = { createSession: async () => { const id = 'outcome-child-' + children.length; children.push(id); return { id } },
      sendMessage: async () => {}, setSessionStatus: async () => {}, setKanbanColumn: async () => {}, cancelProcessing: async () => {},
      getSessionFinalText: () => 'Which account should I use?',
      onSessionComplete: (listener: any) => { listeners.add(listener); return () => listeners.delete(listener) },
      commitTaskRunFact: ({ entry }: any) => facts.push(entry) }
    const runner = new TaskRunner({ workspaceRoot, workspaceId: workspace.id, host: inert, classifyNodeOutcome: buildNodeOutcomeClassifier() } as any) as any
    runners.push(runner)
    runner.run('outcome-task', { runId: 'needs-input', verifyOnComplete: false })
    await until(() => children.length === 1)
    answers = { outcome: choice('needs_input', ['finished', 'needs_input', 'blocked']) }
    for (const listener of [...listeners]) listener({ sessionId: children[0], reason: 'complete', finalText: 'Which account should I use?' })
    await until(() => runner.runs.get('outcome-task:needs-input').runStatus === 'failed')
    assert(facts.some(entry => entry.kind === 'node-finished' && entry.state === 'failed' && entry.reason.includes('asked for input')))
    runner.run('outcome-task', { runId: 'fallback', verifyOnComplete: false })
    await until(() => children.length === 2)
    fail = true
    for (const listener of [...listeners]) listener({ sessionId: children[1], reason: 'complete', finalText: 'Finished fixture step' })
    await until(() => runner.runs.get('outcome-task:fallback').runStatus === 'completed')
    fail = false; settings()
    return { needsInput: 'failed', unavailableDecision: 'completed via existing behavior' }
  })
  await check('All seven authenticated remote decision RPCs use the target server config and encrypted vault', async () => {
    const { WsRpcClient } = await import('../../packages/server-core/src/transport/client.ts')
    const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol/channels.ts')
    const targetRoot = join(fixture, 'remote-config')
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(join(targetRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], llmConnections: [], decisionLayer: featureSettings }))
    const importer = (path: string) => JSON.stringify(pathToFileURL(join(root, path)).href)
    const entry = join(fixture, 'remote-server.ts')
    writeFileSync(entry, `
      const { WsRpcServer } = await import(${importer('packages/server-core/src/transport/server.ts')});
      const { registerDecisionsHandlers } = await import(${importer('packages/server-core/src/handlers/rpc/decisions.ts')});
      const { registerTasksHandlers } = await import(${importer('packages/server-core/src/handlers/rpc/tasks.ts')});
      const server = new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async token=>token==='fixture-token'});
      registerDecisionsHandlers(server, {}); registerTasksHandlers(server, {}); await server.listen(); console.log(JSON.stringify({port:server.port}));
      process.on('SIGTERM',()=>{server.close();process.exit(0)});
    `)
    const localBefore = readFileSync(join(configRoot, 'config.json'), 'utf8')
    const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, PHANERIS_CONFIG_DIR: targetRoot }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let port = 0, stderr = '', stdout = ''
    child.stdout.on('data', chunk => { stdout += String(chunk); for (const line of stdout.split('\n')) { try { const value = JSON.parse(line); if (value.port) port = value.port } catch {} } })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    let good: any, bad: any
    try {
      await until(() => port > 0, 10_000)
      good = new WsRpcClient(`ws://127.0.0.1:${port}`, { mode: 'remote', token: 'fixture-token', autoReconnect: false })
      bad = new WsRpcClient(`ws://127.0.0.1:${port}`, { mode: 'remote', token: 'wrong-token', autoReconnect: false, connectTimeout: 500 })
      good.connect(); bad.connect()
      await until(() => good.isConnected)
      await assert.rejects(bad.invoke(RPC_CHANNELS.decisions.GET_SETTINGS))
      const before = await good.invoke(RPC_CHANNELS.decisions.GET_SETTINGS)
      assert.equal(before.features.guardedMode, true)
      await good.invoke(RPC_CHANNELS.decisions.SET_SETTINGS, { features: { guardedMode: false } })
      const secret = 'fixture-decision-secret-do-not-log'
      await good.invoke(RPC_CHANNELS.decisions.SET_API_KEY, 'custom', secret)
      const status = await good.invoke(RPC_CHANNELS.decisions.GET_STATUS)
      assert(status.providersWithKey.includes('custom'))
      assert(!JSON.stringify(status).includes(secret))
      fail = false; answers = {}; delay = 0
      const tested = await good.invoke(RPC_CHANNELS.decisions.TEST)
      assert.equal(tested.ok, true)
      const probed = await good.invoke(RPC_CHANNELS.decisions.PROBE_SERVER, { baseUrl: api.url.href })
      assert(probed)
      await good.invoke(RPC_CHANNELS.decisions.DELETE_API_KEY, 'custom')
      assert(!(await good.invoke(RPC_CHANNELS.decisions.GET_STATUS)).providersWithKey.includes('custom'))
      assert.equal(readFileSync(join(configRoot, 'config.json'), 'utf8'), localBefore)
      assert.equal(JSON.parse(readFileSync(join(targetRoot, 'config.json'), 'utf8')).decisionLayer.features.guardedMode, false)
      const results = await good.invoke(RPC_CHANNELS.tasks.GET_RESULTS, workspace.id, 'workflow-task', 'workflow-run')
      assert.equal(results.verdicts.at(-1).via, 'decision')
      assert.equal(results.verdicts.at(-1).confidence, .95)
      return { channels: 7, wrongTokenRejected: true, localConfigUnchanged: true, responseSecretAbsent: true, taskResultsInference: { via: results.verdicts.at(-1).via, confidence: results.verdicts.at(-1).confidence } }
    } finally { good?.destroy(); bad?.destroy(); child.kill(); if (!port) console.error('Fixture server startup failed:', stderr) }
  })
  await check('Real PiAgent JSONL subprocess lowers one turn and restores the latest user thinking level', async () => {
    const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
    const wirePath = join(fixture, 'pi-wire.json'), entry = join(fixture, 'pi-fixture.cjs')
    writeFileSync(entry, `
      const fs=require('node:fs'),readline=require('node:readline'); const wire=[];
      const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const msg=JSON.parse(line); wire.push(msg.type==='prompt'?{type:msg.type,message:msg.message}:msg.type==='set_thinking_level'?msg:{type:msg.type});
        fs.writeFileSync(${JSON.stringify(wirePath)},JSON.stringify(wire));
        if(msg.type==='init')send({type:'ready',sessionId:'fixture-pi'});
        if(msg.type==='set_auto_compaction')send({type:'set_auto_compaction_result',id:msg.id,success:true,enabled:msg.enabled});
        if(msg.type==='shutdown')process.exit(0);
        if(msg.type==='prompt')setTimeout(()=>{send({type:'event',event:{type:'message_end',message:{role:'assistant',content:[{type:'text',text:'fixture reply'}],stopReason:'stop',usage:{input:0,output:1,totalTokens:1,cost:{total:0}}}}});send({type:'event',event:{type:'agent_end',messages:[]}})},20);
      });
    `)
    const agent = new PiAgent({ workspace, model: 'pi/gpt-5-mini', thinkingLevel: 'max', isHeadless: true, skipConfigWatcher: true,
      session: { id: 'pi-wire-fixture', workspaceRootPath: workspaceRoot, createdAt: Date.now(), lastUsedAt: Date.now() },
      runtime: { paths: { piServer: entry, node: process.execPath }, customEndpoint: { api: 'openai-completions' }, baseUrl: api.url.href } } as any)
    const deadline = setTimeout(() => agent.forceAbort('user_stop' as any), 5_000)
    try {
      let completed = false
      for await (const event of agent.chat('Original request', undefined, { thinkingOverride: 'low', turnContext: 'Transient suggestion fixture' })) {
        if (event.type === 'text_complete') agent.setThinkingLevel('high')
        if (event.type === 'complete') completed = true
      }
      assert(completed)
      await until(() => JSON.parse(readFileSync(wirePath, 'utf8')).some((entry: any) => entry.type === 'set_thinking_level' && entry.level === 'high'))
      const wire = JSON.parse(readFileSync(wirePath, 'utf8'))
      const levels = wire.filter((entry: any) => entry.type === 'set_thinking_level').map((entry: any) => entry.level)
      assert.equal(levels[0], 'low'); assert.equal(levels.at(-1), 'high')
      assert.equal(agent.getThinkingLevel(), 'high')
      assert.equal(wire.find((entry: any) => entry.type === 'prompt').message.split('Transient suggestion fixture').length - 1, 1)
      return { completed, levels, suggestionCopies: 1 }
    } finally {
      clearTimeout(deadline)
      // Let this controlled JSONL fixture acknowledge shutdown by exiting before teardown.
      // Windows SIGTERM is immediate, so killing it while stdin flushes would race the proof.
      const child = (agent as any).subprocess
      if (child && child.exitCode === null && !child.signalCode) {
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
        ;(agent as any).send({ type: 'shutdown' })
        await exited
      }
      await agent.disposeForRestart(); agent.destroy()
    }
  })
} finally {
  api.stop(true); modes.setGuardedModeActiveResolver(null); setLargeResultSummaryGate(null)
  for (const runner of runners) for (const active of runner.runs.values()) { clearTimeout(active.timeoutTimer); active.unsubscribe?.() }
  for (const manager of managers) await manager.flushAllSessions()
  for (const manager of managers) manager.durableRuntime.closeAll()
}
const failed = records.filter(record => !record.pass)
const out = process.argv.find(arg => arg.startsWith('--report='))?.slice(9) ?? join(root, 'docs/verification/results/upstream-0.14.0-b4-b5-workflows.json')
writeFileSync(out, JSON.stringify({ executedAt: new Date().toISOString(), fixture, total: records.length, passed: records.length - failed.length,
  failed: failed.length, requests: network.length, records }, null, 2) + '\n')
console.log(`${records.length - failed.length}/${records.length} passed; ${out}`)
for (const record of failed) console.log('FAIL', record.id, record.error)
process.exitCode = failed.length ? 1 : 0
