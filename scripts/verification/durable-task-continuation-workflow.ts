/** RC15–RC16: actual DAG scheduling and persisted run logs across restart, with a controlled session host. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { TaskRunner, type ConductorSessionHost } from '../../packages/server-core/src/tasks/TaskRunner'
import { parseTaskSpec, saveTaskSpec, appendRunLog, readRunLog } from '../../packages/shared/src/tasks'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('durable-task-continuation', async evidence => {
  const checks: string[] = []
  for (const mode of ['completed', 'interrupted', 'created-before-receipt', 'fact-outage'] as const) {
    const root = join(evidence.directory, mode)
    const parsed = parseTaskSpec({ id: 'continuity', title: 'Continuity', goal: 'Resume pending work', defaults: { permissionMode: 'safe' }, nodes: [{ id: 'a', prompt: 'ORIGINAL_TASK' }, { id: 'b', depends_on: ['a'], prompt: 'Use ${nodes.a.output}' }] })
    assert(parsed.success); saveTaskSpec(root, parsed.data)
    const listeners = new Set<(evt: any) => void>(), sent: { id: string; text: string }[] = [], facts: any[] = []
    let creates = 0, failing = mode === 'fact-outage'
    const child = { id: 'existing-child', hasInput: mode !== 'created-before-receipt', processing: false,
      ...(mode === 'completed' ? { finalText: 'EXISTING_VERIFIED_OUTPUT' } : {}) }
    const host: ConductorSessionHost = {
      async createSession(_workspace, options) { creates++; return { id: `new-${options.taskNodeId}` } },
      async sendMessage(id, text) { sent.push({ id, text }) },
      async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
      onSessionComplete(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      getSessionFinalText() { return undefined }, getSessionWorkingDirectory() { return root },
      async prepareTaskNodeDispatch(input) { return { durableSessionId: 'parent', runOperationId: input.nodeId, operationId: `dispatch-${input.nodeId}`, providerToolCallId: input.nodeId, canonicalArgsHash: 'hash', created: input.nodeId !== 'a' } },
      async commitTaskNodeDispatch() { if (failing) throw new Error('fixture fact outage') },
      commitTaskRunFact(input) { if (failing) throw new Error('fixture fact outage'); facts[input.ordinal] = input.entry },
      listTaskRunFacts() { return facts.filter(Boolean) },
      async findTaskNodeSession(input) { return input.nodeId === 'a' ? child : undefined },
    }
    const started = { kind: 'run-started' as const, taskId: 'continuity', runId: 'run', t: new Date().toISOString(), orchestratorSessionId: 'parent' }
    appendRunLog(root, 'continuity', 'run', started); facts.push(started)
    appendRunLog(root, 'continuity', 'run', { kind: 'node-scheduled', nodeId: 'a', t: new Date().toISOString() })
    if (mode !== 'created-before-receipt') appendRunLog(root, 'continuity', 'run', { kind: 'node-spawned', nodeId: 'a', sessionId: child.id, t: new Date().toISOString() })
    // Ledger intentionally has only the first entry: a stale nonempty projection must not hide the native tail.
    const runner = new TaskRunner({ workspaceRoot: root, workspaceId: 'fixture', host })
    runner.resume('continuity', 'run')
    const tick = () => new Promise(resolve => setTimeout(resolve, 30))
    await tick()
    if (mode === 'completed') {
      assert(!sent.some(item => item.id === child.id)); assert.equal(creates, 1)
      assert(sent.some(item => item.id === 'new-b' && item.text.includes('EXISTING_VERIFIED_OUTPUT')))
    } else {
      assert.equal(creates, 0); assert.equal(sent.length, 1); assert.equal(sent[0]!.id, child.id)
      assert(sent[0]!.text.includes('ORIGINAL_TASK'))
      if (child.hasInput) assert.match(sent[0]!.text, /recover|continu|恢复/i)
      failing = false
      for (const fn of [...listeners]) fn({ sessionId: child.id, workspaceId: 'fixture', reason: 'complete', finalText: 'RECOVERED_OUTPUT' })
      await tick(); assert.equal(creates, 1)
      assert(sent.some(item => item.id === 'new-b' && item.text.includes('RECOVERED_OUTPUT')))
    }
    for (const fn of [...listeners]) fn({ sessionId: 'new-b', workspaceId: 'fixture', reason: 'complete', finalText: 'DONE' })
    await tick()
    for (const fn of [...listeners]) fn({ sessionId: 'parent', workspaceId: 'fixture', reason: 'complete', finalText: 'VERDICT: PASS' })
    await tick(); assert.equal(runner.getRunState('continuity', 'run')!.status, 'completed')
    const log = readRunLog(root, 'continuity', 'run')
    assert.equal(facts.length, log.length)
    evidence.json(`${mode}.json`, { sent, creates, facts, log, snapshot: runner.getRunState('continuity', 'run') })
    checks.push(`RC15/RC16 ${mode}: reuse child, preserve output and automatically backfill task facts`)
  }
  evidence.complete(checks, ['Controlled child host; actual TaskRunner scheduler, file scopes, JSONL, output files, restart and verification flow. Live model quality is not measured.'])
})
