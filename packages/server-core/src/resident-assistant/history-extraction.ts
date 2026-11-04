import { createHash } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { MemoryRecord, MemorySourceResult } from '@phaneris/session-tools-core/memory-contracts'
import type { MemoryExtractionCoverage, MemoryMaintenanceCommand, MemoryMaintenanceResult } from '@phaneris/session-tools-core/memory-maintenance-contracts'
import type { HistoryMatch } from '@phaneris/session-tools-core/history-contracts'
import type { SqliteDatabase } from '../runtime/sqlite'

interface Checkpoint {
  id: string; session_id: string; message_id: string; content_hash: string; project_id: string | null
  start_offset: number; end_offset: number; full_chars: number; created_at: number; acknowledgement: string | null
}
interface PendingSource { session_id: string; message_id: string; body: string; project_id: string | null; through: number; full_chars: number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export function initializeHistoryExtraction(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS history_extraction(
    id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,content_hash TEXT NOT NULL,project_id TEXT,
    start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,full_chars INTEGER NOT NULL,created_at INTEGER NOT NULL,acknowledgement TEXT);
    CREATE INDEX IF NOT EXISTS history_extraction_source ON history_extraction(session_id,message_id,content_hash,project_id);
    CREATE TABLE IF NOT EXISTS history_extraction_reads(run_id TEXT PRIMARY KEY,checkpoint_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history_extraction_unavailable(session_id TEXT NOT NULL,message_id TEXT NOT NULL,
      history_version INTEGER NOT NULL,memory_version INTEGER NOT NULL,PRIMARY KEY(session_id,message_id));`)
}

// Match both content version and project scope. A catalogue rebuild can reuse
// authority checkpoints, while a source rewrite/move cannot inherit old progress.
const projection = `WITH progress AS (
  SELECT session_id,message_id,content_hash,project_id,MAX(CASE WHEN acknowledgement IS NOT NULL THEN end_offset ELSE 0 END) AS through,
    COUNT(acknowledgement) AS acknowledged,MAX(full_chars) AS full_chars
  FROM history_extraction GROUP BY session_id,message_id,content_hash,project_id
), sources AS (
  SELECT m.session_id,m.message_id,m.body,s.project_id,COALESCE(p.full_chars,length(m.content)) AS full_chars,
    COALESCE(p.through,0) AS through,COALESCE(p.acknowledged,0) AS acknowledged,
    (u.history_version=(SELECT version FROM history_clock WHERE singleton=1)
      AND u.memory_version=(SELECT version FROM meta WHERE singleton=1)) AS unavailable
  FROM history_messages m JOIN history_sessions s ON s.id=m.session_id
  LEFT JOIN progress p ON p.session_id=m.session_id AND p.message_id=m.message_id
    AND p.content_hash=json_extract(m.body,'$.contentHash') AND p.project_id IS s.project_id
  LEFT JOIN history_extraction_unavailable u ON u.session_id=m.session_id AND u.message_id=m.message_id
  WHERE s.state='indexed' AND NOT EXISTS(SELECT 1 FROM suppression WHERE source_key=json_array(m.session_id,m.message_id))
) `

export function historyExtractionCoverage(db: SqliteDatabase): MemoryExtractionCoverage {
  const result = db.prepare(projection + `SELECT
    (SELECT COUNT(*) FROM history_sessions WHERE state='pending') AS pendingSessions,
    (SELECT COUNT(*) FROM history_sessions WHERE state='unreadable') AS unreadableSessions,
    COALESCE(SUM(acknowledged>0 AND through>=full_chars),0) AS processedMessages,
    COALESCE(SUM(acknowledged>0 AND through<full_chars),0) AS partialMessages,
    COALESCE(SUM((acknowledged=0 OR through<full_chars) AND NOT COALESCE(unavailable,0)),0) AS pendingMessages,
    COALESCE(SUM(COALESCE(unavailable,0)),0) AS unavailableMessages,
    COALESCE(SUM(json_extract(body,'$.attachmentCount')>0),0) AS unparsedAttachmentMessages FROM sources`).get()
  return result as MemoryExtractionCoverage
}

/** One bounded slice per existing Runtime run. No model, task or source copy. */
export function maintainHistory(db: SqliteDatabase, command: MemoryMaintenanceCommand, runId: string,
  read: (source: { sessionId: string; messageId: string; expectedContentHash?: string }) => MemorySourceResult,
  memory: (id: string) => MemoryRecord): MemoryMaintenanceResult {
  return db.transaction((): MemoryMaintenanceResult => {
    const selected = db.prepare('SELECT checkpoint_id FROM history_extraction_reads WHERE run_id=?').get(runId) as { checkpoint_id: string } | undefined
    if (command.action === 'acknowledge') {
      if (selected?.checkpoint_id !== command.checkpointId) throw new Error('Read the extraction checkpoint in this Runtime run before acknowledging it')
      const checkpoint = db.prepare('SELECT * FROM history_extraction WHERE id=?').get(command.checkpointId) as Checkpoint
      const source = read({ sessionId: checkpoint.session_id, messageId: checkpoint.message_id, expectedContentHash: checkpoint.content_hash })
      const current = db.prepare(`SELECT s.project_id,json_extract(m.body,'$.contentHash') AS content_hash FROM history_messages m
        JOIN history_sessions s ON s.id=m.session_id WHERE m.session_id=? AND m.message_id=? AND s.state='indexed'`).get(checkpoint.session_id, checkpoint.message_id) as { project_id: string | null; content_hash: string } | undefined
      if (!current || current.project_id !== checkpoint.project_id || current.content_hash !== source.contentHash) throw new Error('Extraction source version or project scope changed; read the current source again')
      const acknowledgement = canonicalJson({ conclusion: command.conclusion, reason: command.reason, candidateIds: [...new Set(command.candidateIds ?? [])].sort() })
      if (checkpoint.acknowledgement && checkpoint.acknowledgement !== acknowledgement) throw new Error('Extraction acknowledgement conflict: conclusion changed')
      for (const id of command.candidateIds ?? []) {
        const candidate = memory(id)
        if (candidate.state !== 'candidate' || candidate.basis !== 'inferred' || candidate.redacted || (candidate.projectId ?? null) !== checkpoint.project_id
          || candidate.createdAt < checkpoint.created_at || !candidate.sources.some(ref => ref.sessionId === source.sessionId && ref.messageId === source.messageId && ref.contentHash === source.contentHash)) {
          throw new Error('Extraction candidate must be a new inferred candidate from this exact source version and project')
        }
      }
      db.prepare('UPDATE history_extraction SET acknowledgement=? WHERE id=?').run(acknowledgement, checkpoint.id)
      return { status: 'acknowledged', checkpointId: checkpoint.id, coverage: historyExtractionCoverage(db) }
    }
    if (selected) {
      const checkpoint = db.prepare('SELECT * FROM history_extraction WHERE id=?').get(selected.checkpoint_id) as Checkpoint
      if (checkpoint.acknowledgement) return { status: 'budget_exhausted', coverage: historyExtractionCoverage(db) }
      if ((command.sessionId && command.sessionId !== checkpoint.session_id) || (command.projectId && command.projectId !== checkpoint.project_id)) throw new Error('This Runtime run already selected a different extraction source')
      const source = read({ sessionId: checkpoint.session_id, messageId: checkpoint.message_id, expectedContentHash: checkpoint.content_hash })
      const body = db.prepare(`SELECT m.body,s.project_id FROM history_messages m JOIN history_sessions s ON s.id=m.session_id
        WHERE m.session_id=? AND m.message_id=? AND s.state='indexed'`).get(source.sessionId, source.messageId) as { body: string; project_id: string | null } | undefined
      if (!body || body.project_id !== checkpoint.project_id) throw new Error('Extraction source scope changed or is no longer indexed')
      return { status: 'source', checkpointId: checkpoint.id, requestIdPrefix: `extract:${checkpoint.id}`,
        source: { ...JSON.parse(body.body) as HistoryMatch, ...(checkpoint.project_id ? { projectId: checkpoint.project_id } : {}) },
        content: source.content.slice(checkpoint.start_offset, checkpoint.end_offset),
        range: { offset: checkpoint.start_offset, end: checkpoint.end_offset, fullChars: checkpoint.full_chars }, coverage: historyExtractionCoverage(db) }
    }
    const pending = db.prepare(projection + `SELECT * FROM sources WHERE (acknowledged=0 OR through<full_chars)
      AND NOT COALESCE(unavailable,0) AND (? IS NULL OR project_id=?) AND (? IS NULL OR session_id=?)
      ORDER BY COALESCE(json_extract(body,'$.timestamp'),0) ASC,session_id ASC,message_id ASC LIMIT 16`)
      .all(command.projectId ?? null, command.projectId ?? null, command.sessionId ?? null, command.sessionId ?? null) as PendingSource[]
    for (const item of pending) {
      const reference = JSON.parse(item.body) as HistoryMatch
      let source: MemorySourceResult
      // File availability and derived lineage are external I/O boundaries. Keep
      // unavailable sources visible in coverage and let other sources progress.
      try { source = read({ ...reference, expectedContentHash: reference.contentHash }) }
      catch {
        db.prepare(`INSERT INTO history_extraction_unavailable VALUES(?,?,(SELECT version FROM history_clock WHERE singleton=1),(SELECT version FROM meta WHERE singleton=1))
          ON CONFLICT(session_id,message_id) DO UPDATE SET history_version=excluded.history_version,memory_version=excluded.memory_version`).run(item.session_id, item.message_id)
        continue
      }
      // JavaScript offsets, not SQLite's Unicode-codepoint length, define ranges.
      const end = Math.min(item.through + 6000, source.content.length)
      const checkpointId = digest(canonicalJson({ sessionId: source.sessionId, messageId: source.messageId, contentHash: source.contentHash,
        projectId: item.project_id, offset: item.through, end }))
      db.prepare('INSERT OR IGNORE INTO history_extraction VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(checkpointId, source.sessionId, source.messageId, source.contentHash, item.project_id, item.through, end, source.content.length, Date.now())
      db.prepare('INSERT INTO history_extraction_reads VALUES(?,?)').run(runId, checkpointId)
      return { status: 'source', checkpointId, requestIdPrefix: `extract:${checkpointId}`,
        source: { ...reference, ...(item.project_id ? { projectId: item.project_id } : {}) },
        content: source.content.slice(item.through, end), range: { offset: item.through, end, fullChars: source.content.length }, coverage: historyExtractionCoverage(db) }
    }
    return { status: pending.length === 16 ? 'blocked' : 'idle', coverage: historyExtractionCoverage(db) }
  })()
}
