import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-automatic-memory', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha'), sourceId = '261105-memory-learning'
  process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  mkdirSync(root, { recursive: true })
  const workspace = { id: 'alpha', rootPath: root }
  const policy = (learning: string, use: unknown = true) => writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'alpha', name: 'Memory fixture', assistantMemory: { version: 1, learning, use } }))
  policy('automatic')
  const { saveSession } = await import('@phaneris/shared/sessions')
  await saveSession({ id: sourceId, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, messages: [
    { id: 'preference-user', type: 'user', timestamp: 1, content: '请用中文沟通，结果先给结论。' },
    { id: 'correction-user', type: 'user', timestamp: 2, content: '需要解释时先举例，再给结论。' },
    { id: 'unsupported-model', type: 'assistant', timestamp: 3, content: '我猜测用户可能喜欢很长的解释。' },
  ], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  let memory = new AssistantMemoryStore(workspace)
  const sources = (messageId: string) => [{ sessionId: sourceId, messageId }]
  const scenes: string[] = []
  const assessment = { confidence: 'supported', durability: 'durable', domain: 'collaboration', reason: 'An exact user preference that applies across tasks.' } as const
  try {
    const learned = memory.mutate({ action: 'remember', requestId: 'learn-supported', key: 'collaboration-language', kind: 'fact', basis: 'inferred',
      content: '使用中文沟通，先给结论。', assessment, sources: sources('preference-user') })
    assert.equal(learned.record.state, 'active', 'Low-risk extraction from an exact direct user source does not require manual promotion')
    assert.equal(memory.query({ text: '中文' }).items.length, 1)
    const uncertain = memory.mutate({ action: 'remember', requestId: 'learn-uncertain', key: 'uncertain-preference', kind: 'fact', basis: 'inferred',
      content: '用户可能喜欢长篇解释。', sources: sources('unsupported-model') })
    assert.equal(uncertain.record.state, 'candidate', 'Unsupported model guesses remain unavailable for default recall')
    assert.equal(memory.query({ text: '长篇' }).items.length, 0)
    const tentative = memory.mutate({ action: 'remember', requestId: 'tentative-direct-source', key: 'tentative-direct-source', kind: 'fact', basis: 'inferred',
      content: '这只是一项待确认的归纳。', assessment: { ...assessment, confidence: 'tentative' }, sources: sources('preference-user') })
    assert.equal(tentative.record.state, 'candidate', 'Direct-source provenance alone does not prove an inferred conclusion')
    scenes.push('M01-supported-personal-learning-is-automatic', 'M02-unsupported-inference-does-not-become-a-user-fact')
    const revised = memory.mutate({ action: 'revise', requestId: 'learn-correction', id: learned.record.id, expectedRevision: 1,
      content: '解释新问题时先举例，再给结论。', sources: sources('correction-user') })
    assert.equal(revised.record.state, 'active')
    assert.equal(memory.query({ text: '先举例' }).items.length, 1)
    const dormant = memory.mutate({ action: 'transition', requestId: 'automatic-cooling', id: learned.record.id, expectedRevision: revised.record.revision, state: 'dormant' })
    assert.equal(memory.query({ text: '先举例' }).items.length, 0)
    memory.mutate({ action: 'transition', requestId: 'automatic-restoration', id: learned.record.id, expectedRevision: dormant.record.revision, state: 'active' })
    assert.equal(memory.query({ text: '先举例' }).items.length, 1)
    scenes.push('M03-correction-and-cooling-use-the-same-versioned-owner')
    memory.close(); memory = new AssistantMemoryStore(workspace)
    assert.equal(memory.query({ text: '先举例' }).items.length, 1)
    scenes.push('M04-admission-survives-restart')
    const background = { action: 'remember' as const, requestId: 'background-policy', key: 'background-policy', kind: 'fact' as const, basis: 'inferred' as const,
      content: '需要解释时先举例。', assessment, sources: sources('correction-user') }
    policy('paused')
    assert.throws(() => memory.mutate(background, 'automatic'), /learning|paused|policy/i)
    assert.throws(() => memory.mutate(background, 'user_request'), /learning|paused|policy/i)
    policy('explicit')
    assert.throws(() => memory.mutate(background, 'automatic'), /learning|explicit|policy/i)
    assert.equal(memory.mutate({ ...background, requestId: 'explicit-policy', key: 'explicit-policy' }, 'management').record.state, 'active')
    scenes.push('M05-pause-and-explicit-only-stop-background-learning')
    policy('automatic', false)
    assert.equal(memory.lookup({ query: '先举例' }).items.length, 0, 'Use disabled stops recall, while records remain available for management')
    assert.equal(memory.inspect({ id: learned.record.id, expectedRevision: 4 }).record.content, null)
    assert(memory.query({ text: '先举例' }).items.length > 0)
    policy('automatic', 'malformed')
    assert.equal(memory.lookup({ query: '先举例' }).items.length, 0)
    assert.throws(() => memory.mutate(background, 'automatic'), /policy|configuration|learning/i)
    writeFileSync(join(root, 'config.json'), '{broken')
    assert.throws(() => memory.mutate(background, 'automatic'), /policy|configuration|learning/i)
    assert.equal(memory.lookup({ query: '先举例' }).items.length, 0)
    policy('automatic')
    assert(memory.lookup({ query: '先举例' }).items.length > 0)
    scenes.push('M06-use-and-learning-are-separate', 'M07-invalid-configuration-does-not-expand-processing')
    await assert.rejects(Promise.resolve().then(() => memory.mutate({ action: 'transition', requestId: 'forged-background-forget', id: learned.record.id,
      expectedRevision: 4, state: 'forgotten' }, 'automatic')), /explicit|forget/i)
    assert.throws(() => memory.mutate({ action: 'transition', requestId: 'unsupported-auto-promotion', id: uncertain.record.id, expectedRevision: 1, state: 'active' }, 'automatic'), /evidence|admission/i)
    scenes.push('M08-automatic-maintenance-cannot-forget-or-promote-unsupported-inferences')
    assert.throws(() => memory.mutate({ ...background, requestId: 'missing-assessment', key: 'missing-assessment', assessment: undefined }, 'automatic'), /assessment|评估/i)
    assert.throws(() => memory.mutate({ ...background, requestId: 'secret-material', key: 'secret-material', assessment: { ...assessment, domain: 'secret' } }, 'automatic'), /secret|credential/i)
    assert.throws(() => memory.mutate({ ...background, requestId: 'one-time-material', key: 'one-time-material', assessment: { ...assessment, durability: 'task_only' } }, 'automatic'), /one-time|task|context/i)
    assert.throws(() => memory.mutate({ ...background, requestId: 'project-body', key: 'project-body', assessment: { ...assessment, domain: 'project_fact' } }, 'automatic'), /project/i)
    scenes.push('M09-automatic-learning-requires-assessment-and-respects-domain-ownership')
    const forgotten = memory.mutate({ action: 'transition', requestId: 'explicit-forget-evidence', id: learned.record.id, expectedRevision: 4, state: 'forgotten' })
    assert.equal(forgotten.record.assessment, undefined, 'Forgetting also suppresses free-text assessment reasons')
    scenes.push('M10-forgetting-redacts-assessment-content')
    run.json('automatic-memory-evidence.json', { scenes, records: memory.query({ includeRetired: true }) })
    run.complete(scenes, ['Automatic Runtime maintenance and tool actor boundaries are extended in subsequent scenes'])
  } finally { memory.close() }
})
