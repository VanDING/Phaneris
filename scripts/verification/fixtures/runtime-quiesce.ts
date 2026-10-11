import assert from 'node:assert/strict'
import { createDurableRuntime, durableToolOperationId } from '../../../packages/server-core/src/durable-runtime'
const runtime = createDurableRuntime()
const scope = { sessionId: 'quiesce-fixture', workspaceRootPath: process.argv[2]! }
const operationId = 'quiesce-run'
const handle = runtime.execution.begin(scope)
runtime.execution.accept(handle, { operationId, turnId: 't1', userMessageId: 'm1', userMessage: 'Retain recovery evidence' })
let steerAttempts = 0
runtime.execution.installDriver(scope.sessionId, { stop() {}, dispose() {}, async *run() {},
  async steer() { steerAttempts++; return { disposition: 'handled' } } })
await runtime.effects.prepareTool(scope.workspaceRootPath, { sessionId: scope.sessionId, turnId: 't1', runOperationId: operationId,
  providerToolCallId: 'quiesce-tool', toolName: 'Write', args: { path: 'evidence.txt' } })
const toolId = durableToolOperationId(operationId, 'quiesce-tool')
const recovery = runtime.evidence.getRecoveryEvidence(scope.workspaceRootPath, toolId)
assert(recovery)
const before = runtime.queries.events(scope.workspaceRootPath, { sessionId: scope.sessionId })
runtime.quiesce()
assert.throws(() => runtime.execution.begin(scope), /admission is closed/)
assert.throws(() => runtime.commands.acceptRun({ ...scope, operationId: 'forbidden-run', turnId: 't2', userMessageId: 'm2', userMessage: 'Must not execute' }), /admission is closed/)
assert.equal((await runtime.execution.steer(scope.sessionId, 'No late input', { messageId: 'late', content: 'No late input', createdAt: Date.now() })).disposition, 'rejected')
assert.equal(steerAttempts, 0)
assert.deepEqual(runtime.queries.events(scope.workspaceRootPath, { sessionId: scope.sessionId }), before)
assert.deepEqual(runtime.evidence.getRecoveryEvidence(scope.workspaceRootPath, toolId), recovery)
assert.equal(runtime.commands.completeRun(scope.workspaceRootPath, operationId, 'complete').kind, 'parked')
await runtime.close()
console.log(JSON.stringify({ id: 'L06-runtime-admission-quiesce', passed: true, retainedEvents: before.length }))
