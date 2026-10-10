#!/usr/bin/env bun
/**
 * Written before the boundary implementation; F01–F21 are specified in the
 * companion failure matrix. This workflow exercises the real database and
 * host, including SQL fault injection and reopening without SessionManager.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { createDurableRuntime, RuntimeCommitFailure, type RuntimeDriver } from '../../packages/server-core/src/durable-runtime/index'
import { createTaskNodeReconciliationAdapter } from '../../packages/server-core/src/tasks/runtime-reconciliation'
import { auxiliaryModelEffect } from '../../packages/server-core/src/services/auxiliary-model-effect'
import { runtimeBoundaryEvidence } from './runtime-boundary-evidence'

const root = mkdtempSync(join(tmpdir(), 'phaneris-runtime-boundary-'))
const checks: Array<{ id: string; passed: boolean; detail: string }> = []
let runtime = createDurableRuntime()
const session = { sessionId: 'independent', workspaceRootPath: root }
const identity = (run: string, call: string) => ({ sessionId: session.sessionId, turnId: run,
  runOperationId: run, providerToolCallId: call, toolName: 'Write', args: { path: 'evidence.txt' } })
const accept = (run: string) => runtime.commands.acceptRun({ ...session, operationId: run, turnId: run,
  userMessageId: `${run}:input`, userMessage: 'original input' })
function check(id: string, detail: string) { checks.push({ id, passed: true, detail }) }
try {
  accept('parked')
  await runtime.effects.prepareTool(root, identity('parked', 'unknown'))
  const parked = runtime.commands.completeRun(root, 'parked', 'complete')
  assert.equal(parked.kind, 'parked')
  assert.equal(runtime.queries.operations(root, session.sessionId)[0]?.phase, 'recovery_parked')
  check('F06', 'An unsettled effect produces a parked result rather than successful termination')

  const sql = new Database(join(root, 'runtime', 'runtime.db'))
  sql.exec("CREATE TRIGGER reject_terminal BEFORE INSERT ON runtime_events WHEN NEW.event_type = 'operation_terminal' BEGIN SELECT RAISE(ABORT, 'injected terminal failure'); END")
  const handle = runtime.execution.begin(session)
  runtime.execution.accept(handle, { userMessageId: 'failed:input', userMessage: 'preserve this identity', operationId: 'failed' })
  let completed = 0
  runtime.execution.subscribe(session.sessionId, { settled: () => { completed++ } })
  const queued = { messageId: 'waiting-input', message: 'wait for a committed conclusion' }
  runtime.execution.enqueue(session.sessionId, queued)
  let dispatched = 0
  runtime.execution.setQueueDispatcher(session.sessionId, () => { dispatched++ })
  const failed = await runtime.execution.finish(handle, 'complete')
  assert.equal(failed.kind, 'commit_failed')
  assert.equal(runtime.execution.view(session.sessionId).activeRunOperationId, 'failed')
  assert.equal(completed, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(dispatched, 0)
  assert.equal(runtime.execution.queued(session.sessionId)[0], queued)
  assert.throws(() => runtime.execution.begin(session))
  sql.exec('DROP TRIGGER reject_terminal')
  const settled = await runtime.execution.finish(handle, 'complete')
  assert.equal(settled.kind, 'terminal')
  assert.equal(completed, 1)
  runtime.execution.clearQueue(session.sessionId)
  sql.close()
  check('F07', 'A failed terminal commit retains ownership and emits no success; convergence can be retried')

  const adapter = createTaskNodeReconciliationAdapter(() => [], async () => {})
  await assert.rejects(() => adapter.queryExternal!({ args: { taskSlug: 'task', runId: 'run', nodeId: 'node' } } as never), /evidence|review|unknown|absence/i)
  const child = { id: 'task-child', taskSlug: 'task', taskRunId: 'run', taskNodeId: 'node', messages: [{ id: 'cached-input', role: 'user' }] }
  const taskRequest = { args: { taskSlug: 'task', runId: 'run', nodeId: 'node' } } as never
  await assert.rejects(() => createTaskNodeReconciliationAdapter(() => [child], async () => {}).queryExternal!(taskRequest), /committed input/)
  runtime.commands.acceptRun({ workspaceRootPath: root, sessionId: child.id, operationId: 'task-child-run', userMessageId: 'canonical-task-input', userMessage: 'task input' })
  const canonicalTaskAdapter = createTaskNodeReconciliationAdapter(() => [child], async () => {}, session => {
    const event = runtime.queries.events(root, { sessionId: session.id }).find(event => event.type === 'user_message_committed')
    return event ? { id: (event.payload as { messageId: string }).messageId, role: 'user' } : undefined
  })
  assert.equal((await canonicalTaskAdapter.queryExternal!(taskRequest)).decision, 'completed')
  runtime.commands.completeRun(root, 'task-child-run', 'complete')
  check('F13', 'Absence and cached UI messages cannot authorize replay; task reconciliation requires an explicit canonical input read port')

  const old = runtime.execution.begin(session)
  runtime.execution.accept(old, { operationId: 'old', userMessageId: 'old:input', userMessage: 'old input' })
  await runtime.execution.finish(old, 'interrupted')
  const current = runtime.execution.begin(session)
  runtime.execution.accept(current, { operationId: 'current', userMessageId: 'current:input', userMessage: 'current input' })
  assert.equal(runtime.execution.isCurrent(old), false)
  assert.equal((await runtime.execution.finish(old, 'complete')).kind, 'stale')
  assert.equal(runtime.execution.view(session.sessionId).activeRunOperationId, 'current')
  let effects = 0
  const driver: RuntimeDriver = {
    async *run() { effects++; yield { type: 'complete' } },
    stop() {}, dispose() {},
  }
  runtime.execution.subscribe(session.sessionId, { event: () => { throw new Error('observer unavailable') } })
  await runtime.execution.drive(current, driver, {})
  assert.equal(effects, 1)
  assert.equal(runtime.execution.view(session.sessionId).isProcessing, false)
  check('F04/F10', 'Observer failures do not retry effects, and stale generations cannot settle the active run')

  const commitScope = { ...session, sessionId: 'required-commit' }, commitHandle = runtime.execution.begin(commitScope)
  runtime.execution.accept(commitHandle, { operationId: 'required-commit-run', userMessageId: 'required-commit-input', userMessage: 'required outcome' })
  const commitSql = new Database(join(root, 'runtime', 'runtime.db'))
  commitSql.exec("CREATE TRIGGER reject_assistant BEFORE INSERT ON runtime_events WHEN NEW.event_type = 'assistant_message_committed' BEGIN SELECT RAISE(ABORT, 'injected assistant failure'); END")
  let prematureSuccess = 0, prematureQueue = 0
  runtime.execution.subscribe(commitScope.sessionId, { event: () => {
    try { runtime.commands.commitAssistantMessage({ ...commitScope, operationId: 'required-commit-run', messageId: 'required-answer', content: 'answer', createdAt: 1 }) }
    catch (error) { throw new RuntimeCommitFailure(error) }
  }, settled: () => { prematureSuccess++ } })
  runtime.execution.enqueue(commitScope.sessionId, { messageId: 'held-after-failure', message: 'must wait' })
  runtime.execution.setQueueDispatcher(commitScope.sessionId, () => { prematureQueue++ })
  assert.equal((await runtime.execution.drive(commitHandle, driver, {})).kind, 'commit_failed')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(prematureSuccess, 0); assert.equal(prematureQueue, 0)
  assert.equal(runtime.execution.view(commitScope.sessionId).activeRunOperationId, 'required-commit-run')
  assert.throws(() => runtime.execution.begin(commitScope))
  commitSql.exec('DROP TRIGGER reject_assistant'); commitSql.close()
  check('F07/required-commit', 'Required canonical writes cannot be waived as a harmless projection failure')

  const reentrantScope = { ...session, sessionId: 'reentrant' }, reentrantHandle = runtime.execution.begin(reentrantScope)
  runtime.execution.accept(reentrantHandle, { operationId: 'reentrant-first', userMessageId: 'reentrant-input', userMessage: 'first' })
  const reentered = Promise.withResolvers<void>()
  let notified = 0
  runtime.execution.subscribe(reentrantScope.sessionId, { settled: async () => {
    if (++notified !== 1) return
    await runtime.execution.admission(reentrantScope.sessionId, async () => {
      const next = runtime.execution.begin(reentrantScope)
      runtime.execution.accept(next, { operationId: 'reentrant-next', userMessageId: 'reentrant-next-input', userMessage: 'next' })
      reentered.resolve()
    })
  } })
  await runtime.execution.drive(reentrantHandle, driver, {})
  const reentrantDeadline = setTimeout(() => reentered.reject(new Error('Reentrant observer deadlocked admission')), 1500)
  try { await reentered.promise } finally { clearTimeout(reentrantDeadline) }
  assert.equal(runtime.execution.view(reentrantScope.sessionId).activeRunOperationId, 'reentrant-next')
  await runtime.execution.finish(runtime.execution.current(reentrantScope.sessionId)!, 'interrupted')
  assert.equal(notified, 2)
  check('F10/notification', 'A completion observer can admit a new turn without deadlocking ownership or duplicating its conclusion')

  let created = 0, disposed = 0
  const initSession = 'single-initializer', ready = Promise.withResolvers<void>()
  const initDriver: RuntimeDriver = { ...driver, dispose() { disposed++ } }
  const initialize = async () => { created++; await ready.promise; runtime.execution.installDriver(initSession, initDriver); throw new Error('initialization failed') }
  const initializers = [runtime.execution.ensureDriver(initSession, initialize), runtime.execution.ensureDriver(initSession, initialize)]
  ready.resolve()
  assert.deepEqual((await Promise.allSettled(initializers)).map(result => result.status), ['rejected', 'rejected'])
  assert.equal(created, 1); assert.equal(disposed, 1)
  assert.equal(runtime.execution.view(initSession).driver, null)
  await runtime.execution.ensureDriver(initSession, async () => { created++; return initDriver })
  assert.equal(created, 2)
  assert.throws(() => runtime.execution.bindSession({ ...session, workspaceRootPath: join(root, 'foreign') }))
  check('F15/F18', 'Concurrent initialization shares one owner, disposes partial failure, permits retry, and rejects a foreign workspace binding')

  const blockedScope = { ...session, sessionId: 'parked-host' }
  const blockedHandle = runtime.execution.begin(blockedScope)
  runtime.execution.accept(blockedHandle, { operationId: 'parked-host-run', userMessageId: 'parked-host-input', userMessage: 'pending effect' })
  await runtime.effects.prepareTool(root, { ...identity('parked-host-run', 'pending'), sessionId: blockedScope.sessionId, turnId: 'parked-host-input' })
  const conclusions: string[] = []
  runtime.execution.subscribe(blockedScope.sessionId, { settled: event => { conclusions.push(`${event.result.kind}:${event.reason}`) } })
  const blockedResult = await runtime.execution.drive(blockedHandle, driver, {})
  assert.equal(blockedResult.kind, 'parked')
  assert.deepEqual(conclusions, ['parked:interrupted'])
  assert.throws(() => runtime.execution.begin(blockedScope))
  check('F06/Host', 'A driver complete with an unsettled effect cannot publish a successful task conclusion')

  const inputScope = { ...session, sessionId: 'input-recovery' }, inputHandle = runtime.execution.begin(inputScope)
  runtime.execution.accept(inputHandle, { operationId: 'input-run', userMessageId: 'original', userMessage: 'original' })
  runtime.execution.installDriver(inputScope.sessionId, { ...driver, steer: async () => ({ disposition: 'unknown' }) })
  const candidate = { messageId: 'ambiguous', message: 'retain verbatim', attachments: [{ name: 'evidence.txt' }], options: { hidden: true } }
  runtime.commands.recordUserInputAdmission({ ...inputScope, messageId: candidate.messageId, content: candidate.message, createdAt: 1,
    attachments: candidate.attachments, options: candidate.options })
  const receipt = await runtime.execution.steer(inputScope.sessionId, {}, { messageId: candidate.messageId, content: candidate.message, createdAt: 1 })
  assert.equal(receipt.disposition, 'unknown')
  await runtime.execution.finish(inputHandle, 'interrupted')
  const safe = { messageId: 'saved-only', message: 'never attempted', options: { hidden: true } }
  runtime.commands.recordUserInputAdmission({ ...inputScope, messageId: safe.messageId, content: safe.message, createdAt: 2, options: safe.options })
  assert.deepEqual(runtime.execution.recoverQueued(inputScope, [candidate, safe, { messageId: 'legacy', message: 'no receipt' }]), { queued: 1, held: 2 })
  assert.deepEqual(runtime.execution.queued(inputScope.sessionId), [safe])
  const admission = runtime.queries.events(root, { sessionId: inputScope.sessionId }).find(event => event.type === 'user_input_admitted')!
  assert.deepEqual((admission.payload as any).attachments, candidate.attachments)
  assert.deepEqual((admission.payload as any).options, candidate.options)
  check('F08/F09', 'Persisted delivery attempts hold unknown inputs; admission preserves original attachments and hidden options')

  for (const stopReason of ['length', 'error', 'aborted'] as const) {
    const scope = { ...session, sessionId: `stop-${stopReason}` }, handle = runtime.execution.begin(scope), runId = `run-${stopReason}`
    runtime.execution.accept(handle, { operationId: runId, userMessageId: `input-${stopReason}`, userMessage: 'one request' })
    if (stopReason === 'length') for (let i = 0; i < 1005; i++) runtime.effects.recordSdkObservation(root, {
      observationId: `length-progress-${i}`, sessionId: scope.sessionId, runOperationId: runId,
      event: 'progress', capturedAt: i, data: { index: i },
    })
    const request = { sessionId: scope.sessionId, turnId: `input-${stopReason}`, runOperationId: runId, providerRequestId: stopReason,
      provider: 'loopback', model: 'fixture', canonicalRequestHash: stopReason }
    const prepared = await runtime.effects.prepareModel(root, request)
    await runtime.effects.commitModelOutcome(root, { ...request, operationId: prepared.operationId, stopReason, text: 'partial answer', content: [], usage: {} })
    const result = await runtime.execution.drive(handle, driver, {})
    assert.equal(result.kind, 'terminal')
    if (result.kind === 'terminal') assert.equal(result.reason, stopReason === 'aborted' ? 'interrupted' : 'error')
    assert.equal(runtime.queries.events(root, { operationId: runId }).filter(event => event.type === 'model_dispatch_committed').length, 1)
  }
  check('F11', 'Length, error and aborted outcomes keep distinct canonical causes and never trigger automatic continuation')

  const auxiliaryScope = { ...session, sessionId: 'late-auxiliary' }, foreground = runtime.execution.begin(auxiliaryScope)
  runtime.execution.accept(foreground, { operationId: 'foreground', userMessageId: 'foreground-input', userMessage: 'foreground' })
  const release = Promise.withResolvers<{ usage: { inputTokens: number; outputTokens: number; costUsd: number } }>()
  const pending = auxiliaryModelEffect(runtime, { workspaceRoot: root, sessionId: auxiliaryScope.sessionId,
    purpose: 'image_generation', provider: 'loopback', model: 'fixture', request: { prompt: 'fixture' } }, () => release.promise,
    () => { throw new Error('deleted UI projection') })
  await new Promise(resolve => setImmediate(resolve))
  await runtime.execution.finish(foreground, 'complete')
  await runtime.execution.releaseSession(auxiliaryScope.sessionId)
  release.resolve({ usage: { inputTokens: 3, outputTokens: 2, costUsd: .01 } })
  assert.equal((await pending).usage.inputTokens, 3)
  const auxUsage = runtime.queries.usage(root, { sessionId: auxiliaryScope.sessionId })
  assert.equal(auxUsage.length, 1)
  assert.notEqual(auxUsage[0]!.operationId, 'foreground')
  assert.equal(runtime.queries.operations(root, auxiliaryScope.sessionId).length, 0)
  check('F12', 'A late paid auxiliary result survives UI deletion and an observer exception without changing the foreground checkpoint')

  const batchScope = { ...session, sessionId: 'tool-batch' }
  runtime.commands.acceptRun({ ...batchScope, operationId: 'batch-run', turnId: 'batch-input', userMessageId: 'batch-input', userMessage: 'two tools' })
  const calls = await Promise.all(['first', 'second'].map(providerToolCallId => runtime.effects.prepareTool(root, {
    sessionId: batchScope.sessionId, turnId: 'batch-input', runOperationId: 'batch-run', providerToolCallId, toolName: 'Read', args: { providerToolCallId } })))
  const outcome = async (index: number) => runtime.effects.commitToolOutcome(root, { sessionId: batchScope.sessionId,
    turnId: 'batch-input', runOperationId: 'batch-run', providerToolCallId: index ? 'second' : 'first', toolName: 'Read',
    operationId: calls[index]!.operationId, canonicalArgsHash: calls[index]!.canonicalArgsHash, result: index, isError: false })
  await assert.rejects(() => runtime.effects.commitToolOutcome(root, { sessionId: 'wrong-session', turnId: 'batch-input', runOperationId: 'batch-run',
    providerToolCallId: 'second', toolName: 'Read', operationId: calls[1]!.operationId, canonicalArgsHash: calls[1]!.canonicalArgsHash, result: 1, isError: false }))
  await outcome(1)
  assert.equal(runtime.queries.unsettledTools(root, 'batch-run').length, 1)
  await outcome(0)
  assert.equal(runtime.queries.unsettledTools(root, 'batch-run').length, 0)
  assert.equal(runtime.commands.completeRun(root, 'batch-run', 'complete').kind, 'terminal')
  check('F05/F18', 'Reverse tool completion cannot settle its unfinished sibling; an incorrect session identity is rejected')

  const before = runtime.queries.events(root, { sessionId: session.sessionId })
  const recovery = runtime.admin.recoverWorkspace(root)
  assert.ok(recovery.items.some(item => item.operationId === 'parked'))
  await runtime.close()
  runtime = createDurableRuntime()
  const after = runtime.queries.events(root, { sessionId: session.sessionId })
  assert.ok(after.length >= before.length)
  assert.equal(runtime.queries.operations(root).find(item => item.operationId === 'parked')?.phase, 'recovery_parked')
  check('F03/F16/F19', 'Recovery and canonical queries work after reopening without a session application')
  const restoreRuntime = createDurableRuntime(), restoreRoot = join(root, 'restore'), restoreScope = { sessionId: 'restore', workspaceRootPath: restoreRoot }
  restoreRuntime.commands.acceptRun({ ...restoreScope, operationId: 'backup-run', userMessageId: 'backup-input', userMessage: 'backed up' })
  restoreRuntime.commands.completeRun(restoreRoot, 'backup-run', 'complete')
  const restoreBackup = restoreRuntime.admin.backupDatabase(restoreRoot, join(root, 'restore-backup.db'))
  const restoreHandle = restoreRuntime.execution.begin(restoreScope)
  restoreRuntime.execution.accept(restoreHandle, { operationId: 'restore-active', userMessageId: 'restore-input', userMessage: 'active' })
  assert.throws(() => restoreRuntime.admin.restoreDatabase(restoreRoot, restoreBackup), /Drain/)
  await restoreRuntime.execution.finish(restoreHandle, 'interrupted')
  const restoreResult = restoreRuntime.admin.restoreDatabase(restoreRoot, restoreBackup)
  assert.equal(restoreResult.integrity.ok, true)
  assert.equal((await restoreRuntime.execution.finish(restoreHandle, 'complete')).kind, 'stale')
  assert.equal(restoreRuntime.queries.events(restoreRoot).some(event => event.operationId === 'restore-active'), false)
  await restoreRuntime.close()
  check('F21', 'Database restore requires drained execution and restores canonical facts from a verified backup')
  const closing = createDurableRuntime({ shutdownDeadlineMs: 50 }), closeScope = { ...session, sessionId: 'shutdown' }
  const closeHandle = closing.execution.begin(closeScope)
  closing.execution.accept(closeHandle, { operationId: 'shutdown-run', userMessageId: 'shutdown-input', userMessage: 'pending' })
  await closing.effects.prepareTool(root, { ...identity('shutdown-run', 'pending'), sessionId: closeScope.sessionId, turnId: 'shutdown-input' })
  const stuck: RuntimeDriver = { async *run() { await new Promise(() => {}); yield { type: 'complete' } }, stop() {}, async dispose() { await new Promise(() => {}) } }
  closing.execution.installDriver(closeScope.sessionId, stuck)
  const stuckTurn = closing.execution.drive(closeHandle, stuck, {})
  const closedAt = Date.now(), closingPromise = closing.close()
  assert.throws(() => closing.admin.start([root], () => {}), /closed/)
  assert.throws(() => closing.effects.prepareTool(root, { ...identity('shutdown-run', 'late'), sessionId: closeScope.sessionId, turnId: 'shutdown-input' }), /closed/)
  await assert.rejects(() => closing.effects.trackAuxiliary(async () => {}), /closed/)
  await closingPromise; await stuckTurn
  assert.ok(Date.now() - closedAt < 1500, 'Shutdown must have a resource deadline')
  assert.throws(() => closing.queries.events(root))
  await assert.rejects(() => closing.execution.admission(closeScope.sessionId, async () => {}))
  assert.equal(runtime.queries.operations(root, closeScope.sessionId)[0]?.phase, 'recovery_parked')
  check('F19', 'Non-cooperative resources cannot hang shutdown or reopen a closed database; unknown effects retain recovery evidence')
  const outputDir = resolve(import.meta.dir, '../../docs/verification/results/durable-runtime-boundary')
  mkdirSync(outputDir, { recursive: true })
  const backup = runtime.admin.backupDatabase(root, join(root, 'workflow-backup.db'))
  const db = join(outputDir, 'workflow.db')
  writeFileSync(db, readFileSync(backup))
  const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), command: 'bun run scripts/verification/durable-runtime-boundary-workflow.ts',
    ...runtimeBoundaryEvidence('bun run scripts/verification/durable-runtime-boundary-workflow.ts', root), checks,
    eventTrace: runtime.queries.events(root), operations: runtime.queries.operations(root), usage: runtime.queries.usage(root),
    database: { path: db, sha256: createHash('sha256').update(readFileSync(db)).digest('hex') } }
  writeFileSync(join(outputDir, 'workflow.json'), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify({ passed: checks.length, output: join(outputDir, 'workflow.json') }))
} finally { await runtime.close() }
