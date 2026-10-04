/** Real host + durable store + loopback decisions; no paid provider access. */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-decisions-integration-'))
const workspaceRoot = join(fixture, 'workspace'), configRoot = join(fixture, 'config')
mkdirSync(join(configRoot, 'permissions'), { recursive: true }); mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot; process.env.NODE_ENV = 'test'
let fail = false
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  if (fail) return new Response('fixture unavailable', { status: 503 })
  return Response.json({ model: 'fixture', answers: Object.fromEntries(Object.entries(body.questions).map(([k]) => [k, { type: 'noul', noul: .95 }])),
    usage: { input_tokens: 7, output_tokens: 3 } })
} })
const decisions = await import('../../packages/shared/src/decisions/index.ts')
const host = await import('../../packages/server-core/src/sessions/SessionManager.ts')
const storage = await import('../../packages/shared/src/sessions/storage.ts')
const workspace = { id: 'fixture', name: 'Fixture', rootPath: workspaceRoot, createdAt: Date.now() }
writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id,
  decisionLayer: { enabled: true, provider: 'custom', baseUrl: api.url.href, model: 'fixture', features: { decideTool: true } } }))
const manager = new host.SessionManager() as any
const session = await storage.createSession(workspaceRoot, { name: 'Fixture' })
const managed = host.createManagedSession(session, workspace as any, { messagesLoaded: true }) as any
manager.sessions.set(session.id, managed); manager.eventSink = () => {}
const records: any[] = []
async function check(id: string, action: () => any) {
  try { records.push({ id, pass: true, observation: await action() }) } catch (error) { records.push({ id, pass: false, error: String(error) }) }
}
try {
  await check('Success and failed decision requests both cross T1/T2 and unknown price stays unknown', async () => {
    const { openDecisionPoint, recordDecisionOutcome, recordDecisionFollowUp } = await import('../../packages/server-core/src/decisions/decision-point.ts')
    const point = await openDecisionPoint({ feature: 'decideTool', record: 'integration', sessionId: session.id })
    assert(point)
    const request = { state: 'fixture state', questions: { yes: { type: 'noul' as const, instructions: 'yes or no' } } }
    const answer = await point(request)
    assert(answer?.accountingOperationId)
    assert.equal(answer.usage.costStatus, 'unknown')
    recordDecisionOutcome(answer, { action: 'fixture', changed: true }); recordDecisionFollowUp(answer, { result: 'used' })
    fail = true; assert.equal(await point(request), null)
    await decisions.getDecisionRecorder().flush()
    const store = manager.durableRuntime.storeFor(workspaceRoot)
    const events = store.listEvents({ sessionId: session.id, afterSeq: 0, limit: 500 })
    const dispatch = events.filter((e: any) => e.type === 'model_dispatch_committed' && e.payload.purpose === 'decision')
    const outcomes = events.filter((e: any) => e.type === 'model_outcome_committed' && e.payload.purpose === 'decision')
    assert.equal(dispatch.length, 2); assert.equal(outcomes.length, 2)
    assert.equal(events.filter((e: any) => e.type === 'assistant_message_committed').length, 0)
    const usage = store.listUsage({ sessionId: session.id })
    assert.equal(usage.length, 2)
    assert.equal(usage[0].costUsd, undefined)
    assert.equal(usage[0].inputTokens, 7)
    const report = decisions.summarizeDecisionUsage(await decisions.readDecisionLog(decisions.getDecisionRecorder().path))
    const f = report.features.find(f => f.feature === 'integration')!
    assert.equal(f.unknownCostCalls, 2); assert.equal(f.followUps.used, 1)
    return { dispatch: dispatch.length, outcomes: outcomes.length, usage, feature: f }
  })
  await check('Workspace rules block a native or nested call before effects; malformed rules fail closed', async () => {
    const { evaluateToolCallRules } = await import('../../packages/shared/src/agent/core/tool-call-rules.ts')
    writeFileSync(join(workspaceRoot, 'tool-call-rules.json'), JSON.stringify({ version: 1, rules: [{ id: 'publish', tool: 'mcp__fixture__publish', reason: 'Fixture publication is blocked' }] }))
    assert.equal(evaluateToolCallRules(workspaceRoot, 'mcp__fixture__publish', {}).allowed, false)
    assert.equal(evaluateToolCallRules(workspaceRoot, 'mcp__fixture__read', {}).allowed, true)
    writeFileSync(join(workspaceRoot, 'tool-call-rules.json'), '{invalid')
    assert.equal(evaluateToolCallRules(workspaceRoot, 'mcp__fixture__read', {}).allowed, false)
  })
  await check('Legacy AgentEvent actions produce unsupported history without dispatching prompts', async () => {
    const { AutomationSystem } = await import('../../packages/shared/src/automations/automation-system.ts')
    const { readFileSync } = await import('node:fs')
    writeFileSync(join(workspaceRoot, 'automations.json'), JSON.stringify({ automations: { PreToolUse: [{ id: 'legacy-fixture', matcher: 'Read', actions: [{ type: 'prompt', prompt: 'Must never dispatch' }] }] } }))
    let dispatched = 0
    const system = new AutomationSystem({ workspaceId: workspace.id, workspaceRootPath: workspaceRoot, onPromptsReady() { dispatched++ } })
    try {
      assert.equal(await system.executeAgentEvent('PreToolUse', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }), 1)
      const entries = readFileSync(join(workspaceRoot, 'automations-history.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
      assert.equal(entries.at(-1).status, 'unsupported'); assert.equal(entries.at(-1).ok, false); assert.equal(dispatched, 0)
      return { matched: 1, dispatched, status: entries.at(-1).status }
    } finally { await system.dispose() }
  })
} finally {
  manager.cleanup(); api.stop(true)
  const output = join(root, '.cache/capability-integration/decision-governance.json')
  writeFileSync(output, JSON.stringify({ fixture, records }, null, 2)); console.log(JSON.stringify({ output, records }))
}
process.exit(records.every(r => r.pass) ? 0 : 1)
