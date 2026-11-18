import type { AssignmentView, GoalView, ReadyView, RequirementView, TaskControlAction, TaskProjectionView, TaskStage, VerificationView } from '@phaneris/session-tools-core/task-delegation-contracts'

/**
 * Pure stage derivation. Every branch answers a fact the store already holds;
 * nothing here infers progress the Host cannot show evidence for.
 *
 * Precedence: explicit control and acceptance outrank execution, and execution
 * outranks readiness — a running task must never be reported as "not ready yet",
 * and a terminated task must never appear to be running.
 */
export function deriveStage(input: {
  assignments: readonly AssignmentView[]
  control?: { action: TaskControlAction }
  verification?: VerificationView
  ready?: ReadyView
}): TaskStage {
  const { assignments, control, verification } = input
  if (control?.action === 'terminate') return 'cancelled'
  if (verification?.verdict === 'accepted') return 'accepted'
  if (verification?.verdict === 'rework') return 'rework'
  if (verification?.verdict === 'needs_user') return 'needs_user'

  const active = assignments.filter(assignment => !['completed', 'failed', 'cancelled', 'stopped'].includes(assignment.state))
  if (active.some(assignment => assignment.state === 'stopping')) return 'stopping'
  if (active.some(assignment => assignment.state === 'running')) return 'running'
  // A pause freezes new admission even with nothing running yet; reporting it as
  // "ready" would claim the Host would admit work it has been told to hold.
  if (control?.action === 'pause') return 'paused'
  if (active.length) return 'queued'

  const finished = assignments.filter(assignment => assignment.state === 'completed' || assignment.state === 'failed')
  if (finished.some(assignment => assignment.state === 'completed')) return 'candidate_result'
  if (finished.some(assignment => assignment.state === 'failed')) return 'failed'
  return input.ready?.ready ? 'ready' : 'intake'
}

type ProjectionFacts = Omit<TaskProjectionView, 'stage' | 'executedVersion' | 'definitionAheadOfExecution'>

/** Unify every read path (tool, RPC, tests) onto one derivation. */
export function projectTask(facts: ProjectionFacts): TaskProjectionView {
  const stage = deriveStage({ assignments: facts.assignments, control: facts.control, verification: facts.verification, ready: facts.ready })
  const executedVersion = facts.assignments.reduce<number | undefined>((highest, assignment) =>
    highest === undefined || assignment.definitionVersion > highest ? assignment.definitionVersion : highest, undefined)
  return { ...facts, stage, executedVersion,
    definitionAheadOfExecution: executedVersion !== undefined && facts.definitionVersion > executedVersion }
}

export function countStages(projections: readonly TaskProjectionView[]): Partial<Record<TaskStage, number>> {
  const counts: Partial<Record<TaskStage, number>> = {}
  for (const projection of projections) counts[projection.stage] = (counts[projection.stage] ?? 0) + 1
  return counts
}

/** Compile-checked aliases so the domain module reads in its own vocabulary. */
export type ProjectionFactsInput = { goal: GoalView; requirements: RequirementView[]; assignments: AssignmentView[]; verification?: VerificationView; ready?: ReadyView }
