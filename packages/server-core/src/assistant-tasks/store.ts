import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type {
  DelegationTaskAmend, AssignmentView, ChangeView, DelegationTaskCreate, GoalView, ReadyView, RequirementInput, RequirementView,
  TaskControlAction, DelegationTaskControl, TaskControlResult, TaskPageView, TaskProjectionView, DelegationTaskQuery, TaskRecordView,
  DelegationTaskVerify, VerificationView,
} from '@phaneris/session-tools-core/task-delegation-contracts'
import { countStages, projectTask } from './stage'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'

const SCHEMA_VERSION = 1

/**
 * The single writer of delegation definitions in a workspace.
 *
 * Identity, definition versions, requirement history, assignment admission,
 * control receipts and verification decisions all commit here, so a crash can
 * never leave two of them disagreeing. Execution facts stay in the Runtime and
 * file versions stay in Artifact; this store only references them.
 */
export class AssistantTaskStore {
  private readonly db: SqliteDatabase
  constructor(readonly workspace: { id: string; rootPath: string }) {
    const path = join(workspace.rootPath, 'assistant', 'tasks.db')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = openSqliteDatabase(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000')
    this.migrate()
    const owner = this.db.prepare('SELECT workspace_id FROM owner WHERE singleton=1').get() as { workspace_id: string } | undefined
    if (!owner) this.db.prepare('INSERT INTO owner (singleton, workspace_id) VALUES (1, ?)').run(workspace.id)
    else if (owner.workspace_id !== workspace.id) throw new Error('Assistant task database belongs to another workspace')
  }

  private migrate(): void {
    const current = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (current > SCHEMA_VERSION) throw new Error(`Assistant task schema ${current} is newer than supported ${SCHEMA_VERSION}`)
    if (current >= SCHEMA_VERSION) return
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, definition_version INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ready (task_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS controls (task_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verifications (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, kind TEXT NOT NULL, result TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS requirements_task ON requirements (task_id, version);
      CREATE INDEX IF NOT EXISTS changes_task ON changes (task_id);
      CREATE INDEX IF NOT EXISTS assignments_task ON assignments (task_id);
      CREATE INDEX IF NOT EXISTS verifications_task ON verifications (task_id);
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;`)
  }

  close(): void { this.db.close() }

  /** The same trusted request id returns its original result; a new input never does. */
  private replay<T>(requestId: string, kind: string, produce: () => T): T {
    const prior = this.db.prepare('SELECT kind, result FROM requests WHERE request_id=?').get(requestId) as { kind: string; result: string } | undefined
    if (prior) {
      if (prior.kind !== kind) throw new Error(`Request id ${requestId} was already used for a ${prior.kind} change`)
      return JSON.parse(prior.result) as T
    }
    return produce()
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { try { this.db.exec('ROLLBACK') } catch { /* preserve the original failure */ } throw error }
  }

  private body<T>(table: string, id: string, column = 'id'): T | undefined {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE ${column}=?`).get(id) as { body: string } | undefined
    return row ? JSON.parse(row.body) as T : undefined
  }
  private bodies<T>(table: string, taskId: string, order = 'rowid'): T[] {
    return (this.db.prepare(`SELECT body FROM ${table} WHERE task_id=? ORDER BY ${order}`).all(taskId) as Array<{ body: string }>)
      .map(row => JSON.parse(row.body) as T)
  }

  /** Latest decision wins for display; the table keeps every earlier review. */
  private latestVerification(taskId: string): VerificationView | undefined {
    const row = this.db.prepare('SELECT body FROM verifications WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId) as { body: string } | undefined
    return row ? JSON.parse(row.body) as VerificationView : undefined
  }

  projection(taskId: string): TaskProjectionView | undefined {
    const task = this.body<TaskRecordView>('tasks', taskId)
    const goal = task && this.body<GoalView>('goals', task.goalId)
    if (!task || !goal) return undefined
    const requirements = this.bodies<RequirementView>('requirements', taskId, 'version')
    return projectTask({ task, goal, requirements, activeRequirements: requirements.filter(item => item.state === 'active'),
      changes: this.bodies<ChangeView>('changes', taskId), assignments: this.bodies<AssignmentView>('assignments', taskId),
      ready: this.body<ReadyView>('ready', taskId, 'task_id'),
      control: this.body<{ taskId: string; action: TaskControlAction; at: number; reason?: string }>('controls', taskId, 'task_id'),
      verification: this.latestVerification(taskId), definitionVersion: task.definitionVersion })
  }

  private assertProjection(taskId: string): TaskProjectionView {
    const projection = this.projection(taskId)
    if (!projection) throw new Error(`Task ${taskId} vanished while committing`)
    return projection
  }

  list(input: DelegationTaskQuery & { taskIds?: readonly string[] }): TaskPageView {
    // A single-task read must address exactly that record; falling back to the
    // full list here would make the query cost scale with workspace history.
    const single = input.taskId ?? input.taskIds?.length === 1 ? input.taskId ?? input.taskIds?.[0] : undefined
    const rows = (single
      ? this.db.prepare('SELECT id FROM tasks WHERE id=?').all(single)
      : input.taskIds?.length
        ? this.db.prepare(`SELECT id FROM tasks WHERE id IN (${input.taskIds.map(() => '?').join(',')}) ORDER BY rowid DESC`).all(...input.taskIds)
        : input.goalId
          ? this.db.prepare('SELECT id FROM tasks WHERE goal_id=? ORDER BY rowid DESC LIMIT ?').all(input.goalId, input.limit ?? 50)
          : this.db.prepare('SELECT id FROM tasks ORDER BY rowid DESC LIMIT ?').all(input.limit ?? 50)) as Array<{ id: string }>
    const items = rows.map(row => this.projection(row.id)).filter((item): item is TaskProjectionView => !!item)
    return { observedAt: Date.now(), items, counts: countStages(items), total: items.length }
  }

  /**
   * Commits a Goal, a Task, its first requirement versions and the Change that
   * produced them, in one transaction. An unclear target must be resolved before
   * this is called; nothing here invents a task out of a greeting.
   */
  create(input: DelegationTaskCreate, inputMessageId?: string): TaskProjectionView {
    return this.replay(input.requestId, 'create', () => this.transaction(() => {
      const now = Date.now(), goalId = `goal-${randomUUID()}`, taskId = `task-${randomUUID()}`
      for (const dependency of input.dependsOn ?? []) if (!this.body<TaskRecordView>('tasks', dependency)) throw new Error(`Unknown dependency task ${dependency}`)
      const goal: GoalView = { id: goalId, title: input.goalTitle, successCriteria: [], createdAt: now, updatedAt: now }
      const task: TaskRecordView = { id: taskId, goalId, title: input.title, scopeIn: input.scopeIn ?? [], scopeOut: input.scopeOut ?? [],
        acceptance: (input.acceptance ?? []).map((statement, index) => ({ id: `ac-${index + 1}`, statement })),
        deliverable: input.deliverable, dependsOn: input.dependsOn ?? [], definitionVersion: 1, createdAt: now, updatedAt: now }
      this.db.prepare('INSERT INTO goals (id, body) VALUES (?, ?)').run(goalId, JSON.stringify(goal))
      this.db.prepare('INSERT INTO tasks (id, goal_id, definition_version, body) VALUES (?, ?, 1, ?)').run(taskId, goalId, JSON.stringify(task))
      const items: ChangeView['items'] = []
      this.writeRequirements(taskId, input.requirements ?? [], inputMessageId, now, items)
      this.db.prepare('INSERT INTO changes (id, task_id, request_id, body) VALUES (?, ?, ?, ?)')
        .run(`chg-${randomUUID()}`, taskId, input.requestId, JSON.stringify({ id: `chg-${randomUUID()}`, taskId, requestId: input.requestId,
          inputMessageId, items, producedVersion: 1, createdAt: now } satisfies ChangeView))
      const projection = this.assertProjection(taskId)
      this.db.prepare('INSERT INTO requests (request_id, kind, result) VALUES (?, ?, ?)').run(input.requestId, 'create', JSON.stringify(projection))
      return projection
    }))
  }

  /** Adds, replaces, withdraws or explicitly keeps requirements and bumps the definition version. */
  amend(input: DelegationTaskAmend, inputMessageId?: string): TaskProjectionView {
    return this.replay(input.requestId, 'amend', () => this.transaction(() => {
      const task = this.body<TaskRecordView>('tasks', input.taskId)
      if (!task) throw new Error(`Unknown task ${input.taskId}`)
      if (this.body<{ action: TaskControlAction }>('controls', input.taskId, 'task_id')?.action === 'terminate')
        throw new Error('A terminated task cannot change requirements')
      const now = Date.now(), items: ChangeView['items'] = [], existing = this.bodies<RequirementView>('requirements', input.taskId, 'version')
      const active = (requirementId: string): RequirementView => {
        const requirement = existing.find(item => item.id === requirementId)
        if (!requirement) throw new Error(`Unknown requirement ${requirementId}`)
        if (requirement.state !== 'active') throw new Error(`Requirement ${requirementId} is already ${requirement.state}`)
        return requirement
      }
      for (const requirementId of input.keep ?? []) items.push({ requirementId: active(requirementId).id, action: 'kept', version: active(requirementId).version })
      for (const requirementId of input.withdraw ?? []) {
        const requirement = active(requirementId)
        this.writeRequirementState(requirement, 'withdrawn')
        items.push({ requirementId, action: 'withdrawn', version: requirement.version })
      }
      this.writeRequirements(input.taskId, input.requirements ?? [], inputMessageId, now, items)
      if (!items.length) throw new Error('A requirement change must add, replace, withdraw or keep at least one requirement')
      const version = task.definitionVersion + 1
      this.db.prepare('UPDATE tasks SET definition_version=?, body=? WHERE id=?')
        .run(version, JSON.stringify({ ...task, definitionVersion: version, updatedAt: now }), task.id)
      const change: ChangeView = { id: `chg-${randomUUID()}`, taskId: task.id, requestId: input.requestId, inputMessageId,
        reason: input.reason, items, producedVersion: version, createdAt: now }
      this.db.prepare('INSERT INTO changes (id, task_id, request_id, body) VALUES (?, ?, ?, ?)').run(change.id, change.taskId, change.requestId, JSON.stringify(change))
      const projection = this.assertProjection(task.id)
      this.db.prepare('INSERT INTO requests (request_id, kind, result) VALUES (?, ?, ?)').run(input.requestId, 'amend', JSON.stringify(projection))
      return projection
    }))
  }

  private writeRequirementState(requirement: RequirementView, state: RequirementView['state'], supersededBy?: string): void {
    const updated: RequirementView = { ...requirement, state, ...(supersededBy ? { supersededBy } : {}) }
    this.db.prepare('UPDATE requirements SET state=?, body=? WHERE id=?').run(state, JSON.stringify(updated), requirement.id)
  }

  private writeRequirements(taskId: string, inputs: readonly RequirementInput[], inputMessageId: string | undefined, now: number, items: ChangeView['items']): void {
    let version = this.bodies<RequirementView>('requirements', taskId).reduce((highest, item) => Math.max(highest, item.version), 0)
    for (const input of inputs) {
      const replacement = input.supersedes ? this.bodies<RequirementView>('requirements', taskId).find(item => item.id === input.supersedes) : undefined
      if (input.supersedes && !replacement) throw new Error(`Unknown requirement ${input.supersedes}`)
      if (replacement && replacement.state !== 'active') throw new Error(`Requirement ${input.supersedes} is already ${replacement.state}`)
      const requirement: RequirementView = { id: `req-${randomUUID()}`, taskId, version: ++version, statement: input.statement,
        scope: input.scope, state: 'active', supersedes: replacement?.id, quote: input.quote, inputMessageId, createdAt: now }
      this.db.prepare('INSERT INTO requirements (id, task_id, version, state, body) VALUES (?, ?, ?, ?, ?)')
        .run(requirement.id, taskId, requirement.version, 'active', JSON.stringify(requirement))
      if (replacement) this.writeRequirementState(replacement, 'superseded', requirement.id)
      items.push({ requirementId: requirement.id, action: replacement ? 'replaced' : 'added', version: requirement.version })
    }
  }

  /** Persists a precondition record and returns the projection that reflects it. */
  applyReady(check: ReadyView): TaskProjectionView {
    this.recordReady(check)
    return this.assertProjection(check.taskId)
  }

  /** Records a precondition check outcome; never dispatches and never edits a definition. */
  private recordReady(check: ReadyView): ReadyView {
    this.db.prepare('INSERT INTO ready (task_id, body) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET body=?')
      .run(check.taskId, JSON.stringify(check), JSON.stringify(check))
    return check
  }

  /** One durable control receipt per task; latest wins, idempotent by request id. */
  control(input: DelegationTaskControl): TaskControlResult {
    return this.replay(input.requestId, 'control', () => this.transaction(() => {
      const receipts: TaskControlResult['receipts'] = []
      for (const taskId of input.taskIds) {
        if (!this.body<TaskRecordView>('tasks', taskId)) throw new Error(`Unknown task ${taskId}`)
        const previous = this.body<{ action: TaskControlAction }>('controls', taskId, 'task_id')?.action
        if (previous === 'terminate' && input.action !== 'terminate') throw new Error(`Task ${taskId} is terminated; it cannot be paused or resumed`)
        const record = { taskId, action: input.action, at: Date.now(), reason: input.reason }
        this.db.prepare('INSERT INTO controls (task_id, body) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET body=?').run(taskId, JSON.stringify(record), JSON.stringify(record))
        receipts.push({ taskId, action: input.action, previousAction: previous })
      }
      const result = { receipts }
      this.db.prepare('INSERT INTO requests (request_id, kind, result) VALUES (?, ?, ?)').run(input.requestId, 'control', JSON.stringify(result))
      return result
    }))
  }

  recordAssignment(assignment: AssignmentView): AssignmentView {
    this.db.prepare('INSERT INTO assignments (id, task_id, state, body) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=?, body=?')
      .run(assignment.id, assignment.taskId, assignment.state, JSON.stringify(assignment), assignment.state, JSON.stringify(assignment))
    return assignment
  }

  /** The one assignment bound to a runtime delegation receipt. */
  assignmentForDelegation(delegationId: string): AssignmentView | undefined {
    const rows = this.db.prepare('SELECT body FROM assignments WHERE json_extract(body, \'$.delegationId\')=?').all(delegationId) as Array<{ body: string }>
    return rows.length ? JSON.parse(rows[0]!.body) as AssignmentView : undefined
  }

  recordVerification(input: DelegationTaskVerify, definitionVersion: number, assignmentId?: string): TaskProjectionView {
    return this.replay(input.requestId, 'verify', () => this.transaction(() => {
      if (!this.body<TaskRecordView>('tasks', input.taskId)) throw new Error(`Unknown task ${input.taskId}`)
      const record: VerificationView = { id: `ver-${randomUUID()}`, taskId: input.taskId, definitionVersion, assignmentId,
        verdict: input.verdict, results: input.results ?? [], reason: input.reason, createdAt: Date.now() }
      this.db.prepare('INSERT INTO verifications (id, task_id, body) VALUES (?, ?, ?)').run(record.id, record.taskId, JSON.stringify(record))
      const projection = this.assertProjection(input.taskId)
      this.db.prepare('INSERT INTO requests (request_id, kind, result) VALUES (?, ?, ?)').run(input.requestId, 'verify', JSON.stringify(projection))
      return projection
    }))
  }

  /** Digest of one task's current definition, for CAS and evidence. */
  digest(taskId: string): string {
    const projection = this.projection(taskId)
    if (!projection) throw new Error(`Unknown task ${taskId}`)
    return canonicalJson({ version: projection.task.definitionVersion,
      requirements: projection.activeRequirements.map(item => [item.id, item.version]) })
  }
}
