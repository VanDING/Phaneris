import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { sessionDirectoryEntries } from '@phaneris/shared/sessions'
import { getSessionFilePath, readSessionJsonl } from '@phaneris/shared/sessions'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import type { HistoryMatch, HistoryPage, HistoryQuery } from '@phaneris/session-tools-core/history-contracts'
import type { SqliteDatabase } from '../runtime/sqlite'
import { isDirectUserMessage, historySourceContent, sourceContentHash } from './source-provenance'
import { historyExtractionCoverage } from './history-extraction'

type SourceState = 'pending' | 'indexed' | 'unreadable' | 'assistant'
interface SourceRow { id: string; signature: string; state: SourceState; project_id: string | null; scanned_at: number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export function initializeHistoryIndex(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS history_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
    INSERT OR IGNORE INTO history_clock VALUES(1,0);
    CREATE TABLE IF NOT EXISTS history_sessions(id TEXT PRIMARY KEY, signature TEXT NOT NULL, state TEXT NOT NULL, project_id TEXT, scanned_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS history_messages(session_id TEXT NOT NULL, message_id TEXT NOT NULL, content TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(session_id,message_id));
    CREATE TABLE IF NOT EXISTS history_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL);`)
  const schema = db.prepare('SELECT version FROM history_schema WHERE singleton=1').get() as { version: number } | undefined
  if (!schema || schema.version < 2) db.transaction(() => {
    db.exec("UPDATE history_sessions SET state='pending'; INSERT OR REPLACE INTO history_schema VALUES(1,2)")
  })()
}

/** Atomic JSONL rewrites make file identity, rather than a byte offset, the incremental boundary.
 * Only eight changed Sessions are decoded per query. Unchanged files are only stat'ed.
 * This is a disposable search projection; Session storage and suppression retain authority. */
export function queryHistory(db: SqliteDatabase, workspaceRootPath: string, input: HistoryQuery, memoryVersion: number,
  sourceAvailable?: (source: { sessionId: string; messageId: string; contentHash: string }) => boolean): HistoryPage {
  return db.transaction(() => {
    const inventory = new Map<string, string>()
    for (const entry of sessionDirectoryEntries(workspaceRootPath)) {
      const stat = lstatSync(getSessionFilePath(workspaceRootPath, entry.id), { bigint: true, throwIfNoEntry: false })
      if (!stat) continue
      inventory.set(entry.id, stat.isFile() ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : 'unreadable')
    }
    const rows = db.prepare('SELECT * FROM history_sessions').all() as SourceRow[]
    const previous = new Map(rows.map(row => [row.id, row]))
    let changed = false
    for (const row of rows) if (!inventory.has(row.id)) {
      db.prepare('DELETE FROM history_messages WHERE session_id=?').run(row.id)
      db.prepare('DELETE FROM history_sessions WHERE id=?').run(row.id)
      changed = true
    }
    for (const [id, signature] of inventory) if (previous.get(id)?.signature !== signature) {
      db.prepare('DELETE FROM history_messages WHERE session_id=?').run(id)
      db.prepare(`INSERT INTO history_sessions VALUES(?,?,'pending',NULL,0)
        ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,state='pending',project_id=NULL`).run(id, signature)
      changed = true
    }
    // Unreadable files are retried when their file identity changes, so one damaged
    // source cannot starve older history. No model or startup-wide history replay.
    const pending = db.prepare("SELECT * FROM history_sessions WHERE state='pending' ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,scanned_at ASC,id ASC LIMIT 8").all(input.sessionId ?? null) as SourceRow[]
    for (const row of pending) {
      const session = row.signature === 'unreadable' ? null : readSessionJsonl(getSessionFilePath(workspaceRootPath, row.id), { strict: true })
      const valid = session?.id === row.id && session.messages.every(message => message && typeof message.id === 'string'
        && message.id.length > 0 && typeof message.content === 'string'
        && ['user', 'assistant', 'tool', 'error', 'info', 'warning', 'status', 'plan', 'auth-request'].includes(message.type))
        && new Set(session.messages.map(message => message.id)).size === session.messages.length
      const state: SourceState = !valid ? 'unreadable' : 'indexed'
      db.prepare('UPDATE history_sessions SET state=?,project_id=?,scanned_at=? WHERE id=?').run(state, valid ? session.projectId ?? null : null, Date.now(), row.id)
      if (state === 'indexed' && session) for (const message of session.messages) {
        if (session.sessionKind === 'resident_assistant' && !isDirectUserMessage(message)) continue
        if (db.prepare('SELECT 1 FROM suppression WHERE source_key=? LIMIT 1').get(JSON.stringify([row.id, message.id]))) continue
        const content = historySourceContent(message)
        const body: Omit<HistoryMatch, 'snippet' | 'range' | 'projectId'> & { projectId: string | null } = { sessionId: row.id, messageId: message.id, role: message.type,
          projectId: message.projectScope ? message.projectScope.projectId : session.projectId ?? null,
          timestamp: message.timestamp, directUser: isDirectUserMessage(message), inputSource: message.inputSource,
          contentHash: sourceContentHash(workspaceRootPath, row.id, content), attachmentCount: message.attachments?.length ?? 0, attachmentContentIndexed: false }
        db.prepare('INSERT INTO history_messages VALUES(?,?,?,?)').run(row.id, message.id, content, JSON.stringify(body))
      }
      changed = true
    }
    if (changed) db.prepare('UPDATE history_clock SET version=version+1 WHERE singleton=1').run()
    const version = (db.prepare('SELECT version FROM history_clock WHERE singleton=1').get() as { version: number }).version
    const query = input.query ?? '', limit = input.limit ?? 20
    const fingerprint = digest(canonicalJson({ query, limit, sessionId: input.sessionId ?? null, projectId: input.projectId ?? null, includeWorkspace: !!input.projectId && !!input.includeWorkspace }))
    if (input.cursor && (input.cursor.version !== version || input.cursor.memoryVersion !== memoryVersion || input.cursor.fingerprint !== fingerprint)) {
      throw new Error('History cursor version or query changed; restart query')
    }
    const offset = input.cursor?.offset ?? 0
    const matches = db.prepare(`SELECT m.content,m.body,json_extract(m.body,'$.projectId') AS project_id FROM history_messages m JOIN history_sessions s ON s.id=m.session_id
      WHERE s.state='indexed' AND (? IS NULL OR json_extract(m.body,'$.projectId')=? OR (? AND json_extract(m.body,'$.projectId') IS NULL)) AND (? IS NULL OR m.session_id=?)
      AND instr(lower(m.content),lower(?))>0
      AND NOT EXISTS(SELECT 1 FROM suppression WHERE source_key=json_array(m.session_id,m.message_id))
      ORDER BY COALESCE(json_extract(m.body,'$.timestamp'),0) DESC,m.session_id ASC,m.message_id ASC LIMIT ? OFFSET ?`)
      .all(input.projectId ?? null, input.projectId ?? null, input.includeWorkspace ? 1 : 0, input.sessionId ?? null, input.sessionId ?? null, query, limit + 1, offset) as Array<{ content: string; body: string; project_id: string | null }>
    const counts = db.prepare('SELECT state,COUNT(*) AS count FROM history_sessions GROUP BY state').all() as Array<{ state: SourceState; count: number }>
    const count = (state: SourceState) => counts.find(row => row.state === state)?.count ?? 0
    return { version, memoryVersion, scope: { projectId: input.projectId, includesWorkspace: !input.projectId || !!input.includeWorkspace, workspaceWide: !input.projectId }, extraction: historyExtractionCoverage(db), items: matches.slice(0, limit).map(row => {
      const start = Math.max(0, row.content.toLowerCase().indexOf(query.toLowerCase()) - 120)
      const end = Math.min(row.content.length, start + 500)
      return { ...JSON.parse(row.body) as Omit<HistoryMatch, 'snippet' | 'range'>,
        projectId: row.project_id ?? undefined, snippet: row.content.slice(start, end), range: { offset: start, end, fullChars: row.content.length } }
    }).filter(source => !sourceAvailable || sourceAvailable(source)), nextCursor: matches.length > limit ? { version, memoryVersion, fingerprint, offset: offset + limit } : null,
    coverage: { discoveredSessions: inventory.size, indexedSessions: count('indexed'), pendingSessions: count('pending'),
      unreadableSessions: count('unreadable'), excludedAssistantSessions: count('assistant'), refreshedSessions: pending.length,
      indexedMessages: (db.prepare('SELECT COUNT(*) AS count FROM history_messages').get() as { count: number }).count } }
  })()
}
