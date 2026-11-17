import { createHash } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { SqliteDatabase } from '../runtime/sqlite'
import type { AssistantDelegationReceipt, AssistantWork } from '@phaneris/session-tools-core/delegation-contracts'
import type { WorkerControl, WorkerControlApplication, WorkerControlReceipt, WorkerControlResult } from '@phaneris/session-tools-core/worker-control-contracts'

interface CommandRow { fingerprint: string; command: string; receipt: string }
/** A command can fail after the Runtime has already stopped. Preserve that fact. */
export class WorkerControlInterrupted extends Error {
  constructor(error: unknown, readonly state: 'paused' | 'needs_attention') {
    super(error instanceof Error ? error.message : 'Worker management failed after stopping', { cause: error })
  }
}
/** Durable command facts in delegations.db; Session and Runtime retain actual state. */
export class WorkerControls {
  private readonly active = new Map<string, Promise<WorkerControlResult>>()
  constructor(private readonly db: SqliteDatabase, private readonly port: {
    read(id: string): AssistantDelegationReceipt
    save(work: AssistantDelegationReceipt): AssistantDelegationReceipt
    view(work: AssistantDelegationReceipt): Promise<AssistantWork>
    apply(work: AssistantDelegationReceipt, command: WorkerControl, supplements: string[], context: Pick<WorkerControlReceipt, 'actor' | 'initialState' | 'evidence'>): Promise<WorkerControlApplication>
    evidence(work: AssistantDelegationReceipt): Promise<NonNullable<WorkerControlReceipt['evidence']>>
    status?(receipt: WorkerControlReceipt): Pick<WorkerControlReceipt, 'processedAt'>
    evidenceValid(evidence: NonNullable<WorkerControlReceipt['evidence']>): boolean
    wake(): void
    rejected?(work: AssistantDelegationReceipt): Promise<void>
  }) { db.exec('CREATE TABLE IF NOT EXISTS worker_commands(id TEXT PRIMARY KEY,work_id TEXT NOT NULL,fingerprint TEXT NOT NULL,command TEXT NOT NULL,receipt TEXT NOT NULL); CREATE INDEX IF NOT EXISTS worker_commands_work ON worker_commands(work_id);') }

  private receipt(row: CommandRow): WorkerControlReceipt { return JSON.parse(row.receipt) as WorkerControlReceipt }
  private update(receipt: WorkerControlReceipt): WorkerControlReceipt {
    const updated = { ...receipt, updatedAt: Date.now() }
    this.db.prepare('UPDATE worker_commands SET receipt=? WHERE id=?').run(JSON.stringify(updated), receipt.commandId)
    return updated
  }
  supersede(id: string): void {
    const rows = this.db.prepare('SELECT fingerprint,command,receipt FROM worker_commands WHERE work_id=?').all(id) as CommandRow[]
    for (const row of rows) { const receipt = this.receipt(row); if (['accepted', 'waiting'].includes(receipt.phase)) this.update({ ...receipt, phase: 'rejected', error: 'The original task or command was superseded' }) }
  }
  list(id: string): WorkerControlReceipt[] {
    return (this.db.prepare('SELECT receipt FROM worker_commands WHERE work_id=? ORDER BY json_extract(receipt,\'$.at\') DESC LIMIT 20').all(id) as Array<{ receipt: string }>).map(row => {
      const receipt = JSON.parse(row.receipt) as WorkerControlReceipt
      return { ...receipt, ...this.port.status?.(receipt) }
    })
  }
  pendingMessage(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM worker_commands WHERE work_id=? AND json_extract(command,'$.action')='message' AND COALESCE(json_extract(command,'$.delivery'),'queued')='queued' AND json_extract(receipt,'$.phase') IN ('accepted','waiting') LIMIT 1").get(id)
  }
  async control(command: WorkerControl, actor: WorkerControlReceipt['actor'] = 'assistant'): Promise<WorkerControlResult> {
    const fingerprint = createHash('sha256').update(canonicalJson(command)).digest('hex')
    const stored = this.db.prepare('SELECT fingerprint,command,receipt FROM worker_commands WHERE id=?').get(command.commandId) as CommandRow | undefined
    if (stored && stored.fingerprint !== fingerprint) throw new Error('Worker command identity has different content')
    if (stored && ['applied', 'rejected'].includes(this.receipt(stored).phase)) return { command: this.receipt(stored), work: await this.port.view(this.port.read(command.id)) }
    const existing = this.active.get(command.commandId)
    if (existing) return existing
    const operation = this.apply(command, fingerprint, actor, stored)
    this.active.set(command.commandId, operation)
    try { return await operation } finally { this.active.delete(command.commandId) }
  }
  private async apply(command: WorkerControl, fingerprint: string, actor: WorkerControlReceipt['actor'], stored?: CommandRow): Promise<WorkerControlResult> {
    const work = this.port.read(command.id)
    if (!stored && work.seq !== command.expectedSeq) throw new Error('Worker sequence changed; inspect the current receipt before issuing this command')
    if (work.pendingControlId && work.pendingControlId !== command.commandId) throw new Error('Another Worker command is pending; inspect it before replacing the task intent')
    if (!stored && ['cancelled', 'cancel_requested', 'result_ready'].includes(work.state)) throw new Error('A cancelled or completed result cannot be resumed or retried implicitly')
    if (!stored) {
      const receipt: WorkerControlReceipt = { commandId: command.commandId, delegationId: command.id, action: command.action, expectedSeq: command.expectedSeq,
        phase: 'accepted', at: Date.now(), updatedAt: Date.now(), actor, initialState: work.state,
        ...(actor === 'assistant' && command.action === 'message' ? { evidence: await this.port.evidence(work) } : {}) }
      if (this.port.read(work.id).seq !== work.seq) throw new Error('Worker sequence changed while preparing supplemental evidence; inspect the current receipt')
      this.db.prepare('INSERT INTO worker_commands VALUES(?,?,?,?,?)').run(command.commandId, command.id, fingerprint, JSON.stringify(command), JSON.stringify(receipt))
    }
    const row = this.db.prepare('SELECT fingerprint,command,receipt FROM worker_commands WHERE id=?').get(command.commandId) as CommandRow
    const staged = this.port.save({ ...work, pendingControlId: command.commandId,
      ...(command.action === 'pause' || command.action !== 'plan' && !(command.action === 'message' && command.delivery !== 'interrupt') && ['submitting', 'submitted', 'needs_attention'].includes(work.state) ? { state: 'pause_requested' as const } : {}) })
    const messages = this.db.prepare("SELECT command,receipt FROM worker_commands WHERE work_id=? AND json_extract(command,'$.action')='message' AND json_extract(receipt,'$.phase')='applied' ORDER BY json_extract(receipt,'$.at') DESC LIMIT 16").all(work.id) as Array<{ command: string; receipt: string }>
    const supplements = messages.reverse().filter(row => {
      const receipt = JSON.parse(row.receipt) as WorkerControlReceipt
      return receipt.actor === 'user' || !!receipt.evidence && this.port.evidenceValid(receipt.evidence)
    }).map(row => (JSON.parse(row.command) as Extract<WorkerControl, { action: 'message' }>).message)
    try {
      const application = await this.port.apply(staged, command, supplements, this.receipt(row))
      const current = this.port.read(work.id)
      if (current.pendingControlId !== command.commandId || ['cancelled', 'cancel_requested'].includes(current.state)) {
        const receipt = this.update({ ...this.receipt(row), phase: 'rejected', error: 'The command was superseded while applying' })
        return { command: receipt, work: await this.port.view(current) }
      }
      const phase = application.phase ?? 'applied'
      const saved = this.port.save({ ...current, state: command.action === 'plan' || application.delivery === 'queued' ? current.state : application.state, error: application.error, pendingControlId: phase === 'waiting' ? command.commandId : undefined,
        ...(command.action === 'plan' && command.priority !== undefined ? { priority: command.priority } : {}) })
      const receipt = this.update({ ...this.receipt(row), phase, error: application.error, delivery: application.delivery, input: application.input })
      if (saved.state === 'accepted') this.port.wake()
      return { command: receipt, work: await this.port.view(saved) }
    } catch (error) {
      const current = this.port.read(work.id)
      if (current.pendingControlId === command.commandId) {
        const restored = this.port.save({ ...current, state: error instanceof WorkerControlInterrupted ? error.state
          : current.state === 'pause_requested' ? work.state === 'pause_requested' ? 'needs_attention' : work.state : current.state, pendingControlId: undefined })
        if (restored.state === 'accepted') this.port.wake()
      }
      this.update({ ...this.receipt(row), phase: 'rejected', error: error instanceof Error ? error.message : 'Worker management failed' })
      await this.port.rejected?.(this.port.read(work.id))
      throw error
    }
  }
  settled(id: string): void {
    const rows = this.db.prepare("SELECT command FROM worker_commands WHERE work_id=? AND json_extract(receipt,'$.phase') IN ('accepted','waiting')").all(id) as Array<{ command: string }>
    for (const row of rows) {
      const command = JSON.parse(row.command) as WorkerControl
      const pending = this.active.get(command.commandId)
      // Runtime settlement can precede the first waiting ACK by a microtask.
      // Retry after that operation leaves the active map, not against itself.
      void (pending ? pending.then(() => this.control(command)) : this.control(command)).catch(() => undefined)
    }
  }
  async recover(): Promise<void> {
    const rows = this.db.prepare("SELECT command,receipt FROM worker_commands WHERE json_extract(receipt,'$.phase') IN ('accepted','waiting') ORDER BY json_extract(receipt,'$.at')").all() as Array<{ command: string; receipt: string }>
    for (const row of rows) await this.control(JSON.parse(row.command) as WorkerControl, (JSON.parse(row.receipt) as WorkerControlReceipt).actor).catch(() => undefined)
  }
}
