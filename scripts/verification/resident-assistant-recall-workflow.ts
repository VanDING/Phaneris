import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure contract before implementation: natural Chinese queries miss exact-substring
// storage; project/condition filters must precede ranking; candidates and forgotten
// sources cannot enter derived material; summaries must rebuild after revisions;
// scenarios cannot invent a goal, merge projects/conditions, or become task status.
await verificationWorkflow('resident-assistant-recall', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Recall fixture', rootPath: root, createdAt: 1 }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'automatic', use: true } }))
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { createProject } = await import('@phaneris/shared/projects')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const projectA = createProject(root, { name: 'Writing' }), projectB = createProject(root, { name: 'Other work' })
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  const source = async (id: string, text: string, projectId?: string) => {
    await saveSession({ id, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, projectId, tokenUsage: usage,
      messages: [{ id: 'user', type: 'user', timestamp: 1, projectScope: { projectId: projectId ?? null }, content: text }] })
    return { sessionId: id, messageId: 'user' }
  }
  const reportSource = await source('report-preference', '报告使用中文，先给结论，再列依据；措辞简明。', projectA.id)
  const otherSource = await source('other-preference', '报告使用英文，采用详细表达。', projectB.id)
  const globalSource = await source('global-preference', '我希望所有交流中对不确定之处明确说明。')
  const goalSource = await source('review-goal', '整理复盘方法，形成下一次可以回查的经验。', projectA.id)
  const decisionSource = await source('review-decision', '以后复盘先列出失败原因，再决定下一步。', projectA.id)
  const correctionSource = await source('review-correction', '更正复盘方法：先核对事实，再分析失败原因。', projectA.id)
  let memory = new AssistantMemoryStore(workspace)
  const scenes: string[] = []
  try {
    const assessment = { confidence: 'supported', durability: 'durable', domain: 'collaboration', reason: 'The direct user explicitly states this durable communication preference.' } as const
    const report = memory.mutate({ action: 'remember', requestId: 'report', key: 'report-communication', content: '报告使用中文，先给结论，再列依据，措辞简明。',
      kind: 'fact', basis: 'inferred', projectId: projectA.id, condition: '写报告时', assessment, sources: [reportSource] }, 'automatic').record
    memory.mutate({ action: 'remember', requestId: 'other', key: 'other-communication', content: '报告使用英文并详细表达。', kind: 'fact', basis: 'inferred',
      projectId: projectB.id, assessment, sources: [otherSource] }, 'automatic')
    const global = memory.mutate({ action: 'remember', requestId: 'global', key: 'uncertainty', content: '不确定之处明确说明。', kind: 'fact', basis: 'inferred', assessment, sources: [globalSource] }, 'automatic').record
    memory.mutate({ action: 'remember', requestId: 'tentative', key: 'tentative-profile', content: '这不是已确认的协作偏好。', kind: 'fact', basis: 'inferred',
      assessment: { ...assessment, confidence: 'tentative' }, sources: [globalSource] }, 'automatic')
    const match = memory.lookup({ query: '我写报告时希望怎么表达才更简洁', projectId: projectA.id, includeWorkspace: true })
    assert.equal(match.items[0]?.id, report.id, 'Chinese segmentation and aliases must recover a relevant preference from a natural question')
    assert(!match.items.some(item => item.projectId === projectB.id))
    scenes.push('R01-natural-Chinese-query-and-project-boundary-before-ranking')
    const profile = memory.profile({ projectId: projectA.id })
    assert(profile.items.some(item => item.id === report.id && item.condition === '写报告时'))
    assert(profile.items.some(item => item.id === global.id))
    assert(!JSON.stringify(profile).includes('英文')); assert(!JSON.stringify(profile).includes('不是已确认'))
    assert(!memory.profile({}).items.some(item => item.id === report.id))
    scenes.push('R02-collaboration-summary-is-derived-scoped-conditional-and-excludes-candidates')
    const decision = memory.mutate({ action: 'remember', requestId: 'decision', key: 'review-method', content: '复盘先列出失败原因，再决定下一步。', kind: 'decision', basis: 'inferred',
      projectId: projectA.id, assessment: { ...assessment, domain: 'experience' }, sources: [decisionSource] }, 'automatic').record
    const scenarioCommand = { requestId: 'review-scenario', key: 'review-method', title: '复盘方法', goalQuote: '整理复盘方法', projectId: projectA.id,
      assessment: { ...assessment, domain: 'experience' as const }, sources: [goalSource], atoms: [{ id: decision.id, expectedRevision: decision.revision }] }
    const scenario = memory.captureScenario(scenarioCommand)
    assert.deepEqual(memory.captureScenario(scenarioCommand), scenario)
    assert.throws(() => memory.captureScenario({ ...scenarioCommand, requestId: 'invented-goal', key: 'invented', goalQuote: '原文没有这项目标' }), /quote|goal|source/i)
    assert.throws(() => memory.captureScenario({ ...scenarioCommand, requestId: 'cross-project', key: 'cross-project', projectId: projectB.id }), /project|scope/i)
    const episodes = memory.scenarios({ query: '复盘经验', projectId: projectA.id })
    run.json('recall-diagnostic.json', { match, profile, scenario, episodes, decision: memory.query({ ids: [decision.id] }), goal: memory.readSource(goalSource) })
    assert.equal(episodes.items[0]?.id, scenario.id)
    assert(episodes.items[0]?.atoms.some(atom => atom.id === decision.id))
    scenes.push('R03-scenario-owns-goal-conditions-atom-and-source-references-without-invented-authority')
    memory.mutate({ action: 'revise', requestId: 'correct-review', id: decision.id, expectedRevision: decision.revision,
      content: '复盘先核对事实，再分析失败原因。', sources: [correctionSource], assessment: { ...assessment, domain: 'experience' } }, 'automatic')
    const revised = memory.scenarios({ query: '复盘经验', projectId: projectA.id })
    assert(JSON.stringify(revised.items).includes('先核对事实')); assert(!JSON.stringify(revised.items).includes('再决定下一步'))
    assert.notEqual(revised.items[0]?.derivedVersion, episodes.items[0]?.derivedVersion)
    scenes.push('R04-atom-correction-rebuilds-derived-scenario-with-current-evidence')
    memory.close(); memory = new AssistantMemoryStore(workspace)
    assert.equal(memory.scenarios({ projectId: projectA.id }).items[0]?.id, scenario.id)
    memory.mutate({ action: 'transition', requestId: 'forget-profile', id: global.id, expectedRevision: global.revision, state: 'forgotten' }, 'user_request')
    assert(!memory.profile({ projectId: projectA.id }).items.some(item => item.id === global.id))
    const goalMemory = memory.mutate({ action: 'remember', requestId: 'goal-holder', key: 'goal-holder', content: '可回查的复盘目标来源。', kind: 'fact', basis: 'user_stated', sources: [goalSource] }).record
    memory.mutate({ action: 'transition', requestId: 'forget-goal', id: goalMemory.id, expectedRevision: 1, state: 'forgotten' }, 'user_request')
    assert.equal(memory.scenarios({ projectId: projectA.id }).items.length, 0)
    scenes.push('R05-restart-preserves-derived-identity-and-forgetting-removes-profile-and-scenario-material')
    run.json('recall-evidence.json', { scenes, match, profile, scenario, episodes, revised })
    run.complete(scenes, ['Real model summary quality and desktop interaction (separate workflows)', 'Vector retrieval quality'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { memory.close() }
})
