/**
 * Host-side decision points.
 *
 * Every harness feature that asks the decision model something (task verdicts,
 * semantic labels, turn outcomes, ...) goes through `openDecisionPoint`:
 *
 *   1. resolve a client: Settings switch → the feature's toggle → key → endpoint;
 *   2. decide under the user's background deadline (`decisionLayer.deadlineMs`)
 *      unless the request sets its own;
 *   3. record every call (feature tag, question keys, answers, state hash, never
 *      the state itself);
 *   4. return `null` on any failure so the caller keeps its pre-decision behaviour;
 *   5. `recordDecisionOutcome(result, ...)` then records what the point did with the
 *      answer (an outcome line joined to the decision by id), so usage can be judged
 *      without re-deriving thresholds from the code; `recordDecisionFollowUp` adds what
 *      turned out later (was the suggested source used?), which is what tunes a threshold.
 *
 * A decision is advice for the host. It never grants authority.
 */

import { randomUUID } from 'node:crypto'
import {
  createDecisionPointTrace,
  decisionObservation,
  toDecisionFailure,
  type DecisionPointTrace,
  type DecisionSource,
  type DecisionApplication,
  buildDecisionRecord,
  getDecisionRecorder,
  type DecisionFollowUp,
  type DecisionOutcome,
  type DecisionRecord,
  resolveDecisionClient,
  type DecisionClientResolution,
  type DecisionFeature,
  type DecisionLayerFeature,
  type DecisionRecorder,
  type DecisionRequest,
  type DecisionResult,
  type ResolveDecisionClientOptions,
} from '@phaneris/shared/decisions'

/** Ask a resolved decision point. `null` means no answer: behave as before. `signal` cancels the call. */
export type DecisionPointFn = ((request: DecisionRequest, meta?: Record<string, unknown>, signal?: AbortSignal) => Promise<DecisionResult | null>) & { trace?: DecisionPointTrace }

/** Test seams and logging shared by every decision point. */
export interface DecisionPointDeps {
  source?: DecisionSource
  onTrace?: (trace: DecisionPointTrace) => void
  now?: () => number
  log?: (message: string) => void
  resolveClient?: (options: ResolveDecisionClientOptions) => Promise<DecisionClientResolution>
  recorder?: DecisionRecorder
}

export interface DecisionPointOptions extends DecisionPointDeps {
  /** Settings toggle that gates this point. */
  feature: DecisionLayerFeature
  /** Tag written to decisions.jsonl. */
  record: DecisionFeature
  sessionId?: string
  /** Upper bound on the deadline for points someone waits on (a turn start, a message ack). */
  maxDeadlineMs?: number
}

/** Deadline cap for decision points that hold up a turn start or a message acknowledgement. */
export const FOREGROUND_MAX_DEADLINE_MS = 3_000
export const DECISION_COLD_AFTER_MS = 30_000
export const DECISION_COLD_DEADLINE_MS = 2_800
const lastAnsweredAt = new Map<string, number>()

/**
 * Resolve once and return a function that asks the model, possibly several
 * times (batches). `null` when the point is switched off or unavailable.
 * Never throws.
 */
export async function openDecisionPoint(options: DecisionPointOptions): Promise<DecisionPointFn | null> {
  const resolveClient = options.resolveClient ?? resolveDecisionClient
  const tag = `[decision:${options.record}]`
  let resolution: DecisionClientResolution
  try {
    resolution = await resolveClient({ feature: options.feature, sessionId: options.sessionId })
  } catch (error) {
    const trace = createDecisionPointTrace({ sessionId: options.sessionId, feature: options.feature }, options.source)
    trace.failed = true
    options.onTrace?.(trace)
    decisionObservation(trace, { kind: 'unavailable', reason: toDecisionFailure(error, { includeDetail: false }).kind })
    options.log?.(`${tag} resolver failed: ${errorMessage(error)}`)
    return null
  }
  if (!resolution.ok) {
    if (resolution.failure.kind !== 'disabled') {
      const trace = createDecisionPointTrace({ sessionId: options.sessionId, feature: options.feature }, options.source)
      trace.failed = true
      options.onTrace?.(trace)
      decisionObservation(trace, { kind: 'unavailable', reason: resolution.failure.kind })
    }
    if (resolution.failure.kind !== 'disabled') options.log?.(`${tag} unavailable: ${resolution.failure.message}`)
    return null
  }

  const { client, provider, endpoint, settings, keySource, deadlineIsExplicit } = resolution.value
  const recorder = options.recorder ?? getDecisionRecorder()
  const now = options.now ?? Date.now
  const warmthKey = JSON.stringify([provider, settings.connectionSlug ?? keySource, endpoint.baseUrl, endpoint.model])
  const trace = createDecisionPointTrace({ sessionId: options.sessionId, feature: options.feature }, options.source)
  options.onTrace?.(trace)
  const decide: DecisionPointFn = async (request, meta, signal) => {
    const attemptId = randomUUID()
    const identity = { decisionPointId: trace.decisionPointId, sessionId: trace.sessionId, feature: trace.feature, attemptId }
    decisionObservation(identity, { kind: 'attempt_started', provider, model: endpoint.model })
    const startedAt = performance.now()
    const lastAnswer = lastAnsweredAt.get(warmthKey)
    const coldStart = lastAnswer === undefined || now() - lastAnswer >= DECISION_COLD_AFTER_MS
    const defaultBudget = coldStart && !deadlineIsExplicit ? Math.max(settings.deadlineMs, DECISION_COLD_DEADLINE_MS) : settings.deadlineMs
    const deadlineMs = Math.min(request.deadlineMs ?? defaultBudget, options.maxDeadlineMs ?? Number.POSITIVE_INFINITY)
    const base = { feature: options.record, provider, model: endpoint.model, questions: request.questions, sessionId: options.sessionId, meta: { ...meta, deadlineMs }, coldStart }
    try {
      const response = await client.decide({ ...request, deadlineMs, observation: identity }, signal)
      const result = { ...response, decisionPointId: trace.decisionPointId, attemptId }
      lastAnsweredAt.delete(warmthKey)
      if (lastAnsweredAt.size >= 256) lastAnsweredAt.delete(lastAnsweredAt.keys().next().value!)
      lastAnsweredAt.set(warmthKey, now())
      const record = buildDecisionRecord({ ...base, result })
      void recorder.append(record)
      decisionObservation(identity, { kind: 'answered', record })
      recordHandles.set(result, { record, recorder, trace })
      return result
    } catch (error) {
      trace.failed = true
      const record = { ...buildDecisionRecord({ ...base, error, latencyMs: Math.round(performance.now() - startedAt) }), decisionPointId: trace.decisionPointId, attemptId }
      void recorder.append(record)
      decisionObservation(identity, { kind: 'answered', record })
      options.log?.(`${tag} failed: ${errorMessage(error)}`)
      return null
    }
  }
  decide.trace = trace
  return decide
}

/** Decision record behind each result a decision point returned, for `recordDecisionOutcome`/`recordDecisionFollowUp`. */
const recordHandles = new WeakMap<DecisionResult, { record: DecisionRecord; recorder: DecisionRecorder; trace: DecisionPointTrace; outcomeRecorded?: boolean }>()

/**
 * Record what the point did with `result`'s answer. Call once per result, including when
 * the answer changed nothing (`changed: false`): the ratio is what shows whether a toggle
 * earns its keep. No-op for `null` (no answer; the decision line already says why) and for
 * a second call on the same result.
 */
export function recordDecisionOutcome(result: DecisionResult | null | undefined, outcome: DecisionOutcome): void {
  if (!result) return
  const handle = recordHandles.get(result)
  if (!handle || handle.outcomeRecorded) return
  handle.outcomeRecorded = true
  if (outcome.action === 'unsure' || outcome.action === 'reask' || outcome.detail?.reason === 'no_answer' || outcome.detail?.reason === 'low_confidence') handle.trace.failed = true
  void handle.recorder.recordOutcome(handle.record, outcome)
  decisionObservation(handle.trace, { kind: 'recommended', outcome })
}

/** Confirm at the host execution boundary, never at the classification boundary. */
export function recordDecisionApplied(result: DecisionResult | null | undefined, application: DecisionApplication): void {
  if (result) recordHandles.get(result)?.trace.apply(application)
}

/** Record what turned out later about `result`'s answer (e.g. the suggested source was used). */
export function recordDecisionFollowUp(result: DecisionResult | null | undefined, followUp: DecisionFollowUp): void {
  if (!result) return
  const handle = recordHandles.get(result)
  if (!handle) return
  void handle.recorder.recordFollowUp(handle.record, followUp)
  decisionObservation(handle.trace, { kind: 'observed', observation: followUp })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Capture primitive-returning classifiers without inferring application from their answers. */
export class DecisionCapture {
  trace?: DecisionPointTrace
  constructor(readonly source?: DecisionSource) {}
  onTrace = (trace: DecisionPointTrace): void => { this.trace = trace }
  get deps(): Pick<DecisionPointDeps, 'source' | 'onTrace'> { return { source: this.source, onTrace: this.onTrace } }
  resolve(action: string, changed = false, detail?: Record<string, unknown>): void {
    this.trace?.apply({ action, changed, detail, status: changed ? 'applied' : this.trace.failed ? 'fallback' : 'unchanged' })
  }
  discard(reason: string): void { this.trace?.apply({ action: 'discard', changed: false, status: 'discarded', reason }) }
}
