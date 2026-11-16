import { openSqliteDatabase } from './sqlite'

export class WriterLeaseBusyError extends Error {
  constructor(message: string) { super(message); this.name = 'WriterLeaseBusyError' }
}

/** A data-free OS lease, released on process death by the active SQLite runtime.
 * It uses a separate resource file, never a business database transaction. */
export function acquireWriterLease(file: string, busyMessage = 'Writer lease is busy for this resource'): () => void {
  const database = openSqliteDatabase(file)
  try {
    database.exec('PRAGMA busy_timeout = 0')
    database.exec('BEGIN IMMEDIATE')
  } catch (error) {
    database.close()
    const sqlite = error as { code?: string; errcode?: number }
    if (sqlite.code === 'SQLITE_BUSY' || sqlite.code === 'SQLITE_LOCKED' || sqlite.errcode === 5 || sqlite.errcode === 6) {
      throw new WriterLeaseBusyError(busyMessage)
    }
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try { database.exec('ROLLBACK') } finally { database.close() }
  }
}
