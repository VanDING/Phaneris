import { Worker } from 'node:worker_threads'
import type { SqliteDatabase } from './sqlite-driver.js'

type DatabaseTask = { kind: 'integrity' } | { kind: 'backup'; destination: string }
  | { kind: 'maintain'; projectionRetentionMs?: number; vacuum?: boolean }

/** Self-contained so the identical SQL/file protocol runs in-process or in a
 * bundled worker without depending on a source-tree entry file. */
export function performDatabaseTask(db: SqliteDatabase, databasePath: string, task: DatabaseTask): unknown {
  const { existsSync, mkdirSync, linkSync, unlinkSync } = process.getBuiltinModule('fs') as typeof import('node:fs')
  const { resolve, dirname } = process.getBuiltinModule('path') as typeof import('node:path')
  const { randomUUID } = process.getBuiltinModule('crypto') as typeof import('node:crypto')
  if (task.kind === 'integrity') {
    const rows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>
    const messages = rows.map(row => String(row.integrity_check ?? Object.values(row)[0] ?? 'unknown'))
    return { ok: messages.length === 1 && messages[0]!.toLowerCase() === 'ok', messages, checkedAt: Date.now() }
  }
  if (task.kind === 'backup') {
    if (databasePath === ':memory:') throw new Error('In-memory runtime databases cannot be backed up to disk')
    const destination = resolve(task.destination)
    if (destination === resolve(databasePath)) throw new Error('Runtime database backup destination must differ from the source')
    if (existsSync(destination)) throw new Error(`Runtime database backup already exists: ${destination}`)
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    const staged = `${destination}.${randomUUID()}.tmp`
    try {
      db.exec('PRAGMA wal_checkpoint(FULL)')
      db.exec(`VACUUM INTO '${staged.replaceAll("'", "''")}'`)
      linkSync(staged, destination)
      return destination
    } finally { if (existsSync(staged)) unlinkSync(staged) }
  }
  const maintainedAt = Date.now(), removedProjections: string[] = []
  if (task.projectionRetentionMs !== undefined && (!Number.isFinite(task.projectionRetentionMs) || task.projectionRetentionMs < 0)) {
    throw new Error('projectionRetentionMs must be a non-negative finite number')
  }
  db.exec('PRAGMA wal_checkpoint(FULL)')
  if (task.projectionRetentionMs !== undefined) {
    const rows = db.prepare('SELECT projection FROM projection_snapshots WHERE updated_at < ?')
      .all(maintainedAt - task.projectionRetentionMs) as Array<{ projection: string }>
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        db.prepare('DELETE FROM projection_snapshots WHERE projection = ?').run(row.projection)
        db.prepare('DELETE FROM projection_cursors WHERE projection = ?').run(row.projection)
        removedProjections.push(row.projection)
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  if (task.vacuum) db.exec('VACUUM')
  db.exec('PRAGMA optimize')
  return { removedProjections, vacuumed: task.vacuum === true, maintainedAt }
}

/** Uses the active runtime's native SQLite. Full scans/VACUUM never run on the
 * Electron event loop; the connection is worker-owned and always closed. */
export function runDatabaseTask<T>(databasePath: string, task: DatabaseTask, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error('Database maintenance cancelled'))
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const Database = process.versions.bun ? require('bun:sqlite').Database : require('node:sqlite').DatabaseSync;
      let db;
      try {
        db = new Database(workerData.databasePath);
        db.exec('PRAGMA busy_timeout = 5000');
        const result = (${performDatabaseTask.toString()})(db, workerData.databasePath, workerData.task);
        parentPort.postMessage({ result });
      } catch (error) { parentPort.postMessage({ error: String(error) }); }
      finally { if (db) db.close(); parentPort.close(); }
    `, { eval: true, workerData: { databasePath, task } })
    let result: { result: T } | { error: string } | undefined
    let cancelled = false, failure: Error | undefined
    const cancel = () => { cancelled = true; void worker.terminate() }
    signal?.addEventListener('abort', cancel, { once: true })
    worker.on('message', message => { result = message })
    worker.on('error', error => { failure = error })
    worker.on('exit', code => {
      signal?.removeEventListener('abort', cancel)
      if (cancelled) reject(new Error('Database maintenance cancelled'))
      else if (failure) reject(failure)
      else if (code !== 0 || !result) reject(new Error(`Database worker exited without a result (${code})`))
      else if ('error' in result) reject(new Error(result.error))
      else resolve(result.result)
    })
  })
}
