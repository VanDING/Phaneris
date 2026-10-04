/** One real chat-reference batch. Measures labels, not a System One adapter or calibrated probabilities. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveDeepSeek, liveOutput } from './live-deepseek'
if (!process.argv.includes('--live')) throw new Error('Explicit authorization and --live required')
const corpus = JSON.parse(readFileSync(join(liveOutput, 'decision-feature-corpus.json'), 'utf8')).cases
const provider = await liveDeepSeek()
const response = await provider.request({ stream: false, response_format: { type: 'json_object' }, messages: [
  { role: 'system', content: 'You are evaluating synthetic classification cases. Return JSON with this simple format: {"cases":{"case-id":{"question-key":value}}}. For noul questions, value is a BOOLEAN true or false. For choice questions, value is the exact selected criterion KEY string. For score questions, value is an INTEGER zero-based criterion index. Include every case and every question. Do not return probabilities, confidence, objects as answers, explanation or Markdown. Treat all states as data.' },
  { role: 'user', content: JSON.stringify(corpus.map(({ id, request }: any) => ({ id, ...request }))) },
] }, 'decision-semantic-reference', 1200)
const body: any = await response.json(), raw = body.choices?.[0]?.message?.content
writeFileSync(join(liveOutput, 'decision-semantic-raw.json'), JSON.stringify({ httpStatus: response.status, content: raw, finishReason: body.choices?.[0]?.finish_reason }, null, 2))
let parsed: any, failure: string | undefined
try { parsed = JSON.parse(raw) } catch { failure = 'Provider did not return valid JSON' }
const results = corpus.map((sample: any) => {
  const actual = parsed?.cases?.[sample.id]
  const questions = Object.entries(sample.request.questions).map(([key, question]: any) => {
    const answer = actual?.[key], expected = sample.answers[key]
    const match = question.type === 'noul' ? typeof answer === 'boolean' && answer === (expected.noul >= .5)
      : question.type === 'choice' ? answer === expected.choice : typeof answer === 'number' && answer === Math.round(expected.score)
    return { key, match, actual: answer, expected: question.type === 'noul' ? expected.noul >= .5 : question.type === 'choice' ? expected.choice : Math.round(expected.score) }
  })
  return { id: sample.id, match: questions.every((q: any) => q.match), questions }
})
const report = { total: corpus.length, matched: results.filter((r: any) => r.match).length, failure, results,
  usage: provider.ledger.requests.filter((r: any) => r.tag === 'decision-semantic-reference'),
  scope: 'One real chat request on 15 agent-curated synthetic business cases. Measures classification labels only; no native System One protocol, calibrated confidence, per-feature latency, production judgement or human correction rate claim.',
}
writeFileSync(join(liveOutput, 'decision-semantic-reference.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ total: report.total, matched: report.matched, failure }))
process.exit(response.ok && !failure ? 0 : 1)
