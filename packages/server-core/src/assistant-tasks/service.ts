import { AssistantTaskStore } from './store'
import { checkReady, type ReadyFacts } from './ready'
import { countStages } from './stage'
import { AssistantTaskDispatcher, type TaskDispatchHost } from './dispatch'
import type {
  DelegationTaskAmend, DelegationTaskCreate, DelegationTaskControl, TaskControlResult, TaskPageView, TaskProjectionView, DelegationTaskQuery, DelegationTaskVerify,
} from '@phaneris/session-tools-core/task-delegation-contracts'

export interface TaskServiceHost {
  /** Current execution facts for the assignment this task would admit. */
  readyFacts(task: TaskProjectionView): Promise<ReadyFacts>
  /** Notify the panel that a task's definition, control or acceptance moved. */
  changed(taskId?: string): void
}

/**
 * Delegation orchestration above the store.
 *
 * The Assistant states meaning; this service binds the trusted input, asks the
 * Host for current execution facts, and records versions, readiness and control
 * receipts. Execution stays in SessionManager and file versions stay in
 * Artifact; this layer only references them.
 */
export class AssistantTaskService {
  readonly store: AssistantTaskStore
  private dispatcher?: AssistantTaskDispatcher
  constructor(readonly workspace: { id: string; rootPath: string }, private readonly host: TaskServiceHost) {
    this.store = new AssistantTaskStore(workspace)
  }

  close(): void { this.store.close() }

  /** Execution adapter is installed by the Host that owns the Session runtime. */
  connect(host: TaskDispatchHost): AssistantTaskDispatcher {
    return this.dispatcher ??= new AssistantTaskDispatcher(this.store, host)
  }

  create(input: DelegationTaskCreate, inputMessageId: string | undefined, authority: { directUser: boolean }): TaskProjectionView {
    if (!authority.directUser) throw new Error('task_authority: only a direct user instruction can define new work')
    const projection = this.store.create(input, inputMessageId)
    this.host.changed(projection.task.id)
    return projection
  }

  amend(input: DelegationTaskAmend, inputMessageId: string | undefined, authority: { directUser: boolean }): TaskProjectionView {
    if (!authority.directUser) throw new Error('task_authority: only a direct user instruction can change requirements')
    const projection = this.store.amend(input, inputMessageId)
    this.host.changed(projection.task.id)
    return projection
  }

  /** Bounded read; `checkReady` additionally persists a precondition record. */
  async query(input: DelegationTaskQuery): Promise<TaskPageView> {
    // The readiness record is a Host fact, so a query that asks for it must
    // compute it against the current version rather than echo a stale verdict.
    if (input.checkReady && input.taskId) {
      const refreshed = await this.refreshReady(input.taskId)
      if (!refreshed) return { observedAt: Date.now(), items: [], counts: {}, total: 0 }
      return { observedAt: Date.now(), items: [refreshed], counts: countStages([refreshed]), total: 1 }
    }
    return this.store.list(input)
  }

  /** Recomputes and persists readiness for one task's current version. */
  async refreshReady(taskId: string): Promise<TaskProjectionView | undefined> {
    const projection = this.store.projection(taskId)
    if (!projection) return undefined
    return this.store.applyReady(checkReady(projection, await this.host.readyFacts(projection)))
  }

  control(input: DelegationTaskControl): TaskControlResult {
    const result = this.store.control(input)
    for (const receipt of result.receipts) this.host.changed(receipt.taskId)
    return result
  }

  verify(input: DelegationTaskVerify, assignmentId?: string): TaskProjectionView {
    const current = this.store.projection(input.taskId)
    if (!current) throw new Error(`Unknown task ${input.taskId}`)
    const projection = this.store.recordVerification(input, current.task.definitionVersion, assignmentId)
    this.host.changed(projection.task.id)
    return projection
  }
}
