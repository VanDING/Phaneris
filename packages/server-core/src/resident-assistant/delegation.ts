import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { SessionDelegationInput } from '@phaneris/core/types'
import type { AssistantDispatch, AssistantWork, AssistantWorkPage, AssistantWorkQuery, AssistantDelegationReceipt, EffectiveWorkerConfig } from '@phaneris/session-tools-core/delegation-contracts'
import type { SessionCompletionEvent } from '../domain/session-completion'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'
import type { ResidentInboxEvent, ResidentEventsPage } from '@phaneris/session-tools-core/resident-context-contracts'

import type { LegacyDelegation } from './delegation-migration'

export interface SessionDelegationPlan { config: EffectiveWorkerConfig; adjustments: string[]; configRevision?: string; capabilityRevision?: string }
export type { LegacyDelegation } from './delegation-migration'
export class SessionDelegationConflict extends Error {}
export interface DelegationHost {
  plan(request: AssistantDispatch): Promise<SessionDelegationPlan>
  prepare(receipt: AssistantDelegationReceipt, request: AssistantDispatch, plan: SessionDelegationPlan,
    bind: (sessionId: string) => void): Promise<{ sessionId: string; inputMessageId: string }>
  snapshot(receipt: AssistantDelegationReceipt): Promise<SessionDelegationInput | undefined>
  execution?(receipt: AssistantDelegationReceipt, options: { before?: number; limit: number }): Promise<AssistantWork['execution']>
  recover(receipt: AssistantDelegationReceipt): Promise<{ sessionId?: string; inputMessageId?: string }>
  importLegacy(legacy: LegacyDelegation): Promise<{ sessionId: string; inputMessageId: string }>
  start(receipt: AssistantDelegationReceipt, maySubmit: () => boolean): Promise<void>
  rejectStaged(receipt: AssistantDelegationReceipt, reason: string): Promise<void>
  /** Only cancel execution owned by this input, never an unrelated human turn. */
  cancel(receipt: AssistantDelegationReceipt): Promise<boolean>
  reportError(error: unknown): void
  eventsAvailable?(): void
}

/** Delivery receipts and references only; ordinary Sessions own the actual work. */
export class AssistantDelegation {
  readonly ready: Promise<void>
  private readonly db: SqliteDatabase
  private pumping: Promise<void> | undefined
  private pendingKick = false
  private closed = false
  private initialized = false
  constructor(private readonly workspace: { id: string; rootPath: string }, private readonly host: DelegationHost) {
    const root = join(workspace.rootPath, 'assistant')
    mkdirSync(root, { recursive: true })
    this.db = openSqliteDatabase(join(root, 'delegations.db'))
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), workspace_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS work_sequence ON work(seq);
      CREATE INDEX IF NOT EXISTS work_state ON work(json_extract(body, '$.state'), seq);
      CREATE INDEX IF NOT EXISTS work_session ON work(json_extract(body, '$.sessionId'));
      CREATE TABLE IF NOT EXISTS clock (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO clock VALUES (1,0);
      CREATE TABLE IF NOT EXISTS legacy_work_archive (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_consumption(event_id TEXT PRIMARY KEY,phase TEXT NOT NULL,run_id TEXT,delivery TEXT);`)
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES (1,?)').run(workspace.id)
    if ((this.db.prepare('SELECT workspace_id FROM owner').get() as { workspace_id: string }).workspace_id !== workspace.id) {
      this.db.close(); throw new Error('Delegation database belongs to another workspace')
    }
    this.ready = this.initialize()
  }
  private async initialize(): Promise<void> {
    if ((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version < 2) {
      const { migrateDelegations } = await import('./delegation-migration')
      await migrateDelegations(this.db, this.workspace.id, legacy => this.host.importLegacy(legacy), receipt => this.save(receipt))
    }
    const interrupted = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state') IN ('preparing','submitting','submitted','cancel_requested')").all() as Array<{ body: string }>
    for (const row of interrupted) {
      const receipt = JSON.parse(row.body) as AssistantDelegationReceipt
      try { Object.assign(receipt, await this.host.recover(receipt)) }
      catch (error) { receipt.error = error instanceof Error ? error.message : 'Conflicting original Session references' }
      this.save({ ...receipt, state: 'needs_attention', error: receipt.error ?? 'Host restarted before delivery settled; inspect the original Session before continuing.' })
    }
    this.initialized = true
  }
  private get(id: string): AssistantDelegationReceipt {
    const row = this.db.prepare('SELECT body FROM work WHERE id=?').get(id) as { body: string } | undefined
    if (!row) throw new Error('Delegation not found in this workspace')
    return JSON.parse(row.body) as AssistantDelegationReceipt
  }
  private save(receipt: AssistantDelegationReceipt, request?: { requestId: string; fingerprint: string }): AssistantDelegationReceipt {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('UPDATE clock SET value=value+1')
      const seq = (this.db.prepare('SELECT value FROM clock').get() as { value: number }).value
      const saved = { ...receipt, seq, updatedAt: Date.now() }
      if (request) this.db.prepare('INSERT INTO work VALUES (?,?,?,?,?)').run(receipt.id, request.requestId, request.fingerprint, seq, JSON.stringify(saved))
      else this.db.prepare('UPDATE work SET seq=?,body=? WHERE id=?').run(seq, JSON.stringify(saved), receipt.id)
      const eventId = `${receipt.id}:${receipt.state}:${receipt.result?.messageId ?? ''}`
      const event = { eventId, workspaceId: receipt.workspaceId, delegationId: receipt.id, assistantSessionId: receipt.assistantSessionId,
        originMessageId: receipt.originMessageId, kind: receipt.state, sessionId: receipt.sessionId, inputMessageId: receipt.inputMessageId,
        result: receipt.result, createdAt: saved.updatedAt }
      this.db.prepare('INSERT OR IGNORE INTO inbox_events(event_id,body) VALUES(?,?)').run(eventId, JSON.stringify(event))
      this.db.exec('COMMIT')
      if (this.initialized && ['result_ready','failed','needs_attention'].includes(receipt.state)) this.host.eventsAvailable?.()
      return saved
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private async view(receipt: AssistantDelegationReceipt, query: AssistantWorkQuery = {}): Promise<AssistantWork> {
    const [input, execution] = await Promise.all([this.host.snapshot(receipt), this.host.execution?.(receipt, { before: query.attemptsBefore, limit: query.attemptLimit ?? 5 })])
    return { ...receipt, ...(input ? { effectiveConfig: input.effectiveConfig, adjustments: input.adjustments, artifactBaselines: input.artifactBaselines,
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
      AND json_extract(body,'$.state') IN ('preparing','accepted','submitting','submitted','needs_attention','cancel_requested') LIMIT 1`).get(sessionId, sessionId)
  }
  async dispatch(assistantSessionId: string, originMessageId: string, request: AssistantDispatch): Promise<AssistantWork> {
    await this.ready
    const fingerprint = createHash('sha256').update(canonicalJson({ assistantSessionId, request })).digest('hex')
    const prior = this.replay(request.requestId, fingerprint)
    if (prior) { this.kick(); return this.view(prior) }
    const plan = await this.host.plan(request)
    const concurrent = this.replay(request.requestId, fingerprint)
    if (concurrent) return this.view(concurrent)
    if (request.targetSessionId && this.reserved(request.targetSessionId)) throw new Error('Target Session has a pending delegation')
    const receipt = this.save({ formatVersion: 2, id: randomUUID(), workspaceId: this.workspace.id,
      assistantSessionId, originMessageId, requestId: request.requestId, fingerprint, targetSessionId: request.targetSessionId,
      state: 'preparing', seq: 0, createdAt: Date.now(), updatedAt: Date.now() }, { requestId: request.requestId, fingerprint })
    try {
      const binding = await this.host.prepare(receipt, request, plan, sessionId => {
        this.save({ ...this.get(receipt.id), sessionId })
      })
      const current = this.get(receipt.id)
      const saved = this.save({ ...current, ...binding, state: current.state === 'cancel_requested' ? 'cancelled' : 'accepted' })
      if (saved.state === 'cancelled') await this.host.rejectStaged(saved, 'Delegation cancelled before submission')
      this.kick()
      return this.view(saved)
    } catch (error) {
      const current = this.get(receipt.id)
      const failed = this.save({ ...current, state: current.state === 'cancel_requested' ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : 'Session input preparation failed' })
      await this.host.rejectStaged(failed, failed.error!)
      this.kick()
      throw error
    }
  }
  async query(query: AssistantWorkQuery): Promise<AssistantWorkPage> {
    await this.ready
    const limit = query.limit ?? 20
    const rows = (query.id ? this.db.prepare('SELECT body FROM work WHERE id=?').all(query.id)
      : this.db.prepare('SELECT body FROM work WHERE seq>? ORDER BY seq LIMIT ?').all(query.after ?? 0, limit + 1)) as Array<{ body: string }>
    const items = await Promise.all(rows.slice(0, limit).map(row => this.view(JSON.parse(row.body) as AssistantDelegationReceipt, query)))
    return { items, nextAfter: rows.length > limit ? items.at(-1)!.seq : null,
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
      WHERE json_extract(e.body,'$.kind') IN ('result_ready','failed','needs_attention','decision_requested')
      AND (c.phase IS NULL ${automatic ? '' : "OR c.phase!='delivered'"}) ORDER BY e.sequence LIMIT 20`).all() as
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
    this.db.transaction(() => { for (const id of eventIds) this.db.prepare("INSERT OR IGNORE INTO inbox_consumption VALUES(?,'prepared',?,NULL)").run(id, inputId) })()
  }
  handledEvents(eventIds: string[], runId: string): void {
    this.db.transaction(() => { for (const id of eventIds) this.db.prepare("UPDATE inbox_consumption SET phase='handled' WHERE event_id=? AND run_id=? AND phase='entered'").run(id, runId) })()
  }
  finishEvents(runId: string, delivery?: { sessionId: string; messageId: string }): void {
    if (delivery) this.db.prepare("UPDATE inbox_consumption SET phase='delivered',delivery=? WHERE run_id=? AND phase='handled'").run(JSON.stringify(delivery), runId)
    else this.db.prepare("UPDATE inbox_consumption SET phase='attention' WHERE run_id=? AND phase!='delivered'").run(runId)
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
    this.save({ ...receipt, state: 'cancel_requested' })
    const awaitingSettlement = receipt.state === 'preparing' || (receipt.sessionId ? await this.host.cancel(receipt) : false)
    const current = this.get(id)
    const cancelled = awaitingSettlement || current.state === 'cancelled' ? current : this.save({ ...current, state: 'cancelled' })
    if (cancelled.state === 'cancelled') await this.host.rejectStaged(cancelled, 'Delegation cancelled before submission')
    this.kick()
    return this.view(cancelled)
  }
  complete(event: SessionCompletionEvent): void {
    if (!this.initialized || this.closed || event.workspaceId !== this.workspace.id) return
    const rows = this.db.prepare(`SELECT body FROM work WHERE json_extract(body,'$.sessionId')=?
      AND json_extract(body,'$.state') IN ('submitting','submitted','needs_attention','cancel_requested')`).all(event.sessionId) as Array<{ body: string }>
    const receipt = rows.map(row => JSON.parse(row.body) as AssistantDelegationReceipt)
      .find(item => item.inputMessageId && event.inputMessageIds?.includes(item.inputMessageId))
    if (!receipt) return
    if (receipt.state === 'cancel_requested') this.save({ ...receipt, state: 'cancelled' })
    else if (event.reason === 'complete' && event.finalMessageId) this.save({ ...receipt, state: 'result_ready', error: undefined,
      result: { sessionId: event.resultSessionId ?? event.sessionId, messageId: event.finalMessageId } })
    else this.save({ ...receipt, state: ['error','timeout'].includes(event.reason) ? 'failed' : 'needs_attention', error: `Session ${event.reason}; inspect its original execution.` })
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
  private async pump(): Promise<void> {
    while (!this.closed) {
      if (this.db.prepare("SELECT 1 FROM work WHERE json_extract(body,'$.state') IN ('preparing','submitting','submitted','needs_attention','cancel_requested') LIMIT 1").get()) return
      const row = this.db.prepare("SELECT body FROM work WHERE json_extract(body,'$.state')='accepted' ORDER BY seq LIMIT 1").get() as { body: string } | undefined
      if (!row) return
      const receipt = this.save({ ...JSON.parse(row.body) as AssistantDelegationReceipt, state: 'submitting' })
      try {
        await this.host.start(receipt, () => this.get(receipt.id).state === 'submitting')
        const current = this.get(receipt.id)
        if (current.state === 'submitting') this.save({ ...current, state: 'submitted' })
      }
      catch (error) {
        const current = this.get(receipt.id)
        if (!['cancelled','cancel_requested','result_ready'].includes(current.state)) {
          const failed: AssistantDelegationReceipt = { ...current, state: error instanceof SessionDelegationConflict ? 'failed' : 'needs_attention',
            error: error instanceof Error ? error.message : 'Session input submission failed' }
          if (failed.state === 'failed') await this.host.rejectStaged(failed, failed.error!)
          if (!['cancelled','cancel_requested','result_ready'].includes(this.get(receipt.id).state)) this.save(failed)
        }
      }
    }
  }
  async close(): Promise<void> { this.closed = true; await this.ready; await this.pumping; this.db.close() }
}
