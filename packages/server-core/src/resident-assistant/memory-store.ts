import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSession, validateSessionId } from '@phaneris/shared/sessions'
import type { MemoryMutation, MemoryMutationResult, MemoryQuery, MemoryQueryResult, MemoryRecord, MemorySource, MemorySourceResult } from '@phaneris/shared/protocol'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'
import { initializeHistoryIndex, queryHistory } from './history-index'
import { isDirectUserMessage, historySourceContent } from './source-provenance'
import type { HistoryQuery, HistoryPage } from '@phaneris/session-tools-core/history-contracts'
import { initializeHistoryExtraction, maintainHistory, historyExtractionCoverage } from './history-extraction'
import type { MemoryMaintenanceCommand, MemoryMaintenanceResult } from '@phaneris/session-tools-core/memory-maintenance-contracts'
import type { MemorySuppressionQuery, MemorySuppressionPage, MemorySuppressionMerge, MemorySuppressionMergeResult } from '@phaneris/session-tools-core/memory-contracts'
import type { MemoryLookupQuery, MemoryLookupResult, MemoryLookupItem, MemoryInspectQuery, MemoryInspectResult } from '@phaneris/session-tools-core/memory-lookup-contracts'

type StoredRecord = Omit<MemoryRecord, 'content' | 'key'> & { content: string; key: string }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

/** Workspace-owned memory only. No Session, preference or task state is rewritten. */
export class AssistantMemoryStore {
  private readonly db: SqliteDatabase
  private readonly resolvingSources = new Set<string>()
  private readonly sourceSnapshot = new Map<string, ReturnType<typeof loadSession>>()
  private snapshotDepth = 0
  private sourceFileLoads = 0
  private sourceCacheHits = 0
  constructor(private readonly workspace: { id: string; rootPath: string }) {
    const root = join(workspace.rootPath, 'memory')
    mkdirSync(root, { recursive: true })
    this.db = openSqliteDatabase(join(root, 'memory.db'))
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), workspace_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, revision));
      CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, memory_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_request_members(request_id TEXT NOT NULL,memory_id TEXT NOT NULL,PRIMARY KEY(request_id,memory_id));
      CREATE TABLE IF NOT EXISTS suppression_imports(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS suppression (memory_id TEXT NOT NULL, source_key TEXT NOT NULL, PRIMARY KEY(memory_id, source_key));
      CREATE INDEX IF NOT EXISTS suppression_source ON suppression(source_key);`)
    this.db.exec('CREATE TABLE IF NOT EXISTS derived_sources(source_key TEXT PRIMARY KEY,dependencies TEXT NOT NULL);')
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES (1, ?)').run(workspace.id)
    const owner = this.db.prepare('SELECT workspace_id FROM owner WHERE singleton=1').get() as { workspace_id: string }
    if (owner.workspace_id !== workspace.id) {
      this.db.close()
      throw new Error('Memory database belongs to another workspace')
    }
    initializeHistoryIndex(this.db)
    initializeHistoryExtraction(this.db)
  }

  close(): void { this.db.close() }
  getDiagnostics(): { sourceFileLoads: number; sourceCacheHits: number } { return { sourceFileLoads: this.sourceFileLoads, sourceCacheHits: this.sourceCacheHits } }
  private withSourceSnapshot<T>(operation: () => T): T {
    this.snapshotDepth++
    try { return operation() }
    finally { if (--this.snapshotDepth === 0) this.sourceSnapshot.clear() }
  }
  extractionCoverage() { return historyExtractionCoverage(this.db) }
  contextVersion(): number { return this.version() }
  registerDerivedSources(sources: MemorySource[], dependencies: import('@phaneris/session-tools-core/resident-context-contracts').ResidentDependencies): void {
    this.db.transaction(() => { for (const source of sources) this.db.prepare('INSERT INTO derived_sources VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET dependencies=excluded.dependencies').run(this.sourceKey(source), JSON.stringify(dependencies)) })()
  }
  isSourceSuppressed(source: MemorySource): boolean { return this.suppressed(source) }
  dependenciesValid(dependencies: import('@phaneris/session-tools-core/resident-context-contracts').ResidentDependencies): boolean {
    return this.withSourceSnapshot(() => {
      for (const reference of dependencies.memories) {
        const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(reference.id) as { body: string } | undefined
        if (!row) return false
        const record = this.view(JSON.parse(row.body) as StoredRecord)
        if (record.revision !== reference.revision || record.state !== (reference.observedState ?? 'active') || !!record.dispute !== (reference.observedDispute ?? false) || record.redacted) return false
      }
      // Source availability is an I/O boundary: a missing/corrupt source invalidates
      // dependent model material, rather than falling back to a cached excerpt.
      try { for (const source of dependencies.sources) this.readSource({ ...source, expectedContentHash: source.contentHash }) }
      catch { return false }
      return true
    })
  }

  private version(): number {
    return (this.db.prepare('SELECT version FROM meta WHERE singleton=1').get() as { version: number }).version
  }

  private sourceKey(source: MemorySource): string { return JSON.stringify([source.sessionId, source.messageId]) }

  private suppressed(source: MemorySource): boolean {
    return !!this.db.prepare('SELECT 1 FROM suppression WHERE source_key=? LIMIT 1').get(this.sourceKey(source))
  }

  exportSuppression(query: MemorySuppressionQuery): MemorySuppressionPage {
    return this.db.transaction(() => {
      const version = this.version(), limit = query.limit ?? 200, offset = query.cursor?.offset ?? 0
      if (query.cursor && (query.cursor.version !== version || query.cursor.limit !== limit)) throw new Error('Suppression cursor version or page size changed; restart export')
      const rows = this.db.prepare('SELECT memory_id,source_key FROM suppression ORDER BY memory_id,source_key LIMIT ? OFFSET ?').all(limit + 1, offset) as Array<{ memory_id: string; source_key: string }>
      return { formatVersion: 1 as const, workspaceId: this.workspace.id, version, entries: rows.slice(0, limit).map(row => {
        const [sessionId, messageId] = JSON.parse(row.source_key) as [string, string]
        return { memoryId: row.memory_id, source: { sessionId, messageId } }
      }), nextCursor: rows.length > limit ? { version, offset: offset + limit, limit } : null }
    })()
  }

  private suppressAncestry(memoryId: string): number {
    const pending = [memoryId], visited = new Set<string>()
    let inserted = 0
    while (pending.length) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      const versions = this.db.prepare('SELECT body FROM revisions WHERE id=?').all(id) as Array<{ body: string }>
      const entries = [this.get(id), ...versions.map(row => JSON.parse(row.body) as StoredRecord)]
      for (const entry of entries) {
        for (const source of [...entry.sources, ...entry.dispute?.sources ?? []]) inserted += this.db.prepare('INSERT OR IGNORE INTO suppression VALUES (?, ?)').run(memoryId, this.sourceKey(source)).changes
        pending.push(...entry.supersedes?.map(reference => reference.id) ?? [])
      }
    }
    return inserted
  }

  mergeSuppression(command: MemorySuppressionMerge): MemorySuppressionMergeResult {
    if (command.workspaceId !== this.workspace.id) throw new Error('Suppression bundle belongs to another workspace')
    return this.db.transaction(() => {
      const fingerprint = digest(canonicalJson(command))
      const receipt = this.db.prepare('SELECT fingerprint,result FROM suppression_imports WHERE request_id=?').get(command.requestId) as { fingerprint: string; result: string } | undefined
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('Suppression import request conflict: payload changed')
        return JSON.parse(receipt.result) as MemorySuppressionMergeResult
      }
      let inserted = 0, changed = false
      const affectedIds = [...new Set(command.entries.map(entry => entry.memoryId))]
      for (const entry of command.entries) inserted += this.db.prepare('INSERT OR IGNORE INTO suppression VALUES(?,?)').run(entry.memoryId, this.sourceKey(entry.source)).changes
      for (const id of affectedIds) {
        const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(id) as { body: string } | undefined
        if (!row) continue // Preserve tombstones even when the old memory is absent.
        const current = JSON.parse(row.body) as StoredRecord
        inserted += this.suppressAncestry(id)
        if (current.state === 'forgotten') continue
        const retired: StoredRecord = { ...current, state: 'forgotten', revision: current.revision + 1, updatedAt: Date.now() }
        this.db.prepare('UPDATE memories SET body=? WHERE id=?').run(JSON.stringify(retired), id)
        this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(id, retired.revision, JSON.stringify(retired))
        changed = true
      }
      this.db.prepare('DELETE FROM history_messages WHERE EXISTS(SELECT 1 FROM suppression WHERE source_key=json_array(session_id,message_id))').run()
      if (inserted || changed) this.db.prepare('UPDATE meta SET version=version+1 WHERE singleton=1').run()
      const result = { version: this.version(), inserted, affectedIds }
      this.db.prepare('INSERT INTO suppression_imports VALUES(?,?,?)').run(command.requestId, fingerprint, JSON.stringify(result))
      return result
    })()
  }

  history(query: HistoryQuery): HistoryPage {
    return this.withSourceSnapshot(() => queryHistory(this.db, this.workspace.rootPath, query, this.version(), source => {
      try { this.readSource({ ...source, expectedContentHash: source.contentHash }); return true } catch { return false }
    }))
  }

  maintain(command: MemoryMaintenanceCommand, runId: string): MemoryMaintenanceResult {
    return this.withSourceSnapshot(() => {
      // Refresh source identity before selecting/acknowledging checkpoints. This
      // bounded catalogue pass never invokes a model or replays a Session.
      this.history({ limit: 1 })
      return maintainHistory(this.db, command, runId, source => this.readSource(source), id => this.view(this.get(id)))
    })
  }

  readSource(source: MemorySource & { expectedContentHash?: string }): MemorySourceResult {
    return this.withSourceSnapshot(() => {
      validateSessionId(source.sessionId)
      if (this.suppressed(source)) throw new Error('Source suppressed by a forgotten memory')
      let session = this.sourceSnapshot.get(source.sessionId)
      if (this.sourceSnapshot.has(source.sessionId)) this.sourceCacheHits++
      else {
        this.sourceFileLoads++
        session = loadSession(this.workspace.rootPath, source.sessionId)
        this.sourceSnapshot.set(source.sessionId, session)
      }
      const message = session?.messages.find(item => item.id === source.messageId)
      if (!message) throw new Error('Memory source message does not exist in this workspace')
      if (message.delegationInput?.materialDependencies && !this.dependenciesValid(message.delegationInput.materialDependencies)) {
        throw new Error('Delegated source is unavailable because its original materials changed or were forgotten')
      }
      const lineage = this.db.prepare('SELECT dependencies FROM derived_sources WHERE source_key=?').get(this.sourceKey(source)) as { dependencies: string } | undefined
      if (lineage) {
        const key = this.sourceKey(source)
        if (this.resolvingSources.has(key)) throw new Error('Derived source dependency cycle is unavailable')
        this.resolvingSources.add(key)
        try {
          if (!this.dependenciesValid(JSON.parse(lineage.dependencies))) throw new Error('Derived source is unavailable because its original materials changed or were forgotten')
        } finally { this.resolvingSources.delete(key) }
      } else if (session?.sessionKind === 'resident_assistant' && message.type !== 'user') {
        throw new Error('Historical resident-derived source has no verifiable material lineage and is unavailable for model recall')
      }
      const content = historySourceContent(message)
      const contentHash = digest(content)
      if (source.expectedContentHash && source.expectedContentHash !== contentHash) throw new Error('Memory source content hash changed; search again before reading')
      return { sessionId: source.sessionId, messageId: source.messageId, content, role: message.type, timestamp: message.timestamp,
        directUser: isDirectUserMessage(message), contentHash }
    })
  }

  private resolveSources(sources: MemorySource[], basis: StoredRecord['basis']): StoredRecord['sources'] {
    return sources.map(source => {
      const resolved = this.readSource(source)
      // Historical role=user alone cannot establish a direct user statement.
      if (basis === 'user_stated' && !resolved.directUser) {
        throw new Error('Source is not a confirmed direct user statement; use inferred provenance')
      }
      return { ...source, contentHash: resolved.contentHash }
    })
  }

  private get(id: string): StoredRecord {
    const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(id) as { body: string } | undefined
    if (!row) throw new Error('Memory does not exist in this workspace')
    return JSON.parse(row.body) as StoredRecord
  }

  private view(record: StoredRecord, now = Date.now()): MemoryRecord {
    const redacted = record.state === 'forgotten' || record.sources.some(source => this.suppressed(source))
      || !this.dependenciesValid({ sources: [...record.sources, ...record.dispute?.sources ?? []], memories: [] })
    const state = record.state !== 'active' ? record.state
      : record.validUntil !== undefined && record.validUntil <= now ? 'expired'
        : record.validFrom !== undefined && record.validFrom > now ? 'scheduled' : 'active'
    return { ...record, state, redacted, key: redacted ? null : record.key, condition: redacted ? undefined : record.condition,
      dispute: redacted ? undefined : record.dispute, supersedes: redacted ? undefined : record.supersedes,
      supersededBy: redacted ? undefined : record.supersededBy, retirementReason: redacted ? undefined : record.retirementReason,
      content: redacted ? null : record.content, sources: redacted ? [] : record.sources }
  }

  lookup(input: MemoryLookupQuery): MemoryLookupResult {
    return this.withSourceSnapshot(() => {
      const items: MemoryLookupItem[] = [], maxChars = 12000, requestedItems = input.limit ?? 5, scanLimit = 100
      const projectId = input.scope === 'workspace' ? undefined : input.projectId, includesWorkspace = !projectId || !!input.includeWorkspace
      let nextCursor = input.cursor ?? null, version = this.version(), scannedRecords = 0
      while (items.length < requestedItems && scannedRecords < scanLimit) {
        const priorCursor = nextCursor
        const page = this.query({ text: input.query, projectId, includeWorkspace: includesWorkspace, condition: input.condition, ids: input.ids,
          includeRetired: input.includeRetired, limit: 1, cursor: nextCursor ?? undefined })
        version = page.version
        scannedRecords++
        const record = page.items[0]
        if (record) {
          const { id, key, projectId, kind, basis, state, revision, redacted, validFrom, validUntil, updatedAt, lastValidatedAt, supersededBy } = record
          const item: MemoryLookupItem = { id, key, projectId, kind, basis, state, revision, redacted, validFrom, validUntil, updatedAt, lastValidatedAt, supersededBy,
            condition: record.condition?.slice(0, 200), conditionChars: record.condition?.length ?? 0,
            content: record.content?.slice(0, 600) ?? null, contentChars: record.content?.length ?? 0, contentTruncated: (record.content?.length ?? 0) > 600,
            sources: record.sources.slice(0, 2), sourceCount: record.sources.length, supersedesCount: record.supersedes?.length ?? 0, disputed: !!record.dispute }
          // Reserve the bounded envelope/cursor before admitting another row.
          if (JSON.stringify([...items, item]).length > maxChars - 1024) {
            if (!items.length) throw new Error(`Memory navigation item exceeds its transport budget; inspect ${id} at revision ${revision}`)
            nextCursor = priorCursor; break
          }
          items.push(item)
        }
        nextCursor = page.nextCursor
        if (!nextCursor) break
      }
      const result: MemoryLookupResult = { items, nextCursor, version, scope: { projectId, includesWorkspace, workspaceWide: !projectId }, budget: { maxChars, usedChars: 0, requestedItems, scannedRecords, scanLimit } }
      result.budget.usedChars = JSON.stringify(result).length
      result.budget.usedChars = JSON.stringify(result).length
      return result
    })
  }

  inspect(input: MemoryInspectQuery): MemoryInspectResult {
    return this.withSourceSnapshot(() => {
      const stored = this.get(input.id)
      if (stored.revision !== input.expectedRevision) throw new Error('Memory inspection revision changed; search again before reading')
      const record = this.view(stored), content = record.content ?? ''
      const offset = Math.min(input.offset ?? 0, content.length), end = Math.min(offset + (input.maxChars ?? 2000), content.length)
      const page = <T>(items: T[], requestedOffset: number, limit: number) => {
        const start = Math.min(requestedOffset, items.length), last = Math.min(start + limit, items.length)
        return { items: items.slice(start, last), range: { offset: start, end: last, total: items.length }, next: last < items.length ? last : null }
      }
      const sources = page(record.sources, input.sourceOffset ?? 0, 4), proof = page(record.dispute?.sources ?? [], input.proofSourceOffset ?? 0, 4)
      const lineage = page(record.supersedes ?? [], input.lineageOffset ?? 0, 8)
      return { record: { ...record, content: record.content === null ? null : content.slice(offset, end), sources: sources.items,
        supersedes: record.supersedes ? lineage.items : undefined, dispute: record.dispute ? { ...record.dispute, sources: proof.items } : undefined },
        contentRange: { offset, end, fullChars: content.length }, nextOffset: end < content.length ? end : null,
        sourceRange: sources.range, nextSourceOffset: sources.next, proofSourceRange: proof.range, nextProofSourceOffset: proof.next,
        lineageRange: lineage.range, nextLineageOffset: lineage.next }
    })
  }

  query(query: MemoryQuery): MemoryQueryResult {
    // One read transaction keeps records and version from different processes consistent.
    return this.withSourceSnapshot(() => this.db.transaction(() => {
      const version = this.version()
      const now = Date.now()
      const fingerprint = digest(canonicalJson({ text: query.text ?? '', projectId: query.projectId ?? null, condition: query.condition ?? null,
        ids: query.ids ? [...new Set(query.ids)].sort() : null, includeWorkspace: !!query.projectId && !!query.includeWorkspace, includeRetired: query.includeRetired ?? false, limit: query.limit ?? 20 }))
      if (query.cursor && query.cursor.fingerprint !== fingerprint) throw new Error('Memory cursor query changed; restart query')
      if (query.cursor && query.cursor.version !== version) throw new Error('Memory cursor version changed; restart query')
      if (query.cursor?.expiresAt != null && query.cursor.expiresAt <= now) throw new Error('Memory cursor expired; restart query')
      const expiry = this.db.prepare(`SELECT MIN(boundary) AS deadline FROM (
        SELECT json_extract(body, '$.validFrom') AS boundary FROM memories WHERE json_extract(body, '$.state')='active'
        UNION ALL SELECT json_extract(body, '$.validUntil') FROM memories WHERE json_extract(body, '$.state')='active'
      ) WHERE boundary>?`).get(now) as { deadline: number | null }
      const limit = query.limit ?? 20
      const offset = query.cursor?.offset ?? 0
      const rows = this.db.prepare(`WITH views AS (
        SELECT id, body, (json_extract(body, '$.state')='forgotten' OR EXISTS (
          SELECT 1 FROM json_each(body, '$.sources') AS source JOIN suppression
          ON suppression.source_key=json_array(json_extract(source.value, '$.sessionId'), json_extract(source.value, '$.messageId'))
        )) AS redacted FROM memories
      ) SELECT body FROM views
        WHERE (? IS NULL OR json_extract(body, '$.projectId')=? OR (? AND json_extract(body,'$.projectId') IS NULL))
        AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))
        AND (? IS NULL OR json_extract(body, '$.condition')=?)
        AND (?='' OR (NOT redacted AND instr(lower(json_extract(body, '$.content')), lower(?))>0))
        AND (? OR (NOT redacted AND json_extract(body, '$.state')='active'
          AND json_extract(body, '$.dispute') IS NULL
          AND (json_extract(body, '$.validFrom') IS NULL OR json_extract(body, '$.validFrom')<=?)
          AND (json_extract(body, '$.validUntil') IS NULL OR json_extract(body, '$.validUntil')>?)))
        ORDER BY json_extract(body, '$.updatedAt') DESC, id ASC LIMIT ? OFFSET ?`)
        .all(query.projectId ?? null, query.projectId ?? null, query.includeWorkspace ? 1 : 0, query.ids ? JSON.stringify(query.ids) : null, query.ids ? JSON.stringify(query.ids) : null,
          query.condition ?? null, query.condition ?? null, query.text ?? '', query.text ?? '',
          query.includeRetired ? 1 : 0, now, now, limit + 1, offset) as Array<{ body: string }>
      return { items: rows.slice(0, limit).map(row => this.view(JSON.parse(row.body) as StoredRecord, now))
        .filter(item => query.includeRetired || (!item.redacted && !item.dispute && item.state === 'active')), version,
        nextCursor: rows.length > limit ? { version, offset: offset + limit, expiresAt: expiry.deadline, fingerprint } : null }
    })())
  }

  private relate(command: Extract<MemoryMutation, { action: 'dispute' | 'resolve' }>, now: number): StoredRecord[] {
    const references = [{ id: command.id, expectedRevision: command.expectedRevision }, ...command.related]
    const ids = new Set(references.map(reference => reference.id))
    if (ids.size !== references.length) throw new Error('Memory relation members must be distinct')
    const records = references.map(reference => {
      const record = this.get(reference.id)
      if (record.revision !== reference.expectedRevision) throw new Error('Memory relation revision conflict; reload all members')
      if (record.state === 'forgotten' || record.state === 'superseded' || this.view(record).redacted) throw new Error('Forgotten, superseded or unavailable memory cannot enter a relation')
      if (record.dispute?.relatedMemoryIds.some(id => !ids.has(id))) throw new Error('Include every disputed relation member before resolving or expanding the group')
      return record
    })
    const first = records[0]!
    if (records.some(record => record.projectId !== first.projectId || record.condition !== first.condition)) throw new Error('Memory relation project/condition scope differs; preserve distinct facts')
    const winner = command.action === 'resolve' && command.winnerId ? records.find(record => record.id === command.winnerId) : undefined
    if (command.action === 'resolve' && command.winnerId && !winner) throw new Error('Resolution winner must belong to this relation')
    if (command.action === 'dispute' || winner) {
      if (records.some(record => Math.max(record.validFrom ?? 0, first.validFrom ?? 0) >= Math.min(record.validUntil ?? Infinity, first.validUntil ?? Infinity))) throw new Error('Memory validity intervals do not overlap; preserve temporal facts')
    }
    const sources = this.resolveSources(command.sources, winner?.basis ?? 'inferred')
    return records.map((record): StoredRecord => {
      const base = { ...record, revision: record.revision + 1, updatedAt: now }
      if (command.action === 'dispute') return { ...base, dispute: { relatedMemoryIds: [...ids].filter(id => id !== record.id), reason: command.reason, raisedAt: now, sources } }
      if (!winner) return { ...base, dispute: undefined, lastValidatedAt: now }
      if (record.id !== winner.id) return { ...base, state: 'superseded', dispute: undefined, supersededBy: winner.id, retirementReason: command.reason }
      const sourceMap = new Map([...record.sources, ...sources].map(source => [this.sourceKey(source), source]))
      return { ...base, state: 'active', dispute: undefined, lastValidatedAt: now, sources: [...sourceMap.values()],
        supersedes: [...record.supersedes ?? [], ...records.filter(item => item.id !== winner.id).map(item => ({ id: item.id, revision: item.revision }))] }
    })
  }

  mutate(command: MemoryMutation): MemoryMutationResult {
    return this.withSourceSnapshot(() => this.db.transaction(() => {
      const fingerprint = digest(canonicalJson(command))
      const receipt = this.db.prepare('SELECT fingerprint, memory_id FROM requests WHERE request_id=?').get(command.requestId) as { fingerprint: string; memory_id: string } | undefined
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('Request ID conflict: payload changed')
        // Always use the current view: a replay must not resurrect an old, now-forgotten response.
        const members = this.db.prepare('SELECT memory_id FROM memory_request_members WHERE request_id=?').all(command.requestId) as Array<{ memory_id: string }>
        return { record: this.view(this.get(receipt.memory_id)), version: this.version(), affectedIds: members.length ? members.map(member => member.memory_id) : [receipt.memory_id] }
      }
      const now = Date.now()
      let record: StoredRecord
      let related: StoredRecord[] = []
      if (command.action === 'remember') {
        const resolved = this.resolveSources(command.sources, command.basis)
        // Keep the existing unqualified key format so old databases retain their
        // uniqueness boundary without rewriting the authority or its revisions.
        const scopeKey = JSON.stringify(command.condition === undefined ? [command.projectId ?? null, command.key] : [command.projectId ?? null, command.key, command.condition])
        if (this.db.prepare('SELECT 1 FROM memories WHERE scope_key=?').get(scopeKey)) throw new Error('Memory key already exists; revise it explicitly')
        record = { id: randomUUID(), workspaceId: this.workspace.id, key: command.key, projectId: command.projectId, condition: command.condition,
          content: command.content, kind: command.kind, basis: command.basis, sources: resolved,
          state: command.basis === 'inferred' ? 'candidate' : 'active', revision: 1,
          createdAt: now, updatedAt: now, validFrom: command.validFrom, validUntil: command.validUntil, redacted: false }
        if (record.validFrom !== undefined && record.validUntil !== undefined && record.validFrom >= record.validUntil) throw new Error('Memory validity interval must have validFrom before validUntil')
        this.db.prepare('INSERT INTO memories VALUES (?, ?, ?)').run(record.id, scopeKey, JSON.stringify(record))
      } else if (command.action === 'dispute' || command.action === 'resolve') {
        const records = this.relate(command, now)
        record = records[0]!
        related = records.slice(1)
        for (const changed of records) this.db.prepare('UPDATE memories SET body=? WHERE id=?').run(JSON.stringify(changed), changed.id)
      } else {
        record = this.get(command.id)
        if (record.revision !== command.expectedRevision) throw new Error('Memory revision conflict; reload before changing it')
        if (record.state === 'forgotten') throw new Error('Forgotten memory cannot be changed or automatically restored')
        if (record.state === 'superseded' && (command.action !== 'transition' || command.state !== 'forgotten')) throw new Error('Superseded memory cannot be revised or automatically restored')
        if (command.action === 'revise') {
          record = { ...record, content: command.content, sources: this.resolveSources(command.sources, record.basis),
            validFrom: command.validFrom === undefined ? record.validFrom : command.validFrom ?? undefined,
            validUntil: command.validUntil === undefined ? record.validUntil : command.validUntil ?? undefined }
          if (record.validFrom !== undefined && record.validUntil !== undefined && record.validFrom >= record.validUntil) throw new Error('Memory validity interval must have validFrom before validUntil')
        } else {
          if (command.state === 'active' && record.dispute) throw new Error('Resolve the memory dispute explicitly before activation')
          if (command.state === 'active' && record.sources.some(source => this.suppressed(source))) throw new Error('Memory source remains suppressed')
          record = { ...record, state: command.state }
          if (command.state === 'forgotten') {
            // All source revisions remain blocked, including earlier statements replaced by a correction.
            this.suppressAncestry(record.id)
            this.db.prepare('DELETE FROM history_messages WHERE EXISTS(SELECT 1 FROM suppression WHERE source_key=json_array(session_id,message_id))').run()
          }
        }
        record = { ...record, revision: record.revision + 1, updatedAt: now }
        this.db.prepare('UPDATE memories SET body=? WHERE id=?').run(JSON.stringify(record), record.id)
      }
      for (const changed of [record, ...related]) {
        this.db.prepare('INSERT INTO revisions VALUES (?, ?, ?)').run(changed.id, changed.revision, JSON.stringify(changed))
        this.db.prepare('INSERT INTO memory_request_members VALUES(?,?)').run(command.requestId, changed.id)
      }
      this.db.prepare('INSERT INTO requests VALUES (?, ?, ?)').run(command.requestId, fingerprint, record.id)
      this.db.prepare('UPDATE meta SET version=version+1 WHERE singleton=1').run()
      return { record: this.view(record), version: this.version(), affectedIds: [record, ...related].map(item => item.id) }
    })())
  }
}
