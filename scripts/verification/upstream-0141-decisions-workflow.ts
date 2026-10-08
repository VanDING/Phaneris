/** Failure matrix precedes implementation. Real host, decision HTTP, logs and authenticated RPC. */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-0141-decisions-'))
const workspaceRoot = join(fixture, 'workspace'), configRoot = join(fixture, 'config')
mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot; process.env.NODE_ENV = 'test'
const requests: any[] = [], checks: any[] = []
let correction = 0, consequential = 0, delay = 0, omitGuard = false
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any; requests.push(body)
  if (delay) await Bun.sleep(delay)
  return Response.json({ model: body.model, answers: Object.fromEntries(Object.entries(body.questions).filter(([key]) => !(omitGuard && key === 'consequential')).map(([key, q]: any) => [key,
    q.type === 'score' ? { type: 'score', score: 0, confidence: .97, probabilities: { '0': .97, '1': .01, '2': .01, '3': .01 } }
      : q.type === 'choice' ? { type: 'choice', choice: 'none', confidence: .95, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === 'none' ? 1 : 0])) }
        : { type: 'noul', noul: key === 'corrects_previous' ? correction : key === 'consequential' ? consequential : .95 }])), usage: { input_tokens: 7, output_tokens: 3 } })
} })
const decisions = await import('../../packages/shared/src/decisions/index.ts')
const host = await import('../../packages/server-core/src/sessions/SessionManager.ts')
const storage = await import('../../packages/shared/src/sessions/storage.ts')
const points = await import('../../packages/server-core/src/decisions/decision-point.ts')
const workspace = { id: 'fixture', name: 'Fixture', rootPath: workspaceRoot, createdAt: Date.now() }
writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id,
  decisionLayer: { enabled: true, provider: 'custom', baseUrl: api.url.href, model: 'fixture', features: { adaptiveThinking: true, suggestions: true, decideTool: true } } }))
const manager = new host.SessionManager() as any
const session = await storage.createSession(workspaceRoot, { name: 'Fixture' })
const managed = host.createManagedSession(session, workspace as any, { messagesLoaded: true }) as any
manager.sessions.set(session.id, managed); manager.eventSink = () => {}
managed.isProcessing = true; managed.processingGeneration = 1; managed.thinkingLevel = 'max'
async function check(id: string, run: () => any) { try { checks.push({ id, pass: true, observation: await run() }) } catch (e) { checks.push({ id, pass: false, error: String(e) }) } }
async function until(f: () => boolean, ms = 10000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw Error('Workflow deadline'); await Bun.sleep(10) } }
try {
  await check('auth retry reuses thinking and suggestion without another paid decision', async () => {
    managed.turnThinkingOverride = 'medium'; managed.turnSuggestionHint = 'inert suggestion'
    const before = requests.length
    const retry = await manager.startPreTurnDecisions(managed, 'same durable input', {}, { authRetry: true })
    assert.deepEqual(retry, { thinkingOverride: 'medium', suggestionHint: 'inert suggestion' }); assert.equal(requests.length, before)
    return { additionalRequests: requests.length - before }
  })
  await check('hidden and unattended turns remain excluded', async () => {
    assert.equal(manager.startPreTurnDecisions(managed, 'internal prompt', { hidden: true }), null)
    managed.taskRunId = 'task'; assert.equal(manager.startPreTurnDecisions(managed, 'task work'), null); managed.taskRunId = undefined
  })
  await check('cold budgets are scoped to endpoint/model/connection and obey explicit deadlines', async () => {
    let now = 100000, slug = 'one', model = 'cold-fixture'
    const deadlines: number[] = []
    const recorder = new decisions.DecisionRecorder({ path: join(fixture, 'cold.jsonl') })
    const make = async (explicit = false) => points.openDecisionPoint({ feature: 'decideTool', record: 'cold-fixture', recorder, now: () => now, maxDeadlineMs: 3000,
      resolveClient: async () => {
        const resolved = await decisions.resolveDecisionClient({ feature: 'decideTool' }); assert(resolved.ok)
        const native = new decisions.SystemOneClient({ baseUrl: api.url.href, model })
        return { ok: true, value: { ...resolved.value, deadlineIsExplicit: explicit, settings: { ...resolved.value.settings, connectionSlug: slug }, endpoint: { ...resolved.value.endpoint, model }, client: { decide: (req: any, signal: any) => { deadlines.push(req.deadlineMs); return native.decide(req, signal) } } as any } }
      } })
    const request = { state: 'fixture', questions: { q: { type: 'noul' as const, instructions: 'fixture' } } }
    const one = (await make())!; await one(request); await one(request)
    slug = 'two'; const two = (await make())!; await two(request)
    await two({ ...request, deadlineMs: 120 })
    model = 'another-model'; await (await make(true))!(request)
    now += 30001; await one(request)
    assert.deepEqual(deadlines, [2800, 1500, 2800, 120, 1500, 2800])
    await recorder.flush()
    const lines = await decisions.readDecisionLog(recorder.path)
    assert.deepEqual(lines.map((r: any) => r.coldStart), [true, false, true, false, true, true])
    return { deadlines }
  })
  if (!process.argv.includes('--b2')) {
    await check('missing guard answers preserve the cap; follow-ups refer only to the immediately rated reply', async () => {
      omitGuard = true
      assert.equal((await manager.startPreTurnDecisions(managed, 'routine')).thinkingOverride, null)
      omitGuard = false
      managed.messages = [{ id: 'first-user', role: 'user', content: 'routine' }]
      await manager.startPreTurnDecisions(managed, 'routine')
      managed.messages.push({ id: 'reply', role: 'assistant', content: 'final answer' }, { id: 'second-user', role: 'user', content: 'wrong' })
      correction = .9
      await manager.startPreTurnDecisions(managed, 'wrong')
      await decisions.getDecisionRecorder().flush()
      const lines = await decisions.readDecisionLog(decisions.defaultDecisionsLogPath())
      const followUps = lines.filter((line: any) => line.kind === 'followup' && line.feature === 'adaptive_thinking') as any[]
      assert.equal(followUps.length, 1); assert.equal(followUps[0].result, 'correction_likely')
      manager.startPreTurnDecisions(managed, 'hidden', { hidden: true })
      await manager.startPreTurnDecisions(managed, 'another user')
      await decisions.getDecisionRecorder().flush()
      const after = (await decisions.readDecisionLog(decisions.defaultDecisionsLogPath())).filter((line: any) => line.kind === 'followup' && line.feature === 'adaptive_thinking')
      assert.equal(after.length, 1)
      correction = 0
    })
    await check('thinking reads final reply tail and attachment metadata; correction and consequential floor respect user cap', async () => {
      managed.messages = [{ role: 'assistant', isIntermediate: false, content: 'prefix'.repeat(500) + 'TAIL EVIDENCE' }]
      const attachment = { name: '模型.xlsx', type: 'document', size: 4096, base64: 'PRIVATE_ATTACHMENT_BODY' }
      correction = .9
      const corrected = await manager.startPreTurnDecisions(managed, '不对，请按附件重新算', {}, { attachments: [attachment] })
      assert.equal(corrected.thinkingOverride, null)
      const state = requests.findLast(r => r.questions.demand).state
      assert(state.previous_assistant_reply.endsWith('TAIL EVIDENCE')); assert(state.previous_assistant_reply.length <= 1201)
      assert(JSON.stringify(state.attachments).includes('模型.xlsx')); assert(!JSON.stringify(state).includes(attachment.base64))
      correction = 0; consequential = .9
      assert.equal((await manager.startPreTurnDecisions(managed, '发布到生产')).thinkingOverride, 'high')
      managed.thinkingLevel = 'low'
      assert.equal((await manager.startPreTurnDecisions(managed, '发布到生产')).thinkingOverride, null)
      managed.thinkingLevel = 'max'; consequential = 0
      return { attachmentMetadataOnly: true, correctionKeepsCap: true, consequentialFloor: 'high' }
    })
    await check('a late thinking answer cannot override a stopped turn or a user lower cap', async () => {
      delay = 100
      const stopped = manager.startPreTurnDecisions(managed, 'routine')
      managed.stopRequested = true
      assert.deepEqual(await stopped, { thinkingOverride: null, suggestionHint: null })
      managed.stopRequested = false
      const lowered = manager.startPreTurnDecisions(managed, 'routine')
      managed.thinkingLevel = 'off'
      assert.equal((await lowered).thinkingOverride, null)
      managed.thinkingLevel = 'max'; delay = 0
    })
  }
  await check('rotated logs deduplicate outcomes and preserve zero versus unknown cost', async () => {
    const path = join(fixture, 'usage.jsonl'), t = new Date().toISOString()
    const call = { id: 'one', t, feature: 'adaptive_thinking', provider: 'custom', model: 'fixture', ok: true, questions: {}, state: null, coldStart: true }
    const outcome = { t, feature: 'adaptive_thinking', kind: 'outcome', decisionId: 'one', action: 'keep', changed: false }
    writeFileSync(decisions.previousDecisionsLogPath(path), JSON.stringify(call) + '\n' + JSON.stringify(outcome) + '\n')
    writeFileSync(path, [call, outcome, { ...call, id: 'two', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }].map(r => JSON.stringify(r)).join('\n'))
    const report = await decisions.readDecisionUsageReport(new Date(Date.now() - 7 * 86400000), path)
    const f = report.features.adaptiveThinking
    assert.equal(f.calls, 2); assert.equal(f.withOutcome, 1); assert.equal(f.changed, 0); assert.equal(f.unknownCostCalls, 1); assert.equal(f.knownCostUsd, 0)
    assert.equal(report.features.largeResults, undefined); assert.equal(report.retentionLimited, true)
    return report
  })
  await check('authenticated remote usage reads only target-server records', async () => {
    const { WsRpcClient } = await import('../../packages/server-core/src/transport/client.ts')
    const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol/channels.ts')
    const remote = join(fixture, 'remote'); mkdirSync(remote, { recursive: true })
    const entry = join(fixture, 'remote.ts')
    const importer = (p: string) => JSON.stringify(pathToFileURL(join(root, p)).href)
    writeFileSync(entry, `const {WsRpcServer}=await import(${importer('packages/server-core/src/transport/server.ts')});
      const {registerDecisionsHandlers}=await import(${importer('packages/server-core/src/handlers/rpc/decisions.ts')});
      const {getDecisionRecorder}=await import(${importer('packages/shared/src/decisions/records.ts')});
      await getDecisionRecorder().append({id:'remote-only',t:new Date().toISOString(),feature:'smart_titles',provider:'custom',model:'fixture',ok:true,questions:{},state:null});
      const server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async t=>t==='fixture-token'});
      registerDecisionsHandlers(server,{}); await server.listen(); console.log(JSON.stringify({port:server.port}));`)
    const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, PHANERIS_CONFIG_DIR: remote }, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
    let port = 0; child.stdout.on('data', b => { for (const line of String(b).split('\n')) { try { port = JSON.parse(line).port || port } catch {} } })
    let good: any, bad: any
    try {
      await until(() => port > 0)
      good = new WsRpcClient(`ws://127.0.0.1:${port}`, { mode: 'remote', token: 'fixture-token', autoReconnect: false })
      bad = new WsRpcClient(`ws://127.0.0.1:${port}`, { mode: 'remote', token: 'wrong', autoReconnect: false, connectTimeout: 500 })
      good.connect(); bad.connect(); await until(() => good.isConnected)
      await assert.rejects(bad.invoke(RPC_CHANNELS.decisions.GET_USAGE))
      const report = await good.invoke(RPC_CHANNELS.decisions.GET_USAGE)
      assert.equal(report.features.smartTitles.calls, 1); assert.equal(report.features.adaptiveThinking, undefined)
      return { remoteCalls: 1, unauthorizedRejected: true }
    } finally { good?.destroy(); bad?.destroy(); child.kill() }
  })
} finally { await decisions.getDecisionRecorder().flush(); manager.cleanup(); api.stop(true) }
const output = resolve(process.argv.find(a => a.endsWith('.json')) ?? join(root, '.cache/pi-110-implementation/decisions-0141.json'))
mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: 'upstream-0141-decisions-v1', checks }, null, 2) + '\n')
console.log(JSON.stringify({ output, checks })); process.exit(checks.every(c => c.pass) ? 0 : 1)
