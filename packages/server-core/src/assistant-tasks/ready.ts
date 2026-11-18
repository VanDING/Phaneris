import type { ReadyView, TaskProjectionView } from '@phaneris/session-tools-core/task-delegation-contracts'

/**
 * Execution preconditions for one task definition version.
 *
 * `Ready` means this version could be dispatched — not that it was, and not that
 * it succeeded. Capacity is deliberately absent: it belongs to the scheduler, and
 * a full queue must not make a task look unready.
 */
export interface ReadyFacts {
  /** Effective permission mode for execution in this workspace. */
  permissionMode: 'safe' | 'ask' | 'guarded' | 'allow-all'
  /** Working directory the task would execute in, absent when unresolvable. */
  workingDirectory?: string
  /** Dependency task ids that are not accepted yet. */
  unsatisfiedDependencies?: readonly string[]
  /** Concrete authorization gaps the Assistant reported for this work. */
  authorityGaps?: readonly string[]
}

export function checkReady(projection: TaskProjectionView, facts: ReadyFacts): ReadyView {
  const missing: string[] = []
  if (!projection.task.title.trim()) missing.push('task_title')
  if (!projection.activeRequirements.length) missing.push('no_recorded_requirement')
  if (!projection.task.acceptance.length) missing.push('no_acceptance_criterion')
  if (!facts.workingDirectory) missing.push('working_directory_unresolved')
  for (const dependency of facts.unsatisfiedDependencies ?? []) missing.push(`dependency_not_accepted:${dependency}`)
  for (const gap of facts.authorityGaps ?? []) missing.push(`authority_gap:${gap}`)
  return { taskId: projection.task.id, definitionVersion: projection.task.definitionVersion,
    ready: missing.length === 0, missing, authority: [`permission:${facts.permissionMode}`], checkedAt: Date.now() }
}
