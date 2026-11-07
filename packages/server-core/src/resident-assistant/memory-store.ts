import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadSession, validateSessionId } from '@phaneris/shared/sessions'
import { readAssistantMemoryPolicy, assertAssistantMemoryLearning } from '@phaneris/shared/workspaces'
import type { MemoryMutation, MemoryMutationResult, MemoryQuery, MemoryQueryResult, MemoryRecord, MemorySource, MemorySourceResult, MemorySourceRead, MemorySourcePage } from '@phaneris/shared/protocol'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'
import { initializeHistoryIndex, queryHistory } from './history-index'
import { isDirectUserMessage, historySourceContent, sourceContentHash, sourceContentMatches } from './source-provenance'
import type { HistoryQuery, HistoryPage } from '@phaneris/session-tools-core/history-contracts'
import { initializeHistoryExtraction, maintainHistory, historyExtractionCoverage } from './history-extraction'
import type { MemoryMaintenanceCommand, MemoryMaintenanceResult } from '@phaneris/session-tools-core/memory-maintenance-contracts'
import type { MemorySuppressionQuery, MemorySuppressionPage, MemorySuppressionMerge, MemorySuppressionMergeResult } from '@phaneris/session-tools-core/memory-contracts'
import type { MemoryLookupQuery, MemoryLookupResult, MemoryLookupItem, MemoryInspectQuery, MemoryInspectResult } from '@phaneris/session-tools-core/memory-lookup-contracts'
import type { ObservationVerifier } from './source-observation'
import { MemoryMaintenanceQueue, type MemoryMaintenanceJob } from './memory-maintenance-queue'
import { MemoryLexicalIndex, lexicalTokens, type MemorySearchSnapshot } from './memory-lexical'
import { DerivedMemory } from './memory-derived'
import { ProjectMemoryService, type ProjectMemoryRequestReceipt } from './project-memory'
import { knowledgeSourceVersion } from '@phaneris/shared/agent/knowledge-materials'
import type { ScenarioCapture, ScenarioQuery } from '@phaneris/session-tools-core/memory-derived-contracts'

type StoredRecord = Omit<MemoryRecord, 'content' | 'key'> & { content: string; key: string }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

/** Workspace-owned memory only. No Session, preference or task state is rewritten. */
export class AssistantMemoryStore {
  readonly maintenance: MemoryMaintenanceQueue
  readonly projects: ProjectMemoryService
  private readonly lexical: MemoryLexicalIndex
  private readonly derived: DerivedMemory
  private readonly db: SqliteDatabase
  private readonly resolvingSources = new Set<string>()
  private readonly sourceSnapshot = new Map<string, ReturnType<typeof loadSession>>()
  private snapshotDepth = 0
  private sourceFileLoads = 0
  private sourceCacheHits = 0
  constructor(private readonly workspace: { id: string; rootPath: string }, private readonly verifyObservation?: ObservationVerifier) {
    const root = join(workspace.rootPath, 'assistant', 'memory')
    mkdirSync(root, { recursive: true })
    this.db = openSqliteDatabase(join(root, 'memory.db'))
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), workspace_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, revision));
      CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, memory_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,project_id TEXT NOT NULL,entry_id TEXT NOT NULL);
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
    this.maintenance = new MemoryMaintenanceQueue(this.db)
    this.projects = new ProjectMemoryService(workspace, this)
    this.lexical = new MemoryLexicalIndex(this.db)
    this.derived = new DerivedMemory(this.db, {
      record: id => { const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(id) as { body: string } | undefined; return row ? this.view(JSON.parse(row.body) as StoredRecord) : undefined },
      source: source => this.readSource(source), policy: () => readAssistantMemoryPolicy(this.workspace), version: () => this.version(),
    })
  }

  close(): void { this.db.close() }
  /** Request references only: Project text and entry authority remain in MEMORY.md. */
  projectRequest(id: string): ProjectMemoryRequestReceipt | undefined {
    return this.db.prepare('SELECT fingerprint,project_id AS projectId,entry_id AS entryId FROM project_requests WHERE id=?').get(id) as ProjectMemoryRequestReceipt | undefined
  }
  recordProjectRequest(id: string, receipt: ProjectMemoryRequestReceipt): void {
    const previous = this.projectRequest(id)
    if (previous && (previous.fingerprint !== receipt.fingerprint || previous.projectId !== receipt.projectId || previous.entryId !== receipt.entryId)) throw new Error('Project memory request receipt conflict')
    this.db.prepare('INSERT OR IGNORE INTO project_requests VALUES(?,?,?,?)').run(id, receipt.fingerprint, receipt.projectId, receipt.entryId)
  }
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
    if (dependencies.memories.length && !readAssistantMemoryPolicy(this.workspace).use) return false
    return this.withSourceSnapshot(() => {
      if (dependencies.scenarios?.some(reference => !this.derived.valid(reference))) return false
      for (const reference of dependencies.memories) {
        const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(reference.id) as { body: string } | undefined
        if (!row) return false
        const record = this.view(JSON.parse(row.body) as StoredRecord)
        if (record.revision !== reference.revision || record.state !== (reference.observedState ?? 'active') || !!record.dispute !== (reference.observedDispute ?? false) || record.redacted) return false
      }
      // Source availability is an I/O boundary: a missing/corrupt source invalidates
      // dependent model material, rather than falling back to a cached excerpt.
      try {
        for (const source of dependencies.knowledge ?? []) if (knowledgeSourceVersion(this.workspace.rootPath, source.sourceSlug) !== source.version) return false
        for (const source of dependencies.sources) {
        const current = this.readSource({ ...source, expectedContentHash: source.contentHash, readPurpose: source.readPurpose })
        if (source.observation && (current.observation?.operationId !== source.observation.operationId || current.observation.runOperationId !== source.observation.runOperationId)) return false
      } }
      catch { return false }
      return true
    })
  }

  private version(): number {
    return (this.db.prepare('SELECT version FROM meta WHERE singleton=1').get() as { version: number }).version
  }
  profile(input: { projectId?: string; query?: string }) { return this.withSourceSnapshot(() => this.derived.profile(input)) }
  captureScenario(command: ScenarioCapture, authority: 'automatic' | 'user_request' | 'management' = 'automatic') {
    return this.withSourceSnapshot(() => this.derived.capture(command, authority))
  }
  scenarios(input: ScenarioQuery) { return this.withSourceSnapshot(() => this.derived.scenarios(input)) }

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

  maintenanceStatus() { return this.maintenance.status() }
  enqueueMaintenance(sessionId: string, inputIds: readonly string[]): void {
    const source = loadSession(this.workspace.rootPath, sessionId)
    if (!source) return
    const start = source.messages.findIndex(message => inputIds.includes(message.id))
    if (start < 0) return
    const eligible = source.messages.slice(start).filter(message => isDirectUserMessage(message) && inputIds.includes(message.id)
      || source.sessionKind !== 'resident_assistant' && message.type === 'tool' && message.toolStatus === 'completed')
    const groups = new Map<string | undefined, import('@phaneris/core/types').SourceMaterialReference[]>()
    for (const message of eligible) {
      if (this.suppressed({ sessionId, messageId: message.id })) continue
      try {
        const item = this.readSource({ sessionId, messageId: message.id }), projectId = message.projectScope ? message.projectScope.projectId ?? undefined : source.projectId
        groups.set(projectId, [...groups.get(projectId) ?? [], { sessionId, messageId: message.id, contentHash: item.contentHash }])
      } catch { /* Withdrawn/corrupt sources cannot be scheduled as fresh material. */ }
    }
    for (const [projectId, sources] of groups) this.maintenance.enqueue(sessionId, projectId, sources)
  }
  assertMaintenance(job: MemoryMaintenanceJob): void {
    this.maintenance.assert(job)
    assertAssistantMemoryLearning(readAssistantMemoryPolicy(this.workspace), 'automatic')
    this.withSourceSnapshot(() => {
      for (const source of job.sources) if (this.readSource({ ...source, expectedContentHash: source.contentHash }).projectId !== job.projectId) throw new Error('Maintenance source project scope changed')
    })
  }
  assertMaintenanceMutation(job: MemoryMaintenanceJob, command: MemoryMutation): void {
    this.assertMaintenance(job)
    if (command.intent === 'user_request' || command.action === 'transition' && command.state === 'forgotten') throw new Error('Maintenance cannot grant user authority or permanent forgetting')
    const sources = command.action === 'remember' || command.action === 'revise' || command.action === 'dispute' || command.action === 'resolve'
      ? command.sources : this.get(command.id).sources
    if (!sources.length || sources.some(source => !job.sources.some(allowed => allowed.sessionId === source.sessionId && allowed.messageId === source.messageId)))
      throw new Error('Maintenance mutation exceeds the source grant')
    const projectId = command.action === 'remember' ? command.projectId : this.get(command.id).projectId
    if (projectId !== job.projectId) throw new Error('Maintenance cannot change project ownership')
  }
  maintain(command: MemoryMaintenanceCommand, runId: string, job?: MemoryMaintenanceJob): MemoryMaintenanceResult {
    return this.withSourceSnapshot(() => {
      // Refresh source identity before selecting/acknowledging checkpoints. This
      // bounded catalogue pass never invokes a model or replays a Session.
      if (job) this.assertMaintenance(job)
      this.history({ limit: 1, sessionId: job?.sessionId })
      return maintainHistory(this.db, command, runId, source => this.readSource(source), id => this.view(this.get(id)), job?.sources.map(source => source.messageId),
        (reference, source) => this.projects.verifyEntry(reference, source))
    })
  }

  /** Historical reading still enforces source/credential revocation and forgetting,
   * but a corrected memory or disabled automatic recall does not erase L0. */
  private historicalDependenciesValid(dependencies: import('@phaneris/session-tools-core/resident-context-contracts').ResidentDependencies): boolean {
    if (dependencies.knowledge?.some(reference => knowledgeSourceVersion(this.workspace.rootPath, reference.sourceSlug) !== reference.version)) return false
    for (const reference of dependencies.memories) {
      const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(reference.id) as { body: string } | undefined
      if (!row) return false
      const record = JSON.parse(row.body) as StoredRecord
      if (record.state === 'forgotten' || record.sources.some(source => this.suppressed(source))) return false
    }
    return dependencies.sources.every(reference => {
      try { this.readSource({ ...reference, readPurpose: 'historical' }); return true } catch { return false }
    })
  }
  readHistoricalSources(sessionId: string, references: Array<{ messageId: string; contentHash: string }>): Array<{ source?: MemorySourceResult; unavailable?: string }> {
    return this.withSourceSnapshot(() => references.map(reference => {
      try { return { source: this.readSource({ sessionId, messageId: reference.messageId, expectedContentHash: reference.contentHash, readPurpose: 'historical' }) } }
      catch (error) { return { unavailable: error instanceof Error ? error.message : 'Original source unavailable' } }
    }))
  }
  /** Model and management readers share one versioned, bounded source page. */
  readSourceRange(input: MemorySourceRead): MemorySourcePage {
    const source = this.readSource(input)
    const offset = Math.min(input.offset ?? 0, source.content.length)
    const end = Math.min(offset + (input.maxChars ?? 5000), source.content.length)
    return { ...source, content: source.content.slice(offset, end), range: { offset, end, fullChars: source.content.length },
      nextOffset: end < source.content.length ? end : null }
  }
  readSource(source: MemorySource & { expectedContentHash?: string; readPurpose?: 'historical' }): MemorySourceResult {
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
      const valid = (dependencies: import('@phaneris/session-tools-core/resident-context-contracts').ResidentDependencies) => source.readPurpose === 'historical' ? this.historicalDependenciesValid(dependencies) : this.dependenciesValid(dependencies)
      if (message.delegationInput?.materialDependencies && !valid(message.delegationInput.materialDependencies)) {
        throw new Error('Delegated source is unavailable because its original materials changed or were forgotten')
      }
      if (message.delegationRefresh && !valid(message.delegationRefresh.materialDependencies)) throw new Error('Refreshed delegated source is unavailable because its materials changed or were forgotten')
      const lineage = this.db.prepare('SELECT dependencies FROM derived_sources WHERE source_key=?').get(this.sourceKey(source)) as { dependencies: string } | undefined
      if (lineage) {
        const key = this.sourceKey(source)
        if (this.resolvingSources.has(key)) throw new Error('Derived source dependency cycle is unavailable')
        this.resolvingSources.add(key)
        try {
          if (!valid(JSON.parse(lineage.dependencies))) throw new Error('Derived source is unavailable because its original materials changed or were forgotten')
        } finally { this.resolvingSources.delete(key) }
      } else if (source.readPurpose !== 'historical' && session?.sessionKind === 'resident_assistant' && message.type !== 'user') {
        throw new Error('Historical resident-derived source has no verifiable material lineage and is unavailable for model recall')
      }
      const content = historySourceContent(message)
      const contentHash = sourceContentHash(this.workspace.rootPath, source.sessionId, content)
      if (source.expectedContentHash && !sourceContentMatches(this.workspace.rootPath, source.sessionId, content, source.expectedContentHash)) throw new Error('Memory source content hash changed; search again before reading')
      const observation = message.type === 'tool' && message.toolStatus === 'completed' && !message.isError && message.durableOperationId && message.toolUseId && message.toolName && message.toolInput && message.toolResult
        ? this.verifyObservation?.({ sessionId: source.sessionId, operationId: message.durableOperationId, providerToolCallId: message.toolUseId,
          toolName: message.toolName, toolInput: message.toolInput, toolResult: message.toolResult }) : undefined
      return { sessionId: source.sessionId, messageId: source.messageId, content, role: message.type, timestamp: message.timestamp,
        projectId: message.projectScope ? message.projectScope.projectId ?? undefined : session?.projectId,
        directUser: isDirectUserMessage(message), contentHash, observation }
    })
  }

  private resolveSources(sources: MemorySource[], basis: StoredRecord['basis']): StoredRecord['sources'] {
    return sources.map(source => {
      const resolved = this.readSource(source)
      // Historical role=user alone cannot establish a direct user statement.
      if (basis === 'user_stated' && !resolved.directUser) {
        throw new Error('Source is not a confirmed direct user statement; use inferred provenance')
      }
      return { sessionId: source.sessionId, messageId: source.messageId, contentHash: resolved.contentHash, observation: resolved.observation }
    })
  }

  private supportedUserExtraction(sources: StoredRecord['sources'], assessment: StoredRecord['assessment']): boolean {
    if (assessment?.confidence !== 'supported' || assessment.durability !== 'durable' || !sources.length) return false
    const resolved = sources.map(source => this.readSource({ ...source, expectedContentHash: source.contentHash }))
    return ['collaboration', 'user_fact', 'project_pointer', 'experience'].includes(assessment.domain) && resolved.every(source => source.directUser)
      || assessment.domain === 'experience' && resolved.every(source => source.directUser || source.observation) && resolved.some(source => source.observation)
  }

  private get(id: string): StoredRecord {
    const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(id) as { body: string } | undefined
    if (!row) throw new Error('Memory does not exist in this workspace')
    return JSON.parse(row.body) as StoredRecord
  }

  private view(record: StoredRecord, now = Date.now(), readable = true): MemoryRecord {
    const redacted = !readable || record.state === 'forgotten' || record.sources.some(source => this.suppressed(source))
      || !this.dependenciesValid({ sources: [...record.sources, ...record.dispute?.sources ?? []], memories: [] })
    const state = record.state !== 'active' ? record.state
      : record.validUntil !== undefined && record.validUntil <= now ? 'expired'
        : record.validFrom !== undefined && record.validFrom > now ? 'scheduled' : 'active'
    return { ...record, state, redacted, key: redacted ? null : record.key, condition: redacted ? undefined : record.condition,
      dispute: redacted ? undefined : record.dispute, supersedes: redacted ? undefined : record.supersedes,
      supersededBy: redacted ? undefined : record.supersededBy, retirementReason: redacted ? undefined : record.retirementReason,
      assessment: redacted ? undefined : record.assessment,
      content: redacted ? null : record.content, sources: redacted ? [] : record.sources }
  }

  lookup(input: MemoryLookupQuery): MemoryLookupResult {
    return this.withSourceSnapshot(() => {
      const items: MemoryLookupItem[] = [], maxChars = 12000, requestedItems = input.limit ?? 5, scanLimit = 100
      const projectId = input.scope === 'workspace' ? undefined : input.projectId, includesWorkspace = !projectId || !!input.includeWorkspace
      let nextCursor = input.cursor ?? null, version = this.version(), scannedRecords = 0
      if (!readAssistantMemoryPolicy(this.workspace).use) return { items: [], nextCursor: null, version, scope: { projectId, includesWorkspace, workspaceWide: !projectId },
        budget: { maxChars, usedChars: 0, requestedItems, scannedRecords: 0, scanLimit } }
      const search = this.lexical.refresh({ projectId, includeWorkspace: includesWorkspace }, record => !this.view(record).redacted)
      while (items.length < requestedItems && scannedRecords < scanLimit) {
        const priorCursor = nextCursor
        const page = this.querySnapshot({ text: input.query, projectId, includeWorkspace: includesWorkspace, condition: input.condition, ids: input.ids,
          includeRetired: input.includeRetired, limit: 1, cursor: nextCursor ?? undefined }, search)
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
      const result: MemoryLookupResult = { items, nextCursor, version, coverage: search, scope: { projectId, includesWorkspace, workspaceWide: !projectId }, budget: { maxChars, usedChars: 0, requestedItems, scannedRecords, scanLimit } }
      result.budget.usedChars = JSON.stringify(result).length
      result.budget.usedChars = JSON.stringify(result).length
      return result
    })
  }

  inspect(input: MemoryInspectQuery): MemoryInspectResult {
    return this.withSourceSnapshot(() => {
      const stored = this.get(input.id)
      if (stored.revision !== input.expectedRevision) throw new Error('Memory inspection revision changed; search again before reading')
      const record = this.view(stored, undefined, readAssistantMemoryPolicy(this.workspace).use), content = record.content ?? ''
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
    return this.withSourceSnapshot(() => this.querySnapshot(query, this.lexical.refresh(query, record => !this.view(record).redacted)))
  }
  private querySnapshot(query: MemoryQuery, search: MemorySearchSnapshot): MemoryQueryResult {
    // One read transaction keeps records and version from different processes consistent.
    return this.withSourceSnapshot(() => this.db.transaction(() => {
      const version = this.version()
      const now = Date.now()
      const searching = !!query.text?.trim(), fulltext = searching && search.engine === 'fts5' && query.text!.trim().length > 1
      const terms = lexicalTokens(query.text ?? '', true), termsJson = JSON.stringify(terms)
      const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
      const searchable = "lower(json_extract(body,'$.content')||' '||json_extract(body,'$.key')||' '||COALESCE(json_extract(body,'$.condition'),''))"
      const fingerprint = digest(canonicalJson({ text: query.text ?? '', projectId: query.projectId ?? null, condition: query.condition ?? null,
        ids: query.ids ? [...new Set(query.ids)].sort() : null, includeWorkspace: !!query.projectId && !!query.includeWorkspace, includeRetired: query.includeRetired ?? false, limit: query.limit ?? 20,
        lexicalVersion: searching ? search.version : undefined }))
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
        SELECT rowid AS row_id,id, body, (json_extract(body, '$.state')='forgotten' OR EXISTS (
          SELECT 1 FROM json_each(body, '$.sources') AS source JOIN suppression
          ON suppression.source_key=json_array(json_extract(source.value, '$.sessionId'), json_extract(source.value, '$.messageId'))
        )) AS redacted FROM memories
      ) SELECT body FROM views ${fulltext ? 'JOIN memory_fts ON memory_fts.rowid=views.row_id' : ''}
        WHERE (? IS NULL OR json_extract(body, '$.projectId')=? OR (? AND json_extract(body,'$.projectId') IS NULL))
        AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))
        AND (? IS NULL OR json_extract(body, '$.condition')=?)
        AND (? OR (NOT redacted AND json_extract(body, '$.state')='active'
          AND json_extract(body, '$.dispute') IS NULL
          AND (json_extract(body, '$.validFrom') IS NULL OR json_extract(body, '$.validFrom')<=?)
          AND (json_extract(body, '$.validUntil') IS NULL OR json_extract(body, '$.validUntil')>?)))
        ${!searching ? '' : fulltext ? 'AND NOT redacted AND memory_fts MATCH ?' : `AND NOT redacted AND EXISTS(SELECT 1 FROM json_each(?) term WHERE instr(${searchable},term.value)>0)`}
        ORDER BY ${fulltext ? 'bm25(memory_fts,4.0,1.0,2.0),' : searching ? `(SELECT COALESCE(SUM(length(term.value)),0) FROM json_each(?) term WHERE instr(${searchable},term.value)>0) DESC,` : ''}
          json_extract(body, '$.updatedAt') DESC, id ASC LIMIT ? OFFSET ?`)
        .all(query.projectId ?? null, query.projectId ?? null, query.includeWorkspace ? 1 : 0, query.ids ? JSON.stringify(query.ids) : null, query.ids ? JSON.stringify(query.ids) : null,
          query.condition ?? null, query.condition ?? null, query.includeRetired ? 1 : 0, now, now,
          ...(searching ? [fulltext ? match : termsJson] : []), ...(searching && !fulltext ? [termsJson] : []), limit + 1, offset) as Array<{ body: string }>
      return { items: rows.slice(0, limit).map(row => this.view(JSON.parse(row.body) as StoredRecord, now))
        .filter(item => (!searching || !item.redacted) && (query.includeRetired || (!item.redacted && !item.dispute && item.state === 'active'))), version, coverage: search,
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

  mutate(command: MemoryMutation, authority: 'management' | 'user_request' | 'automatic' = 'management'): MemoryMutationResult {
    const policy = readAssistantMemoryPolicy(this.workspace), readable = authority === 'management' || policy.use
    return this.withSourceSnapshot(() => this.db.transaction(() => {
      const fingerprint = digest(canonicalJson(command))
      const receipt = this.db.prepare('SELECT fingerprint, memory_id FROM requests WHERE request_id=?').get(command.requestId) as { fingerprint: string; memory_id: string } | undefined
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('Request ID conflict: payload changed')
        // Always use the current view: a replay must not resurrect an old, now-forgotten response.
        const members = this.db.prepare('SELECT memory_id FROM memory_request_members WHERE request_id=?').all(command.requestId) as Array<{ memory_id: string }>
        return { record: this.view(this.get(receipt.memory_id), undefined, readable), version: this.version(), affectedIds: members.length ? members.map(member => member.memory_id) : [receipt.memory_id] }
      }
      const now = Date.now()
      if (authority === 'automatic' && command.action === 'transition' && command.state === 'forgotten') throw new Error('Permanent forgetting requires an explicit user request')
      if (authority !== 'management' && command.action !== 'transition') assertAssistantMemoryLearning(policy, authority)
      if (authority === 'automatic' && (command.action === 'remember' || command.action === 'revise') && !(command.assessment ?? (command.action === 'revise' ? this.get(command.id).assessment : undefined))) throw new Error('Automatic learning requires a source-based assessment')
      if ((command.action === 'remember' || command.action === 'revise') && command.assessment) {
        if (command.assessment.domain === 'secret') throw new Error('Credentials and secrets do not belong in assistant memory')
        if (command.assessment.domain === 'project_fact') throw new Error('Project facts belong to their Project memory owner; retain a scoped pointer instead')
        if (command.assessment.durability === 'task_only') throw new Error('One-time instructions belong in the current task or context')
        if (authority === 'automatic' && command.assessment.domain === 'sensitive') throw new Error('Sensitive personal memory requires an explicit user request')
      }
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
          assessment: command.assessment,
          state: command.assessment?.confidence === 'tentative' || command.assessment?.domain === 'authority' ? 'candidate'
            : command.basis === 'user_stated' || this.supportedUserExtraction(resolved, command.assessment) ? 'active' : 'candidate', revision: 1,
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
          const sources = this.resolveSources(command.sources, record.basis)
          const assessment = command.assessment ?? record.assessment
          record = { ...record, content: command.content, sources,
            assessment,
            state: ['candidate', 'active'].includes(record.state) && record.basis === 'inferred' ? this.supportedUserExtraction(sources, assessment) ? 'active' : 'candidate' : record.state,
            validFrom: command.validFrom === undefined ? record.validFrom : command.validFrom ?? undefined,
            validUntil: command.validUntil === undefined ? record.validUntil : command.validUntil ?? undefined }
          if (record.validFrom !== undefined && record.validUntil !== undefined && record.validFrom >= record.validUntil) throw new Error('Memory validity interval must have validFrom before validUntil')
        } else {
          if (command.state === 'active' && record.dispute) throw new Error('Resolve the memory dispute explicitly before activation')
          if (command.state === 'active' && record.assessment?.domain === 'authority') throw new Error('Permissions belong to execution policy, not memory activation')
          if (authority === 'automatic' && command.state === 'active' && record.state === 'candidate' && policy.learning !== 'automatic') throw new Error('Learning policy does not permit automatic candidate admission')
          if (authority === 'automatic' && command.state === 'active' && record.state === 'candidate' && !this.supportedUserExtraction(record.sources, record.assessment)) throw new Error('This candidate still lacks evidence for automatic admission')
          if (command.state === 'active' && record.sources.some(source => this.suppressed(source))) throw new Error('Memory source remains suppressed')
          if (command.state === 'active' && record.state === 'candidate') record = { ...record, sources: this.resolveSources(record.sources, record.basis) }
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
      return { record: this.view(record, undefined, readable), version: this.version(), affectedIds: [record, ...related].map(item => item.id) }
    })())
  }
}
