import type { TaskProjectionView, TaskStage } from '@phaneris/session-tools-core/task-delegation-contracts'

/**
 * Which task the focus board shows, and what the user may do to it.
 *
 * Pure derivations over the Host's projection: nothing here invents state,
 * decides acceptance or guesses progress. A stage the Host recorded is the
 * only thing that grants an action, so a button can never appear for work
 * whose preconditions the Host would refuse.
 */

/** Stage grouping used by the capacity strip, in the order it renders. */
export const FOCUS_GROUPS = ['needs', 'active', 'settled'] as const
export type FocusGroup = (typeof FOCUS_GROUPS)[number]

/**
 * Map a Host stage onto the strip's group.
 *
 * `terminate` outranks everything in the Host's own derivation, so a
 * terminated task is settled here too — it must not sit among live work.
 */
export function focusGroupOf(stage: TaskStage): FocusGroup {
  if (stage === 'accepted' || stage === 'cancelled' || stage === 'failed') return 'settled'
  if (stage === 'needs_user' || stage === 'candidate_result' || stage === 'rework') return 'needs'
  return 'active'
}

/** A task the user must act on before the work can move. */
export function needsDecision(stage: TaskStage): boolean {
  return stage === 'needs_user' || stage === 'candidate_result' || stage === 'rework'
}

/**
 * The task the board opens on: the first one waiting for the user, else the
 * first still in flight. Chosen here rather than in the component so the
 * initial selection is one rule, testable and independent of render order.
 */
export function initialFocus(items: readonly TaskProjectionView[]): string | undefined {
  return items.find(item => focusGroupOf(item.stage) === 'needs')?.task.id
    ?? items.find(item => focusGroupOf(item.stage) === 'active')?.task.id
    ?? items[0]?.task.id
}

export type FocusAction = 'accept' | 'rework' | 'pause' | 'resume' | 'terminate'

/**
 * The actions the Host would actually honour for this projection.
 *
 * Kept aligned with `SessionManager.dispatchAssistantTask`, which refuses a
 * terminated or paused task and refuses one already accepted. An action that
 * would be rejected there is not offered here.
 *
 * Pause and terminate control *execution*; once a run has finished there is
 * nothing to stop, so a candidate result offers the acceptance decision
 * instead of controls that would have no effect.
 */
export function actionsFor(projection: TaskProjectionView): readonly FocusAction[] {
  const control = projection.control?.action
  if (control === 'terminate') return []
  if (projection.verification?.verdict === 'accepted') return []
  if (control === 'pause') return ['resume']
  // A result to judge: acceptance replaces the execution controls.
  if (projection.stage === 'candidate_result' || projection.stage === 'rework') return ['accept', 'rework']
  if (projection.stage === 'accepted') return []
  return ['pause', 'terminate']
}

/**
 * The capacity strip's segments: every task in play, grouped, in Host order.
 *
 * Terminated and accepted work is excluded: the strip exists to switch
 * between things the user can still act on, and an empty group must not
 * render a segment.
 */
export function segmentsFor(items: readonly TaskProjectionView[]): Array<{
  taskId: string; title: string; group: FocusGroup; stage: TaskStage
}> {
  return items
    .filter(item => item.stage !== 'accepted' && item.stage !== 'cancelled')
    .map(item => ({ taskId: item.task.id, title: item.task.title, group: focusGroupOf(item.stage), stage: item.stage }))
}

/** The stage's tone, i.e. which state the gauge bar has to read as. */
export type FocusTone = 'needs' | 'active' | 'idle' | 'failed' | 'settled'

/**
 * A stage's tone, used by the gauge bars.
 *
 * `focusGroupOf` answers "which section does this belong to"; the tone answers
 * "what does the bar look like". They agree on `needs` and `settled`, and the
 * tone splits the active group by whether the work is actually moving.
 */
export function focusToneOf(stage: TaskStage): FocusTone {
  if (stage === 'needs_user' || stage === 'candidate_result' || stage === 'rework') return 'needs'
  if (stage === 'running' || stage === 'stopping') return 'active'
  if (stage === 'failed') return 'failed'
  if (stage === 'accepted' || stage === 'cancelled') return 'settled'
  return 'idle'
}

/**
 * The task's own reason for needing the user, in the Host's words.
 *
 * The board used to show only the stage ("needs your decision") and leave the
 * reason in the task detail. But the first question a reader has is *why*, and
 * a stage word never answers it. Only recorded facts are returned: a task with
 * no recorded reason yields `undefined` and the panel falls back to its own
 * copy rather than inventing a cause.
 */
export function askedReasonOf(projection: TaskProjectionView): string | undefined {
  if (!needsDecision(projection.stage)) return undefined
  const invalidation = projection.verification?.reason
  if (invalidation) return invalidation
  if (projection.ready && !projection.ready.ready && projection.ready.missing.length) {
    return projection.ready.missing.join('；')
  }
  return undefined
}

/**
 * Why a task is not moving, in the Host's own words.
 *
 * Derived only from facts the Host recorded; a queued task with no recorded
 * reason is reported as simply queued rather than given an invented cause.
 */
export function reasonOf(projection: TaskProjectionView, capacity: { occupied: number; capacity: number } | undefined): string | undefined {
  if (projection.stage === 'paused') return 'paused'
  if (projection.stage !== 'queued' && projection.stage !== 'intake') return undefined
  // The Host's own readiness record names the concrete missing preconditions.
  if (projection.ready && !projection.ready.ready) return projection.ready.missing.length ? 'precondition' : 'queued'
  if (projection.task.dependsOn.length) return 'dependency'
  if (capacity && capacity.occupied >= capacity.capacity) return 'capacity'
  return 'queued'
}
