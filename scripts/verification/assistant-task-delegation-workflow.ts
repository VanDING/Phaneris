import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Stage 1 acceptance: one sentence becomes a versioned, inspectable delegation,
 * and a correction appends a requirement version instead of overwriting one.
 *
 * Failure conditions are fixed in
 * docs/verification/assistant-refactor-2026-11-18-failure-matrix.md (M01-M09).
 * This workflow drives the real workspace store through the real service; it
 * does not assert on model text, because that is a separate live-model run.
 */
await verificationWorkflow('assistant-task-delegation', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const root = mkdtempSync(resolve('.cache/verification/assistant-tasks-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  process.env.NODE_ENV = 'test'
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  const workspace = { id: 'delegation', rootPath: workspaceRoot }
  const { AssistantTaskService } = await import('../../packages/server-core/src/assistant-tasks/service')
  const { AssistantTaskStore } = await import('../../packages/server-core/src/assistant-tasks/store')

  const changed: string[] = []
  const service = new AssistantTaskService(workspace, {
    readyFacts: async () => ({ permissionMode: 'safe', workingDirectory: workspaceRoot }),
    changed: taskId => { if (taskId) changed.push(taskId) },
  })
  const scenes: string[] = []
  try {
    // M02 · One clear request becomes exactly one Goal + Task + requirement version + Change.
    const created = service.create({ requestId: 'req-pelican', goalTitle: 'Deliver a pelican HTML', title: 'Pelican on a bicycle HTML',
      scopeIn: ['single self-contained HTML file'], scopeOut: ['external network requests'],
      requirements: [{ statement: 'A pelican rides a bicycle', scope: 'task', quote: '做一个鹈鹕骑自行车的HTML' },
        { statement: 'Deliver one self-contained file', scope: 'task' }],
      acceptance: ['The file opens in a browser', 'The pelican and bicycle are visible'], deliverable: 'self-contained HTML' }, 'msg-1', { directUser: true })
    assert.equal(created.stage, 'intake')
    assert.equal(created.definitionVersion, 1)
    assert.equal(created.activeRequirements.length, 2)
    assert.equal(created.changes.length, 1)
    assert.equal(created.changes[0]!.producedVersion, 1)
    assert.equal(created.changes[0]!.inputMessageId, 'msg-1')
    assert.equal(created.goal.title, 'Deliver a pelican HTML')
    assert.equal(created.requirements[0]!.quote, '做一个鹈鹕骑自行车的HTML')
    scenes.push('A01-one-request-becomes-goal-task-requirement-and-change')

    // M06 · Replaying the same trusted request returns its original result.
    const replay = service.create({ requestId: 'req-pelican', goalTitle: 'ignored', title: 'ignored', requirements: [], acceptance: [] }, 'msg-9', { directUser: true })
    assert.equal(replay.task.id, created.task.id)
    assert.equal(replay.definitionVersion, 1)
    assert.equal((await service.query({})).total, 1)
    scenes.push('A02-replayed-request-creates-nothing-new')

    // M02/M06 · One trusted input defines work once, even when the model retries
    // under a fresh request id. A live model did exactly that and produced two
    // Tasks from one message before this was fixed; a new id is not new intent.
    const retried = service.create({ requestId: 'req-pelican-retry-2', goalTitle: 'A different goal', title: 'A different task',
      requirements: [{ statement: 'A different requirement', scope: 'task' }], acceptance: [] }, 'msg-1', { directUser: true })
    assert.equal(retried.task.id, created.task.id, 'a retry under a new request id must return the Task the input already created')
    assert.equal((await service.query({})).total, 1, 'one input must never leave two Tasks behind')
    assert.equal(retried.goal.title, created.goal.title, 'the second attempt must not replace the recorded Goal')
    scenes.push('A02b-retry-with-a-fresh-request-id-does-not-duplicate-work')

    // M04 · A correction appends a requirement version and keeps the old one readable.
    const amended = service.amend({ requestId: 'req-dark', taskId: created.task.id,
      requirements: [{ supersedes: created.activeRequirements[0]!.id, statement: 'A dark-background pelican rides a bicycle', scope: 'task' }] }, 'msg-2', { directUser: true })
    assert.equal(amended.definitionVersion, 2)
    assert.equal(amended.activeRequirements.length, 2)
    const superseded = amended.requirements.filter(item => item.state === 'superseded')
    assert.equal(superseded.length, 1)
    assert.equal(superseded[0]!.statement, 'A pelican rides a bicycle')
    assert.equal(amended.activeRequirements.find(item => item.statement.includes('dark-background'))?.supersedes, superseded[0]!.id)
    assert.equal(amended.changes.at(-1)!.items[0]!.action, 'replaced')
    scenes.push('A03-correction-appends-version-and-keeps-prior-statement')

    // M09 · Withdrawing keeps the record and the history instead of deleting it.
    const withdrawn = service.amend({ requestId: 'req-drop', taskId: created.task.id, withdraw: [amended.activeRequirements[1]!.id] }, 'msg-3', { directUser: true })
    assert.equal(withdrawn.definitionVersion, 3)
    assert.equal(withdrawn.activeRequirements.length, 1)
    assert.equal(withdrawn.requirements.find(item => item.state === 'withdrawn')?.id, amended.activeRequirements[1]!.id)
    scenes.push('A04-withdrawn-requirement-stays-readable')

    // M05 · A keep-only statement is a real change with an explicit record.
    const kept = service.amend({ requestId: 'req-keep', taskId: created.task.id, keep: [withdrawn.activeRequirements[0]!.id] }, 'msg-4', { directUser: true })
    assert.equal(kept.changes.at(-1)!.items[0]!.action, 'kept')
    assert.equal(kept.definitionVersion, 4)
    scenes.push('A05-explicit-keep-is-recorded-not-inferred')

    // M08 · Readiness reports concrete facts instead of a blanket verdict.
    const ready = await service.refreshReady(created.task.id)
    assert(ready?.ready?.ready, 'Expected the delegation to be ready: no missing preconditions')
    assert.deepEqual(ready!.ready!.missing, [])
    assert.equal(ready!.ready!.definitionVersion, 4)
    assert(ready!.ready!.authority.includes('permission:safe'))
    scenes.push('A06-ready-binds-version-and-authority')

    // M01 · An unknown task id is a refusal, never a fabricated projection.
    assert.throws(() => service.amend({ requestId: 'req-ghost', taskId: 'task-missing', keep: [] }, 'msg-5', { directUser: true }), /Unknown task/)
    scenes.push('A07-unknown-task-is-refused')

    // M07 · An internal event cannot define or change work.
    assert.throws(() => service.create({ requestId: 'req-internal', goalTitle: 'x', title: 'x', requirements: [], acceptance: [] }, 'msg-6', { directUser: false }),
      /task_authority/)
    scenes.push('A08-internal-input-cannot-define-work')

    // M19/M20 · Control is a durable receipt and termination is final.
    const paused = service.control({ requestId: 'ctl-pause', taskIds: [created.task.id], action: 'pause' })
    assert.equal(paused.receipts[0]!.action, 'pause')
    assert.equal((await service.query({ taskId: created.task.id })).items[0]!.stage, 'paused')
    const resumed = service.control({ requestId: 'ctl-resume', taskIds: [created.task.id], action: 'resume' })
    assert.equal(resumed.receipts[0]!.previousAction, 'pause')
    const terminated = service.control({ requestId: 'ctl-stop', taskIds: [created.task.id], action: 'terminate' })
    assert.equal(terminated.receipts[0]!.action, 'terminate')
    assert.equal((await service.query({ taskId: created.task.id })).items[0]!.stage, 'cancelled')
    assert.throws(() => service.control({ requestId: 'ctl-revive', taskIds: [created.task.id], action: 'resume' }), /terminated/)
    assert.throws(() => service.amend({ requestId: 'req-after-stop', taskId: created.task.id, keep: [withdrawn.activeRequirements[0]!.id] }, 'msg-7', { directUser: true }),
      /terminated task cannot change requirements/)
    scenes.push('A09-termination-closes-further-definition-and-resume')

    // M10/M11 · Acceptance binds a definition version and survives later reads.
    const verified = service.verify({ requestId: 'ver-1', taskId: created.task.id, verdict: 'accepted',
      results: [{ criterionId: 'ac-1', outcome: 'met', evidence: 'opened the file' }] })
    assert.equal(verified.verification!.verdict, 'accepted')
    assert.equal(verified.verification!.definitionVersion, 4)
    assert.equal((await service.query({ taskId: created.task.id })).items[0]!.stage, 'cancelled')
    scenes.push('A10-verification-binds-the-reviewed-version')

    // The panel is notified for every committed definition/control/acceptance move.
    assert(changed.includes(created.task.id))
    scenes.push('A11-panel-is-notified-of-committed-changes')
  } finally { service.close() }

  // A closed store reopens at the same version; nothing was cached in the process.
  const reopened = new AssistantTaskStore(workspace)
  try {
    const projections = reopened.list({}).items
    assert.equal(projections.length, 1)
    assert.equal(projections[0]!.definitionVersion, 4)
    assert.equal(projections[0]!.requirements.length, 3)
    assert.equal(projections[0]!.changes.length, 4)
    assert.equal(projections[0]!.stage, 'cancelled')
    scenes.push('A12-definition-and-history-survive-a-reopen')
    run.json('delegation-state.json', { scenes, projection: projections[0] })
  } finally { reopened.close() }

  writeFileSync(join(run.directory, 'delegation-summary.txt'), scenes.join('\n') + '\n')
  run.complete(scenes, ['Live model intent quality', 'Execution dispatch to a real Session', 'Panel rendering in Electron'])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
