import { createHash, randomUUID } from 'node:crypto'
import type { DurableRuntime } from '../durable-runtime/index.js'

/** Independently owned paid effect; never replace the active conversation checkpoint. */
export async function auxiliaryModelEffect<T extends { usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number }; costStatus?: string }>(
  runtime: DurableRuntime, input: { workspaceRoot: string; sessionId: string; purpose: 'image_generation'; provider: string; model: string; request: unknown; signal?: AbortSignal },
  invoke: () => Promise<T>, settled: () => void,
): Promise<T> {
  return runtime.effects.trackAuxiliary(async () => {
  const requestId = `${input.purpose}:${randomUUID()}`, runId = `utility:${input.sessionId}:${requestId}`
  runtime.commands.acceptRun({ workspaceRootPath: input.workspaceRoot, sessionId: input.sessionId, turnId: runId, operationId: runId,
    userMessageId: `${runId}:input`, userMessage: input.purpose, kind: 'system', modelVisible: false })
  const identity = { purpose: input.purpose, sessionId: input.sessionId, turnId: runId, runOperationId: runId,
    providerRequestId: requestId, provider: input.provider, model: input.model,
    canonicalRequestHash: createHash('sha256').update(JSON.stringify(input.request)).digest('hex') }
  const prepared = await runtime.effects.prepareModel(input.workspaceRoot, identity)
  if (!prepared.created) throw new Error('Auxiliary request requires reconciliation before replay')
  let result: T | undefined, failure: unknown
  try { result = await invoke(); return result }
  catch (error) { failure = error; throw error }
  finally {
    const observed = result ?? failure as Pick<T, 'usage' | 'costStatus'> | undefined
    const cancelled = !!failure && (input.signal?.aborted || (failure instanceof Error && failure.name === 'AbortError'))
    await runtime.effects.commitModelOutcome(input.workspaceRoot, { ...identity, operationId: prepared.operationId,
      stopReason: cancelled ? 'aborted' : failure ? 'error' : 'stop', content: { completed: !failure },
      usage: { ...observed?.usage, payload: { kind: input.purpose, costSource: observed?.costStatus ?? 'unknown', failed: !!failure, cancelled } } })
    runtime.commands.completeRun(input.workspaceRoot, runId, cancelled ? 'interrupted' : failure ? 'error' : 'complete')
    try { settled() } catch { /* UI failure is independent of the committed paid effect. */ }
  }
  })
}
