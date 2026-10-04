/** Analyze retained real chat reference evidence without another provider call. */
import { strict as assert } from 'node:assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const output = resolve(import.meta.dir, '../../.cache/capability-integration')
const corpus = JSON.parse(readFileSync(resolve(output, 'decision-feature-corpus.json'), 'utf8')).cases
const reference = JSON.parse(readFileSync(resolve(output, 'decision-chat-reference-first.json'), 'utf8'))
const results = corpus.map((sample: any) => {
  const actual = reference.results.find((r: any) => r.id === sample.id)
  const checks = Object.entries(sample.request.questions).map(([key, question]: any) => {
    const answer = actual?.answers?.[key], expected = sample.answers[key]
    const fullContract = question.type === 'noul' ? answer?.type === 'noul' && typeof answer.noul === 'number'
      : answer?.type === question.type && typeof answer.confidence === 'number' && answer.probabilities && Object.keys(answer.probabilities).length >= 2
    // Interpret abbreviated labels only for a separate semantic-reference score.
    // Never inject invented confidence/probabilities into a production decision.
    const value = typeof answer === 'number' || typeof answer === 'string' ? answer : question.type === 'noul' ? answer?.noul : question.type === 'choice' ? answer?.choice : answer?.score
    const semanticMatch = question.type === 'noul' ? typeof value === 'number' && (value >= .5) === (expected.noul >= .5)
      : question.type === 'choice' ? value === expected.choice : typeof value === 'number' && Math.round(value) === Math.round(expected.score)
    return { key, fullContract: !!fullContract, semanticMatch }
  })
  return { id: sample.id, fullContract: checks.every((c: any) => c.fullContract), semanticMatch: checks.every((c: any) => c.semanticMatch), checks }
})
assert.equal(results.length, 15)
writeFileSync(resolve(output, 'decision-chat-assessment.json'), JSON.stringify({ results, total: results.length,
  fullContract: results.filter((r: any) => r.fullContract).length, semanticMatches: results.filter((r: any) => r.semanticMatch).length,
  basis: 'Agent-curated synthetic reference, first two real DeepSeek Flash chat calls. Abbreviated labels scored separately; production HTTP validator rejected incomplete typed answers. A later stricter prompt produced malformed JSON. No human correction rate, calibrated confidence or native System One quality claim.',
  decision: 'Keep production System One adapter and opt-in settings; do not use chat-reference confidence for permission policy.',
}, null, 2))
console.log(JSON.stringify({ total: results.length, fullContract: results.filter((r: any) => r.fullContract).length, semanticMatches: results.filter((r: any) => r.semanticMatch).length }))
