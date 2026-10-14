import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { verificationWorkflow } from './verification-artifacts'

const workspace = process.argv[2] === '--reopen' ? process.argv[3]! : undefined
if (workspace) {
  const { readSessionReliabilityReport } = await import('../../packages/server-core/src/observability/reliability-report')
  const runtime = createDurableRuntime()
  console.log(JSON.stringify(readSessionReliabilityReport(runtime, workspace, 'reliability', 2_000_000_000_000)))
  await runtime.close()
} else await verificationWorkflow('runtime-reliability', async run => {
  const ws = join(run.directory, 'workspace'); mkdirSync(ws)
  const runtime = createDurableRuntime(), sessionId = 'reliability', runOperationId = 'run'
  runtime.commands.acceptRun({ workspaceRootPath: ws, sessionId, operationId: runOperationId, turnId: 'input', userMessageId: 'input', userMessage: 'reliability' })
  for (const toolName of ['Write', 'Read']) for (let i = 0; i < 3; i++) {
    const request = { sessionId, runOperationId, providerToolCallId: `${toolName}-${i}`, toolName, args: { path: 'same.txt', content: 'same' } }
    const prepared = await runtime.effects.prepareTool(ws, request)
    await runtime.effects.commitToolOutcome(ws, { ...request, operationId: prepared.operationId, canonicalArgsHash: prepared.canonicalArgsHash, result: toolName === 'Write' ? { error: 'Permission denied' } : 'poll result', isError: toolName === 'Write' })
  }
  for (const event of ['auto_retry_start', 'auto_compaction_end']) runtime.effects.recordSdkObservation(ws, { sessionId, runOperationId, observationId: event, event, capturedAt: Date.now(), data: {} })
  for (let index = 0; index < 1002; index++) runtime.effects.recordSdkObservation(ws, { sessionId, runOperationId, observationId: `retained-${index}`, event: 'diagnostic', capturedAt: Date.now(), data: {} })
  const { TaskRuntimeFacts } = await import('../../packages/server-core/src/tasks/runtime-facts')
  const facts = new TaskRuntimeFacts(runtime)
  facts.commitTaskRunFact({ workspaceRootPath: ws, sessionId, taskSlug: 'budget', runId: 'one', ordinal: 0, entry: { t: new Date().toISOString(), kind: 'run-started', taskId: 'budget', runId: 'one', tokenBudget: 500 } })
  facts.commitTaskRunFact({ workspaceRootPath: ws, sessionId, taskSlug: 'budget', runId: 'one', ordinal: 1, entry: { t: new Date().toISOString(), kind: 'usage-observed', sessionId, totalTokens: 120, tokensUsed: 120 } })
  runtime.commands.completeRun(ws, 'run', 'error')
  runtime.commands.acceptRun({ workspaceRootPath: ws, sessionId, operationId: 'unknown', turnId: 'input2', userMessageId: 'input2', userMessage: 'unknown effect' })
  await runtime.effects.prepareTool(ws, { sessionId, runOperationId: 'unknown', providerToolCallId: 'unknown', toolName: 'Write', args: { path: 'unknown.txt' } })
  const secondRequest = { sessionId, runOperationId: 'unknown', providerToolCallId: 'settled-sibling', toolName: 'Write', args: { path: 'settled.txt' } }
  const sibling = await runtime.effects.prepareTool(ws, secondRequest)
  await runtime.effects.commitToolOutcome(ws, { ...secondRequest, operationId: sibling.operationId, canonicalArgsHash: sibling.canonicalArgsHash, isError: false, result: 'done' })
  runtime.commands.acceptRun({ workspaceRootPath: ws, sessionId, operationId: 'model-run', turnId: 'model', userMessageId: 'model', userMessage: 'model accounting' })
  const model = { sessionId, runOperationId: 'model-run', providerRequestId: 'request-one', provider: 'loopback', model: 'fixture', canonicalRequestHash: 'fixture' }
  const preparedModel = await runtime.effects.prepareModel(ws, model)
  await runtime.effects.commitModelOutcome(ws, { ...model, operationId: preparedModel.operationId, stopReason: 'stop', content: [], usage: { inputTokens: 10, outputTokens: 1 } })
  const abandonedModel = await runtime.effects.prepareModel(ws, { ...model, providerRequestId: 'request-two' })
  runtime.admin.recoverWorkspace(ws)
  runtime.evidence.reconcileModel(ws, { sessionId, modelOperationId: abandonedModel.operationId, decision: 'manual_abandon', reason: 'fixture operator decision', actor: { type: 'user', id: 'fixture' }, evidence: [] })
  const { buildReliabilityReport, readSessionReliabilityReport, safelyBuildReliabilityReport } = await import('../../packages/server-core/src/observability/reliability-report')
  const events = runtime.queries.events(ws, { sessionId, limit: 10_000 }), usage = runtime.queries.usage(ws, { sessionId }), now = 2_000_000_000_000
  const report = readSessionReliabilityReport(runtime, ws, sessionId, now)
  assert(events.length > 1000)
  assert.equal(report.terminal.error, 1); assert.equal(report.unsettled.count, 1); assert(report.unsettled.oldestAgeMs! > 0)
  assert(report.signals.some(signal => signal.kind === 'repeated-action' && signal.count === 3))
  assert(report.signals.some(signal => signal.kind === 'repeated-error' && signal.count === 3))
  assert(!report.signals.some(signal => signal.toolName === 'Read'))
  assert.equal(report.observations.pollingCandidates, 3)
  assert.equal(report.userAcceptance, 'unknown'); assert.equal(report.knownCostUsd, null)
  assert.equal(report.unsettled.modelCount, 0); assert.equal(report.unknownCostRequests, 2)
  assert.deepEqual(report.unsettled.operationIds, [(await runtime.queries.unsettledTools(ws))[0]?.dispatch?.operationId])
  assert.deepEqual(report.taskBudgets.map(budget => [budget.limit, budget.used]), [[500, 120]])
  assert.equal(report.observations.sdkRetries, 1); assert.equal(report.observations.compactions, 1)
  assert.deepEqual(buildReliabilityReport({ sessionId, events: [...events].reverse(), usage, now }), report)
  assert.deepEqual(buildReliabilityReport({ sessionId, events: [...events, ...events], usage, now }), report)
  const unavailable = safelyBuildReliabilityReport(() => { throw new Error('observer failed') })
  assert.equal(unavailable.state, 'unavailable')
  assert.equal(runtime.queries.events(ws, { sessionId, limit: 10_000 }).length, events.length, 'Observer cannot commit or steer execution')
  run.json('reliability-before-restart.json', report); await runtime.close()
  const child = Bun.spawn([process.execPath, import.meta.path, '--reopen', ws], { stdout: 'pipe', stderr: 'pipe' })
  const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text()
  assert.equal(await child.exited, 0, error); assert.deepEqual(JSON.parse(output), report)
  writeFileSync(join(run.directory, 'reliability-after-restart.json'), output)
  run.complete(['persisted-repeated-action', 'persisted-repeated-error', 'polling-separated', 'unsettled-age', 'terminal-count', 'unknown-cost-and-acceptance', 'order-and-duplicate-invariant', 'observer-failure-isolated', 'fresh-process-deterministic-rebuild', 'retained-facts-beyond-first-page'], ['Signals establish repetition only; they do not infer user progress or trigger intervention. SDK retry/compaction observations are classified separately when recorded.'])
})
