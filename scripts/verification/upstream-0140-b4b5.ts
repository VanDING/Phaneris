/** Real decision service workflows. Loopback only; emits a repeatable report. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strict as assert } from 'node:assert'
const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-b4b5-'))
process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
process.env.NODE_ENV = 'test'
mkdirSync(process.env.PHANERIS_CONFIG_DIR, { recursive: true })
const baseline = process.argv.includes('--baseline')
const records: { id: string; pass: boolean; observation?: unknown; error?: string }[] = []
async function check(id: string, fn: () => unknown | Promise<unknown>) {
  try { records.push({ id, pass: true, observation: await fn() }) }
  catch (error) { records.push({ id, pass: false, error: String(error) }) }
}
const decisions = await import('../../packages/shared/src/decisions/index.ts')
await check('13 feature gates, original three defaults preserved, ten new defaults off', () => {
  const settings = decisions.normalizeDecisionLayerSettings()
  assert.equal(decisions.DECISION_LAYER_FEATURES.length, 13)
  assert.equal(settings.enabled, false)
  for (const key of decisions.DECISION_LAYER_FEATURES) assert.equal(settings.features[key], ['decideTool', 'taskVerdicts', 'semanticLabels'].includes(key))
  return settings
})
await check('Guarded parses and preserves four-mode child ceilings', async () => {
  const modes = await import('../../packages/shared/src/agent/mode-types.ts')
  assert.equal(modes.parsePermissionMode('guarded'), 'guarded')
  assert.equal(modes.clampPermissionMode('allow-all', 'guarded' as any), 'guarded')
  assert.equal(modes.clampPermissionMode('guarded' as any, 'ask'), 'ask')
})
await check('All seven decision channels route to the owning remote server', async () => {
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol/channels.ts')
  const routes = await import('../../packages/shared/src/protocol/routing.ts')
  for (const channel of Object.values(RPC_CHANNELS.decisions)) {
    assert(routes.REMOTE_ELIGIBLE_CHANNELS.has(channel))
    assert(!routes.LOCAL_ONLY_CHANNELS.has(channel))
  }
})
const names = ['task-verdict', 'task-repairs', 'semantic-labels', 'turn-outcome', 'automation-condition', 'smart-titles', 'permission-risks', 'large-results', 'suggestions', 'guarded-mode', 'adaptive-thinking', 'mid-turn-messages']
const modules: Record<string, any> = {}
for (const name of names) await check('Consumer available: ' + name, async () => {
  modules[name] = await import(resolve(root, 'packages/server-core/src/decisions', name + '.ts'))
})
if (!baseline) {
  let answers: Record<string, unknown> = {}
  let fail = false
  const calls: unknown[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json() as any
    calls.push({ questions: Object.keys(body.questions), state: body.state })
    if (fail) return new Response('fixture failure', { status: 503 })
    return Response.json({ model: 'fixture', answers, usage: { input_tokens: 7, output_tokens: 3 } })
  } })
  const settings = decisions.normalizeDecisionLayerSettings({ enabled: true, features: Object.fromEntries(decisions.DECISION_LAYER_FEATURES.map(key => [key, true])) })
  const recorder = new decisions.DecisionRecorder({ path: join(fixture, 'decisions.jsonl') })
  const client = new decisions.SystemOneClient({ baseUrl: api.url.href, model: 'fixture' })
  const deps = { sessionId: 'fixture-session', recorder, resolveClient: async () => ({ ok: true, value: { client, settings, provider: 'custom', keySource: 'none', endpoint: { baseUrl: api.url.href, model: 'fixture' } } } as any) }
  const noul = (noul: number) => ({ type: 'noul', noul })
  const choice = (choice: string, options: string[]) => ({ type: 'choice', choice, confidence: 0.95, probabilities: Object.fromEntries(options.map(option => [option, option === choice ? 0.98 : 0.02 / (options.length - 1)])) })
  await check('Turn outcome loopback classification and linked outcome', async () => {
    answers = { outcome: choice('needs_input', ['finished', 'needs_input', 'blocked']) }
    const result = await modules['turn-outcome'].classifyTurnOutcome({ request: 'implement', reply: 'Which account should I use?' }, deps)
    assert.equal(result?.outcome, 'needs_input')
    return result
  })
  await check('Adaptive thinking only lowers this turn', async () => {
    answers = { demand: { type: 'score', score: 0, confidence: 0.95, probabilities: { '0': 0.98, '1': 0.01, '2': 0.005, '3': 0.005 } } }
    assert.equal(await modules['adaptive-thinking'].pickTurnThinkingLevel('hello', 'max', deps), 'low')
    assert.equal(await modules['adaptive-thinking'].pickTurnThinkingLevel('hello', 'low', deps), null)
  })
  await check('Automation condition false skips; provider failure preserves run fallback', async () => {
    answers = { condition: noul(0.1) }
    assert.equal((await modules['automation-condition'].checkAutomationCondition({ question: 'Needs attention?' }, { event: 'SessionCompleted' }, deps))?.run, false)
    fail = true
    assert.equal(await modules['automation-condition'].checkAutomationCondition({ question: 'Needs attention?' }, { event: 'SessionCompleted' }, deps), null)
    fail = false
  })
  await check('Large result gate preview; failure keeps summarization', async () => {
    answers = { handling: choice('preview', ['summary', 'preview']) }
    const gate = modules['large-results'].buildLargeResultSummaryGate(deps)
    const input = { text: 'Result at top\n'.repeat(1000), context: { toolName: 'fixture' }, estimatedTokens: 7000, sessionId: 'fixture-session' }
    assert.equal(await gate(input), false)
    fail = true
    assert.equal(await gate(input), null)
    fail = false
  })
  await check('Smart title defers small talk and detects drift', async () => {
    answers = { asks_for_something: noul(0.05) }
    assert.equal(await modules['smart-titles'].isSmallTalk('hello', deps), true)
    answers = { title_fits: noul(0.05) }
    const request = modules['smart-titles'].buildTitleDriftRequest('Old topic', ['New topic'])
    answers = Object.fromEntries(Object.keys(request.questions).map(key => [key, noul(0.05)]))
    assert.equal(await modules['smart-titles'].titleNoLongerFits('Old topic', ['New topic'], deps), true)
  })
  await check('Risk badges only annotate the prompt', async () => {
    const mod = modules['permission-risks']
    answers = Object.fromEntries(Object.keys(mod.buildPermissionRiskRequest({ toolName: 'Bash', description: 'publish' }).questions).map(key => [key, noul(key === 'publishes' ? 0.95 : 0.05)]))
    assert.deepEqual(await mod.assessPermissionRisks({ toolName: 'Bash', description: 'publish' }, deps), ['publishes'])
  })
  await check('Mid-turn delivery and continuation use actual HTTP decisions', async () => {
    answers = { delivery: choice('steer', ['steer', 'queue']) }
    assert.equal(await modules['mid-turn-messages'].decideMidTurnDelivery({ runningRequest: 'build', newMessage: 'keep exports', configured: 'queue' }, deps), 'steer')
    answers = { same_request: noul(0.95) }
    assert.equal(await modules['mid-turn-messages'].isContinuation('build', 'also keep exports', deps), true)
  })
  await recorder.flush()
  await check('Decision logs contain outcomes, usage and hashes without input bodies', () => {
    const body = readFileSync(recorder.path, 'utf8')
    assert(!body.includes('Which account should I use?'))
    const summary = decisions.summarizeDecisionUsage(decisions.parseDecisionLog(body))
    assert(summary.total >= 10)
    assert(summary.features.some(feature => feature.withOutcome > 0))
    return { calls: calls.length, summary }
  })
  api.stop(true)
}
const failed = records.filter(record => !record.pass)
const out = join(root, 'docs/verification/results', baseline ? 'upstream-0.14.0-b4-b5-before.json' : 'upstream-0.14.0-b4-b5-host.json')
writeFileSync(out, JSON.stringify({ executedAt: new Date().toISOString(), baseline, fixture, total: records.length, passed: records.length - failed.length, failed: failed.length, records }, null, 2) + '\n')
console.log(`${records.length - failed.length}/${records.length} passed; ${failed.length} failed; ${out}`)
for (const failure of failed) console.log('FAIL', failure.id, failure.error)
process.exitCode = failed.length ? 1 : 0
