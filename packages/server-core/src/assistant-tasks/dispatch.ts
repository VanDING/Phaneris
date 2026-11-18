import type { AssignmentView, TaskProjectionView } from '@phaneris/session-tools-core/task-delegation-contracts'
import type { AssistantDelegationReceipt } from '@phaneris/session-tools-core/delegation-contracts'
import { AssistantTaskStore } from './store'

/**
 * Execution adapter between the delegation definition and the existing runtime.
 *
 * The definition layer decides what is authorized and ready; this adapter only
 * binds one assignment to the execution receipt that actually runs it, and maps
 * the runtime's own states back onto the assignment. It never invents progress:
 * a state the runtime did not report stays absent.
 */
export interface TaskDispatchHost {
  /** Hand one ready definition to the existing Session/Runtime path. */
  dispatch(definition: TaskProjectionView): Promise<AssistantDelegationReceipt>
  /** Stop or pause execution owned by a specific assignment. */
  control?(assignment: AssignmentView, action: 'pause' | 'resume' | 'terminate'): Promise<void>
}

/** Runtime receipt states → assignment states, one-to-one and lossless. */
export function assignmentStateOf(receipt: AssistantDelegationReceipt): AssignmentView['state'] {
  switch (receipt.state) {
    case 'preparing': return 'admitted'
    case 'accepted': return 'queued'
    case 'submitting':
    case 'submitted': return 'running'
    case 'pause_requested':
    case 'cancel_requested': return 'stopping'
    case 'paused': return 'stopped'
    case 'result_ready': return 'completed'
    case 'needs_attention': return 'failed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
  }
}

export class AssistantTaskDispatcher {
  constructor(private readonly store: AssistantTaskStore, private readonly host: TaskDispatchHost) {}

  /**
   * Admit one assignment for the current definition version.
   *
   * Refuses unless the Host's own readiness record says this version is ready, so
   * a stale `ready` flag from an earlier version can never authorize dispatch.
   */
  async dispatch(taskId: string): Promise<{ assignment: AssignmentView; receipt: AssistantDelegationReceipt }> {
    const projection = this.store.projection(taskId)
    if (!projection) throw new Error(`Unknown task ${taskId}`)
    if (projection.stage === 'cancelled') throw new Error(`Task ${taskId} is terminated and cannot be dispatched`)
    if (projection.stage === 'paused') throw new Error(`Task ${taskId} is paused; resume it before dispatching`)
    if (projection.verification?.verdict === 'accepted') throw new Error(`Task ${taskId} is already accepted`)
    const ready = projection.ready
    if (!ready) throw new Error(`Task ${taskId} has no readiness record; check its preconditions first`)
    if (ready.definitionVersion !== projection.task.definitionVersion)
      throw new Error(`Task ${taskId} readiness covers version ${ready.definitionVersion}, but version ${projection.task.definitionVersion} is current`)
    if (!ready.ready) throw new Error(`Task ${taskId} is not ready: ${ready.missing.join(', ')}`)

    const assignment: AssignmentView = { id: `asg-${taskId}-${projection.assignments.length + 1}`, taskId,
      definitionVersion: projection.task.definitionVersion,
      requirementIds: projection.activeRequirements.map(requirement => requirement.id),
      state: 'admitted', createdAt: Date.now(), updatedAt: Date.now() }
    this.store.recordAssignment(assignment)
    const receipt = await this.host.dispatch(projection)
    const bound: AssignmentView = { ...assignment, state: assignmentStateOf(receipt), delegationId: receipt.id,
      sessionId: receipt.sessionId, inputMessageId: receipt.inputMessageId, updatedAt: Date.now() }
    this.store.recordAssignment(bound)
    return { assignment: bound, receipt }
  }

  /** Mirror a later runtime receipt onto the assignment that owns it. */
  settled(receipt: AssistantDelegationReceipt): AssignmentView | undefined {
    const assignment = this.store.assignmentForDelegation(receipt.id)
    if (!assignment) return undefined
    return this.store.recordAssignment({ ...assignment, state: assignmentStateOf(receipt), sessionId: receipt.sessionId ?? assignment.sessionId,
      inputMessageId: receipt.inputMessageId ?? assignment.inputMessageId, error: receipt.error, updatedAt: Date.now() })
  }
}
