/** B5 failure matrix: actual Pi 1.0.2 journal -> 1.1.0 resume, branch cutoff, manual compaction and restart. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-pi-history-'))
const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3)
const currentEntry = process.env.PHANERIS_VERIFY_PI_ENTRY ?? join(root, 'packages/pi-agent-server/dist/index.js')
const baselineEntry = arg('baseline-entry')
if (!baselineEntry) throw Error('Pass --baseline-entry with a verified Pi 1.0.2 subprocess bundle')
const output = resolve(arg('output') ?? join(root, '.cache/pi-110-implementation/history-final.json'))
process.env.PHANERIS_CONFIG_DIR = fixture; process.env.NODE_ENV = 'test'
const requests: any[] = [], effects: any[] = [], checks: any[] = [], agents: any[] = []
let seq = 0
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any, text = JSON.stringify(body.messages)
  requests.push({ model: body.model, before: text.includes('BASELINE_BEFORE_EVIDENCE'), after: text.includes('BASELINE_AFTER_EVIDENCE'), compacted: text.includes('COMPACTED_STATE_42') })
  const event = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: `history-${requests.length}`, object: 'chat.completion.chunk',
    created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: Math.ceil(text.length / 4), completion_tokens: 10, total_tokens: Math.ceil(text.length / 4) + 10 } } : {}) })}\n\n`
  const reply = text.includes('Preserve fixture evidence') ? 'COMPACTED_STATE_42 fixture summary' : 'NORMAL_HISTORY_REPLY fixture complete'
  return new Response(event({ role: 'assistant' }) + event({ content: reply }) + event({}, 'stop') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } })
} })
const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
const workspace = join(fixture, 'workspace')
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const sessionPath = (id: string) => join(workspace, 'sessions', id)
function fileFor(id: string) {
  const directory = join(sessionPath(id), '.pi-sessions')
  const file = readdirSync(directory, { recursive: true }).find(name => String(name).endsWith('.jsonl'))
  assert(file, 'Native session file missing'); return join(directory, String(file))
}
function make(id: string, entry = currentEntry, branch?: Record<string, unknown>) {
  mkdirSync(sessionPath(id), { recursive: true })
  const agent = new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture',
    workspace: { id: 'history', name: 'History fixture', rootPath: workspace },
    session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1, ...branch }, isHeadless: true, contextPolicy: 'manual',
    runtime: { paths: { piServer: entry, node: process.env.PHANERIS_VERIFY_PI_BUN ?? process.execPath },
      baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
    envOverrides: { HOME: fixture, USERPROFILE: fixture, PHANERIS_CONFIG_DIR: fixture, NODE_ENV: 'test' },
    beginDurableUtilityRun: () => ({ runOperationId: `utility-${++seq}`, turnId: `utility-${seq}` }),
    durableModelBoundary: { prepare: async (request: any) => { effects.push({ phase: 'T1', ...request }); return { operationId: `model-${++seq}`, idempotencyKey: `model-${seq}`, created: true, status: 'prepared', committedSeq: seq } },
      commitOutcome: async (request: any) => { effects.push({ phase: 'T2', ...request }); return { committedSeq: ++seq } } },
  } as any) as any
  agent.wire = []
  const handle = agent.handleLine.bind(agent)
  agent.handleLine = (line: string) => { try { agent.wire.push(JSON.parse(line)) } catch {} return handle(line) }
  agents.push(agent); return agent
}
async function until(done: () => boolean) {
  const deadline = Date.now() + 30000
  while (!done()) { if (Date.now() > deadline) throw Error('History workflow deadline'); await Bun.sleep(10) }
}
async function turn(agent: any, message: string) {
  await agent.ensureSubprocess(); const start = agent.wire.length
  agent.send({ type: 'prompt', id: `turn-${++seq}`, message, systemPrompt: 'History fixture', durableRunOperationId: `run-${seq}` })
  await until(() => agent.wire.slice(start).some((m: any) => m.type === 'event' && m.event?.type === 'agent_settled'))
  assert(!agent.wire.slice(start).some((m: any) => m.type === 'error'))
}
async function check(id: string, action: () => unknown | Promise<unknown>) {
  try { checks.push({ id, pass: true, observation: await action() }) }
  catch (error) { checks.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }) }
}
try {
  const legacy = make('parent', baselineEntry)
  await turn(legacy, 'BASELINE_BEFORE_EVIDENCE ' + 'earlier context '.repeat(6500))
  await turn(legacy, 'BASELINE_AFTER_EVIDENCE ' + 'later context '.repeat(6500))
  const oldSessionId = legacy.piSessionId
  await legacy.disposeForRestart()
  const original = readFileSync(fileFor('parent'), 'utf8')
  const entries = original.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const anchor = entries.find(entry => entry.type === 'message' && entry.message?.role === 'assistant')?.id
  assert(anchor)
  const current = make('parent')
  await check('Pi 1.1.0 restores a real 1.0.2 journal without losing its identity or previous messages', async () => {
    await turn(current, 'Resume the existing history')
    assert.equal(current.piSessionId, oldSessionId)
    assert(requests.at(-1).before && requests.at(-1).after)
    assert.equal(requests.slice(0, 2).some(request => request.compacted), false)
    assert(readFileSync(fileFor('parent'), 'utf8').startsWith(original))
    return { oldSessionId, restoredSessionId: current.piSessionId, baselineSha256: hash(original), anchor }
  })
  await check('A real host branch uses the selected SDK cutoff and leaves the parent intact', async () => {
    const parentBefore = readFileSync(fileFor('parent'))
    const branch = make('branch', currentEntry, { branchFromMessageId: 'host-fixture-anchor', branchFromSessionPath: sessionPath('parent'),
      branchFromSdkSessionId: oldSessionId, branchFromSdkTurnId: anchor })
    await branch.ensureBranchReady(); assert.notEqual(branch.piSessionId, oldSessionId)
    await turn(branch, 'Continue from the selected earlier reply')
    assert(requests.at(-1).before); assert.equal(requests.at(-1).after, false)
    assert.equal(hash(readFileSync(fileFor('parent'))), hash(parentBefore))
    await branch.disposeForRestart()
    return { branchSessionId: branch.piSessionId, parentSha256: hash(parentBefore), afterCutoffExcluded: true }
  })
  await check('Manual compaction crosses the real provider and durable model boundary and survives restart', async () => {
    const beforeRequests = requests.length, beforeEffects = effects.length
    const compact = await current.requestCompact('Preserve fixture evidence')
    assert(compact.summary.includes('COMPACTED_STATE_42'))
    assert(requests.length > beforeRequests)
    assert(effects.slice(beforeEffects).some(effect => effect.phase === 'T1'))
    assert(effects.slice(beforeEffects).some(effect => effect.phase === 'T2'))
    assert(readFileSync(fileFor('parent'), 'utf8').includes('"type":"compaction"'))
    const idBefore = current.piSessionId
    await current.disposeForRestart()
    const restarted = make('parent')
    await turn(restarted, 'Continue after compacting')
    assert.equal(restarted.piSessionId, idBefore); assert(requests.at(-1).compacted)
    return { tokensBefore: compact.tokensBefore, estimatedTokensAfter: compact.estimatedTokensAfter, sessionId: idBefore }
  })
} finally {
  for (const agent of agents) { await agent.disposeForRestart(); agent.destroy() }
  api.stop(true)
}
mkdirSync(resolve(output, '..'), { recursive: true })
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), fixture, baselineEntry, currentEntry, scope: 'Real saved 1.0.2 sessions, Pi host/child and loopback provider; synthetic inference.',
  checks, requests, modelPreparations: effects.filter(e => e.phase === 'T1').length, modelOutcomes: effects.filter(e => e.phase === 'T2').length }, null, 2) + '\n')
console.log(JSON.stringify({ output, passed: checks.filter(c => c.pass).length, total: checks.length, failures: checks.filter(c => !c.pass) }))
process.exit(checks.every(check => check.pass) ? 0 : 1)
