import type { ClassifierModel, ClassifierApi, ClassifierContext, ModelsClassifierOptions } from '@earendil-works/pi-ai'
import { prepareDecisionState, validateDecisionRequest } from './client.ts'
import type { DecisionAnswer, DecisionRequest } from './types.ts'

export type PiClassifierComparison = { supported: false; reason: string } | {
  supported: true; answers: Record<string, DecisionAnswer>; usage?: { inputTokens: number; outputTokens: number; costUsd?: number }; model: string
}

/** An explicit comparison path. It cannot select a production adapter or grant authority. */
export async function compareWithPiClassifier(model: ClassifierModel<ClassifierApi>, request: DecisionRequest,
  options: ModelsClassifierOptions = {}): Promise<PiClassifierComparison> {
  validateDecisionRequest(request)
  const prepared = prepareDecisionState(request.state)
  if (!prepared.state || typeof prepared.state !== 'object' || Array.isArray(prepared.state)) {
    return { supported: false, reason: 'Pi classifier requires object state; wrapping or truncating text would change the existing protocol.' }
  }
  if (Object.values(request.questions).some(q => q.type === 'score')) {
    return { supported: false, reason: 'Pi 1.0 classifier score answers omit the probability distribution required by Phaneris.' }
  }
  if (Object.values(request.questions).some(q => typeof q.instructions !== 'string'
    || q.type === 'choice' && Object.values(q.criteria).some(value => typeof value !== 'string'))) {
    return { supported: false, reason: 'Structured instructions or option descriptions cannot be represented without changing semantics.' }
  }
  const context: ClassifierContext = { state: prepared.state as ClassifierContext['state'], questions: {} }
  for (const [key, q] of Object.entries(request.questions)) {
    if (q.type === 'noul') context.questions[key] = { type: 'bool', instructions: q.instructions as string,
      criteria: { true: q.criteria?.true ?? 'Yes', false: q.criteria?.false ?? 'No' } }
    else if (q.type === 'choice') context.questions[key] = { type: 'choice', instructions: q.instructions as string, criteria: q.criteria as Record<string, string> }
  }
  const [{ builtinModels }, { InMemoryCredentialStore }] = await Promise.all([
    import('@earendil-works/pi-ai/providers/all'), import('@earendil-works/pi-ai'),
  ])
  const models = builtinModels({ credentials: new InMemoryCredentialStore() })
  const result = await models.classify(model, context, { ...options, timeoutMs: request.deadlineMs ?? options.timeoutMs ?? 5000, maxRetries: 0 })
  if (result.stopReason !== 'stop') return { supported: false, reason: result.errorMessage ?? result.stopReason }
  const answers: Record<string, DecisionAnswer> = {}
  for (const [key, q] of Object.entries(request.questions)) {
    const answer = result.answers[key]
    if (q.type === 'noul' && answer?.type === 'bool') answers[key] = { type: 'noul', noul: answer.probability }
    else if (q.type === 'choice' && answer?.type === 'choice') answers[key] = answer
    else return { supported: false, reason: `Pi classifier omitted or changed answer ${key}` }
  }
  return { supported: true, answers, model: result.model, usage: result.usage ? { inputTokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
    outputTokens: result.usage.output, costUsd: Object.values(model.cost).some(rate => typeof rate === 'number' && rate > 0) ? result.usage.cost.total : undefined } : undefined }
}
