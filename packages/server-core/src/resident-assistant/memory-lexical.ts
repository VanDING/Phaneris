import type { MemoryRecord } from '@phaneris/session-tools-core/memory-contracts'
import type { SqliteDatabase } from '../runtime/sqlite'

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const stop = new Set(['我们', '我的', '什么', '哪些', '如何', '怎么', '希望', '目前', '现在', '之前', '是否', '一下', '这个', '那个', '请问', '需要'])
const aliases = [['简洁', '简明', '简短', '精简', '简要'], ['中文', '汉语'], ['英文', '英语']]

/** Pre-tokenized FTS keeps two-character Chinese words and exact ASCII identifiers. */
export function lexicalTokens(text: string, query = false): string[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase(), terms = new Set<string>()
  for (const part of segmenter.segment(normalized)) if (part.isWordLike && part.segment.length >= 2 && (!query || !stop.has(part.segment))) terms.add(part.segment)
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let index = 0; index + 1 < run.length; index++) {
      const term = run.slice(index, index + 2)
      if (!query || !stop.has(term)) terms.add(term)
    }
  }
  if (query) for (const group of aliases) if (group.some(term => terms.has(term))) for (const term of group) terms.add(term)
  if (!terms.size && normalized.trim()) terms.add(normalized.trim())
  return [...terms].slice(0, query ? 24 : 20000)
}
export function lexicalScore(text: string, query: string): number {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  return lexicalTokens(query, true).reduce((score, term) => score + (normalized.includes(term) ? term.length : 0), 0)
}
export interface MemorySearchSnapshot { engine: 'fts5' | 'lexical'; version: number; indexedRecords: number; pendingRecords: number; unavailableRecords: number; refreshedRecords: number }
type IndexRecord = Omit<MemoryRecord, 'content' | 'key'> & { content: string; key: string }

/** Disposable index only. Memory records, suppression and exact sources retain authority. */
export class MemoryLexicalIndex {
  readonly engine: MemorySearchSnapshot['engine']
  constructor(private readonly db: SqliteDatabase) {
    this.engine = (db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as { enabled: number }).enabled ? 'fts5' : 'lexical'
    if (this.engine !== 'fts5') return
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(memory_key,content,condition,tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS memory_search_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL);
      INSERT OR IGNORE INTO memory_search_clock VALUES(1,0);
      CREATE TABLE IF NOT EXISTS memory_search_rows(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_search_dirty(id TEXT PRIMARY KEY,queued_at INTEGER NOT NULL,retry_at INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER IF NOT EXISTS memory_search_insert AFTER INSERT ON memories BEGIN
        INSERT OR REPLACE INTO memory_search_dirty VALUES(NEW.id,unixepoch('subsec')*1000,0);
        UPDATE memory_search_clock SET version=version+1; END;
      CREATE TRIGGER IF NOT EXISTS memory_search_update AFTER UPDATE ON memories BEGIN
        DELETE FROM memory_fts WHERE rowid=NEW.rowid;
        INSERT OR REPLACE INTO memory_search_dirty VALUES(NEW.id,unixepoch('subsec')*1000,0);
        UPDATE memory_search_clock SET version=version+1; END;
      CREATE TRIGGER IF NOT EXISTS memory_search_delete AFTER DELETE ON memories BEGIN
        DELETE FROM memory_fts WHERE rowid=OLD.rowid; DELETE FROM memory_search_rows WHERE id=OLD.id;
        DELETE FROM memory_search_dirty WHERE id=OLD.id; UPDATE memory_search_clock SET version=version+1; END;
      CREATE TRIGGER IF NOT EXISTS memory_search_suppression AFTER INSERT ON suppression BEGIN
        DELETE FROM memory_fts WHERE rowid IN (SELECT m.rowid FROM memories m,json_each(m.body,'$.sources') s
          WHERE json_array(json_extract(s.value,'$.sessionId'),json_extract(s.value,'$.messageId'))=NEW.source_key);
        UPDATE memory_search_clock SET version=version+1; END;
      INSERT OR IGNORE INTO memory_search_dirty SELECT m.id,0,0 FROM memories m LEFT JOIN memory_search_rows p ON p.id=m.id
        WHERE p.id IS NULL OR p.revision<>json_extract(m.body,'$.revision');`)
  }
  refresh(scope: { projectId?: string; includeWorkspace?: boolean }, available: (record: IndexRecord) => boolean): MemorySearchSnapshot {
    if (this.engine === 'lexical') return { engine: 'lexical', version: 0, indexedRecords: 0, pendingRecords: 0, unavailableRecords: 0, refreshedRecords: 0 }
    return this.db.transaction((): MemorySearchSnapshot => {
      const pending = this.db.prepare(`SELECT m.rowid AS row_id,m.body FROM memory_search_dirty d JOIN memories m ON m.id=d.id WHERE d.retry_at<=?
        AND (? IS NULL OR json_extract(m.body,'$.projectId')=? OR (? AND json_extract(m.body,'$.projectId') IS NULL))
        ORDER BY d.queued_at DESC,d.id LIMIT 32`).all(Date.now(), scope.projectId ?? null, scope.projectId ?? null, scope.includeWorkspace ? 1 : 0) as Array<{ row_id: number; body: string }>
      for (const row of pending) {
        const record = JSON.parse(row.body) as IndexRecord
        this.db.prepare('DELETE FROM memory_fts WHERE rowid=?').run(row.row_id)
        const suppressed = record.state === 'forgotten' || record.sources.some(source => this.db.prepare('SELECT 1 FROM suppression WHERE source_key=?').get(JSON.stringify([source.sessionId, source.messageId])))
        if (!suppressed && !available(record)) { this.db.prepare('UPDATE memory_search_dirty SET retry_at=? WHERE id=?').run(Date.now() + 1000, record.id); continue }
        if (!suppressed) this.db.prepare('INSERT INTO memory_fts(rowid,memory_key,content,condition) VALUES(?,?,?,?)').run(row.row_id,
          lexicalTokens(record.key).join(' '), lexicalTokens(record.content).join(' '), lexicalTokens(record.condition ?? '').join(' '))
        this.db.prepare('INSERT OR REPLACE INTO memory_search_rows VALUES(?,?)').run(record.id, record.revision)
        this.db.prepare('DELETE FROM memory_search_dirty WHERE id=?').run(record.id)
      }
      if (pending.length) this.db.exec('UPDATE memory_search_clock SET version=version+1')
      const coverage = this.db.prepare(`SELECT COUNT(*) AS pending,COALESCE(SUM(d.retry_at>?),0) AS unavailable FROM memory_search_dirty d
        JOIN memories m ON m.id=d.id WHERE (? IS NULL OR json_extract(m.body,'$.projectId')=? OR (? AND json_extract(m.body,'$.projectId') IS NULL))`)
        .get(Date.now(), scope.projectId ?? null, scope.projectId ?? null, scope.includeWorkspace ? 1 : 0) as { pending: number; unavailable: number }
      return { engine: 'fts5', version: (this.db.prepare('SELECT version FROM memory_search_clock').get() as { version: number }).version,
        indexedRecords: (this.db.prepare('SELECT COUNT(*) AS count FROM memory_fts').get() as { count: number }).count,
        pendingRecords: coverage.pending, unavailableRecords: coverage.unavailable, refreshedRecords: pending.length }
    })()
  }
}
