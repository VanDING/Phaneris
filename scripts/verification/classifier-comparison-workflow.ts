/** Compare native Pi and direct System One on the supported contract; no live provider. */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
let calls = 0
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  calls++; const body = await req.json() as any
  return Response.json({ model: body.model, answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]: any) => [key,
    q.type === 'noul' ? { type: 'noul', noul: .9 } : { type: 'choice', choice: 'yes', confidence: .9, probabilities: { yes: .9, no: .1 } }])), usage: { input_tokens: 10, output_tokens: 2 } })
} })
const records: any[] = []
try {
  const { compareWithPiClassifier } = await import('../../packages/shared/src/decisions/pi-classifier-comparison.ts')
  const { SystemOneClient } = await import('../../packages/shared/src/decisions/client.ts')
  const { getBuiltinClassifierModels } = await import('@earendil-works/pi-ai/providers/all')
  const model = { ...getBuiltinClassifierModels('typesafe')[0]!, baseUrl: api.url.href }
  const client = new SystemOneClient({ provider: 'custom', baseUrl: api.url.href, model: model.id })
  const request = { state: { text: 'fixture' }, questions: { yes: { type: 'noul' as const, instructions: 'yes or no' }, choice: { type: 'choice' as const, instructions: 'choose', criteria: { yes: 'yes', no: 'no' } } } }
  const direct = await client.decide(request)
  const native = await compareWithPiClassifier(model, request, { apiKey: 'fixture' })
  assert(native.supported); assert.deepEqual(native.answers, direct.answers)
  records.push({ id: 'Native bool and choice match direct System One probabilities', pass: true, provider: model.provider, model: model.id })
  const previous = calls
  const score = await compareWithPiClassifier(model, { ...request, questions: { score: { type: 'score', instructions: 'rank', criteria: ['low', 'high'] } } }, { apiKey: 'fixture' })
  assert(!score.supported); assert.equal(calls, previous)
  const stringState = await compareWithPiClassifier(model, { ...request, state: 'unstructured state' }, { apiKey: 'fixture' })
  assert(!stringState.supported); assert.equal(calls, previous)
  records.push({ id: 'Score distribution and non-object state stay on the original adapter before any request', pass: true, reasons: [score.reason, stringState.reason] })
} catch (e) { records.push({ id: 'Comparison workflow', pass: false, error: String(e) }) }
finally { api.stop(true); const output = resolve(import.meta.dir, '../../.cache/capability-integration/classifier-comparison.json'); writeFileSync(output, JSON.stringify({ records, calls, decision: 'Keep the direct adapter as default until the full contract is represented' }, null, 2)); console.log(JSON.stringify({ output, records })) }
process.exit(records.every(r => r.pass) ? 0 : 1)
