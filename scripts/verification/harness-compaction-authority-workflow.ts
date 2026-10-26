/** HE21 failure cases declared before changing canonical convergence. Real SDK journal, no provider simulation needed. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { Model } from '@earendil-works/pi-ai'
import { verificationWorkflow } from './verification-artifacts'
import { canonicalContextToPiMessages, convergeCanonicalContext, recordCanonicalCompaction } from '../../packages/pi-agent-server/src/canonical-model-context'
import type { DurableCanonicalModelContext } from '../../packages/shared/src/durable-runtime/types'

await verificationWorkflow('harness-compaction-authority', async evidence => {
  const cwd = join(evidence.directory, 'workspace'); mkdirSync(cwd)
  const model = { api: 'openai-completions', provider: 'fixture', id: 'fixture' } as Model<any>, scope = 'workspace:task'
  const context: DurableCanonicalModelContext = { cursor: 10, items: [
    { kind: 'user', eventId: 'run-1:user', operationId: 'run-1', seq: 1, content: 'OLD_LARGE_ORIGINAL_' + 'evidence '.repeat(12000) },
    { kind: 'assistant', eventId: 'answer-1', operationId: 'run-1', seq: 2, content: 'Original conclusion' },
    { kind: 'user', eventId: 'run-2:user', operationId: 'run-2', seq: 8, content: 'Keep the current requirement' },
    { kind: 'assistant', eventId: 'answer-2', operationId: 'run-2', seq: 9, content: 'Current conclusion' },
  ] }
  const session = SessionManager.create(cwd, join(evidence.directory, 'journal'))
  const checks: string[] = []
  const check = (name: string, run: () => void) => { run(); checks.push(name) }
  convergeCanonicalContext(session, context, model, scope)
  const retained = session.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user' && entry.message.timestamp === 8)!
  const compactId = session.appendCompaction('NATIVE_SUMMARY: original evidence established; retain current requirement.', retained.id, 30000)
  recordCanonicalCompaction(session, compactId, scope, 9)
  const before = session.buildSessionProjection().messages
  assert(!JSON.stringify(before).includes('OLD_LARGE_ORIGINAL_'))
  const outcome = convergeCanonicalContext(session, context, model, scope)
  const after = session.buildSessionProjection().messages
  evidence.json('compaction.json', { outcome, beforeCharacters: JSON.stringify(before).length, afterCharacters: JSON.stringify(after).length,
    nativeCompactionId: compactId, oldOriginalRestored: JSON.stringify(after).includes('OLD_LARGE_ORIGINAL_') })
  check('HE21 native compaction keeps old raw history outside working context', () => {
    assert(!JSON.stringify(after).includes('OLD_LARGE_ORIGINAL_'), 'Canonical replay must not undo native history reduction')
    assert(JSON.stringify(after).includes('NATIVE_SUMMARY'))
  })
  const count = session.getEntries().length
  check('HE21 unchanged compacted context is idempotent', () => {
    assert.equal(convergeCanonicalContext(session, context, model, scope), 'aligned'); assert.equal(session.getEntries().length, count)
  })
  const next: DurableCanonicalModelContext = { cursor: 24, items: [...context.items,
    { kind: 'user', eventId: 'run-3:user', operationId: 'run-3', seq: 20, content: 'NEW_INPUT_AFTER_COMPACTION' },
    { kind: 'tool_call', eventId: 'call-3', operationId: 'run-3', seq: 21, toolOperationId: 't3', toolCallId: 'c3', toolName: 'Read', args: { path: 'evidence' } },
    { kind: 'tool_outcome', eventId: 'outcome-3', operationId: 'run-3', seq: 22, toolOperationId: 't3', toolCallId: 'c3', toolName: 'Read', result: 'NEW_TOOL_RESULT', isError: false },
    { kind: 'assistant', eventId: 'answer-3', operationId: 'run-3', seq: 23, content: 'NEW_CONCLUSION' },
  ] }
  check('HE21 new canonical input and complete tool exchange append after native prefix', () => {
    assert.equal(convergeCanonicalContext(session, next, model, scope), 'appended')
    const visible = JSON.stringify(session.buildSessionProjection().messages)
    assert(visible.includes('NEW_INPUT_AFTER_COMPACTION')); assert(visible.includes('NEW_TOOL_RESULT')); assert(visible.includes('NEW_CONCLUSION'))
    assert(!visible.includes('OLD_LARGE_ORIGINAL_')); assert(visible.includes('NATIVE_SUMMARY'))
  })
  const reopened = SessionManager.open(session.getSessionFile()!)
  check('HE21 public SDK journal reload preserves scope-bound compaction coverage', () => {
    assert.equal(convergeCanonicalContext(reopened, next, model, scope), 'aligned')
    assert.deepEqual(reopened.buildSessionProjection().messages, session.buildSessionProjection().messages)
  })
  check('HE21 an abandoned tail is replaced without touching the compacted prefix', () => {
    reopened.appendMessage({ role: 'user', content: 'ABANDONED_ATTEMPT', timestamp: 25 })
    const changed = { ...next, cursor: 26, items: [...next.items, { kind: 'user' as const, eventId: 'u4', operationId: 'r4', seq: 26, content: 'CANONICAL_CORRECTION' }] }
    assert.equal(convergeCanonicalContext(reopened, changed, model, scope), 'replaced')
    const visible = JSON.stringify(reopened.buildSessionProjection().messages)
    assert(!visible.includes('ABANDONED_ATTEMPT')); assert(!visible.includes('OLD_LARGE_ORIGINAL_')); assert(visible.includes('CANONICAL_CORRECTION'))
    assert(visible.includes('NATIVE_SUMMARY'))
  })
  const live = SessionManager.create(cwd, join(evidence.directory, 'live-journal'))
  convergeCanonicalContext(live, context, model, scope)
  const liveMessage = canonicalContextToPiMessages({ cursor: 24, items: [{ kind: 'assistant', eventId: 'live', operationId: 'r-live', seq: 20,
    content: 'CURRENT_RUN_LARGE_PAYLOAD_' + 'raw '.repeat(24000) }] }, model)[0]!
  Object.assign(liveMessage, { durableSeq: 24, durableContextScope: scope }); live.appendMessage(liveMessage as Parameters<SessionManager['appendMessage']>[0])
  const liveCompaction = live.appendCompaction('LIVE_NATIVE_SUMMARY', null, 54000)
  recordCanonicalCompaction(live, liveCompaction, scope, 9)
  const liveContext: DurableCanonicalModelContext = { cursor: 25, items: [...context.items,
    { kind: 'user', eventId: 'late-user', operationId: 'r-live', seq: 11, content: 'LATE_INPUT_MUST_SURVIVE_RECEIPT' },
    { kind: 'assistant', eventId: 'live', operationId: 'r-live', seq: 20, content: 'CURRENT_RUN_LARGE_PAYLOAD_' + 'raw '.repeat(24000) },
  ] }
  check('HE21 journaled current-run output remains summarized without a full-turn replay', () => {
    convergeCanonicalContext(live, liveContext, model, scope)
    assert(!JSON.stringify(live.buildSessionProjection().messages).includes('CURRENT_RUN_LARGE_PAYLOAD_'))
  })
  check('HE21 user facts above the synchronized boundary survive even below a later output receipt', () => {
    assert(JSON.stringify(live.buildSessionProjection().messages).includes('LATE_INPUT_MUST_SURVIVE_RECEIPT'))
  })
  check('HE21 successive native compactions replace their own coverage without restoring prior raw history', () => {
    const compactAgain = live.appendCompaction('SECOND_NATIVE_SUMMARY', null, 6000)
    recordCanonicalCompaction(live, compactAgain, scope, 20)
    assert.equal(convergeCanonicalContext(live, liveContext, model, scope), 'aligned')
    const visible = JSON.stringify(live.buildSessionProjection().messages)
    assert(visible.includes('SECOND_NATIVE_SUMMARY')); assert(!visible.includes('CURRENT_RUN_LARGE_PAYLOAD_'))
    assert(!visible.includes('LIVE_NATIVE_SUMMARY'))
  })
  check('HE21 inherited parent output receipts cannot hide facts in a child task', () => {
    const child = SessionManager.create(cwd, join(evidence.directory, 'child-journal'))
    convergeCanonicalContext(child, context, model, scope)
    const parentOutput = canonicalContextToPiMessages({ cursor: 9999, items: [{ kind: 'assistant', eventId: 'parent', operationId: 'parent', seq: 9999, content: 'PARENT_OUTPUT' }] }, model)[0]!
    Object.assign(parentOutput, { durableSeq: 9999, durableContextScope: 'parent-task' })
    child.appendMessage(parentOutput as Parameters<SessionManager['appendMessage']>[0])
    const childCompaction = child.appendCompaction('CHILD_SUMMARY', null, 30000)
    recordCanonicalCompaction(child, childCompaction, scope, 9)
    convergeCanonicalContext(child, next, model, scope)
    assert(JSON.stringify(child.buildSessionProjection().messages).includes('NEW_CONCLUSION'))
  })
  const recovery = SessionManager.create(cwd, join(evidence.directory, 'recovery-journal'))
  convergeCanonicalContext(recovery, context, model, scope)
  const crossingCall = { kind: 'tool_call' as const, eventId: 'cross-call', operationId: 'cross', seq: 21, toolOperationId: 'cross-t', toolCallId: 'cross-c', toolName: 'Write', args: { path: 'draft' } }
  const callMessage = canonicalContextToPiMessages({ cursor: 21, items: [crossingCall] }, model)[0]!
  Object.assign(callMessage, { durableSeq: 21, durableContextScope: scope }); recovery.appendMessage(callMessage as Parameters<SessionManager['appendMessage']>[0])
  const recoveryCompaction = recovery.appendCompaction('RECOVERY_SUMMARY', null, 32000)
  recordCanonicalCompaction(recovery, recoveryCompaction, scope, 9)
  const recovered: DurableCanonicalModelContext = { cursor: 30, items: [...context.items, crossingCall,
    { kind: 'tool_outcome', eventId: 'cross-result', operationId: 'cross', seq: 30, toolOperationId: 'cross-t', toolCallId: 'cross-c', toolName: 'Write', result: 'ALREADY_COMMITTED_EFFECT', isError: false }] }
  check('HE21 late T2 restores a summarized call and outcome together without invoking an effect', () => {
    convergeCanonicalContext(recovery, recovered, model, scope)
    const visible = recovery.buildSessionProjection().messages
    assert(!JSON.stringify(visible).includes('RECOVERY_SUMMARY'))
    assert.equal(visible.filter(message => message.role === 'toolResult' && message.toolCallId === 'cross-c').length, 1)
    assert(visible.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'toolCall' && block.id === 'cross-c')))
    assert.equal(convergeCanonicalContext(SessionManager.open(recovery.getSessionFile()!), recovered, model, scope), 'aligned')
  })
  check('HE21 another product scope cannot inherit a compaction checkpoint', () => {
    const other = SessionManager.open(session.getSessionFile()!)
    convergeCanonicalContext(other, next, model, 'different-task')
    const visible = JSON.stringify(other.buildSessionProjection().messages)
    assert(visible.includes('OLD_LARGE_ORIGINAL_')); assert(!visible.includes('NATIVE_SUMMARY'))
  })
  check('HE21 legacy compaction without coverage uses complete facts', () => {
    const legacy = SessionManager.create(cwd, join(evidence.directory, 'legacy-journal'))
    convergeCanonicalContext(legacy, context, model)
    legacy.appendCompaction('LEGACY_SUMMARY', null, 30000)
    convergeCanonicalContext(legacy, context, model, scope)
    const visible = JSON.stringify(legacy.buildSessionProjection().messages)
    assert(visible.includes('OLD_LARGE_ORIGINAL_')); assert(!visible.includes('LEGACY_SUMMARY'))
  })
  evidence.json('checks.json', { checks, lateInput: live.buildSessionProjection().messages, recoveredRoles: recovery.buildSessionProjection().messages.map(message => message.role) })
  evidence.complete(checks, ['Live model summary quality', 'Host delivery replay is covered separately by the input-continuity workflow'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
