import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import { assertAssistantMemoryLearning, type AssistantMemoryPolicyStatus } from '@phaneris/shared/workspaces'
import type { MemoryRecord, MemorySource, MemorySourceResult } from '@phaneris/session-tools-core/memory-contracts'
import type { CollaborationProfile, ScenarioCapture, ScenarioPage, ScenarioQuery, ScenarioResult } from '@phaneris/session-tools-core/memory-derived-contracts'
import type { SqliteDatabase } from '../runtime/sqlite'
import { lexicalScore } from './memory-lexical'

interface StoredScenario extends Omit<ScenarioCapture, 'requestId' | 'expectedRevision' | 'intent' | 'sources'> {
  id: string; revision: number; createdAt: number; updatedAt: number; sources: MemoryRecord['sources']
}
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')

/** L2/L3 are reconstructable views over original sources and L1, never independent facts. */
export class DerivedMemory {
  constructor(private readonly db: SqliteDatabase, private readonly owner: {
    record(id: string): MemoryRecord | undefined
    source(source: MemorySource & { expectedContentHash?: string }): MemorySourceResult
    policy(): AssistantMemoryPolicyStatus
    version(): number
  }) {
    db.exec(`CREATE TABLE IF NOT EXISTS memory_scenarios(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_scenario_requests(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL);`)
  }
  profileReferences(input: { projectId?: string; query?: string }): MemoryRecord['sources'] {
    if (!this.owner.policy().use) return []
    const rows = this.db.prepare(`SELECT body FROM memories WHERE (json_extract(body,'$.projectId') IS NULL OR json_extract(body,'$.projectId')=?)
      AND json_extract(body,'$.state')='active' AND json_extract(body,'$.assessment.domain')='collaboration'
      ORDER BY json_extract(body,'$.updatedAt') DESC,id LIMIT 128`).all(input.projectId ?? null) as Array<{ body: string }>
    const ranked = rows.map(row => JSON.parse(row.body) as MemoryRecord).sort((left, right) =>
      lexicalScore(`${right.condition ?? ''} ${right.content ?? ''}`, input.query ?? '') - lexicalScore(`${left.condition ?? ''} ${left.content ?? ''}`, input.query ?? '')
      || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    return ranked.slice(0, 16).flatMap(record => record.sources)
  }
  profile(input: { projectId?: string; query?: string }): CollaborationProfile {
    const version = this.owner.version(), maxChars = 6000, policy = this.owner.policy()
    const unassessedRecords = (this.db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE
      (json_extract(body,'$.projectId') IS NULL OR json_extract(body,'$.projectId')=?)
      AND json_extract(body,'$.state')='active' AND json_extract(body,'$.assessment') IS NULL`).get(input.projectId ?? null) as { count: number }).count
    if (!policy.use) return { version, items: [], policy, coverage: { scanned: 0, candidateRecords: 0, omitted: 0, maxChars, unassessedRecords } }
    const scope = "(json_extract(body,'$.projectId') IS NULL OR json_extract(body,'$.projectId')=?) AND json_extract(body,'$.state')='active' AND json_extract(body,'$.assessment.domain')='collaboration'"
    const rows = this.db.prepare(`SELECT id,body FROM memories WHERE ${scope} ORDER BY json_extract(body,'$.updatedAt') DESC,id LIMIT 128`).all(input.projectId ?? null) as Array<{ id: string; body: string }>
    const count = (this.db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${scope}`).get(input.projectId ?? null) as { count: number }).count
    // Metadata ranking grants no recall authority. Only candidates actually
    // considered for the bounded result cross the full source-validation port.
    const ranked = rows.map(row => JSON.parse(row.body) as MemoryRecord).sort((left, right) => {
      const score = (record: MemoryRecord) => lexicalScore(`${record.condition ?? ''} ${record.content ?? ''}`, input.query ?? '')
        + (record.projectId === input.projectId ? 1 : 0)
      return score(right) - score(left) || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    })
    const items: CollaborationProfile['items'] = []
    let validatedRecords = 0
    for (const candidate of ranked) {
      if (items.length >= 8) break
      const record = this.owner.record(candidate.id); validatedRecords++
      if (!record || record.state !== 'active' || record.redacted || record.dispute) continue
      const item = { id: record.id, revision: record.revision, content: record.content, condition: record.condition, projectId: record.projectId, sources: record.sources }
      if (JSON.stringify([...items, item]).length > maxChars) continue
      items.push(item)
    }
    return { version, items, policy, coverage: { scanned: rows.length, validatedRecords, candidateRecords: count, omitted: Math.max(0, count - items.length), maxChars, unassessedRecords } }
  }
  capture(command: ScenarioCapture, authority: 'automatic' | 'user_request' | 'management') {
    const policy = this.owner.policy()
    if (authority !== 'management') assertAssistantMemoryLearning(policy, authority)
    if (command.assessment.domain !== 'experience' || command.assessment.confidence !== 'supported' || command.assessment.durability !== 'durable') throw new Error('A scenario needs a supported durable experience assessment; sensitive and secret material is ineligible')
    const fingerprint = digest(command)
    return this.db.transaction(() => {
      const replay = this.db.prepare('SELECT fingerprint,receipt FROM memory_scenario_requests WHERE request_id=?').get(command.requestId) as { fingerprint: string; receipt: string } | undefined
      if (replay) { if (replay.fingerprint !== fingerprint) throw new Error('Scenario request identity conflict'); return JSON.parse(replay.receipt) as { id: string; revision: number } }
      const resolved = command.sources.map(source => this.owner.source(source))
      const goalSource = resolved.find(source => source.directUser && source.content.includes(command.goalQuote))
      if (!goalSource) throw new Error('Scenario goal quote requires exact original direct user evidence')
      if (resolved.some(source => source.projectId && source.projectId !== command.projectId)) throw new Error('Scenario goal source belongs to another project scope')
      if (new Set(command.atoms.map(atom => atom.id)).size !== command.atoms.length) throw new Error('Duplicate scenario atoms')
      const atoms = command.atoms.map(reference => {
        const record = this.owner.record(reference.id)
        if (!record || record.revision !== reference.expectedRevision || !this.eligible(record, command)) throw new Error('Scenario atom revision, state, project or condition differs')
        return record
      })
      if (!atoms.some(atom => atom.kind === 'decision' || atom.kind === 'experience')) throw new Error('A scenario needs a meaningful decision or experience, not every conversation')
      const scopeKey = canonicalJson([command.projectId ?? null, command.key, command.condition ?? null])
      const prior = this.db.prepare('SELECT body FROM memory_scenarios WHERE scope_key=?').get(scopeKey) as { body: string } | undefined
      const existing = prior ? JSON.parse(prior.body) as StoredScenario : undefined
      if (existing && existing.revision !== command.expectedRevision) throw new Error('Scenario revision changed; inspect before replacing its definition')
      const { requestId: _requestId, expectedRevision: _expectedRevision, intent: _intent, sources: _sources, ...definition } = command
      const record: StoredScenario = { ...definition, id: existing?.id ?? randomUUID(), revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
        sources: [...new Map([goalSource, ...resolved].map(source => [JSON.stringify([source.sessionId, source.messageId]),
          { sessionId: source.sessionId, messageId: source.messageId, contentHash: source.contentHash }])).values()] }
      this.db.prepare('INSERT INTO memory_scenarios VALUES(?,?,?) ON CONFLICT(scope_key) DO UPDATE SET body=excluded.body').run(record.id, scopeKey, JSON.stringify(record))
      const receipt = { id: record.id, revision: record.revision }
      this.db.prepare('INSERT INTO memory_scenario_requests VALUES(?,?,?)').run(command.requestId, fingerprint, JSON.stringify(receipt))
      this.db.exec('UPDATE meta SET version=version+1 WHERE singleton=1')
      return receipt
    })()
  }
  private eligible(record: MemoryRecord, scope: { projectId?: string; condition?: string }): boolean {
    return record.state === 'active' && !record.redacted && !record.dispute
      && (!record.projectId || record.projectId === scope.projectId) && (!record.condition || record.condition === scope.condition)
  }
  private derive(stored: StoredScenario): { atoms: MemoryRecord[]; derivedVersion: string } | undefined {
    try { for (const source of stored.sources) this.owner.source({ ...source, expectedContentHash: source.contentHash }) }
    catch { return }
    const atoms = stored.atoms.flatMap(reference => {
      let record = this.owner.record(reference.id)
      const seen = new Set<string>()
      // Only explicit replacement relations can move a historical decision forward.
      while (record?.state === 'superseded' && record.supersededBy && seen.size < 8 && !seen.has(record.id)) {
        seen.add(record.id); record = this.owner.record(record.supersededBy)
      }
      return record && this.eligible(record, stored) ? [record] : []
    })
    if (!atoms.length) return
    return { atoms, derivedVersion: digest([stored.id, stored.revision, stored.sources, atoms.map(atom => [atom.id, atom.revision, atom.state, atom.sources])]) }
  }
  valid(reference: { id: string; revision: number; derivedVersion: string }): boolean {
    if (!this.owner.policy().use) return false
    const row = this.db.prepare('SELECT body FROM memory_scenarios WHERE id=?').get(reference.id) as { body: string } | undefined
    if (!row) return false
    const stored = JSON.parse(row.body) as StoredScenario
    return stored.revision === reference.revision && this.derive(stored)?.derivedVersion === reference.derivedVersion
  }
  scenarios(input: ScenarioQuery): ScenarioPage {
    const version = this.owner.version(), projectId = input.scope === 'workspace' ? undefined : input.projectId
    const scope = { projectId, includesWorkspace: !projectId || !!input.includeWorkspace, workspaceWide: !projectId }
    const page: ScenarioPage = { version, items: [], nextCursor: null, scope, coverage: { scanned: 0, maxScan: 100, hasMore: false, unavailable: 0 } }
    if (!this.owner.policy().use) return page
    const fingerprint = digest({ ...input, cursor: undefined, projectId, limit: input.limit ?? 5 })
    if (input.cursor && (input.cursor.version !== version || input.cursor.fingerprint !== fingerprint)) throw new Error('Scenario cursor scope or version changed; restart lookup')
    const offset = input.cursor?.offset ?? 0
    const rows = this.db.prepare(`SELECT body FROM memory_scenarios WHERE (? IS NULL OR json_extract(body,'$.projectId')=?
      OR (? AND json_extract(body,'$.projectId') IS NULL)) AND (? IS NULL OR id=?) ORDER BY json_extract(body,'$.updatedAt') DESC,id LIMIT 101 OFFSET ?`)
      .all(projectId ?? null, projectId ?? null, input.includeWorkspace ? 1 : 0, input.id ?? null, input.id ?? null, offset) as Array<{ body: string }>
    let bytes = 0
    for (const row of rows.slice(0, 100)) {
      const stored = JSON.parse(row.body) as StoredScenario, derived = this.derive(stored)
      if (!derived) { page.coverage.scanned++; page.coverage.unavailable++; continue }
      if (input.query && !lexicalScore(`${stored.title} ${stored.goalQuote} ${derived.atoms.map(atom => atom.content).join(' ')}`, input.query)) { page.coverage.scanned++; continue }
      const start = Math.min(input.atomOffset ?? 0, derived.atoms.length), end = Math.min(start + 4, derived.atoms.length)
      const sourceStart = Math.min(input.sourceOffset ?? 0, stored.sources.length), sourceEnd = Math.min(sourceStart + 8, stored.sources.length)
      const item: ScenarioResult = { id: stored.id, revision: stored.revision, title: stored.title, goal: stored.goalQuote, projectId: stored.projectId,
        condition: stored.condition, derivedVersion: derived.derivedVersion, goalChars: stored.goalQuote.length, goalTruncated: false,
        atoms: derived.atoms.slice(start, end).map(atom => ({ id: atom.id, revision: atom.revision, content: atom.content?.slice(0, 800) ?? null,
          contentChars: atom.content?.length ?? 0, contentTruncated: (atom.content?.length ?? 0) > 800, kind: atom.kind,
          projectId: atom.projectId, condition: atom.condition, sources: atom.sources.slice(0, 2), sourceCount: atom.sources.length })),
        sources: stored.sources.slice(sourceStart, sourceEnd), atomRange: { offset: start, end, total: derived.atoms.length }, nextAtomOffset: end < derived.atoms.length ? end : null,
        sourceRange: { offset: sourceStart, end: sourceEnd, total: stored.sources.length }, nextSourceOffset: sourceEnd < stored.sources.length ? sourceEnd : null }
      while (JSON.stringify(item).length > 12000 && item.sources.length > 1) item.sources.pop()
      while (JSON.stringify(item).length > 12000 && item.atoms.length > 1) item.atoms.pop()
      if (JSON.stringify(item).length > 12000) {
        item.navigationOnly = true; item.title = item.title.slice(0, 120); item.goal = item.goal.slice(0, 64); item.goalTruncated = item.goal.length < stored.goalQuote.length
        item.atoms = item.atoms.map(atom => ({ ...atom, content: null, contentTruncated: true, condition: undefined, sources: [] }))
      }
      item.atomRange.end = start + item.atoms.length; item.nextAtomOffset = item.atomRange.end < derived.atoms.length ? item.atomRange.end : null
      item.sourceRange.end = sourceStart + item.sources.length; item.nextSourceOffset = item.sourceRange.end < stored.sources.length ? item.sourceRange.end : null
      const size = JSON.stringify(item).length
      if (page.items.length >= (input.limit ?? 5) || bytes + size > 12000) break
      page.coverage.scanned++; bytes += size; page.items.push(item)
    }
    page.coverage.hasMore = rows.length > page.coverage.scanned
    if (page.coverage.hasMore) page.nextCursor = { version, offset: offset + page.coverage.scanned, fingerprint }
    return page
  }
}
