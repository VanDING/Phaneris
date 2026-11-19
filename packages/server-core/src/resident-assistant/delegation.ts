import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { SessionDelegationInput } from '@phaneris/core/types'
import type { AssistantDispatch, AssistantWork, AssistantWorkPage, AssistantWorkQuery, AssistantDelegationReceipt, AssistantTaskOverview, EffectiveWorkerConfig } from '@phaneris/session-tools-core/delegation-contracts'
import type { SessionCompletionEvent } from '../domain/session-completion'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'
import type { ResidentInboxEvent, ResidentEventsPage } from '@phaneris/session-tools-core/resident-context-contracts'

import type { LegacyDelegation } from './delegation-migration'
import { TaskResultStore } from './task-results'
import type { TaskDeliverableSelection, TaskReview } from '@phaneris/session-tools-core/task-result-contracts'
import { WorkerControls } from './worker-controls'
import type { WorkerControl, WorkerControlApplication, WorkerControlReceipt } from '@phaneris/session-tools-core/worker-control-contracts'
import { DelegationResources } from './delegation-scheduling'

export interface SessionDelegationPlan { config: EffectiveWorkerConfig; adjustments: string[]; configRevision?: string; capabilityRevision?: string }
export type { LegacyDelegation } from './delegation-migration'
export class SessionDelegationConflict extends Error {}
function dispatchFingerprint(assistantSessionId: string, request: AssistantDispatch): string {
  const { workAdmissionId: _admission, directUserPreparationId: _direct, ...userRequest } = request
  return createHash('sha256').update(canonicalJson({ assistantSessionId, request: userRequest })).digest('hex')
}
export class SessionDelegationWait extends Error {
  constructor(readonly waitingFor: NonNullable<AssistantDelegationReceipt['waitingFor']>) { super(waitingFor.detail ?? waitingFor.reason) }
}
export interface DelegationHost {
  currentSessionIds?(): readonly string[]
  live?(receipt: AssistantDelegationReceipt): Pick<AssistantWork, 'sessionStatus' | 'runtime'> & { goal?: string }
  capacity?(): number | null
  waitingFor?(receipt: AssistantDelegationReceipt): AssistantDelegationReceipt['waitingFor']
  plan(request: AssistantDispatch): Promise<SessionDelegationPlan>
  prepare(receipt: AssistantDelegationReceipt, request: AssistantDispatch, plan: SessionDelegationPlan,
    bind: (sessionId: string) => void): Promise<{ sessionId: string; inputMessageId: string; branchIds?: string[] }>
  snapshot(receipt: AssistantDelegationReceipt): Promise<SessionDelegationInput | undefined>
  pendingInput?(receipt: AssistantDelegationReceipt): boolean
  controlStatus?(receipt: WorkerControlReceipt): Pick<WorkerControlReceipt, 'processedAt'>
  execution?(receipt: AssistantDelegationReceipt, options: { before?: number; limit: number }): Promise<AssistantWork['execution']>
  recover(receipt: AssistantDelegationReceipt): Promise<{ sessionId?: string; inputMessageId?: string; resume?: 'original' | 'materials'; completedResult?: { sessionId: string; messageId: string } }>
  importLegacy(legacy: LegacyDelegation): Promise<{ sessionId: string; inputMessageId: string }>
  start(receipt: AssistantDelegationReceipt, maySubmit: () => boolean): Promise<void>
  /** A stopped receipt must not hide a live lease or an unsettled external effect. */
  heldSessionIds?(): readonly string[]
  rejectStaged(receipt: AssistantDelegationReceipt, reason: string): Promise<void>
  /** Only cancel execution owned by this input, never an unrelated human turn. */
  cancel(receipt: AssistantDelegationReceipt): Promise<boolean>
  control?(receipt: AssistantDelegationReceipt, command: WorkerControl, supplements: string[], context: Pick<WorkerControlReceipt, 'actor' | 'initialState' | 'evidence'>, mayApply: () => boolean): Promise<WorkerControlApplication>
  controlEvidence?(receipt: AssistantDelegationReceipt): Promise<NonNullable<WorkerControlReceipt['evidence']>>
  controlEvidenceValid?(evidence: NonNullable<WorkerControlReceipt['evidence']>): boolean
  reportError(error: unknown): void
  eventsAvailable?(): void
  restoreDeliverables?(receipt: AssistantDelegationReceipt): Promise<void>
  settled?(receipt: AssistantDelegationReceipt): Promise<void>
  review?(receipt: AssistantDelegationReceipt, command: TaskReview, mayApply: () => boolean): Promise<unknown>
}

/** Delivery receipts and references only; ordinary Sessions own the actual work. */
export class AssistantDelegation {
  readonly ready: Promise<void>
  readonly results: TaskResultStore
  readonly controls: WorkerControls
  private readonly db: SqliteDatabase
  private pumping: Promise<void> | undefined
  private pendingKick = false
  private closed = false
  private initialized = false
  private indexTimer?: ReturnType<typeof setTimeout>
  private indexing?: Promise<void>
  private readonly resources: DelegationResources
  constructor(private readonly workspace: { id: string; rootPath: string }, private readonly host: DelegationHost) {
    this.resources = new DelegationResources(workspace.rootPath, () => this.kick())
    const root = join(workspace.rootPath, 'assistant')
    mkdirSync(root, { recursive: true })
    this.db = openSqliteDatabase(join(root, 'delegations.db'))
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), workspace_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS work_sequence ON work(seq);
      CREATE INDEX IF NOT EXISTS work_state ON work(json_extract(body, '$.state'), seq);
      CREATE INDEX IF NOT EXISTS work_session ON work(json_extract(body, '$.sessionId'));
      CREATE INDEX IF NOT EXISTS work_created ON work(json_extract(body, '$.createdAt'),id);
      CREATE INDEX IF NOT EXISTS work_session_created ON work(json_extract(body, '$.sessionId'),json_extract(body, '$.createdAt'));
      CREATE UNIQUE INDEX IF NOT EXISTS work_continuation ON work(json_extract(body,'$.continuationOf')) WHERE json_extract(body,'$.continuationOf') IS NOT NULL;
      CREATE TABLE IF NOT EXISTS work_index(id TEXT PRIMARY KEY,title TEXT NOT NULL,project_id TEXT);
      CREATE TABLE IF NOT EXISTS clock (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO clock VALUES (1,0);
      CREATE TABLE IF NOT EXISTS legacy_work_archive (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_consumption(event_id TEXT PRIMARY KEY,phase TEXT NOT NULL,run_id TEXT,delivery TEXT);
      CREATE TABLE IF NOT EXISTS inbox_retry(event_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,next_at INTEGER NOT NULL);`)
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES (1,?)').run(workspace.id)
    if ((this.db.prepare('SELECT workspace_id FROM owner').get() as { workspace_id: string }).workspace_id !== workspace.id) {
      this.db.close(); throw new Error('Delegation database belongs to another workspace')
    }
    this.results = new TaskResultStore(this.db, this.workspace)
    this.controls = new WorkerControls(this.db, {
      read: id => this.get(id), save: receipt => this.save(receipt), view: receipt => this.view(receipt, { id: receipt.id }),
      evidence: async receipt => this.host.controlEvidence?.(receipt) ?? { sources: [], memories: [] },
      status: receipt => this.host.controlStatus?.(receipt) ?? {},
      evidenceValid: evidence => this.host.controlEvidenceValid?.(evidence) ?? false,
      apply: (receipt, command, supplements, context) => {
        if (!this.host.control) throw new Error('Worker management is unavailable in this Host')
        return this.host.control(receipt, command, supplements, context, () => this.get(receipt.id).pendingControlId === command.commandId && !['cancel_requested', 'cancelled'].includes(this.get(receipt.id).state))
      }, wake: () => this.kick(),
      rejected: async receipt => {
        if (receipt.state !== 'submitted' || this.host.pendingInput?.(receipt) || this.host.heldSessionIds?.().includes(receipt.sessionId!)) return
        const recovered = await this.host.recover(receipt)
        if (recovered.completedResult) await this.syncSessionStatus(this.save({ ...this.get(receipt.id), state: 'result_ready', result: recovered.completedResult }))
      },
    })
    this.ready = this.initialize()
  }
  private async initialize(): Promise<void> {
    if ((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version < 2) {
      const { migrateDelegations } = await import('./delegation-migration')
      await migrateDelegations(this.db, this.workspace.id, legacy => this.host.importLegacy(legacy), receipt => this.save(receipt))
    }
    const interrupted = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state') IN ('preparing','submitting','submitted','cancel_requested','pause_requested')").all() as Array<{ body: string }>
    for (const row of interrupted) {
      const receipt = JSON.parse(row.body) as AssistantDelegationReceipt
      try {
        const { completedResult, resume, ...binding } = await this.host.recover(receipt)
        Object.assign(receipt, binding)
        if (receipt.state === 'cancel_requested') {
          const waiting = this.host.heldSessionIds?.().includes(receipt.sessionId!)
          const saved = this.save({ ...receipt, state: waiting ? 'cancel_requested' : 'cancelled' })
          if (!waiting) {
            await this.host.rejectStaged(saved, 'Original assignment was cancelled before Host restart')
            this.controls.settled(receipt.id)
          }
          await this.syncSessionStatus(saved)
          continue
        }
        if (receipt.state === 'pause_requested') {
          this.save({ ...receipt, state: this.host.heldSessionIds?.().includes(receipt.sessionId!) ? 'pause_requested' : 'paused' })
          this.controls.settled(receipt.id); continue
        }
        if (completedResult) {
          const saved = this.save({ ...receipt, state: 'result_ready', result: completedResult, error: undefined })
          await this.syncSessionStatus(saved); continue
        }
        if (resume) {
          this.save({ ...receipt, state: resume === 'original' ? 'accepted' : 'submitted', error: undefined }); continue
        }
      }
      catch (error) { receipt.error = error instanceof Error ? error.message : 'Conflicting original Session references' }
      this.save({ ...receipt, state: 'needs_attention', error: receipt.error ?? 'Host restarted before delivery settled; inspect the original Session before continuing.' })
    }
    const completed = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state') IN ('result_ready','cancelled') ORDER BY seq DESC LIMIT 20").all() as Array<{ body: string }>
    for (const row of completed) {
      const receipt = JSON.parse(row.body) as AssistantDelegationReceipt
      await this.host.restoreDeliverables?.(receipt).catch(error => this.host.reportError(error))
      await this.syncSessionStatus(receipt)
    }
    this.initialized = true
    await this.controls.recover()
    void this.indexBatch()
  }
  private indexBatch(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.indexing) return this.indexing
    const rows = this.db.prepare('SELECT w.body FROM work w LEFT JOIN work_index i ON i.id=w.id WHERE i.id IS NULL ORDER BY w.seq LIMIT 20').all() as Array<{ body: string }>
    if (!rows.length) return Promise.resolve()
    this.indexing = (async () => {
      for (const row of rows) {
        const receipt = JSON.parse(row.body) as AssistantDelegationReceipt
        const input = await this.host.snapshot(receipt).catch(error => { this.host.reportError(error); return undefined })
        if (this.closed) return
        this.db.prepare('INSERT OR IGNORE INTO work_index VALUES(?,?,?)').run(receipt.id, input?.title ?? receipt.requestId, input?.effectiveConfig.projectId ?? null)
      }
    })().catch(error => this.host.reportError(error)).finally(() => {
      this.indexing = undefined
      if (!this.closed) { this.indexTimer = setTimeout(() => { this.indexTimer = undefined; void this.indexBatch() }, 100); this.indexTimer.unref?.() }
    })
    return this.indexing
  }
  private get(id: string): AssistantDelegationReceipt {
    const row = this.db.prepare('SELECT body FROM work WHERE id=?').get(id) as { body: string } | undefined
    if (!row) throw new Error('Delegation not found in this workspace')
    return JSON.parse(row.body) as AssistantDelegationReceipt
  }
  private save(receipt: AssistantDelegationReceipt, request?: { requestId: string; fingerprint: string; title?: string; projectId?: string }): AssistantDelegationReceipt {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('UPDATE clock SET value=value+1')
      const seq = (this.db.prepare('SELECT value FROM clock').get() as { value: number }).value
      const saved = { ...receipt, ...(receipt.state !== 'accepted' ? { waitingFor: undefined } : {}), seq, updatedAt: Date.now() }
      if (request) this.db.prepare('INSERT INTO work VALUES (?,?,?,?,?)').run(receipt.id, request.requestId, request.fingerprint, seq, JSON.stringify(saved))
      else this.db.prepare('UPDATE work SET seq=?,body=? WHERE id=?').run(seq, JSON.stringify(saved), receipt.id)
      if (request?.title) this.db.prepare('INSERT INTO work_index VALUES(?,?,?)').run(receipt.id, request.title, request.projectId ?? null)
      if (receipt.state === 'result_ready' && receipt.result) this.results.seal(receipt, receipt.result)
      const eventId = `${receipt.id}:${receipt.state}:${receipt.result?.messageId ?? ''}`
      const event = { eventId, workspaceId: receipt.workspaceId, delegationId: receipt.id, assistantSessionId: receipt.assistantSessionId,
        originMessageId: receipt.originMessageId, branchIds: receipt.branchIds, projectId: receipt.projectId ?? null, kind: receipt.state, sessionId: receipt.sessionId, inputMessageId: receipt.inputMessageId,
        result: receipt.result, createdAt: saved.updatedAt }
      this.db.prepare('INSERT OR IGNORE INTO inbox_events(event_id,body) VALUES(?,?)').run(eventId, JSON.stringify(event))
      this.db.exec('COMMIT')
      if (this.initialized && ['result_ready','failed','needs_attention'].includes(receipt.state)) this.host.eventsAvailable?.()
      return saved
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private async view(receipt: AssistantDelegationReceipt, query: AssistantWorkQuery = {}): Promise<AssistantWork> {
    const [input, execution] = await Promise.all([this.host.snapshot(receipt), query.view ? undefined : this.host.execution?.(receipt, { before: query.attemptsBefore, limit: query.attemptLimit ?? 5 })])
    const cached = this.db.prepare('SELECT title FROM work_index WHERE id=?').get(receipt.id) as { title: string } | undefined
    if (input && cached?.title !== input.title) this.db.prepare('UPDATE work_index SET title=? WHERE id=?').run(input.title, receipt.id)
    const reason = !input ? 'Original assignment is unavailable' : execution?.followUp ? 'A later direct user input owns this Session'
      : receipt.pendingControlId ? 'Another management command is pending' : ['result_ready', 'cancelled', 'cancel_requested'].includes(receipt.state) ? 'The original assignment has settled' : undefined
    const actions: NonNullable<AssistantWork['controlAvailability']>['actions'] = reason ? [] : ['plan', 'message', 'configure',
      ...(receipt.state === 'paused' ? ['resume' as const] : ['failed', 'needs_attention'].includes(receipt.state) ? ['pause' as const, 'retry' as const] : ['pause' as const])]
    return { ...receipt, ...this.host.live?.(receipt), ...(query.id ? { outputManifest: this.results.get(receipt.id), controls: this.controls.list(receipt.id), controlAvailability: { actions, reason } } : {}), title: input?.title ?? cached?.title, ...(input ? { effectiveConfig: input.effectiveConfig, adjustments: input.adjustments, artifactBaselines: input.artifactBaselines, invalidation: input.invalidation, review: input.statusControl?.review,
      configRevision: input.configRevision, capabilityRevision: input.capabilityRevision,
      acceptedConfigRevision: input.acceptedConfigRevision, acceptedPermissionMode: input.acceptedPermissionMode } : {}), ...(execution ? { execution } : {}) }
  }
  private replay(requestId: string, fingerprint: string): AssistantDelegationReceipt | undefined {
    const row = this.db.prepare('SELECT fingerprint,body FROM work WHERE request_id=?').get(requestId) as { fingerprint: string; body: string } | undefined
    if (!row) return undefined
    if (row.fingerprint !== fingerprint) throw new Error('Delegation request ID reuse conflict')
    return JSON.parse(row.body) as AssistantDelegationReceipt
  }
  private reserved(sessionId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM work WHERE
      (json_extract(body,'$.sessionId')=? OR json_extract(body,'$.targetSessionId')=?)
      AND json_extract(body,'$.state') IN ('preparing','accepted','submitting','submitted','needs_attention','cancel_requested','pause_requested','paused') LIMIT 1`).get(sessionId, sessionId)
  }
  async existingDispatch(assistantSessionId: string, request: AssistantDispatch): Promise<AssistantWork | undefined> {
    await this.ready
    const prior = this.replay(request.requestId, dispatchFingerprint(assistantSessionId, request))
    return prior ? this.view(prior) : undefined
  }
  async dispatch(assistantSessionId: string, originMessageId: string, request: AssistantDispatch, identityRequest = request): Promise<AssistantWork> {
    await this.ready
    const fingerprint = dispatchFingerprint(assistantSessionId, identityRequest)
    const prior = this.replay(request.requestId, fingerprint)
    if (prior) { this.kick(); return this.view(prior) }
    if (request.continuationOf && this.db.prepare("SELECT 1 FROM work WHERE json_extract(body,'$.continuationOf')=?").get(request.continuationOf))
      throw new Error('This exact result already has an authorized continuation; inspect it instead of dispatching again')
    const plan = await this.host.plan(request)
    const concurrent = this.replay(request.requestId, fingerprint)
    if (concurrent) return this.view(concurrent)
    if (request.targetSessionId && this.reserved(request.targetSessionId)) throw new Error('Target Session has a pending delegation')
    const receipt = this.save({ formatVersion: 2, id: randomUUID(), workspaceId: this.workspace.id,
      assistantSessionId, originMessageId, continuationOf: request.continuationOf, projectId: plan.config.projectId, requestId: request.requestId, fingerprint, targetSessionId: request.targetSessionId,
      state: 'preparing', seq: 0, createdAt: Date.now(), updatedAt: Date.now() }, { requestId: request.requestId, fingerprint, title: request.title, projectId: plan.config.projectId })
    try {
      const binding = await this.host.prepare(receipt, request, plan, sessionId => {
        this.save({ ...this.get(receipt.id), sessionId })
      })
      const current = this.get(receipt.id)
      const saved = this.save({ ...current, ...binding, state: ['cancel_requested', 'cancelled'].includes(current.state) ? 'cancelled' : request.startPaused ? 'paused' : 'accepted' })
      if (saved.state === 'cancelled') await this.host.rejectStaged(saved, 'Delegation cancelled before submission')
      await this.syncSessionStatus(saved)
      this.kick()
      return this.view(saved)
    } catch (error) {
      const current = this.get(receipt.id)
      const failed = this.save({ ...current, state: ['cancel_requested', 'cancelled'].includes(current.state) ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : 'Session input preparation failed' })
      await this.host.rejectStaged(failed, failed.error!)
      await this.syncSessionStatus(failed)
      this.kick()
      throw error
    }
  }
  async query(query: AssistantWorkQuery): Promise<AssistantWorkPage> {
    await this.ready
    const facts = { observedAt: Date.now(), scheduling: this.scheduling() }
    const limit = query.limit ?? 20
    if (query.view === 'deliverables') return { ...facts, ...this.results.list(query), items: [], nextAfter: null,
      lastSeq: (this.db.prepare('SELECT value FROM clock').get() as { value: number }).value }
    if (query.view) {
      await this.indexBatch()
      const state = "json_extract(w.body,'$.state')"
      const delivered = `EXISTS(SELECT 1 FROM inbox_events e JOIN inbox_consumption c ON c.event_id=e.event_id
        WHERE json_extract(e.body,'$.delegationId')=w.id AND json_extract(e.body,'$.kind')=${state} AND c.phase='delivered')`
      const terminal = `${state}='cancelled' OR (${state} IN ('failed','result_ready') AND ${delivered})`
      const current = this.currentWorkPredicate()
      const where = [query.view === 'history' ? `(${terminal})` : current.sql]
      const args: unknown[] = query.view === 'history' ? [] : [current.ids]
        if (query.state) { where.push(`${state}=?`); args.push(query.state) }
      if (query.search) { where.push("COALESCE(i.title,w.request_id) LIKE ? ESCAPE '\\'"); args.push(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`) }
      const from = 'FROM work w LEFT JOIN work_index i ON i.id=w.id'
      const total = (this.db.prepare(`SELECT count(*) AS count ${from} WHERE ${where.join(' AND ')}`).get(...args) as { count: number }).count
      if (query.cursor) {
        where.push("(json_extract(w.body,'$.createdAt')<? OR (json_extract(w.body,'$.createdAt')=? AND w.id<?))")
        args.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id)
      }
      const rows = this.db.prepare(`SELECT w.body ${from} WHERE ${where.join(' AND ')} ORDER BY json_extract(w.body,'$.createdAt') DESC,w.id DESC LIMIT ?`).all(...args, limit + 1) as Array<{ body: string }>
      const items = await Promise.all(rows.slice(0, limit).map(row => this.view(JSON.parse(row.body) as AssistantDelegationReceipt, query)))
      const coverage = this.db.prepare('SELECT (SELECT count(*) FROM work_index) AS indexed,(SELECT count(*) FROM work) AS total').get() as { indexed: number; total: number }
      return { ...facts, items, total, nextAfter: null, nextCursor: rows.length > limit ? { createdAt: items.at(-1)!.createdAt, id: items.at(-1)!.id } : null,
        searchCoverage: coverage, lastSeq: (this.db.prepare('SELECT value FROM clock').get() as { value: number }).value }
    }
    const rows = (query.id ? this.db.prepare('SELECT body FROM work WHERE id=?').all(query.id)
      : this.db.prepare('SELECT body FROM work WHERE seq>? ORDER BY seq LIMIT ?').all(query.after ?? 0, limit + 1)) as Array<{ body: string }>
    const items = await Promise.all(rows.slice(0, limit).map(row => this.view(JSON.parse(row.body) as AssistantDelegationReceipt, query)))
    return { ...facts, items, nextAfter: rows.length > limit ? items.at(-1)!.seq : null,
      lastSeq: (this.db.prepare('SELECT value FROM clock').get() as { value: number }).value }
  }
  events(query: { after?: number; limit?: number } = {}): ResidentEventsPage {
    const limit = query.limit ?? 20
    const rows = this.db.prepare(`SELECT e.sequence,e.body,c.phase,c.run_id,c.delivery FROM inbox_events e
      LEFT JOIN inbox_consumption c ON c.event_id=e.event_id WHERE e.sequence>? ORDER BY e.sequence LIMIT ?`).all(query.after ?? 0, limit + 1) as
      Array<{ sequence: number; body: string; phase: ResidentInboxEvent['phase'] | null; run_id: string | null; delivery: string | null }>
    const items = rows.slice(0, limit).map(row => ({ ...JSON.parse(row.body), sequence: row.sequence, phase: row.phase ?? 'pending',
      ...(row.run_id ? { enteredRunId: row.run_id } : {}), ...(row.delivery ? { delivery: JSON.parse(row.delivery) } : {}) })) as ResidentInboxEvent[]
    return { items, nextAfter: rows.length > limit ? items.at(-1)!.sequence : null }
  }
  pendingEvents(automatic = false): ResidentInboxEvent[] {
    const rows = this.db.prepare(`SELECT e.sequence,e.body,c.phase,c.run_id FROM inbox_events e LEFT JOIN inbox_consumption c ON c.event_id=e.event_id
      LEFT JOIN inbox_retry r ON r.event_id=e.event_id
      WHERE json_extract(e.body,'$.kind') IN ('result_ready','failed','needs_attention','decision_requested')
      AND (${automatic ? "(c.phase IS NULL OR c.phase='attention') AND COALESCE(r.attempts,0)<3 AND COALESCE(r.next_at,0)<=?" : "c.phase IS NULL OR c.phase!='delivered'"})
      ORDER BY e.sequence LIMIT 20`).all(...(automatic ? [Date.now()] : [])) as
      Array<{ sequence: number; body: string; phase: ResidentInboxEvent['phase'] | null; run_id: string | null }>
    return rows.map(row => ({ ...JSON.parse(row.body), sequence: row.sequence, phase: row.phase ?? 'pending', enteredRunId: row.run_id ?? undefined })) as ResidentInboxEvent[]
  }
  unsettledDeliveries(): Array<{ runId: string; phase: string }> {
    return this.db.prepare("SELECT DISTINCT run_id AS runId,phase FROM inbox_consumption WHERE phase IN ('prepared','entered','handled')").all() as Array<{ runId: string; phase: string }>
  }
  enterEvents(eventIds: string[], runId: string): void {
    this.db.transaction(() => { for (const id of eventIds) this.db.prepare(`INSERT INTO inbox_consumption VALUES(?,'entered',?,NULL)
      ON CONFLICT(event_id) DO UPDATE SET phase='entered',run_id=excluded.run_id WHERE phase!='delivered' AND (phase!='handled' OR run_id!=excluded.run_id)`).run(id, runId) })()
  }
  claimEvents(eventIds: string[], inputId: string): void {
    this.db.transaction(() => { for (const id of eventIds) {
      const previous = this.db.prepare('SELECT phase FROM inbox_consumption WHERE event_id=?').get(id) as { phase: string } | undefined
      if (previous && previous.phase !== 'attention') continue
      this.db.prepare("INSERT INTO inbox_consumption VALUES(?,'prepared',?,NULL) ON CONFLICT(event_id) DO UPDATE SET phase='prepared',run_id=excluded.run_id,delivery=NULL").run(id, inputId)
      this.db.prepare('INSERT INTO inbox_retry VALUES(?,1,0) ON CONFLICT(event_id) DO UPDATE SET attempts=attempts+1,next_at=0').run(id)
    } })()
  }
  deliveryInputId(events: ResidentInboxEvent[]): string {
    const attempts = Math.max(0, ...events.map(event => (this.db.prepare('SELECT attempts FROM inbox_retry WHERE event_id=?').get(event.eventId) as { attempts: number } | undefined)?.attempts ?? 0))
    return `resident-event:${events[0]!.eventId}${attempts ? `:retry:${attempts + 1}` : ''}`
  }
  nextDeliveryWakeAt(): number | undefined {
    return (this.db.prepare("SELECT MIN(r.next_at) AS nextAt FROM inbox_retry r JOIN inbox_consumption c ON c.event_id=r.event_id WHERE c.phase='attention' AND r.attempts<3").get() as { nextAt: number | null }).nextAt ?? undefined
  }
  handledEvents(eventIds: string[], runId: string, selections: Array<TaskDeliverableSelection & { eventId: string }> = []): void {
    this.db.transaction(() => {
      for (const selection of selections) this.results.review(selection, selection.eventId)
      for (const id of eventIds) this.db.prepare("UPDATE inbox_consumption SET phase='handled' WHERE event_id=? AND run_id=? AND phase='entered'").run(id, runId)
    })()
  }
  async review(command: TaskReview): Promise<unknown> {
    await this.ready
    const receipt = this.get(command.delegationId)
    const matches = (current: AssistantDelegationReceipt) => current.state === 'result_ready' && current.seq === command.expectedSeq
      && current.result?.sessionId === command.result.sessionId && current.result.messageId === command.result.messageId
    if (!matches(receipt)) throw new Error('Task result or sequence changed; read the current result before reviewing')
    if (!this.host.review) throw new Error('Task review is unavailable in this Host')
    const result = await this.host.review(receipt, command, () => matches(this.get(receipt.id)))
    this.kick()
    return result
  }
  receiptForInput(sessionId: string, inputMessageId: string): AssistantDelegationReceipt | undefined {
    const row = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.sessionId')=? AND json_extract(body,'$.inputMessageId')=?").get(sessionId, inputMessageId) as { body: string } | undefined
    return row ? JSON.parse(row.body) : undefined
  }
  receiptForSession(sessionId: string): AssistantDelegationReceipt | undefined {
    const row = this.db.prepare(`SELECT body FROM work WHERE json_extract(body,'$.sessionId')=?
      AND json_extract(body,'$.state') IN ('accepted','submitting','submitted','needs_attention','failed','pause_requested','paused') ORDER BY seq DESC LIMIT 1`).get(sessionId) as { body: string } | undefined
    return row ? JSON.parse(row.body) : undefined
  }
  async continuation(id: string, assistantSessionId: string): Promise<{ receipt: AssistantDelegationReceipt; input: SessionDelegationInput }> {
    await this.ready
    const receipt = this.get(id), input = await this.host.snapshot(receipt)
    if (receipt.assistantSessionId !== assistantSessionId || receipt.state !== 'result_ready' || !receipt.result || !input?.originGrant)
      throw new Error('Continuation requires a completed result with its original user grant')
    const review = input.statusControl?.review
    if (!review || review.outcome === 'needs_user_review' || review.result.sessionId !== receipt.result.sessionId || review.result.messageId !== receipt.result.messageId || input.statusControl?.withdrawn)
      throw new Error('Read and review the exact original result before continuing its authorized scope')
    return { receipt, input }
  }
  finishEvents(runId: string, delivery?: { sessionId: string; messageId: string }): void {
    this.db.transaction(() => {
      if (delivery) this.db.prepare("UPDATE inbox_consumption SET phase='delivered',delivery=? WHERE run_id=? AND phase='handled'").run(JSON.stringify(delivery), runId)
      const pending = this.db.prepare("SELECT c.event_id,COALESCE(r.attempts,1) AS attempts FROM inbox_consumption c LEFT JOIN inbox_retry r ON r.event_id=c.event_id WHERE c.run_id=? AND c.phase!='delivered'").all(runId) as Array<{ event_id: string; attempts: number }>
      for (const item of pending) {
        this.db.prepare("UPDATE inbox_consumption SET phase='attention' WHERE event_id=?").run(item.event_id)
        this.db.prepare('INSERT INTO inbox_retry VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET next_at=excluded.next_at')
          .run(item.event_id, item.attempts, Date.now() + Math.min(30000, 1000 * 2 ** (item.attempts - 1)))
      }
    })()
    if (!this.closed && this.initialized) this.host.eventsAvailable?.()
  }
  decision(sessionId: string, requestId: string, kind: 'permission' | 'ask_user'): void {
    const row = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.sessionId')=? AND json_extract(body,'$.state') IN ('submitting','submitted') LIMIT 1").get(sessionId) as { body: string } | undefined
    if (!row) return
    const receipt = JSON.parse(row.body) as AssistantDelegationReceipt
    const eventId = `${receipt.id}:decision:${requestId}`
    this.db.prepare('INSERT OR IGNORE INTO inbox_events(event_id,body) VALUES(?,?)').run(eventId, JSON.stringify({ eventId, workspaceId: receipt.workspaceId,
      delegationId: receipt.id, assistantSessionId: receipt.assistantSessionId, originMessageId: receipt.originMessageId, kind: 'decision_requested', sessionId,
      request: { sessionId, requestId, kind }, createdAt: Date.now() }))
    this.host.eventsAvailable?.()
  }
  async cancel(id: string): Promise<AssistantWork> {
    await this.ready
    const receipt = this.get(id)
    if (['result_ready','failed','cancelled'].includes(receipt.state)) return this.view(receipt)
    this.controls.supersede(id)
    this.save({ ...receipt, state: 'cancel_requested', pendingControlId: undefined })
    const awaitingSettlement = receipt.state === 'preparing' || (receipt.sessionId ? await this.host.cancel(receipt) : false)
    const current = this.get(id)
    const cancelled = awaitingSettlement || current.state === 'cancelled' ? current : this.save({ ...current, state: 'cancelled' })
    if (cancelled.state === 'cancelled') await this.host.rejectStaged(cancelled, 'Delegation cancelled before submission')
    await this.syncSessionStatus(cancelled)
    this.kick()
    return this.view(cancelled)
  }
  directUserInput(sessionId: string): void {
    const rows = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.sessionId')=? AND json_extract(body,'$.pendingControlId') IS NOT NULL").all(sessionId) as Array<{ body: string }>
    for (const row of rows) {
      const receipt = JSON.parse(row.body) as AssistantDelegationReceipt
      this.controls.supersede(receipt.id)
      this.save({ ...receipt, pendingControlId: undefined, ...(receipt.state === 'pause_requested' ? {
        state: 'needs_attention' as const, error: 'A later direct user input superseded the pending management command; original execution facts are preserved',
      } : {}) })
    }
  }
  async complete(event: SessionCompletionEvent): Promise<void> {
    if (!this.initialized || this.closed || event.workspaceId !== this.workspace.id) return
    const rows = this.db.prepare(`SELECT body FROM work WHERE json_extract(body,'$.sessionId')=?
      AND json_extract(body,'$.state') IN ('submitting','submitted','needs_attention','cancel_requested','cancelled','pause_requested')`).all(event.sessionId) as Array<{ body: string }>
    const receipt = rows.map(row => JSON.parse(row.body) as AssistantDelegationReceipt)
      .find(item => item.inputMessageId && event.inputMessageIds?.includes(item.inputMessageId))
    if (!receipt) { this.kick(); return }
    if (receipt.state === 'cancelled') { await this.syncSessionStatus(receipt); this.kick(); return }
    if (receipt.state === 'pause_requested') {
      this.save({ ...receipt, state: this.host.heldSessionIds?.().includes(receipt.sessionId!) ? 'pause_requested' : 'paused' })
      this.controls.settled(receipt.id)
    }
    else if (receipt.state === 'cancel_requested') this.save({ ...receipt, state: 'cancelled' })
    else if (this.host.pendingInput?.(receipt)) {
      // An accepted revision still belongs to this assignment. Its preceding
      // answer is intermediate; only the last authorized FIFO turn may seal it.
      this.save({ ...receipt, state: 'submitted', error: undefined })
    }
    else if (event.reason === 'complete' && event.finalMessageId) this.save({ ...receipt, state: 'result_ready', error: undefined,
      result: { sessionId: event.resultSessionId ?? event.sessionId, messageId: event.finalMessageId } })
    else this.save({ ...receipt, state: ['error','timeout'].includes(event.reason) ? 'failed' : 'needs_attention', error: `Session ${event.reason}; inspect its original execution.` })
    await this.syncSessionStatus(this.get(receipt.id))
    this.kick()
  }
  private kick(): void {
    if (this.closed || !this.initialized) return
    if (this.pumping) { this.pendingKick = true; return }
    this.pendingKick = false
    this.pumping = this.pump().catch(error => this.host.reportError(error)).finally(() => {
      this.pumping = undefined
      if (this.pendingKick) this.kick()
    })
  }
  resumeQueue(): void { this.kick() }
  private currentWorkPredicate(alias = 'w'): { sql: string; ids: string } {
    const state = `json_extract(${alias}.body,'$.state')`, session = `json_extract(${alias}.body,'$.sessionId')`
    const ids = JSON.stringify(this.host.currentSessionIds?.() ?? [])
    const delivered = `EXISTS(SELECT 1 FROM inbox_events e JOIN inbox_consumption c ON c.event_id=e.event_id
      WHERE json_extract(e.body,'$.delegationId')=${alias}.id AND json_extract(e.body,'$.kind')=${state} AND c.phase='delivered')`
    return { ids, sql: `(${state} NOT IN ('cancelled','result_ready','failed') OR (${state} IN ('result_ready','failed') AND (NOT ${delivered} OR ${session} IN (SELECT value FROM json_each(?)))))
      AND NOT EXISTS(SELECT 1 FROM work newer WHERE json_extract(newer.body,'$.sessionId')=${session} AND json_extract(newer.body,'$.createdAt')>json_extract(${alias}.body,'$.createdAt'))` }
  }
  overview(limit = 20): AssistantTaskOverview {
    const observedAt = Date.now(), predicate = this.currentWorkPredicate()
    const total = (this.db.prepare(`SELECT count(*) AS count FROM work w WHERE ${predicate.sql}`).get(predicate.ids) as { count: number }).count
    const rows = this.db.prepare(`SELECT w.body,i.title FROM work w LEFT JOIN work_index i ON i.id=w.id WHERE ${predicate.sql}
      ORDER BY json_extract(w.body,'$.state') IN ('failed','needs_attention','result_ready') DESC,COALESCE(json_extract(w.body,'$.priority'),0) DESC,w.seq DESC LIMIT ?`).all(predicate.ids, limit) as Array<{ body: string; title?: string }>
    return { observedAt, scheduling: this.scheduling(), total, omitted: Math.max(0, total - rows.length),
      lastSeq: (this.db.prepare('SELECT value FROM clock').get() as { value: number }).value,
      items: rows.map(row => {
        const work = JSON.parse(row.body) as AssistantDelegationReceipt, live = this.host.live?.(work)
        return { id: work.id, seq: work.seq, sessionId: work.sessionId, inputMessageId: work.inputMessageId, originMessageId: work.originMessageId,
          branchIds: work.branchIds, title: row.title?.slice(0, 160), goal: live?.goal?.slice(0, 300), state: work.state, waitingFor: work.waitingFor,
          result: work.result, error: work.error?.slice(0, 400), sessionStatus: live?.sessionStatus, runtime: live?.runtime,
          ageMs: Math.max(0, observedAt - work.createdAt), ...(work.state === 'accepted' ? { waitingMs: Math.max(0, observedAt - work.createdAt) } : {}) }
      }) }
  }
  scheduling(): NonNullable<AssistantWorkPage['scheduling']> {
    const counts = this.db.prepare(`SELECT
      sum(json_extract(body,'$.state') IN ('submitting','submitted','cancel_requested','pause_requested')) AS occupied,
      sum(json_extract(body,'$.state')='accepted') AS queued,
      sum(json_extract(body,'$.state')='paused') AS paused FROM work`).get() as { occupied: number | null; queued: number | null; paused: number | null }
    const held = this.host.heldSessionIds?.() ?? []
    const reserved = held.length ? (this.db.prepare(`SELECT count(*) AS count FROM work WHERE json_extract(body,'$.sessionId') IN (SELECT value FROM json_each(?))
      AND json_extract(body,'$.state') IN ('failed','result_ready','cancelled','needs_attention','paused')`).get(JSON.stringify(held)) as { count: number }).count : 0
    // `capacity: null` is published as the workspace's honest state: no ceiling,
    // so the board must not render a ceiling it does not have.
    return { capacity: this.host.capacity?.() ?? null, occupied: (counts.occupied ?? 0) + reserved, queued: counts.queued ?? 0, paused: counts.paused ?? 0 }
  }
  reportDeliveryError(error: unknown): void { this.host.reportError(error) }
  private async syncSessionStatus(receipt: AssistantDelegationReceipt): Promise<void> {
    // Session projection/storage failure must not erase Runtime settlement or
    // freeze unrelated queued work. Recovery retries from the durable receipt.
    await this.host.settled?.(receipt).catch(error => this.host.reportError(error))
  }
  private async sharesWaitingResources(receipt: AssistantDelegationReceipt, waiting: AssistantDelegationReceipt[], active = false): Promise<AssistantDelegationReceipt['waitingFor']> {
    if (!waiting.length) return
    const input = await this.host.snapshot(receipt)
    if (!input) return { delegationId: waiting[0]!.id, reason: 'configuration' }
    for (const held of waiting) {
      if (held.sessionId === receipt.sessionId) return { delegationId: held.id, reason: 'session' }
      const previous = await this.host.snapshot(held)
      if (!previous) return { delegationId: held.id, reason: 'configuration' }
      if ((!active || held.state === 'cancel_requested') && this.resources.conflictsWithUncertain(input, receipt.sessionId!, previous, held.sessionId!))
        return { delegationId: held.id, reason: 'file_scope', detail: 'An interrupted assignment retains this file scope until its original effects are inspected' }
      const left = input.effectiveConfig, right = previous.effectiveConfig
      if ((!active || left.permissionMode !== 'safe' || right.permissionMode !== 'safe')
        && left.enabledSourceSlugs.some(slug => right.enabledSourceSlugs.includes(slug))) return { delegationId: held.id, reason: 'source', detail: 'An exclusive source is held by another assignment' }
    }
  }
  private async pump(): Promise<void> {
    while (!this.closed) {
      const active = (this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state') IN ('submitting','submitted','cancel_requested')").all() as Array<{ body: string }>)
        .map(row => JSON.parse(row.body) as AssistantDelegationReceipt)
      const waiting = (this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state') IN ('needs_attention','pause_requested')").all() as Array<{ body: string }>)
        .map(row => JSON.parse(row.body) as AssistantDelegationReceipt)
      const holders = this.host.heldSessionIds?.() ?? []
      let settledCancellation = false
      for (const pending of active) {
        if (pending.state !== 'cancel_requested' || pending.sessionId && holders.includes(pending.sessionId)) continue
        const current = this.get(pending.id)
        if (current.state !== 'cancel_requested') continue
        const cancelled = this.save({ ...current, state: 'cancelled' })
        await this.host.rejectStaged(cancelled, 'Original assignment cancelled before continuation')
        await this.syncSessionStatus(cancelled)
        settledCancellation = true
      }
      if (settledCancellation) continue
      if (holders.length) {
        const held = this.db.prepare(`SELECT body FROM work WHERE json_extract(body,'$.sessionId') IN (SELECT value FROM json_each(?))
          AND json_extract(body,'$.state') IN ('cancelled','failed','result_ready')`).all(JSON.stringify(holders)) as Array<{ body: string }>
        waiting.push(...held.map(row => JSON.parse(row.body) as AssistantDelegationReceipt))
      }
      this.resources.refresh([...active, ...waiting], holders)
      for (const held of [...active, ...waiting]) {
        const input = await this.host.snapshot(held)
        if (input && held.sessionId) this.resources.acquire(held, input)
      }
      const rows = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state')='accepted' ORDER BY COALESCE(json_extract(body,'$.priority'),0) DESC,json_extract(body,'$.createdAt'),seq").all() as Array<{ body: string }>
      let eligible: AssistantDelegationReceipt | undefined
      for (const row of rows) {
        const candidate = JSON.parse(row.body) as AssistantDelegationReceipt
        if (candidate.pendingControlId) continue
        let blocker = this.host.waitingFor?.(candidate)
          ?? await this.sharesWaitingResources(candidate, waiting)
          ?? await this.sharesWaitingResources(candidate, active, true)
        // No ceiling means no capacity blocker: only real constraints stop
        // admission (overlapping file scopes, Session availability). An absent
        // host callback is also no ceiling — nothing declared one.
        const ceiling = this.host.capacity?.() ?? null
        if (!blocker && ceiling !== null && this.scheduling().occupied >= ceiling) blocker = { reason: 'capacity', detail: 'All configured Worker admission slots are occupied' }
        if (!blocker) {
          const input = await this.host.snapshot(candidate)
          if (!input) blocker = { reason: 'configuration', detail: 'The original assignment is unavailable' }
          else if (!this.resources.acquire(candidate, input)) blocker = { reason: 'file_scope', detail: 'Declared file reads/writes overlap an occupied Tasks or Worker scope' }
        }
        if (!blocker) { eligible = candidate; break }
        const current = this.get(candidate.id)
        if (current.state === 'accepted' && canonicalJson(current.waitingFor ?? null) !== canonicalJson(blocker)) this.save({ ...current, waitingFor: blocker })
      }
      if (!eligible || this.closed) return
      // Resource reads yield; cancellation or another admission may have won.
      const fresh = this.get(eligible.id)
      if (fresh.state !== 'accepted' || fresh.pendingControlId || fresh.seq !== eligible.seq) continue
      const receipt = this.save({ ...fresh, state: 'submitting' })
      try {
        await this.host.start(receipt, () => this.get(receipt.id).state === 'submitting' && !this.get(receipt.id).pendingControlId && this.resources.valid(receipt.id))
        const current = this.get(receipt.id)
        if (current.state === 'submitting') this.save({ ...current, state: 'submitted' })
      }
      catch (error) {
        const current = this.get(receipt.id)
        if (error instanceof SessionDelegationWait && current.state === 'submitting') {
          this.save({ ...current, state: 'accepted', waitingFor: error.waitingFor }); continue
        }
        if (current.pendingControlId) continue
        if (!['cancelled','cancel_requested','result_ready'].includes(current.state)) {
          const failed: AssistantDelegationReceipt = { ...current, state: error instanceof SessionDelegationConflict ? 'failed' : 'needs_attention',
            error: error instanceof Error ? error.message : 'Session input submission failed' }
          if (failed.state === 'failed') await this.host.rejectStaged(failed, failed.error!)
          if (!['cancelled','cancel_requested','result_ready'].includes(this.get(receipt.id).state)) await this.syncSessionStatus(this.save(failed))
        }
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true
    if (this.indexTimer) clearTimeout(this.indexTimer)
    await this.ready; await this.pumping; await this.indexing
    this.resources.close()
    this.db.close()
  }
}
