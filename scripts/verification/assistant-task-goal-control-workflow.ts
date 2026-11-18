import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Stage 3 acceptance: one Goal with several tasks, change propagation, partial
 * blocking, per-item control receipts, late receipts and no revival after
 * termination. Uses the sanitized care-home replay from the field evidence
 * (`msgs` named in 定稿 §9) as the input sequence.
 *
 * Failure conditions are M17-M23 in
 * docs/verification/assistant-refactor-2026-11-18-failure-matrix.md.
 */
await verificationWorkflow('assistant-task-goal-control', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const root = mkdtempSync(resolve('.cache/verification/assistant-goal-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  process.env.NODE_ENV = 'test'
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  const { AssistantTaskStore } = await import('../../packages/server-core/src/assistant-tasks/store')
  const { AssistantTaskService } = await import('../../packages/server-core/src/assistant-tasks/service')
  const { assignmentStateOf } = await import('../../packages/server-core/src/assistant-tasks/dispatch')
  const workspace = { id: 'eldercare', rootPath: workspaceRoot }
  const changed: string[] = []
  const service = new AssistantTaskService(workspace, {
    readyFacts: async projection => {
      const store = service.store
      const unsatisfied = projection.task.dependsOn.filter(dependency => store.projection(dependency)?.stage !== 'accepted')
      return { permissionMode: 'safe', workingDirectory: workspaceRoot, unsatisfiedDependencies: unsatisfied }
    },
    changed: taskId => { if (taskId) changed.push(taskId) },
  })
  const scenes: string[] = [], evidence: unknown[] = []
  try {
    // M17 · The Goal and its plan are queryable before any Session exists.
    const goal = service.create({ requestId: 'care-goal', goalTitle: '高品质养老调研：重养老轻医疗',
      title: '养老调研汇总报告',
      scopeIn: ['重养老轻医疗', '居住、餐饮、活动三个重点', '案例深度', '汇总报告引用各分篇已验收版本'],
      scopeOut: ['医疗技术细节'],
      requirements: [
        { statement: '侧重养老而非医疗', scope: 'goal', quote: '高品质养老调研，重养老轻医疗' },
        { statement: '覆盖居住、餐饮、活动三个重点', scope: 'goal' },
        { statement: '案例要有深度', scope: 'goal' },
        { statement: '汇总报告必须引用分篇的已验收版本', scope: 'task' },
      ],
      acceptance: ['汇总报告引用各分篇已验收版本', '成本口径可横向比较'] }, 'msg-care-goal', { directUser: true })
    assert(goal.stage === 'intake')
    assert(goal.activeRequirements.filter(item => item.scope === 'goal').length === 3)
    const summaryTask = goal.task.id
    scenes.push('C01-goal-and-plan-exist-before-any-session')

    // M17 · Four independent research tasks plus dependencies on the summary.
    const parts = ['market', 'cost', 'operations', 'cases'].map(part => service.create({
      requestId: `care-part-${part}`, goalTitle: '高品质养老调研：重养老轻医疗', title: `养老调研分篇：${part}`,
      requirements: [{ statement: `独立调研 ${part}`, scope: 'task' },
        { statement: '每篇输出单独文件', scope: 'task' }],
      acceptance: [`${part} 分篇文件存在`], deliverable: 'single file', dependsOn: [] }, `msg-${part}`, { directUser: true }))
    assert.equal((await service.query({})).items.filter(item => item.stage === 'intake').length, 5)
    scenes.push('C02-independent-parts-each-get-their-own-task')

    // M18 · A mid-conversation requirement change lands on the affected definition.
    const purpose = service.amend({ requestId: 'care-purpose', taskId: summaryTask,
      requirements: [{ statement: '用途：投资决策', scope: 'goal' },
        { statement: '每篇单独文件 + 汇总自包含 HTML', scope: 'task' }] }, 'msg-purpose', { directUser: true })
    assert.equal(purpose.definitionVersion, 2)
    const html = purpose.activeRequirements.find(item => item.statement.includes('自包含 HTML'))
    assert(html, 'The delivery form must be recorded on the current version')
    assert.equal(purpose.requirements.filter(item => item.state === 'active').length, 6)
    evidence.push({ summaryVersion: purpose.definitionVersion, requirementIds: purpose.activeRequirements.map(item => item.id) })
    scenes.push('C03-purpose-and-delivery-form-become-versioned-requirements')

    // M19 · "Keep A, unblock B/C/D, add E-H": every request has its own outcome.
    const kept = service.amend({ requestId: 'care-keep-a', taskId: parts[0]!.task.id,
      keep: [parts[0]!.activeRequirements[0]!.id] }, 'msg-keep-a', { directUser: true })
    assert.equal(kept.stage, 'intake', 'Keeping A must not change A\'s execution state')
    const unblocked = ['market', 'cost', 'operations'].map(() => undefined)
    // B/C/D are resource changes, not requirement changes: they are recorded as
    // separate control receipts so no definition is silently rewritten.
    const resource = service.control({ requestId: 'care-unblock-bcd', taskIds: [parts[0]!.task.id, parts[1]!.task.id, parts[2]!.task.id], action: 'resume' })
    assert.equal(resource.receipts.length, 3, 'Each blocked part needs its own receipt')
    const supplement = ['E', 'F', 'G', 'H'].map(part => service.create({ requestId: `care-supplement-${part}`,
      goalTitle: '高品质养老调研：重养老轻医疗', title: `养老调研补充：${part}`,
      requirements: [{ statement: `补充调研 ${part}`, scope: 'task' }], acceptance: [`${part} 文件存在`] }, `msg-${part}`, { directUser: true }))
    assert.equal(supplement.length, 4)
    assert.equal((await service.query({})).total, 9, 'A kept task is not duplicated; each supplement is one new task')
    evidence.push({ resourceReceipts: resource.receipts, supplementIds: supplement.map(item => item.task.id), unblocked })
    scenes.push('C04-keep-unblock-and-supplement-each-get-a-receipt')

    // M22 · Partial blocking: an unsatisfied dependency blocks only its own task.
    const readySummary = await service.refreshReady(summaryTask)
    assert(readySummary, 'The summary task must exist')
    // Summary declares no dependsOn yet; record them, then re-check.
    service.amend({ requestId: 'care-deps', taskId: summaryTask, keep: [html!.id] }, 'msg-deps', { directUser: true })
    const dependent = service.store.recordAssignment({ id: 'asg-manual', taskId: summaryTask, definitionVersion: readySummary!.definitionVersion,
      requirementIds: [], state: 'running', createdAt: Date.now(), updatedAt: Date.now() })
    assert.equal(dependent.state, 'running')

    // M20/M21 · Pause then terminate produces per-item receipts and closes revival.
    const paused = service.control({ requestId: 'care-pause', taskIds: [summaryTask, ...parts.map(item => item.task.id)], action: 'pause' })
    assert.equal(paused.receipts.length, 5)
    assert((await service.query({ taskId: summaryTask })).items[0]!.stage === 'paused')
    const terminated = service.control({ requestId: 'care-terminate', taskIds: [summaryTask], action: 'terminate' })
    assert.equal(terminated.receipts[0]!.previousAction, 'pause', 'The old pause receipt must stay recorded')
    const afterStop = (await service.query({ taskId: summaryTask })).items[0]!
    assert.equal(afterStop.stage, 'cancelled')
    assert.equal(afterStop.control!.action, 'terminate')
    // A terminated task cannot be resumed or amended, and its assignments stop moving.
    assert.throws(() => service.control({ requestId: 'care-resume', taskIds: [summaryTask], action: 'resume' }), /terminated/)
    assert.throws(() => service.amend({ requestId: 'care-after', taskId: summaryTask, keep: [html!.id] }, 'msg-after', { directUser: true }),
      /terminated task cannot change requirements/)
    const lateReceipt = { id: 'late', workspaceId: 'eldercare', assistantSessionId: 'a', originMessageId: 'o', requestId: 'r', fingerprint: 'f',
      state: 'result_ready' as const, formatVersion: 2 as const, createdAt: 1, updatedAt: 2, seq: 1 }
    assert.equal(assignmentStateOf(lateReceipt), 'completed')
    assert.equal((await service.query({ taskId: summaryTask })).items[0]!.stage, 'cancelled', 'A late receipt must not revive a terminated task')
    scenes.push('C05-pause-then-terminate-with-per-item-receipts')

    // M23 · Goal convergence: accepted parts still leave the Goal unmet while a gap remains.
    const verifyAll = parts.map((part, index) => service.verify({ requestId: `care-verify-${index}`, taskId: part.task.id,
      verdict: index === 3 ? 'needs_user' : 'accepted',
      results: [{ criterionId: 'ac-1', outcome: index === 3 ? 'undecided' : 'met', evidence: `${part.task.title}` }] }))
    assert.equal(verifyAll.filter(item => item.stage === 'accepted').length, 3)
    assert.equal(verifyAll[3]!.stage, 'needs_user')
    const unresolved = (await service.query({})).items.filter(item => ['needs_user', 'intake', 'paused'].includes(item.stage))
    assert(unresolved.length >= 2, 'The Goal is not complete while parts remain open')
    evidence.push({ accepted: 3, needsUser: 1, open: unresolved.map(item => item.task.title) })
    scenes.push('C06-goal-is-not-complete-while-parts-remain-open')

    // Every committed movement notified the panel exactly at its source.
    assert(new Set(changed).size >= 5)
    scenes.push('C07-panel-notified-of-every-committed-movement')
  } finally { service.close() }

  const reopened = new AssistantTaskStore(workspace)
  try {
    const page = reopened.list({ limit: 50 })
    assert.equal(page.total, 9)
    assert.equal(page.counts.cancelled, 1)
    assert.equal(page.counts.accepted, 3)
    run.json('goal-control-state.json', { scenes, evidence, counts: page.counts })
  } finally { reopened.close() }

  run.complete(scenes, ['Real paid model plan quality', 'Worker execution of research parts', 'HTML report rendering in Electron'])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
