import { createHash, randomUUID } from 'node:crypto'
import { prepareDecisionState } from '@phaneris/shared/decisions'
import { toDecisionFailure, type DecisionAccounting, type DecisionAccountingScope, type DecisionResult } from '@phaneris/shared/decisions'
import type { DurableRuntime } from '../durable-runtime/index.js'

export function createDecisionAccounting(runtime: DurableRuntime, workspaceRoot: string, sessionId: string,
  scope: DecisionAccountingScope, settled: () => void): DecisionAccounting {
  return (request, invoke) => runtime.effects.trackAuxiliary(async () => {
    const requestId = `decision:${request.observation?.attemptId ?? randomUUID()}`, operationId = `utility:${sessionId}:${requestId}`
    const digest = prepareDecisionState(request.state).digest
    const canonicalRequestHash = createHash('sha256').update(JSON.stringify({ digest, questions: request.questions, model: request.model ?? scope.model })).digest('hex')
    runtime.commands.acceptRun({ workspaceRootPath: workspaceRoot, sessionId, turnId: operationId, operationId,
      userMessageId: `${operationId}:input`, userMessage: `Decision request: ${scope.feature ?? 'utility'}`, kind: 'system', modelVisible: false })
    const identity = { purpose: 'decision' as const, sessionId, turnId: operationId, runOperationId: operationId,
      providerRequestId: requestId, provider: scope.provider, model: request.model ?? scope.model, canonicalRequestHash }
    const prepared = await runtime.effects.prepareModel(workspaceRoot, identity)
    if (!prepared.created) throw new Error('Decision effect requires reconciliation before replay')
    let result: DecisionResult | undefined, failure: unknown
    try { result = await invoke(); return { ...result, accountingOperationId: prepared.operationId,
      usage: { ...result.usage, costStatus: result.usage.costUsd === undefined ? 'unknown' : 'known' } } }
    catch (error) { failure = error; throw error }
    finally {
      const safeFailure = failure ? toDecisionFailure(failure, { includeDetail: false }) : undefined
      await runtime.effects.commitModelOutcome(workspaceRoot, { ...identity, operationId: prepared.operationId,
        stopReason: safeFailure?.kind === 'cancelled' ? 'aborted' : safeFailure ? 'error' : 'stop',
        content: result ? { answers: result.answers, state: digest } : { error: safeFailure?.kind ?? 'unknown', state: digest },
        usage: { inputTokens: result?.usage.inputTokens, outputTokens: result?.usage.outputTokens, costUsd: result?.usage.costUsd,
          payload: { kind: 'decision', feature: scope.feature, decisionPointId: request.observation?.decisionPointId,
            attemptId: request.observation?.attemptId, accountingOperationId: prepared.operationId,
            costSource: result?.usage.costUsd === undefined ? 'unknown' : 'provider_reported', failure: safeFailure?.kind } } })
      runtime.commands.completeRun(workspaceRoot, operationId, safeFailure?.kind === 'timeout' ? 'timeout' : safeFailure?.kind === 'cancelled' ? 'interrupted' : safeFailure ? 'error' : 'complete')
      try { settled() } catch { /* Product observers cannot change a paid effect's committed result. */ }
    }
  })
}
