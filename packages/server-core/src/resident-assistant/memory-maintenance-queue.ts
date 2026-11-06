import { createHash } from 'node:crypto'
import type { SourceMaterialReference } from '@phaneris/core/types'
import type { SqliteDatabase } from '../runtime/sqlite'

export interface MemoryMaintenanceJob {
  id: string; sessionId: string; projectId?: string; sources: SourceMaterialReference[]; inputId: string
}
interface JobRow { id: string; source_session: string; project_id: string | null; sources: string; input_id: string | null; runs: number; failures: number }

/** References and admission counters only; the existing resident Runtime executes every job. */
export class MemoryMaintenanceQueue {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance_jobs(id TEXT PRIMARY KEY,source_session TEXT NOT NULL,project_id TEXT,sources TEXT NOT NULL,
      state TEXT NOT NULL,input_id TEXT,runs INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS maintenance_admissions(input_id TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,day TEXT NOT NULL,
        PRIMARY KEY(input_id,kind,request_id));
      CREATE TABLE IF NOT EXISTS maintenance_run_ids(input_id TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(input_id,operation_id));
      CREATE INDEX IF NOT EXISTS maintenance_pending ON maintenance_jobs(state,next_at,updated_at);`)
    // The workspace writer lease guarantees that no previous owner's run is live.
    db.prepare("UPDATE maintenance_jobs SET state='pending',next_at=? WHERE state='running'").run(Date.now() + 1000)
  }
  enqueue(sessionId: string, projectId: string | undefined, sources: SourceMaterialReference[]): void {
    if (!sources.length) return
    const body = JSON.stringify(sources), id = createHash('sha256').update(JSON.stringify([sessionId, projectId ?? null, body])).digest('hex')
    this.db.transaction(() => {
      this.db.prepare(`UPDATE maintenance_jobs SET state='replaced' WHERE source_session=? AND id<>? AND state='pending'
        AND EXISTS(SELECT 1 FROM json_each(maintenance_jobs.sources) old JOIN json_each(?) fresh
          ON json_extract(old.value,'$.messageId')=json_extract(fresh.value,'$.messageId'))`).run(sessionId, id, body)
      this.db.prepare("INSERT OR IGNORE INTO maintenance_jobs(id,source_session,project_id,sources,state,next_at,updated_at) VALUES(?,?,?,?,'pending',?,?)")
        .run(id, sessionId, projectId ?? null, body, Date.now() + 1000, Date.now())
    })()
  }
  status() {
    const day = new Date().toISOString().slice(0, 10)
    const counts = this.db.prepare('SELECT state,COUNT(*) AS count FROM maintenance_jobs GROUP BY state').all() as Array<{ state: string; count: number }>
    const admissions = this.db.prepare('SELECT kind,COUNT(*) AS count FROM maintenance_admissions WHERE day=? GROUP BY kind').all(day) as Array<{ kind: string; count: number }>
    const next = this.db.prepare("SELECT MIN(next_at) AS at FROM maintenance_jobs WHERE state='pending'").get() as { at: number | null }
    const count = (state: string) => counts.find(item => item.state === state)?.count ?? 0
    return { pending: count('pending'), running: count('running'), done: count('done'), attention: count('attention'),
      modelCalls: admissions.find(item => item.kind === 'model')?.count ?? 0, toolCalls: admissions.find(item => item.kind === 'tool')?.count ?? 0,
      nextAt: next.at ?? undefined }
  }
  claim(): MemoryMaintenanceJob | undefined {
    return this.db.transaction(() => {
      if (this.status().running) return
      const day = new Date().toISOString().slice(0, 10)
      const used = this.db.prepare("SELECT COUNT(*) AS count FROM maintenance_admissions WHERE kind='run' AND day=?").get(day) as { count: number }
      if (used.count >= 8) {
        const tomorrow = Date.parse(`${day}T00:00:00Z`) + 86400000
        this.db.prepare("UPDATE maintenance_jobs SET next_at=MAX(next_at,?) WHERE state='pending'").run(tomorrow)
        return
      }
      const row = this.db.prepare("SELECT * FROM maintenance_jobs WHERE state='pending' AND next_at<=? ORDER BY updated_at,id LIMIT 1").get(Date.now()) as JobRow | undefined
      if (!row) return
      const inputId = `memory-maintenance:${row.id}:${row.runs + 1}`
      this.db.prepare("UPDATE maintenance_jobs SET state='running',input_id=?,runs=runs+1,updated_at=? WHERE id=?").run(inputId, Date.now(), row.id)
      this.db.prepare("INSERT INTO maintenance_admissions VALUES(?,'run',?,?)").run(inputId, row.id, day)
      return { id: row.id, sessionId: row.source_session, projectId: row.project_id ?? undefined, sources: JSON.parse(row.sources), inputId }
    })()
  }
  assert(job: MemoryMaintenanceJob): void {
    if (!this.db.prepare("SELECT 1 FROM maintenance_jobs WHERE id=? AND state='running' AND input_id=?").get(job.id, job.inputId)) throw new Error('Maintenance grant is no longer active')
  }
  active(inputId: string): MemoryMaintenanceJob | undefined {
    const row = this.db.prepare("SELECT * FROM maintenance_jobs WHERE input_id=? AND state='running'").get(inputId) as JobRow | undefined
    return row ? { id: row.id, sessionId: row.source_session, projectId: row.project_id ?? undefined, sources: JSON.parse(row.sources), inputId } : undefined
  }
  reserve(job: MemoryMaintenanceJob, kind: 'model' | 'tool', requestId: string): void {
    this.db.transaction(() => {
      this.assert(job)
      if (this.db.prepare('SELECT 1 FROM maintenance_admissions WHERE input_id=? AND kind=? AND request_id=?').get(job.inputId, kind, requestId)) return
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM maintenance_admissions WHERE input_id=? AND kind=?').get(job.inputId, kind) as { count: number }
      const day = new Date().toISOString().slice(0, 10)
      const daily = this.db.prepare('SELECT COUNT(*) AS count FROM maintenance_admissions WHERE day=? AND kind=?').get(day, kind) as { count: number }
      if (count.count >= (kind === 'model' ? 6 : 16) || daily.count >= (kind === 'model' ? 48 : 128)) throw new Error('Maintenance admission budget exhausted')
      this.db.prepare('INSERT INTO maintenance_admissions VALUES(?,?,?,?)').run(job.inputId, kind, requestId, day)
    })()
  }
  finish(job: MemoryMaintenanceJob, completed: boolean): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM maintenance_jobs WHERE id=? AND state='running' AND input_id=?").get(job.id, job.inputId) as JobRow | undefined
      if (!row) return
      const acknowledged = this.db.prepare(`SELECT 1 FROM history_extraction_reads r JOIN history_extraction e ON e.id=r.checkpoint_id
        WHERE r.run_id IN (SELECT operation_id FROM maintenance_run_ids WHERE input_id=?) AND e.acknowledgement IS NOT NULL`).get(job.inputId)
      const pending = job.sources.some(source => !this.db.prepare(`SELECT 1 FROM history_extraction WHERE session_id=? AND message_id=? AND content_hash=?
        AND project_id IS ? AND acknowledgement IS NOT NULL AND end_offset>=full_chars`).get(source.sessionId, source.messageId, source.contentHash, job.projectId ?? null))
      const failures = acknowledged ? 0 : row.failures + 1
      const state = !pending ? 'done' : failures >= 3 ? 'attention' : 'pending'
      this.db.prepare('UPDATE maintenance_jobs SET state=?,failures=?,next_at=?,updated_at=? WHERE id=?')
        .run(state, failures, Date.now() + (completed && acknowledged ? 1000 : Math.min(60000, 1000 * 2 ** failures)), Date.now(), job.id)
    })()
  }
  bindRun(job: MemoryMaintenanceJob, operationId: string): void {
    this.assert(job)
    this.db.prepare('INSERT OR IGNORE INTO maintenance_run_ids VALUES(?,?)').run(job.inputId, operationId)
  }
}
