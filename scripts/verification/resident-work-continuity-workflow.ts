import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '@phaneris/core/types'
import type { DurableModelPrepareRequest, DurableToolPrepareRequest } from '@phaneris/shared/durable-runtime/types'
import { ResidentContextSchema } from '@phaneris/session-tools-core/resident-context-contracts'
import { verificationWorkflow } from './verification-artifacts'

// Written before product changes. This crosses the actual context owner, Host
// model/tool boundary and SQLite Runtime, with a counted isolated business effect.
await verificationWorkflow('resident-work-continuity', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const workspace = { id: 'continuity', rootPath: join(run.directory, 'workspace') }
  mkdirSync(workspace.rootPath, { recursive: true })
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, name: 'Isolated continuity', createdAt: 1,
    assistantMemory: { version: 1, learning: 'explicit', use: false } }))
  assert(ResidentContextSchema.safeParse({ action: 'prepare', requestId: 'contract', target: { kind: 'keep' } }).success,
    'WC02: combined work preparation is unavailable')
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { SessionContext } = await import('../../packages/server-core/src/context/session-context')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const { contextReconciliationAdapter } = await import('../../packages/server-core/src/context/runtime-reconciliation')
  const messages: Message[] = [
    { id: 'definition', role: 'user', content: 'Daily push. Keep this reusable definition. Default greeting: morning.', timestamp: 1 },
    { id: 'today', role: 'user', content: 'Trigger today. Greeting: afternoon. Do not change the recurring definition.', timestamp: 2 },
    { id: 'chat', role: 'user', content: 'What are you doing?', timestamp: 3 },
    { id: 'stop', role: 'user', content: 'Already completed elsewhere. Do not trigger it; diagnose the problem.', timestamp: 4 },
    { id: 'other', role: 'user', content: 'An independent report with an unrelated requirement.', timestamp: 5 },
  ]
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  const persist = () => saveSession({ id: 'assistant', sessionKind: 'resident_assistant', workspaceRootPath: workspace.rootPath,
    createdAt: 1, lastUsedAt: 1, tokenUsage: usage, messages: messages.map(({ role, ...message }) => ({ ...message, type: role })) })
  await persist()
  let memory = new AssistantMemoryStore(workspace), context = new SessionContext(workspace, 'assistant', memory)
  const runtime = createDurableRuntime(), scenes: string[] = [], evidence: Record<string, unknown> = {}
  let inputId = 'today', runId = 'run-today', effects = 0
  const accept = (id: string, input: string) => {
    runId = id; inputId = input
    runtime.commands.acceptRun({ workspaceRootPath: workspace.rootPath, sessionId: 'assistant', operationId: id,
      turnId: id, userMessageId: input, userMessage: messages.find(m => m.id === input)!.content })
  }
  const canonical = () => context.prepare(runtime.queries.getCanonicalModelContext(workspace.rootPath, 'assistant'), messages, runId, inputId)
  const policy = () => bindPiRuntime(runtime, { workspaceRootPath: workspace.rootPath, sessionId: 'assistant' }, { modelContext: {
    select: () => canonical(), valid: request => request ? context.outcome(request) : !!context.segmentForRun(runId)
      && context.valid(context.segmentForRun(runId)!),
    assert: request => context.assertRequest(request), assertTool: request => context.assertBusinessTool(request),
    entered: (request, operationId) => context.entered(request, operationId),
    committed: (request, valid) => context.committed(request, valid),
  } })
  const command = (value: unknown, input = inputId) => context.command(ResidentContextSchema.parse(value), messages, input)
  const infer = async (seq: string, callId: string) => {
    const view = (await policy().getCanonicalModelContext!())!, boundary = policy().durableModelBoundary!
    const snapshot = { version: 1 as const, capturedAt: 1, provider: 'isolated', model: 'scripted-boundary', system: { hash: '0'.repeat(64), chars: 0 }, messages: [],
      tools: [{ name: 'assistant_delegate', hash: '1'.repeat(64), schemaChars: 25000, description: 'Repeated tool description '.repeat(1000) }] }
    const request: DurableModelPrepareRequest = { sessionId: 'assistant', runOperationId: runId, turnId: runId,
      providerRequestId: seq, provider: 'isolated', model: 'scripted-boundary', canonicalRequestHash: seq.padEnd(64, '0'),
      contextSnapshot: snapshot, residentContext: { segmentId: view.resident!.segmentId, preparation: view.resident!.preparation, snapshot } }
    const producer = await boundary.prepare(request)
    await boundary.commitOutcome({ ...request, operationId: producer.operationId, stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: callId, name: 'mcp__session__assistant_delegate', arguments: {} }] })
    return { producer, view }
  }
  const effectRequest = (call: string, producer: string): DurableToolPrepareRequest => ({ sessionId: 'assistant',
    runOperationId: runId, turnId: runId, providerToolCallId: call, toolBatchId: producer,
    toolName: 'mcp__session__assistant_delegate', args: {} })
  try {
    command({ action: 'create', requestId: 'daily', label: 'Recurring daily push' }, 'definition')
    const branch = context.get().selectedBranchIds![0]!
    assert.equal(context.branch(branch).origin?.messageId, 'definition', 'Goal origin must remain navigable independently of invocation requirements')
    accept('run-today', 'today')
    const unbound = canonical()
    assert(unbound.resident!.contextText.includes('Original work-scope evidence'))
    assert(unbound.resident!.contextText.includes('Default greeting: morning'))
    assert.equal(context.get().focus.topicId, branch)
    assert.equal(context.get().activeSegment?.preparation, undefined)
    scenes.push('WC01-HEAD-preserved-without-implicit-readiness')

    command({ action: 'select', branchIds: [branch] })
    const old = await infer('1', 'old-call')
    // Retired contract (2026-11-19): a committed producer request that carried
    // no preparation binding is now admitted directly. What must still hold is
    // that its scope comes from *its own* material view, never from a newer
    // pointer or preparation it never saw.
    const oldAdmission = await policy().durableToolBoundary!.prepare(effectRequest('old-call', old.producer.operationId))
    const oldScope = context.admittedScope(oldAdmission.operationId)
    assert(oldScope.branchIds.includes(branch),
      'A preparation-less admission must be bounded by the producer request that actually made the call')
    assert.equal(oldScope.preparationId, undefined,
      'A preparation-less admission must not claim a preparation identity it never had')
    // Settle the effect so the Runtime is not left with an unknown outcome; the
    // assertion above is about the admission boundary, not about executing work.
    await policy().durableToolBoundary!.commitOutcome({ ...effectRequest('old-call', old.producer.operationId),
      operationId: oldAdmission.operationId, canonicalArgsHash: oldAdmission.canonicalArgsHash,
      result: { effects, task: undefined }, isError: false })
    scenes.push('WC03-select-alone-admitted-only-within-the-producer-material-view')
    assert.throws(() => command({ action: 'prepare', requestId: 'unsupported-work-scope', target: { kind: 'keep' },
      requirements: [{ scope: 'work', source: { sessionId: 'assistant', messageId: 'today' } }] }), /context_work_scope_required/)
    assert.equal(context.workPreparation('unsupported-work-scope'), undefined)

    command({ action: 'prepare', requestId: 'today-preparation', target: { kind: 'select', branchIds: [branch] },
      requirements: [{ branchId: branch, scope: 'input', source: { sessionId: 'assistant', messageId: 'today' } }] })
    const ready = canonical()
    assert.equal(context.workPreparation('today-preparation')?.state, 'ready')
    assert(JSON.stringify(ready).includes('Greeting: afternoon'))
    assert(!context.associations(branch).some(ref => ref.messageId === 'today' && ref.role === 'requirement'))
    // The old producer is still bounded by its own view; the newer preparation
    // changes where *later* admissions get their requirements, not what an
    // admission that never carried a binding may claim.
    const oldScopeAfter = context.admittedScope(oldAdmission.operationId)
    assert.equal(oldScopeAfter.preparationId, undefined,
      'A newer preparation must not retroactively give an older admission a preparation identity')
    assert.deepEqual(oldScopeAfter.branchIds, oldScope.branchIds,
      'A newer preparation must not retroactively widen an older admission scope')
    scenes.push('WC02-input-only-requirement-visible-not-promoted', 'WC04-old-producer-cannot-claim-a-newer-preparation')

    const fresh = await infer('2', 'fresh-call')
    assert.equal(context.segmentForRun(runId)!.requests.at(-1)!.snapshot!.tools[0]!.description, undefined, 'Context projection must reference Runtime evidence instead of duplicating tool descriptions')
    const prepared = await policy().durableToolBoundary!.prepare(effectRequest('fresh-call', fresh.producer.operationId))
    effects++
    const task = context.preparedTaskMaterials(prepared.operationId)
    assert(task.sources.some(source => source.messageId === 'today'))
    await policy().durableToolBoundary!.commitOutcome({ ...effectRequest('fresh-call', fresh.producer.operationId),
      operationId: prepared.operationId, canonicalArgsHash: prepared.canonicalArgsHash, result: { effects, task }, isError: false })
    assert.equal(effects, 1)
    evidence.workerMaterials = task
    context.track({ sources: [{ sessionId: 'assistant', messageId: 'other', contentHash: memory.readSource({ sessionId: 'assistant', messageId: 'other' }).contentHash }] }, runId)
    canonical()
    assert(context.segmentForRun(runId)!.dependencies.sources.some(source => source.messageId === 'other'), 'Read evidence must survive view reassembly')
    scenes.push('WC12-read-evidence-survives-reassembly-with-run-scope')

    runtime.evidence.registerReconciliationAdapter('mcp__session__assistant_context', contextReconciliationAdapter(id => context.toolReceipt(id)), workspace.rootPath)
    const recoveryCommand = { action: 'prepare', requestId: 'lost-ack', target: { kind: 'select', branchIds: [branch] }, requirements: [] }
    const localCall = { sessionId: 'assistant', runOperationId: runId, toolName: 'mcp__session__assistant_context',
      providerToolCallId: 'context-lost-ack', contextInputId: inputId, args: { command: recoveryCommand } }
    const lost = await runtime.effects.prepareTool(workspace.rootPath, localCall)
    context.command(ResidentContextSchema.parse(recoveryCommand), messages, inputId, undefined, lost.operationId)
    canonical()
    const retried = await runtime.effects.prepareTool(workspace.rootPath, { ...localCall, providerToolCallId: 'context-retry' })
    assert.equal(runtime.evidence.getRecoveryEvidence(workspace.rootPath, lost.operationId)?.verdict.kind, 'completed')
    await runtime.effects.commitToolOutcome(workspace.rootPath, { ...localCall, operationId: retried.operationId,
      providerToolCallId: 'context-retry', canonicalArgsHash: retried.canonicalArgsHash, result: context.toolReceipt(lost.operationId), isError: false })
    scenes.push('WC05-local-unknown-effect-reconciles-from-atomic-receipt', 'WC07-T2-backfill-does-not-reapply-command')

    messages.push({ id: 'late-event', role: 'info', content: 'Historical work delivery; no new user authority', timestamp: 6,
      inputSource: { kind: 'resident_event', eventIds: ['synthetic-event'] } })
    await persist()
    const foreground = context.get().activeSegment!.id, focus = context.get().focus.topicId
    command({ action: 'prepare', requestId: 'event-work', target: { kind: 'select', branchIds: [branch] }, temporary: true, requirements: [] }, 'late-event')
    const eventView = context.prepare({ cursor: 1000, items: [] }, messages, 'event-run', 'late-event')
    assert(eventView.resident?.preparation)
    assert.equal(context.get().activeSegment!.id, foreground)
    assert.equal(context.get().focus.topicId, focus)
    assert.throws(() => context.command({ action: 'prepare', requestId: 'forged-event', continuationOf: 'original-execution',
      target: { kind: 'select', branchIds: [branch] }, requirements: [] }, messages, 'late-event'), /continuation_conflict/)
    context.command({ action: 'prepare', requestId: 'event-continuation', continuationOf: 'original-execution',
      target: { kind: 'select', branchIds: [branch] }, requirements: [] }, messages, 'late-event', undefined, undefined,
      { id: 'original-execution', branchIds: [branch], requirements: context.workPreparation('today-preparation')!.requirements.filter(requirement => requirement.scope === 'input') })
    const continued = context.prepare({ cursor: 1001, items: [] }, messages, 'event-run', 'late-event')
    assert(JSON.stringify(continued).includes('Greeting: afternoon'))
    assert.equal(context.get().activeSegment!.id, foreground)
    assert.equal(context.get().focus.topicId, focus)
    scenes.push('WC14-event-view-preserves-foreground-pointer')

    command({ action: 'create', requestId: 'unrelated', label: 'Independent report' }, 'other')
    const otherBranch = context.get().selectedBranchIds![0]!
    assert.notEqual(otherBranch, branch)
    // A separate branch change does not modify the original requirements.
    assert(context.associations(branch).some(ref => ref.messageId === 'definition'))
    command({ action: 'prepare', requestId: 'today-again', target: { kind: 'select', branchIds: [branch] },
      requirements: [] })
    canonical()
    assert.equal(context.get().focus.topicId, branch)
    scenes.push('WC12-unrelated-work-does-not-rewrite-original')
    messages.push({ id: 'mixed', role: 'user', content: 'For A: evening. For B: report-only.', timestamp: 7 })
    await persist()
    accept('mixed-run', 'mixed')
    command({ action: 'prepare', requestId: 'mixed-preparation', target: { kind: 'select', branchIds: [branch, otherBranch] },
      requirements: [{ branchId: branch, scope: 'input', source: { sessionId: 'assistant', messageId: 'mixed', quote: 'For A: evening.' } },
        { branchId: otherBranch, scope: 'input', source: { sessionId: 'assistant', messageId: 'mixed', quote: 'For B: report-only.' } }] })
    canonical()
    const mixed = context.workPreparation('mixed-preparation')!
    assert.equal(mixed.requirements.length, 2)
    assert.equal(mixed.requirements[0]!.branchId, branch)
    assert.equal(mixed.requirements[1]!.branchId, otherBranch)
    assert(!context.associations(otherBranch).some(source => source.messageId === 'mixed'))
    scenes.push('WC14-mixed-clauses-retain-explicit-work-and-input-scope')
    accept('run-today-resumed', 'today')

    command({ action: 'prepare', requestId: 'record-before-crash', target: { kind: 'select', branchIds: [branch] },
      requirements: [{ branchId: branch, scope: 'input', source: { sessionId: 'assistant', messageId: 'today' } }] })
    const recorded = context.workPreparation('record-before-crash')!
    assert.equal(recorded.state, 'recorded')
    context.close(); memory.close()
    memory = new AssistantMemoryStore(workspace); context = new SessionContext(workspace, 'assistant', memory)
    assert.equal(context.workPreparation('record-before-crash')?.generation, recorded.generation)
    command({ action: 'recover', requestId: 'record-before-crash', expectedGeneration: recorded.generation })
    canonical()
    assert.equal(context.workPreparation('record-before-crash')?.state, 'ready')
    command({ action: 'preparation', requestId: 'record-before-crash' })
    scenes.push('WC06-recorded-requirements-survive-reopen', 'WC07-published-command-result-queryable')

    const beforeStop = await infer('3', 'late-call')
    const started = await policy().durableToolBoundary!.prepare(effectRequest('late-call', beforeStop.producer.operationId))
    effects++ // Synthetic effect started, but its outcome receipt is deliberately lost.
    accept('run-stop', 'stop')
    canonical()
    await assert.rejects(() => policy().durableToolBoundary!.prepare({ ...effectRequest('late-call', beforeStop.producer.operationId),
      runOperationId: 'run-today-resumed', turnId: 'run-today-resumed' }), /work_input|work_generation|work_not_prepared|context/)
    assert.equal(effects, 2)
    assert.equal(runtime.evidence.getRecoveryEvidence(workspace.rootPath, started.operationId)?.verdict.kind, 'reconcile_required')
    assert.equal(context.get().focus.topicId, branch)
    scenes.push('WC08-new-input-prevents-old-foreground-effect')
    scenes.push('WC09-stop-preserves-already-started-effect-as-unknown')

    const deadline = { ...effectRequest('expired', 'none'), deadlineAt: Date.now() - 1 }
    await assert.rejects(() => runtime.effects.prepareTool(workspace.rootPath, deadline), /expired|deadline/)
    scenes.push('WC10-expired-admission-never-commits')
    accept('run-already-closed', 'chat')
    runtime.commands.completeRun(workspace.rootPath, runId, 'interrupted')
    await assert.rejects(() => runtime.effects.prepareTool(workspace.rootPath, { sessionId: 'assistant', runOperationId: runId,
      providerToolCallId: 'closed-read', toolName: 'Read', args: { path: 'synthetic' } }), /run_closed|not open/)
    accept('run-cancel-reconcile', 'chat')
    const delayed = { sessionId: 'assistant', runOperationId: runId, providerToolCallId: 'lost-before-stop',
      toolName: 'mcp__session__assistant_context', contextInputId: inputId, args: { command: { action: 'select', branchIds: [branch] } } }
    const waiting = await runtime.effects.prepareTool(workspace.rootPath, delayed)
    const queried = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    runtime.evidence.registerReconciliationAdapter(delayed.toolName, { async queryExternal() {
      queried.resolve(); await release.promise
      return { decision: 'completed', reason: 'Isolated committed receipt arrived after stop', evidence: [{ source: 'other', summary: 'Synthetic exact receipt', observedAt: Date.now() }], result: { recovered: true } }
    } }, workspace.rootPath)
    const latePreparation = runtime.effects.prepareTool(workspace.rootPath, { ...delayed, providerToolCallId: 'retry-after-stop' })
    await queried.promise
    runtime.commands.completeRun(workspace.rootPath, runId, 'interrupted')
    release.resolve()
    await assert.rejects(latePreparation, /run_closed/)
    assert.equal(runtime.evidence.getRecoveryEvidence(workspace.rootPath, waiting.operationId)?.verdict.kind, 'completed')
    scenes.push('WC10-closed-run-and-stop-during-reconciliation-cannot-open-new-T1')
    const changed = messages.find(message => message.id === 'definition')!
    changed.content = 'Changed source: the earlier business definition is withdrawn'
    await persist()
    accept('run-revoked', 'today')
    const diagnostic = canonical()
    assert(!diagnostic.resident?.preparation)
    assert(context.segmentForRun(runId)?.diagnostic)
    assert(!JSON.stringify(diagnostic).includes('Default greeting: morning'))
    scenes.push('WC12-related-edit-blocks-business-with-safe-diagnostic')
    evidence.effects = effects
    evidence.preparations = [context.workPreparation('today-preparation'), context.workPreparation('record-before-crash')]
    evidence.events = runtime.queries.events(workspace.rootPath, { sessionId: 'assistant' })
    evidence.currentView = context.get()
    run.json('evidence.json', evidence)
    run.complete(scenes, ['Real model autonomous semantics (separate live workflow)', 'Production migration and signed installation'])
  } finally { context.close(); memory.close(); await runtime.close() }
})
