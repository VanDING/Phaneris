import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import { actionsFor, focusGroupOf, initialFocus, reasonOf, segmentsFor } from '../../apps/electron/src/renderer/components/resident-assistant/focus-board'
import type { TaskProjectionView, TaskStage } from '@phaneris/session-tools-core/task-delegation-contracts'

/**
 * The assistant work board: the pure rules that decide what it shows and what
 * it offers, verified against the Host's own stage vocabulary.
 *
 * The board must never offer an action the Host would refuse, and must never
 * open on finished work when something is waiting for the user. Those are the
 * two failures this exercises, plus the strip's segment derivation.
 */

function projection(stage: TaskStage, extra: Partial<TaskProjectionView> = {}): TaskProjectionView {
  return {
    task: { id: `task-${stage}`, goalId: 'goal-1', title: `任务 ${stage}`, scopeIn: [], scopeOut: [],
      acceptance: [], dependsOn: [], definitionVersion: 1, createdAt: 1, updatedAt: 1 },
    goal: { id: 'goal-1', title: '目标', successCriteria: [], createdAt: 1, updatedAt: 1 },
    requirements: [], activeRequirements: [], changes: [], assignments: [],
    stage, definitionVersion: 1, definitionAheadOfExecution: false,
    ...extra,
  } as TaskProjectionView
}

await verificationWorkflow('assistant-task-board', async run => {
  const scenes: string[] = []
  const evidence: unknown[] = []

  // 1 · The board opens on work that needs the user before work that is moving.
  const opening = initialFocus([
    projection('running'),
    projection('candidate_result'),
    projection('queued'),
  ])
  assert.equal(opening, 'task-candidate_result', 'the board opens on the task waiting for the user')
  assert.equal(initialFocus([projection('running'), projection('queued')]), 'task-running', 'with nothing waiting, the board opens on the active task')
  assert.equal(initialFocus([]), undefined, 'an empty board has no selection')
  scenes.push('F01-opens-on-the-task-that-needs-the-user')

  // 2 · Termination outranks execution: a terminated task never offers an action.
  const terminated = projection('cancelled', { control: { taskId: 't', action: 'terminate', at: 1 } })
  assert.deepEqual(actionsFor(terminated), [], 'a terminated task offers nothing')
  assert.equal(focusGroupOf('cancelled'), 'settled', 'a terminated task is settled, not active')
  scenes.push('F02-terminated-work-offers-no-action')

  // 3 · Acceptance exists only once there is a result to judge.
  assert.deepEqual([...actionsFor(projection('candidate_result'))], ['accept', 'rework'], 'a finished run can be accepted or returned')
  assert.deepEqual([...actionsFor(projection('running'))], ['pause', 'terminate'], 'a running task can be paused or terminated')
  assert(!actionsFor(projection('queued')).includes('accept'), 'a queued task has nothing to accept')
  const accepted = projection('accepted', { verification: { id: 'v', taskId: 't', definitionVersion: 1, verdict: 'accepted', results: [], createdAt: 1 } })
  assert.deepEqual(actionsFor(accepted), [], 'an accepted task offers nothing further')
  scenes.push('F03-actions-follow-the-recorded-stage')

  // 4 · A paused task resumes; pause is not offered twice.
  const paused = projection('paused', { control: { taskId: 't', action: 'pause', at: 1 } })
  assert.deepEqual([...actionsFor(paused)], ['resume'], 'a paused task resumes')
  scenes.push('F04-pause-and-resume-are-one-state')

  // 5 · The strip carries live work only, and never an empty group.
  const segments = segmentsFor([projection('running'), projection('candidate_result'), projection('accepted'), projection('cancelled')])
  assert.equal(segments.length, 2, 'settled work is not a switchable segment')
  assert.deepEqual(segments.map(segment => segment.stage).sort(), ['candidate_result', 'running'])
  scenes.push('F05-strip-carries-live-work-only')

  // 6 · A reason is only given when the Host recorded one.
  assert.equal(reasonOf(projection('queued'), { occupied: 4, capacity: 4 }), 'capacity', 'a full queue names capacity')
  assert.equal(reasonOf(projection('queued'), { occupied: 1, capacity: 4 }), 'queued', 'an unexplained queue is not given an invented cause')
  assert.equal(reasonOf(projection('paused'), undefined), 'paused')
  assert.equal(reasonOf(projection('running'), { occupied: 4, capacity: 4 }), undefined, 'a running task is not reported as blocked')
  const awaitingDependency = projection('queued', {
    task: { ...projection('queued').task, dependsOn: ['task-a'] },
  })
  assert.equal(reasonOf(awaitingDependency, { occupied: 1, capacity: 4 }), 'dependency', 'a declared dependency is named')
  scenes.push('F06-reasons-come-from-recorded-facts')

  run.json('board-evidence.json', { scenes, evidence })
  run.complete(scenes, [
    'Electron rendering of the board (covered by the Electron workflow)',
    'Real model producing the delegations',
  ])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
