/** See docs/verification/decision-run-failure-matrix.md, written before implementation. */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-session-decisions-'))
const configRoot = join(fixture, 'config'), workspaceRoot = join(fixture, 'workspace')
const output = join(root, '.cache/session-decisions'), checks: any[] = [], requests: any[] = []
mkdirSync(output, { recursive: true }); mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot; process.env.NODE_ENV = 'test'
let error = false, delay = 0, knownPrice = true, costUsd = .001, noul = .95
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any; requests.push(body)
  if (delay) await Bun.sleep(delay)
  if (error) return new Response('PRIVATE_INPUT_MUST_NOT_PERSIST', { status: 503 })
  const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]: any) => {
    if (q.type === 'choice') {
      const options = Object.keys(q.criteria), choice = ['needs_input', 'pass', 'steer', 'preview', 'none'].find(value => options.includes(value)) ?? options[0]
      return [key, { type: 'choice', choice, confidence: .98, probabilities: Object.fromEntries(options.map(option => [option, option === choice ? 1 : 0])) }]
    }
    return [key, q.type === 'score' ? { type: 'score', score: 0, confidence: .98, probabilities: { '0': .98, '1': .01, '2': .01, '3': 0 } }
      : { type: 'noul', noul: /^p\d+$/.test(key) ? (Number(key.slice(1)) % 2 ? .95 : .05) : key === 'consequential' || key === 'corrects_previous' ? 0 : noul }]
  }))
  return Response.json({ model: body.model, answers, usage: { input_tokens: 7, output_tokens: 3, ...(knownPrice ? { cost_usd: costUsd } : {}) } })
} })
const decisions = await import('../../packages/shared/src/decisions/index.ts')
const points = await import('../../packages/server-core/src/decisions/decision-point.ts')
const host = await import('../../packages/server-core/src/sessions/SessionManager.ts')
const storage = await import('../../packages/shared/src/sessions/storage.ts')
const { WsRpcServer } = await import('../../packages/server-core/src/transport/server.ts')
const { WsRpcClient } = await import('../../packages/server-core/src/transport/client.ts')
const { registerDecisionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/decisions.ts')
const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol/channels.ts')
const features = decisions.DECISION_LAYER_FEATURES
const tags = ['decide_tool','task_verdict','semantic_labels','turn_outcome','guarded_mode','risk_badges','automation_condition','task_repairs','smart_titles','adaptive_thinking','mid_turn_messages','large_results','suggestions']
const workspace = { id: 'fixture', name: 'Fixture', rootPath: workspaceRoot, createdAt: Date.now() }
const writeConfig = (enabled = true, baseUrl = api.url.href) => writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id,
  decisionLayer: { enabled, provider: 'custom', baseUrl, model: 'fixture', features: Object.fromEntries(features.map(feature => [feature, true])) } }))
writeConfig()
let manager = new host.SessionManager() as any
async function add(name: string, owner = workspace) {
  const stored = await storage.createSession(owner.rootPath, { name })
  const managed = host.createManagedSession(stored, owner as any, { messagesLoaded: true }) as any
  manager.sessions.set(stored.id, managed); return managed
}
const a = await add('Session A'), b = await add('Session B'), empty = await add('Empty branch')
empty.branchFromSessionId = a.id
const foreignRoot = join(fixture, 'foreign'); mkdirSync(foreignRoot, { recursive: true })
const foreign = await add('Foreign', { ...workspace, id: 'foreign', rootPath: foreignRoot })
const legacy = { t: new Date().toISOString(), feature: 'smart_titles', provider: 'custom', model: 'fixture', ok: true, questions: {}, state: null, sessionId: a.id }
await decisions.getDecisionRecorder().append(legacy as any)
await decisions.getDecisionRecorder().append({ ...legacy, id: 'no-session', sessionId: undefined } as any)
await decisions.getDecisionRecorder().flush()
const rpc = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async token => token === 'fixture-token' })
registerDecisionsHandlers(rpc, { sessionManager: { getSessions: () => manager.getSessions(), getSessionDecisions: (id: string, query: any) => manager.getSessionDecisions(id, query) } } as any)
await rpc.listen()
const sink = (channel: string, target: any, ...args: any[]) => rpc.push(channel, target, ...args)
manager.eventSink = sink
const client = new WsRpcClient(`ws://127.0.0.1:${rpc.port}`, { mode: 'remote', workspaceId: workspace.id, token: 'fixture-token', autoReconnect: false })
client.connect()
async function until(predicate: () => boolean | Promise<boolean>, ms = 10000) { const end = Date.now() + ms; while (!await predicate()) { if (Date.now() > end) throw Error('Workflow deadline'); await Bun.sleep(15) } }
await until(() => client.isConnected)
const report = (id = a.id, query?: any) => client.invoke(RPC_CHANNELS.decisions.GET_SESSION, id, query)
const request = { state: 'PRIVATE_INPUT_MUST_NOT_PERSIST', questions: { yes: { type: 'noul' as const, instructions: 'Yes or no' } } }
async function check(id: string, action: () => any) { try { checks.push({ id, pass: true, observation: await action() }) } catch (e) { checks.push({ id, pass: false, error: e instanceof Error ? e.stack : String(e) }); console.error(checks.at(-1).error) } console.log(`${checks.at(-1).pass ? 'PASS' : 'FAIL'} ${id}`) }
async function point(feature: typeof features[number], sessionId = a.id) { return (await points.openDecisionPoint({ feature, record: tags[features.indexOf(feature)] ?? feature, sessionId, source: { messageId: 'source-message', turnId: 'source-turn' } }))! }
let vite: Awaited<ReturnType<typeof createServer>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await check('Batch is one point; recommendation, discarded application and observation stay separate', async () => {
    const decide = await point('largeResults'), answers = await Promise.all([decide(request), decide(request), decide(request)])
    points.recordDecisionOutcome(answers[0], { action: 'filter', changed: true })
    let value = await report(); assert.equal(value.totals.points, 1); assert.equal(value.totals.requests, 3); assert.equal(value.totals.changed, 0)
    decide.trace!.apply({ action: 'discard', status: 'discarded', changed: false, reason: 'new_turn' })
    decide.trace!.apply({ action: 'filter', status: 'applied', changed: true })
    points.recordDecisionFollowUp(answers[0], { result: 'file_access_attempted' })
    value = await report(); assert.equal(value.totals.changed, 0); assert.equal(value.items.find((item: any) => !item.legacy).observations[0].result, 'file_access_attempted')
    return value.totals
  })
  await check('All 13 feature routes persist exact attempt and accounting identities', async () => {
    for (const feature of features) {
      const decide = await point(feature, b.id), answer = await decide(request)
      assert(answer?.attemptId && answer.accountingOperationId)
      points.recordDecisionOutcome(answer, { action: 'fixture_observation', changed: false })
      decide.trace!.apply({ action: 'fixture_host_boundary', status: 'unchanged', changed: false })
    }
    const value = await report(b.id); assert.equal(value.features.length, 13); assert.equal(value.totals.points, 13); assert.equal(value.totals.requests, 13)
    assert(value.items.every((item: any) => item.attempts[0].accountingOperationId && item.attempts[0].inputTokens === 7))
    return value.totals
  })
  await check('Known zero price remains known; an in-flight request has unknown cost until accounted', async () => {
    const zero = await add('Zero price'); costUsd = 0
    const decide = await point('suggestions', zero.id); await decide(request)
    const value = await report(zero.id); assert.equal(value.totals.knownCostUsd, 0); assert.equal(value.totals.knownCostRequests, 1); assert.equal(value.totals.unknownCostRequests, 0)
    costUsd = .001; delay = 200; const pending = decide(request)
    await until(async () => (await report(zero.id)).totals.requests === 2)
    assert.equal((await report(zero.id)).totals.unknownCostRequests, 1)
    await pending; delay = 0; assert.equal((await report(zero.id)).totals.unknownCostRequests, 0)
  })
  await check('Host title and pre-turn boundaries confirm actual changes; stopped results are discarded', async () => {
    noul = 0; await manager.generateTitleUnlessSmallTalk(a, 'Hi'); assert.equal(a.titleDeferred, true)
    a.isProcessing = true; a.processingGeneration = 1; a.thinkingLevel = 'max'; a.messages = [{ id: 'source-message', role: 'user', content: 'routine' }]
    const first = await manager.startPreTurnDecisions(a, 'routine'); assert.equal(first.thinkingOverride, 'low')
    assert(!(await report()).items.find((item: any) => item.feature === 'adaptiveThinking').application)
    first.apply()
    delay = 100; const late = manager.startPreTurnDecisions(a, 'routine'); a.stopRequested = true; await late; a.stopRequested = false; delay = 0; a.isProcessing = false; noul = .95
    const value = await report(); assert(value.items.some((item: any) => item.feature === 'smartTitles' && item.application?.action === 'defer_title' && item.application.changed))
    assert(value.items.some((item: any) => item.feature === 'adaptiveThinking' && item.application?.status === 'discarded'))
  })
  await check('Guarded permission still prompts; unavailable check falls back without auto-approval', async () => {
    const modes = await import('../../packages/shared/src/agent/mode-manager.ts')
    const { buildGuardedModeCheck } = await import('../../packages/server-core/src/decisions/guarded-mode.ts')
    const { applyGuardedModeCheck } = await import('../../packages/shared/src/agent/core/guarded-mode.ts')
    modes.setGuardedModeActiveResolver(() => true); modes.setPermissionMode(a.id, 'guarded')
    const ctx = { sessionId: a.id, toolName: 'Bash', input: { command: 'git push origin main' }, workingDirectory: workspaceRoot, workspaceRootPath: workspaceRoot, plansFolderPath: join(workspaceRoot, 'plans') }
    const guarded = buildGuardedModeCheck({ sessionId: a.id, isInteractive: () => true })
    assert.equal((await applyGuardedModeCheck({ type: 'allow' }, ctx as any, guarded)).type, 'prompt')
    error = true; assert.equal((await applyGuardedModeCheck({ type: 'allow' }, ctx as any, guarded)).type, 'prompt'); error = false
    const value = await report(); assert(value.items.some((item: any) => item.feature === 'guardedMode' && item.application?.status === 'fallback'))
  })
  await check('Decision tool delivery leaves adoption unconfirmed; free-form metadata is not in session evidence', async () => {
    const { buildDecisionToolCallbacks } = await import('../../packages/server-core/src/decisions/tool-callbacks.ts')
    const callbacks = buildDecisionToolCallbacks({ sessionId: a.id })
    assert((await callbacks.decide({ ...request, meta: { payload: request.state, apiKey: 'SECRET_TOKEN' } })).ok)
    const value = await report(); const tool = value.items.find((item: any) => item.feature === 'decideTool')
    assert.equal(tool.application.status, 'unknown'); assert(value.totals.unconfirmed > 0)
    assert(!JSON.stringify(value).includes(request.state)); assert(!JSON.stringify(value).includes('SECRET_TOKEN'))
  })
  await check('Large result is confirmed only when the host actually delivers the excerpt', async () => {
    const { buildLargeResultFilter, finishLargeResultExcerpts } = await import('../../packages/server-core/src/decisions/large-result-filter.ts')
    const filter = buildLargeResultFilter(), excerpt = await filter({ text: Array.from({ length: 8 }, (_, i) => `# section ${i}\n${'evidence '.repeat(160)}`).join('\n'), context: { toolName: 'Read', intent: 'Find relevant evidence' }, budgetChars: 9000, filePath: '/fixture/saved.txt', sessionId: a.id })
    assert(excerpt)
    let value = await report(); const item = value.items.find((item: any) => item.feature === 'largeResults' && item.recommendation?.action === 'filter'); assert(!item.application)
    excerpt.onApplied!(true); finishLargeResultExcerpts(a.id)
    value = await report(); assert.equal(value.items.find((row: any) => row.id === item.id).application.status, 'applied')
    const { buildLargeResultSummaryGate } = await import('../../packages/server-core/src/decisions/large-results.ts')
    const { setLargeResultSummaryGate, askLargeResultSummaryGate, handleLargeResponse } = await import('../../packages/shared/src/utils/large-response.ts')
    setLargeResultSummaryGate(buildLargeResultSummaryGate())
    try {
      let confirm: ((applied: boolean) => void) | undefined
      const input = { text: 'The requested answer is at the top.\n' + 'Details.\n'.repeat(800), context: { toolName: 'Read', intent: 'Read the answer' }, estimatedTokens: 5000, sessionId: a.id }
      const before = (await report()).totals.changed
      assert.equal(await askLargeResultSummaryGate({ ...input, onApplication: callback => { confirm = callback } }), false)
      assert.equal((await report()).totals.changed, before); confirm!(false)
      assert((await report()).items.some((item: any) => item.recommendation?.action === 'skip_summary' && item.application?.status === 'discarded'))
      assert.equal(await askLargeResultSummaryGate(input), false)
      assert.equal((await report()).totals.changed, before + 1)
      delay = 150; const abort = new AbortController(), count = requests.length
      const cancelled = handleLargeResponse({ text: 'Details.\n'.repeat(7000), sessionPath: join(workspaceRoot, 'sessions', a.id), context: input.context,
        contextWindow: 1000, summarize: async () => 'Summary', signal: abort.signal })
      await until(() => requests.length > count); abort.abort(); await assert.rejects(cancelled); delay = 0
      assert.equal((await report()).totals.changed, before + 1)
    } finally { setLargeResultSummaryGate(null) }
  })
  await check('Semantic labels and turn outcome discard late answers after manual edits', async () => {
    const labels = [{ id: 'bug', name: 'Bug', autoRules: [{ semantic: 'Does the user report a bug?', threshold: .9 }] }]
    noul = .95; a.labels = []; a.manualLabelsRevision = 0
    await manager.applySemanticAutoLabels(a, 'The app crashes whenever I try to sign in', labels, 'labels-current')
    assert(a.labels.includes('bug'))
    a.labels = []; delay = 100; const count = requests.length
    const lateLabels = manager.applySemanticAutoLabels(a, 'The app crashes whenever I try to sign in', labels, 'labels-late')
    await until(() => requests.length > count)
    a.manualLabelsRevision++; a.labels = ['manual']; await lateLabels
    assert.deepEqual(a.labels, ['manual'])
    a.isProcessing = false; a.sessionStatus = 'todo'; a.messages = [{ id: 'user-outcome', role: 'user', content: 'Do the work' }, { id: 'final-outcome', role: 'assistant', content: 'Which option?', turnId: 'outcome-turn' }]
    const lateStatus = manager.applyTurnOutcome(a, 'final-outcome'); await Bun.sleep(30); a.sessionStatus = 'in-progress'; await lateStatus
    assert.equal(a.sessionStatus, 'in-progress'); delay = 0
    const value = await report(a.id, { limit: 100 })
    assert(value.items.some((item: any) => item.source?.messageId === 'labels-current' && item.application?.changed))
    assert(value.items.some((item: any) => item.source?.messageId === 'labels-late' && item.application?.status === 'discarded'))
    assert(value.items.some((item: any) => item.source?.messageId === 'final-outcome' && item.application?.status === 'discarded'))
  })
  await check('Missing configuration records a zero-request fallback; provider timeout is explicit', async () => {
    const before = await report(), count = requests.length; writeConfig(true, '')
    const capture = new points.DecisionCapture(); const unavailable = await points.openDecisionPoint({ feature: 'riskBadges', record: 'risk_badges', sessionId: a.id, ...capture.deps })
    assert.equal(unavailable, null); capture.resolve('none'); assert.equal(requests.length, count)
    const after = await report(); assert.equal(after.totals.requests, before.totals.requests); assert.equal(after.totals.points, before.totals.points + 1)
    assert(after.items.some((item: any) => item.unavailableReason && item.attempts.length === 0 && item.application.status === 'fallback'))
    writeConfig(); delay = 400; const decide = await point('riskBadges'); assert.equal(await decide({ ...request, deadlineMs: 250 }), null); decide.trace!.apply({ action: 'none', status: 'fallback', changed: false }); delay = 0
    assert((await report()).items.some((item: any) => item.attempts.some((attempt: any) => attempt.status === 'timeout')))
  })
  await check('Failure, cancellation, unknown price and disabled feature retain accurate counts', async () => {
    knownPrice = false; error = true; const failed = await point('riskBadges'); assert.equal(await failed(request), null); failed.trace!.apply({ action: 'none', status: 'fallback', changed: false }); error = false
    delay = 150; const cancelled = await point('semanticLabels'), abort = new AbortController(); const pending = cancelled(request, undefined, abort.signal); setTimeout(() => abort.abort(), 30); assert.equal(await pending, null); cancelled.trace!.apply({ action: 'discard', status: 'discarded', changed: false }); delay = 0
    const before = await report(); assert(before.totals.failures > 0 && before.totals.cancelled > 0 && before.totals.unknownCostRequests > 0)
    writeConfig(false); const count = requests.length; assert.equal(await points.openDecisionPoint({ feature: 'riskBadges', record: 'risk_badges', sessionId: a.id }), null)
    const after = await report(); assert.equal(after.totals.points, before.totals.points); assert.equal(requests.length, count); assert.equal(after.enabled, false)
    writeConfig(); knownPrice = true
    return before.totals
  })
  await check('Authenticated RPC rejects foreign workspace, missing session, invalid filters and invalid cursors', async () => {
    await assert.rejects(report(foreign.id), /another workspace/); await assert.rejects(report('missing'), /not found/)
    await assert.rejects(report(a.id, { limit: 0 })); await assert.rejects(report(a.id, { feature: 'invalid' })); await assert.rejects(report(a.id, { cursor: 123 }))
    const wrong = new WsRpcClient(`ws://127.0.0.1:${rpc.port}`, { token: 'wrong', autoReconnect: false, connectTimeout: 300 })
    try { wrong.connect(); await assert.rejects(wrong.invoke(RPC_CHANNELS.decisions.GET_SESSION, a.id)) } finally { wrong.destroy() }
    assert.equal((await report(empty.id)).totals.points, 0)
    a.isArchived = true; assert((await report()).totals.points > 0); a.isArchived = false
  })
  await check('Historical missing identities are explicit; no-session automation never joins a chat', async () => {
    const before = await report(), count = before.totals.points, decide = await points.openDecisionPoint({ feature: 'automationConditions', record: 'automation_condition' })
    await decide!(request); const after = await report(); assert.equal(after.totals.points, count)
    assert(after.items.some((item: any) => item.legacy && !item.application && !item.source)); assert.equal(after.coverage, 'partial'); assert.equal(after.totals.legacyCalls, 1)
  })
  await check('Pagination totals cover the full session and late observations invalidate old cursors', async () => {
    for (let index = 0; index < 42; index++) { const decide = await point('suggestions'); await decide(request); decide.trace!.apply({ action: 'none', status: 'unchanged', changed: false }) }
    const first = await report(a.id, { limit: 5 }), second = await report(a.id, { limit: 5, cursor: first.nextCursor })
    assert.equal(first.items.length, 5); assert.deepEqual(first.totals, second.totals); assert(!first.items.some((item: any) => second.items.some((other: any) => item.id === other.id)))
    const decide = await point('suggestions'); const answer = await decide(request); points.recordDecisionFollowUp(answer, { result: 'source_access_attempted' })
    await assert.rejects(report(a.id, { limit: 5, cursor: first.nextCursor }), /snapshot changed/)
    const filtered = await report(a.id, { feature: 'suggestions', turnId: 'source-turn' }); assert(filtered.items.every((item: any) => item.feature === 'suggestions' && item.source.turnId === 'source-turn'))
  })
  await check('Reopening the durable host preserves decisions and cost without provider replay', async () => {
    // Replay the durable sent marker of a process interrupted before completion.
    const trace = decisions.createDecisionPointTrace({ sessionId: b.id, feature: 'riskBadges' })
    decisions.decisionObservation({ ...trace, attemptId: 'interrupted-fixture' }, { kind: 'attempt_started', provider: 'custom', model: 'fixture' })
    decisions.decisionObservation({ ...trace, attemptId: 'interrupted-fixture' }, { kind: 'sent' })
    await Bun.sleep(2)
    await decisions.getDecisionRecorder().flush()
    const before = await report(), count = requests.length, stored = [...manager.sessions.values()]
    manager.cleanup(); manager = new host.SessionManager() as any; for (const entry of stored) manager.sessions.set(entry.id, entry); manager.eventSink = sink
    const after = await report(); assert.deepEqual(after.totals, before.totals); assert.equal(requests.length, count)
    const store = manager.durableRuntime.storeFor(workspaceRoot), usage = store.listUsage({ sessionId: a.id })
    assert.equal(after.totals.knownCostUsd, usage.reduce((sum: number, row: any) => sum + (row.costUsd ?? 0), 0))
    const interrupted = await report(b.id); assert.equal(interrupted.items.find((item: any) => item.id === trace.decisionPointId).attempts[0].status, 'unknown'); assert.equal(interrupted.totals.unknownCostRequests, 1)
    writeFileSync(join(output, 'evidence.json'), JSON.stringify({ report: after, events: store.listDecisionEvents(a.id), usage }, null, 2))
  })
  writeFileSync(join(output, 'run.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/session-decisions.tsx"></script></body></html>')
  vite = await createServer({ configFile: join(root, 'apps/electron/vite.config.ts'), root, server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/runtimes/**'] } } }); await vite.listen()
  const port = (vite.httpServer!.address() as any).port, base = `http://127.0.0.1:${port}/.cache/session-decisions/run.html`
  browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1040, height: 1000 } }), pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message)); page.setDefaultTimeout(8000)
  const load = async (extra = '') => { await page.goto(`${base}?rpc=${encodeURIComponent(`ws://127.0.0.1:${rpc.port}`)}&a=${a.id}&b=${b.id}&empty=${empty.id}&${extra}`, { waitUntil: 'networkidle', timeout: 90000 }); await page.waitForFunction(() => (window as any).decisionsFixture); await page.getByRole('tab', { name: 'Decisions', exact: true }).click(); await page.locator('[data-decision-id]').first().waitFor() }
  await check('Real Run renders decisions with zero chat messages, filters, pagination and keyboard tabs', async () => {
    await load(); assert.equal(await page.getByRole('tab').count(), 5); assert.equal(await page.locator('[data-decision-id]').count(), 40)
    await page.getByRole('button', { name: 'Load more' }).click(); await page.waitForFunction(() => document.querySelectorAll('[data-decision-id]').length > 40)
    const previousCount = await page.locator('[data-decision-id]').count(), previousLast = await page.locator('[data-decision-id]').last().getAttribute('data-decision-id')
    await page.locator('[data-decision-id] button').last().click()
    const refresh = await point('suggestions'); await refresh(request); refresh.trace!.apply({ action: 'none', status: 'unchanged', changed: false })
    await page.waitForFunction(count => document.querySelectorAll('[data-decision-id]').length === count + 1, previousCount)
    assert.equal(await page.locator(`[data-decision-id="${previousLast}"] button`).getAttribute('aria-expanded'), 'true')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-decision-id]')?.getAttribute('data-decision-id')), previousLast)
    const expected = await report(a.id, { status: 'changed' })
    await page.getByLabel('Execution status', { exact: true }).selectOption('changed')
    await page.waitForFunction(points => document.querySelector('[data-session-decisions] dl dd')?.textContent?.trim() === String(points), expected.totals.points)
    await page.locator('[data-decision-id]').first().waitFor(); assert((await page.locator('[data-session-decisions]').innerText()).includes('Changed'))
    await page.getByRole('tab', { name: 'Decisions', exact: true }).focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.getByRole('tab', { name: 'Context', exact: true }).getAttribute('aria-selected'), 'true')
  })
  await check('Pinned and following Run bindings remain separate; stale A responses cannot paint B', async () => {
    await load(); await page.evaluate(() => (window as any).decisionsFixture.pin(0)); await page.evaluate(() => (window as any).decisionsFixture.select(1)); assert.equal(await page.locator('[data-session-decisions]').getAttribute('data-session-decisions'), a.id)
    await page.evaluate(() => { const f = (window as any).decisionsFixture; f.pin(); f.slow(true); f.select(0) }); await page.waitForTimeout(50); await page.evaluate(() => (window as any).decisionsFixture.select(1))
    await page.waitForTimeout(600); assert.equal(await page.locator('[data-session-decisions]').getAttribute('data-session-decisions'), b.id); assert.equal(await page.locator('[data-decision-id]').count(), 14)
    await page.evaluate(() => (window as any).decisionsFixture.select(2)); await page.getByText('No recorded decisions in this session.', { exact: true }).waitFor()
  })
  await check('Application-only updates refresh; query errors retry and old-server capability stays explicit', async () => {
    await load(); const decide = await point('smartTitles'), answer = await decide(request); await page.waitForTimeout(400)
    decide.trace!.apply({ action: 'keep_title', status: 'unchanged', changed: false }); points.recordDecisionFollowUp(answer, { result: 'observed' }); await page.waitForTimeout(400)
    const row = page.locator(`[data-decision-id="${decide.trace!.decisionPointId}"]`); await row.waitFor(); assert((await row.innerText()).includes('Unchanged'))
    const count = await page.evaluate(() => (window as any).decisionsFixture.calls.length)
    await page.evaluate(() => (window as any).decisionsFixture.reconnect()); await page.waitForFunction(previous => (window as any).decisionsFixture.calls.length > previous, count)
    await row.waitFor()
    await page.evaluate(() => { const f = (window as any).decisionsFixture; f.fail(true); f.select(1) }); await page.getByText('Could not load session decisions.', { exact: true }).waitFor()
    await page.evaluate(() => (window as any).decisionsFixture.fail(false)); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.locator('[data-decision-id]').first().waitFor()
    await page.evaluate(() => { const f = (window as any).decisionsFixture; f.unsupported(true); f.select(0) }); await page.getByText(/This server does not support session decision records/).last().waitFor()
  })
  await check('Batched light/dark and narrow Chinese captures have no horizontal overflow', async () => {
    for (const [mode, lang, width] of [['light','en',1040], ['dark','en',1040], ['light','zh-Hans',480]] as const) {
      if (lang === 'zh-Hans') {
        await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}?rpc=${encodeURIComponent(`ws://127.0.0.1:${rpc.port}`)}&a=${a.id}&b=${b.id}&empty=${empty.id}&mode=${mode}&lang=${lang}`, { waitUntil: 'networkidle', timeout: 90000 }); await page.getByRole('tab', { name: '决策', exact: true }).click(); await page.locator('[data-decision-id]').first().waitFor()
      } else { await page.setViewportSize({ width, height: 1000 }); await load(`mode=${mode}&lang=${lang}`) }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (!process.env.PHANERIS_VERIFY_SKIP_SCREENSHOTS) await page.screenshot({ path: join(output, `${mode}-${lang}-${width}.png`) })
      await page.locator('[data-decision-id] button').first().click()
      if (!process.env.PHANERIS_VERIFY_SKIP_SCREENSHOTS) await page.screenshot({ path: join(output, `${mode}-${lang}-${width}-detail.png`) })
    }
    assert.deepEqual(pageErrors, [])
  })
  await check('Deleted session rejects reads and late observations cannot restore evidence', async () => {
    const deleted = await add('Delete fixture'), decide = await point('suggestions', deleted.id); await decide(request)
    await manager.deleteSession(deleted.id); decide.trace!.apply({ action: 'late', status: 'applied', changed: true })
    await assert.rejects(report(deleted.id)); assert.equal(manager.durableRuntime.storeFor(workspaceRoot).listDecisionEvents(deleted.id).length, 0)
  })
} finally {
  await browser?.close(); await vite?.close(); client.destroy(); rpc.close(); await decisions.getDecisionRecorder().flush(); manager.cleanup(); api.stop(true)
  writeFileSync(join(output, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), fixture, requests: requests.length, checks }, null, 2)+'\n')
  console.log(JSON.stringify({ output, passed: checks.filter(check => check.pass).length, total: checks.length }))
}
process.exit(checks.every(check => check.pass) ? 0 : 1)
