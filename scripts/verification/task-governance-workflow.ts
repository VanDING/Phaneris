/** Conductor workflow with persisted DAG/output/run log and deterministic session driver. */
import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { TaskRunner } from '../../packages/server-core/src/tasks/TaskRunner.ts'
import { parseTaskSpec, saveTaskSpec, readRunLog } from '../../packages/shared/src/tasks/index.ts'
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-task-governance-')), records: any[] = []
const listeners = new Set<(evt: any) => void>(), sent: Array<{ sessionId: string; message: string }> = [], usage = new Map<string, any>()
const host = { async createSession(_workspace: string, options: any) { return { id: `session-${options.name}` } },
  async sendMessage(sessionId: string, message: string) { sent.push({ sessionId, message }) }, async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
  onSessionComplete(fn: any) { listeners.add(fn); return () => listeners.delete(fn) }, getSessionFinalText() { return undefined }, getSessionWorkingDirectory() { return fixture }, getSessionTokenUsage(id: string) { return usage.get(id) } }
const tick = () => new Promise(resolve => setTimeout(resolve, 25))
const complete = async (sessionId: string, finalText: string) => { for (const listener of [...listeners]) listener({ sessionId, workspaceId: 'fixture', reason: 'complete', finalText, tokenUsage: usage.get(sessionId) }); await tick() }
async function check(id: string, fn: () => any) { try { records.push({ id, pass: true, observation: await fn() }) } catch (e) { records.push({ id, pass: false, error: String(e) }) } }
await check('Repeated failed verification with identical outputs stops the configured no-progress loop', async () => {
  const parsed = parseTaskSpec({ id: 'stalled', title: 'Stalled', goal: 'fixture', max_iterations: 8, max_no_progress: 2, nodes: [{ id: 'a', prompt: 'fixture' }] }); assert(parsed.success)
  saveTaskSpec(fixture, parsed.data)
  const runner = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: fixture })
  runner.run('stalled', { runId: 'r1', orchestratorSessionId: 'orchestrator' })
  await tick(); await complete('session-a', 'same output'); await complete('orchestrator', 'VERDICT: FAIL — missing result')
  await complete('session-a', 'same output'); await complete('orchestrator', 'VERDICT: FAIL — missing result')
  const snapshot = runner.getRunState('stalled', 'r1')!; assert.equal(snapshot.status, 'failed')
  const log = readRunLog(fixture, 'stalled', 'r1'); assert(log.some(e => e.kind === 'budget-breach' && e.metric === 'no_progress'))
  return { status: snapshot.status, log }
})
await check('Auxiliary decision tokens are added once to the owning task session budget', async () => {
  sent.length = 0
  const parsed = parseTaskSpec({ id: 'budgeted', title: 'Budget', goal: 'fixture', token_budget: 15, nodes: [{ id: 'b', prompt: 'fixture' }, { id: 'c', prompt: 'fixture', depends_on: ['b'] }] }); assert(parsed.success)
  saveTaskSpec(fixture, parsed.data)
  const runner = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: fixture, classifyNodeOutcome: async (_text, context) => {
    assert.equal(context.sessionId, 'session-b'); usage.set(context.sessionId!, { totalTokens: 20 }); return 'finished'
  } })
  usage.set('session-b', { totalTokens: 10 }); runner.run('budgeted', { runId: 'r2', verifyOnComplete: false })
  await tick(); await complete('session-b', 'done')
  const snapshot = runner.getRunState('budgeted', 'r2')!; assert.equal(snapshot.status, 'paused')
  assert(!sent.some(entry => entry.sessionId === 'session-c'))
  await runner.stop('budgeted', 'r2'); return { status: snapshot.status, tokens: snapshot.tokensUsed }
})
await check('Run budget survives restart and excludes pre-run orchestrator history', async () => {
  sent.length = 0
  const parsed = parseTaskSpec({ id: 'resumed', title: 'Resume', goal: 'fixture', token_budget: 25, nodes: [{ id: 'd', prompt: 'fixture' }, { id: 'e', prompt: 'fixture', depends_on: ['d'] }] }); assert(parsed.success)
  saveTaskSpec(fixture, parsed.data); usage.set('old-orchestrator', { totalTokens: 1000 }); usage.set('session-d', { totalTokens: 10 })
  const first = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: fixture })
  first.run('resumed', { runId: 'r3', orchestratorSessionId: 'old-orchestrator' }); await tick()
  first.pause('resumed', 'r3'); await complete('session-d', 'done')
  assert.equal(first.getRunState('resumed', 'r3')!.tokensUsed, 10)
  // Detach the simulated old process, retain the real persisted run log.
  listeners.clear()
  const restored = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: fixture })
  restored.resume('resumed', 'r3'); await tick()
  assert.equal(restored.getRunState('resumed', 'r3')!.tokensUsed, 10)
  usage.set('session-e', { totalTokens: 5 }); await complete('session-e', 'done')
  usage.set('old-orchestrator', { totalTokens: 1005 }); await complete('old-orchestrator', 'VERDICT: PASS')
  const snapshot = restored.getRunState('resumed', 'r3')!; assert.equal(snapshot.tokensUsed, 20); assert.equal(snapshot.status, 'completed')
  return { status: snapshot.status, tokens: snapshot.tokensUsed, previousHistory: 1000 }
})
const output = resolve(import.meta.dir, '../../.cache/capability-integration/task-governance.json')
writeFileSync(output, JSON.stringify({ fixture, records }, null, 2)); console.log(JSON.stringify({ output, records })); process.exit(records.every(r => r.pass) ? 0 : 1)
