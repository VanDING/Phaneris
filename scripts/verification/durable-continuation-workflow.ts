/** RC01–RC14 declared in the failure matrix before implementation. Real Runtime/SQLite/SDK journals. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { createAssistantMessageEventStream, type Model, type AssistantMessageEvent, type TranscriptContext } from '@earendil-works/pi-ai'
import { PendingReplies } from '../../packages/pi-agent-server/src/pending-replies'
import { createDurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { canonicalContextToPiMessages } from '../../packages/pi-agent-server/src/canonical-model-context'
import { wrapDurableModelStream } from '../../packages/pi-agent-server/src/durable-model-stream'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('durable-continuation', async evidence => {
  const checks: string[] = [], results: unknown[] = []
  const check = (name: string, run: () => void) => { run(); checks.push(name) }
  const model = { api: 'openai-completions', provider: 'fixture', id: 'fixture' } as Model<any>
  const intent = { sessionId: 's', turnId: 'u', runOperationId: 'r', providerToolCallId: 'c', toolName: 'Ls', args: { path: '.' } }
  for (const toolName of ['Ls', 'tool_search', 'external_write']) {
    const workspace = join(evidence.directory, toolName), rt = createDurableRuntime()
    try {
      const scope = { workspaceRootPath: workspace, sessionId: 's' }, h = rt.execution.begin(scope)
      rt.execution.accept(h, { operationId: 'r', userMessageId: 'u', userMessage: 'Inspect existing results and continue.' })
      await rt.effects.prepareTool(workspace, { ...intent, toolName })
      const settled = await rt.execution.finish(h, 'interrupted')
      results.push({ toolName, settled, blocked: rt.execution.view('s').blocked })
      evidence.json('progress.json', results)
      check(`RC01 ${toolName} historical unknown releases foreground`, () => assert.equal(rt.execution.view('s').blocked, false))
      const next = rt.execution.begin(scope)
      rt.execution.accept(next, { operationId: 'next', userMessageId: 'u-next', userMessage: 'Continue with an independent inspection.' })
      await rt.effects.prepareModel(workspace, { sessionId: 's', runOperationId: 'next', providerRequestId: 'q', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'x' })
      check(`RC01 ${toolName} next input and model request are admitted`, () => assert.equal(rt.execution.view('s').activeRunOperationId, 'next'))
      const history = rt.queries.getCanonicalModelContext(workspace, 's', 'next')
      const messages = canonicalContextToPiMessages(history, model)
      check(`RC02 ${toolName} missing result is a truthful provider-safe view`, () => {
        const result = messages.find(message => message.role === 'toolResult')
        assert(result && JSON.stringify(result).includes('unknown'))
        assert.equal(rt.queries.unsettledTools(workspace, 'r').length, 1)
      })
      if (toolName === 'external_write') {
        await assert.rejects(rt.effects.prepareTool(workspace, { ...intent, toolName, runOperationId: 'next', providerToolCallId: 'repeat' }), /unconfirmed|unknown|unresolved/i)
        checks.push('RC12 repeated exact unknown non-idempotent action is locally restricted')
        rt.commands.acceptRun({ workspaceRootPath: workspace, sessionId: 'successor', operationId: 'successor-run', turnId: 'successor-u', userMessageId: 'successor-u', userMessage: 'Continue pending work.' })
        await assert.rejects(rt.effects.prepareTool(workspace, { ...intent, sessionId: 'successor', recoverySessionIds: ['s'], toolName,
          runOperationId: 'successor-run', providerToolCallId: 'repeat-in-successor' }), /unconfirmed|unknown|unresolved/i)
        checks.push('RC08/RC12 successor inherits only its lineage unresolved-action guard')
      }
    } finally { await rt.close() }
  }
  {
    const workspace = join(evidence.directory, 'transient-terminal'), rt = createDurableRuntime()
    try {
      const scope = { workspaceRootPath: workspace, sessionId: 's' }, h = rt.execution.begin(scope)
      rt.execution.accept(h, { operationId: 'r', userMessageId: 'u', userMessage: 'Continue.' })
      const sql = new Database(join(workspace, 'runtime/runtime.db'))
      sql.exec("CREATE TRIGGER fail_terminal BEFORE INSERT ON runtime_events WHEN NEW.event_type='operation_terminal' BEGIN SELECT RAISE(ABORT, 'fixture transient commit failure'); END")
      await rt.execution.finish(h, 'complete')
      sql.exec('DROP TRIGGER fail_terminal'); sql.close()
      rt.execution.refreshRecovery('s')
      const next = rt.execution.begin(scope)
      check('RC03 recovered storage does not leave accepted+blocked', () => assert(next.generation > h.generation))
    } finally { await rt.close() }
  }
  {
    const source = createAssistantMessageEventStream()
    const wrapped = wrapDurableModelStream(() => source, async () => async () => { throw new Error('fixture ledger failure') })
    const answer = { role: 'assistant' as const, api: model.api, provider: model.provider, model: model.id,
      content: [{ type: 'text' as const, text: 'KNOWN_SUCCESSFUL_ANSWER' }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() }
    const stream = await wrapped(model, { messages: [] } as unknown as TranscriptContext, {})
    source.push({ type: 'done', reason: 'stop', message: answer })
    const events: AssistantMessageEvent[] = []; for await (const event of stream) events.push(event)
    evidence.json('model-delivery.json', events)
    check('RC04 successful model result survives a ledger commit failure', () => assert(events.some(event => event.type === 'done' && JSON.stringify(event.message).includes('KNOWN_SUCCESSFUL_ANSWER'))))
  }
  {
    const replies = new PendingReplies<{ ok: boolean }>(), controller = new AbortController()
    const timed = await replies.wait('lost-ack', { ok: false }, { timeoutMs: 20 })
    check('RC06 missing RPC acknowledgement has a bounded exit', () => assert.equal(timed.ok, false))
    const cancelled = replies.wait('cancelled', { ok: false }, { signal: controller.signal })
    controller.abort()
    assert.equal((await cancelled).ok, false)
    check('RC06 cancellation clears correlation and ignores late ACK', () => assert.equal(replies.settle('cancelled', { ok: true }), false))
  }
  {
    const workspace = join(evidence.directory, 'deferred-outcome'), rt = createDurableRuntime()
    try {
      const scope = { workspaceRootPath: workspace, sessionId: 's' }, h = rt.execution.begin(scope)
      rt.execution.accept(h, { operationId: 'r', userMessageId: 'u', userMessage: 'Inspect once.' })
      const prepared = await rt.effects.prepareTool(workspace, intent)
      const sql = new Database(join(workspace, 'runtime/runtime.db'))
      sql.exec("CREATE TRIGGER fail_t2 BEFORE INSERT ON runtime_events WHEN NEW.event_type='tool_outcome_committed' BEGIN SELECT RAISE(ABORT, 'fixture transient T2 failure'); END")
      const outcome = await rt.effects.commitToolOutcome(workspace, { ...intent, ...prepared, result: { content: [{ type: 'text', text: 'KNOWN_TOOL_RESULT' }] }, isError: false })
      check('RC05 known tool result is retained for deferred commit', () => assert.equal((outcome as { deferred?: boolean }).deferred, true))
      sql.exec('DROP TRIGGER fail_t2'); sql.close()
      await rt.execution.finish(h, 'complete')
      await rt.effects.prepareModel(workspace, { sessionId: 's', runOperationId: 'r', providerRequestId: 'after-retry', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'x' }).catch(() => undefined)
      check('RC05 next boundary automatically backfills exactly one outcome', () => {
        const outcomes = rt.queries.events(workspace, { sessionId: 's' }).filter(event => event.type === 'tool_outcome_committed')
        assert.equal(outcomes.length, 1); assert(JSON.stringify(outcomes).includes('KNOWN_TOOL_RESULT'))
      })
    } finally { await rt.close() }
  }
  {
    const workspace = join(evidence.directory, 'uncertain-input'), rt = createDurableRuntime()
    try {
      rt.commands.recordUserInputAdmission({ workspaceRootPath: workspace, sessionId: 's', messageId: 'late', content: 'Keep citations.', createdAt: Date.now() })
      const recovered = rt.execution.recoverQueued({ workspaceRootPath: workspace, sessionId: 's' }, [{ messageId: 'late', message: 'Keep citations.', reception: { disposition: 'unknown' } }])
      check('RC07 uncertain unconsumed input is recovered without user review', () => { assert.equal(recovered.queued, 1); assert.equal(recovered.held, 0) })
    } finally { await rt.close() }
  }
  {
    const workspace = join(evidence.directory, 'late-model'), rt = createDurableRuntime()
    try {
      const scope = { workspaceRootPath: workspace, sessionId: 's' }, handle = rt.execution.begin(scope)
      rt.execution.accept(handle, { operationId: 'r', userMessageId: 'u', userMessage: 'Continue.' })
      const request = { sessionId: 's', turnId: 'u', runOperationId: 'r', providerRequestId: 'q', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'hash' }
      const prepared = await rt.effects.prepareModel(workspace, request)
      await rt.execution.finish(handle, 'interrupted'); rt.execution.refreshRecovery('s')
      const next = rt.execution.begin(scope)
      rt.execution.accept(next, { operationId: 'next', userMessageId: 'next-u', userMessage: 'New input.' })
      const outcome = { ...request, operationId: prepared.operationId, stopReason: 'stop', content: [{ type: 'text', text: 'LATE_KNOWN_RESULT' }], text: 'LATE_KNOWN_RESULT', consumedInputIds: ['u'] }
      await rt.effects.commitModelOutcome(workspace, outcome)
      check('RC11 late known model receipt survives terminal parent without settling newer turn', () => {
        assert.equal(rt.execution.view('s').activeRunOperationId, 'next')
        assert.equal(rt.queries.events(workspace, { sessionId: 's' }).filter(event => event.type === 'model_outcome_committed').length, 1)
      })
      await assert.rejects(rt.effects.commitModelOutcome(workspace, { ...outcome, sessionId: 'wrong' }))
      checks.push('RC11 receipt identity mismatches are rejected, never acknowledged as deferred')
      const duplicate = await rt.effects.commitModelOutcome(workspace, { ...outcome, type: 'durable_model_outcome_request', requestId: 'replacement-wire-correlation' } as typeof outcome)
      check('RC05/RC11 model receipt dedup ignores ephemeral RPC correlation fields', () => assert(duplicate.committedSeq))
    } finally { await rt.close() }
  }
  {
    const workspace = join(evidence.directory, 'model-receipt-restart')
    let rt = createDurableRuntime()
    try {
      const scope = { workspaceRootPath: workspace, sessionId: 's' }, handle = rt.execution.begin(scope)
      rt.execution.accept(handle, { operationId: 'r', userMessageId: 'u', userMessage: 'Original input.' })
      const request = { sessionId: 's', turnId: 'u', runOperationId: 'r', providerRequestId: 'q', provider: 'fixture', model: 'fixture', canonicalRequestHash: 'hash' }
      const prepared = await rt.effects.prepareModel(workspace, request)
      const sql = new Database(join(workspace, 'runtime/runtime.db'))
      sql.exec("CREATE TRIGGER fail_model_receipt BEFORE INSERT ON runtime_events WHEN NEW.event_type='model_outcome_committed' BEGIN SELECT RAISE(ABORT, 'fixture unavailable model ledger'); END")
      const result = await rt.effects.commitModelOutcome(workspace, { ...request, operationId: prepared.operationId, stopReason: 'stop', content: [{ type: 'text', text: 'KNOWN_RESPONSE' }], text: 'KNOWN_RESPONSE', consumedInputIds: ['u'], type: 'durable_model_outcome_request', requestId: 'wire-id' } as any)
      check('RC04 known model receipt is retained during a real SQLite write outage', () => { assert.equal(result.deferred, true); assert.equal(rt.queries.hasPendingReceipts(workspace, 's'), true) })
      await rt.execution.finish(handle, 'complete'); await rt.close()
      sql.exec('DROP TRIGGER fail_model_receipt'); sql.close()
      rt = createDurableRuntime(); rt.admin.start([workspace], () => {})
      rt.commands.acceptRun({ ...scope, operationId: 'next', turnId: 'next-u', userMessageId: 'next-u', userMessage: 'Continue.' })
      await rt.effects.prepareModel(workspace, { ...request, runOperationId: 'next', providerRequestId: 'next-q' })
      check('RC04/RC07 restart automatically backfills model response and consumed input once', () => {
        assert.equal(rt.queries.hasPendingReceipts(workspace, 's'), false)
        const outcomes = rt.queries.events(workspace, { sessionId: 's' }).filter(event => event.type === 'model_outcome_committed')
        assert.equal(outcomes.length, 1); assert(JSON.stringify(outcomes).includes('KNOWN_RESPONSE'))
        const recovered = rt.execution.recoverQueued(scope, [{ messageId: 'u', message: 'Original input.', reception: { disposition: 'unknown' } }])
        assert.equal(recovered.queued, 0)
      })
    } finally { await rt.close() }
  }
  {
    let dispatched = 0
    const source = createAssistantMessageEventStream()
    const wrapped = wrapDurableModelStream(() => { dispatched++; return source }, async () => { throw new Error('fixture unavailable accounting') })
    const stream = await wrapped(model, { messages: [] } as unknown as TranscriptContext, {})
    const answer = { role: 'assistant' as const, api: model.api, provider: model.provider, model: model.id, content: [{ type: 'text' as const, text: 'INFERENCE_CONTINUES' }],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() }
    source.push({ type: 'done', reason: 'stop', message: answer })
    const events: AssistantMessageEvent[] = []; for await (const event of stream) events.push(event)
    check('RC04 inference and its actual terminal result survive preparation accounting failure', () => { assert.equal(dispatched, 1); assert(events.some(event => event.type === 'done')) })
  }
  {
    const workspace = join(evidence.directory, 'steer-observation-outage'), rt = createDurableRuntime()
    try {
      const scope = { workspaceRootPath: workspace, sessionId: 's' }, handle = rt.execution.begin(scope)
      rt.execution.accept(handle, { operationId: 'r', userMessageId: 'u', userMessage: 'Work.' })
      let delivered = 0
      rt.execution.installDriver('s', { async *run() {}, stop() {}, dispose() {}, async steer() { delivered++; return { disposition: 'handled' as const } } })
      const sql = new Database(join(workspace, 'runtime/runtime.db'))
      sql.exec("CREATE TRIGGER fail_observation BEFORE INSERT ON runtime_events WHEN NEW.event_type IN ('sdk_observation', 'user_message_committed') BEGIN SELECT RAISE(ABORT, 'fixture diagnostic failure'); END")
      const receipt = await rt.execution.steer('s', { text: 'New direction.' }, { messageId: 'steer-u', content: 'New direction.', createdAt: Date.now() })
      check('RC07 diagnostic and receipt write failures do not prevent SDK input delivery', () => { assert.equal(delivered, 1); assert.equal(receipt.disposition, 'handled') })
      sql.exec('DROP TRIGGER fail_observation'); sql.close()
    } finally { await rt.close() }
  }
  {
    const healthy = join(evidence.directory, 'healthy'), broken = join(evidence.directory, 'broken')
    mkdirSync(join(broken, 'runtime'), { recursive: true }); writeFileSync(join(broken, 'runtime/runtime.db'), 'fixture corrupt original')
    const original = readFileSync(join(broken, 'runtime/runtime.db')), rt = createDurableRuntime()
    try {
      const notices: string[] = []
      const recovered = rt.admin.start([broken, healthy], (_workspace, error) => notices.push(String(error)))
      check('RC09 one failed workspace cannot fail global initialization', () => assert.equal(recovered.length, 2))
      rt.commands.acceptRun({ workspaceRootPath: broken, sessionId: 's', turnId: 'u', operationId: 'r', userMessageId: 'u', userMessage: 'Continue.' })
      check('RC09 affected workspace automatically uses recovery storage and preserves original', () => {
        assert.deepEqual(readFileSync(join(broken, 'runtime/runtime.db')), original)
        assert(existsSync(join(broken, 'runtime/runtime.recovery.db')))
      })
      evidence.json('storage-recovery.json', { notices, recovered })
    } finally { await rt.close() }
  }
  evidence.json('continuation.json', { checks, results })
  evidence.complete(checks, ['Live provider quality', 'Signed/cross-platform release'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
