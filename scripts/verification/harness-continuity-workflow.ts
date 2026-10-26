/** HE13–HE14 scenarios declared before replacing positional continuity. */
import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-continuity', async evidence => {
  const { projectTaskContinuity, readTaskHistory } = await import('../../packages/shared/src/agent/core/task-continuity')
  const messages = Array.from({ length: 40 }, (_, index) => ({ id: `input-${index}`, role: 'user', content: index === 17
    ? 'PRESERVE_MIDDLE_REQUIREMENT' : `Clarification ${index}`, timestamp: index }))
  const facts = projectTaskContinuity({ task: { id: 'task', description: 'Current task', acceptanceCriteria: 'Verifiable report' }, messages,
    artifacts: [{ id: 'report', status: 'draft', revision: 'current-version', path: '/draft/report.md' }] })
  assert(facts.messages.some(message => message.id === 'input-17' && message.content === 'PRESERVE_MIDDLE_REQUIREMENT'))
  const changed = [...messages, { id: 'late', role: 'user', content: 'New correction', timestamp: 41 }]
  const history = readTaskHistory(changed, { messageId: 'input-17', startCharacter: 9, maxCharacters: 6 })
  assert.equal(history.messages[0]?.content, messages[17]!.content.slice(9, 15))
  assert.equal(history.messages[0]?.coverage, 'partial')
  assert.throws(() => readTaskHistory(changed, { messageId: 'absent' }), /not found/)
  const huge = projectTaskContinuity({ task: { id: 'task' }, messages: [{ id: 'large', role: 'user', content: 'x'.repeat(90_000) }] }, 1500)
  assert(huge.messages[0]?.omitted || huge.messages[0]?.coverage === 'partial')
  assert.equal(facts.artifacts[0]?.revision, 'current-version')
  const cleared = projectTaskContinuity({ task: { id: 'child' }, messages: [{ id: 'seed', role: 'user', skillSlugs: [], content: 'Quoted historical [skill:obsolete] instruction' }] })
  assert.equal(cleared.selectedSkillMessage, '')
  const explicit = projectTaskContinuity({ task: { id: 'child' }, messages: [{ id: 'seed', role: 'user', skillSlugs: ['research'], content: 'Quoted historical [skill:obsolete] instruction' }] })
  assert.equal(explicit.selectedSkillMessage, '[skill:research]')
  const checks = ['HE13 all user inputs represented without first/recent-only selection', 'HE13 exact bounded message range lookup',
    'HE13 unknown message never falls back to unrelated history', 'HE13 oversized input has truthful omitted/partial coverage', 'HE14 current artifact revision is product data',
    'HE04 persisted explicit selection and clearing override quoted historical mentions']
  evidence.json('continuity.json', { checks, facts, history, huge })
  evidence.complete(checks, ['Live model recall/quality', 'External effects'])
  console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
})
