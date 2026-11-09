import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '@phaneris/core/types'
import type { ResidentContextState, ResidentContextCommand, ResidentDependencies, ResidentSegment, ResidentSource, ResidentTopic, ContextBranch, ContextCheckpoint } from '@phaneris/session-tools-core/resident-context-contracts'
import { openSqliteDatabase, type SqliteDatabase } from '../runtime/sqlite'
import type { AssistantMemoryStore } from '../resident-assistant/memory-store'
import { getSourceReader } from './source-reader'

export interface Association extends ResidentSource { contentHash?: string; role: 'requirement' | 'evidence' | 'shared'; active: boolean; branchRevision?: number; pinned?: boolean; unclassified?: boolean }
/** Union overlapping requirement intervals without copying their original text. */
export function materialReferences(refs: Association[]): Association[] {
  const output = refs.filter(ref => ref.role !== 'requirement'), groups = new Map<string, Association[]>()
  for (const ref of refs.filter(ref => ref.role === 'requirement')) {
    const key = JSON.stringify([ref.sessionId, ref.messageId, ref.contentHash])
    groups.set(key, [...groups.get(key) ?? [], ref])
  }
  for (const group of groups.values()) {
    const full = group.find(ref => !ref.range)
    if (full) { output.push(full); continue }
    const ordered = group.sort((a, b) => a.range!.offset - b.range!.offset)
    let previous: Association | undefined
    for (const ref of ordered) {
      if (previous && ref.range!.offset <= previous.range!.end) previous.range!.end = Math.max(previous.range!.end, ref.range!.end)
      else { previous = { ...ref, range: { ...ref.range! } }; output.push(previous) }
    }
  }
  return output
}
interface Pointer extends Omit<ResidentContextState, 'activeSegment' | 'topics' | 'branches'> { activeSegmentId?: string; selectedForInput?: string; temporary?: { inputId: string; branchIds: string[] }; recentMainline?: ResidentSource[] }
/** workspace/context.db owns only references, selections and recovery metadata.
 * No message text, task state or execution attempt is stored here. */
export class ContextMetadataStore {
  protected readonly db: SqliteDatabase
  constructor(protected readonly workspace: { id: string; rootPath: string }, protected readonly sessionId: string, protected readonly memory: AssistantMemoryStore) {
    mkdirSync(workspace.rootPath, { recursive: true })
    this.db = openSqliteDatabase(join(workspace.rootPath, 'context.db'))
    const schema = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (schema > 1) { this.db.close(); throw new Error(`context_schema_unsupported: Context schema ${schema} requires a matching application/backup version`) }
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1), workspace_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pointers(session_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS branches(session_id TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS associations(session_id TEXT NOT NULL,branch_id TEXT NOT NULL,source_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session_id,branch_id,source_key));
      CREATE TABLE IF NOT EXISTS checkpoints(session_id TEXT NOT NULL,branch_id TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS views(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_commands(session_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_id TEXT NOT NULL,PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS material_refresh(session_id TEXT NOT NULL,original_input TEXT NOT NULL,state TEXT NOT NULL,input_id TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,PRIMARY KEY(session_id,original_input));`)
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES(1,?)').run(workspace.id)
    if ((this.db.prepare('SELECT workspace_id FROM owner').get() as { workspace_id: string }).workspace_id !== workspace.id) { this.db.close(); throw new Error('context_workspace_conflict: Context metadata belongs to another workspace') }
    try { this.migrateLegacy() } catch (error) { this.db.close(); throw new Error(`context_migration_failed: Session ${sessionId} metadata could not be converted; original Session/Runtime and legacy context are preserved`, { cause: error }) }
    this.db.exec('PRAGMA user_version=1')
    this.db.prepare("UPDATE material_refresh SET state='pending' WHERE session_id=? AND state='running'").run(sessionId)
  }
  close() { this.db.close() }
  private migrateLegacy() {
    if (this.db.prepare('SELECT 1 FROM migrations WHERE id=?').get(this.sessionId)) return
    const file = join(this.workspace.rootPath, 'assistant', 'context.db')
    if (!existsSync(file)) { this.db.prepare('INSERT INTO migrations VALUES(?)').run(this.sessionId); return }
    const legacy = openSqliteDatabase(file, { readonly: true })
    try {
      const topics = legacy.prepare('SELECT body FROM topics WHERE session_id=?').all(this.sessionId) as Array<{ body: string }>
      const old = legacy.prepare('SELECT body FROM context_state WHERE session_id=?').get(this.sessionId) as { body: string } | undefined
      this.db.transaction(() => {
        for (const { body } of topics) {
          const topic = JSON.parse(body) as ResidentTopic
          this.saveBranch({ id: topic.id, sessionId: this.sessionId, label: topic.label, projectId: topic.projectId, revision: 1, state: 'dormant', imported: true, createdAt: topic.createdAt, updatedAt: topic.updatedAt })
          for (const messageId of topic.originalInputIds) this.saveAssociation(topic.id, { sessionId: this.sessionId, messageId, role: 'shared', active: true, unclassified: true })
          for (const source of topic.anchors) this.saveAssociation(topic.id, { ...source, contentHash: source.expectedContentHash, role: 'evidence', active: true, pinned: true, branchRevision: 1 })
        }
        if (old && !this.db.prepare('SELECT 1 FROM pointers WHERE session_id=?').get(this.sessionId)) {
          const state = JSON.parse(old.body) as ResidentContextState
          this.savePointer({ workspaceId: this.workspace.id, sessionId: this.sessionId, revision: state.revision + 1, focus: state.focus,
            selectedBranchIds: state.focus.topicId ? [state.focus.topicId] : [], selectedForInput: '*' })
        }
        // Old request manifests remain historical evidence in the readonly file;
        // they do not claim source coverage or become valid checkpoints.
        this.db.prepare('INSERT INTO migrations VALUES(?)').run(this.sessionId)
      })()
    } finally { legacy.close() }
  }
  protected pointer(): Pointer {
    const row = this.db.prepare('SELECT body FROM pointers WHERE session_id=?').get(this.sessionId) as { body: string } | undefined
    return row ? JSON.parse(row.body) : { workspaceId: this.workspace.id, sessionId: this.sessionId, revision: 0, focus: { label: 'Current conversation', anchors: [] }, selectedBranchIds: [] }
  }
  protected savePointer(state: Pointer) { this.db.prepare('INSERT INTO pointers VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET body=excluded.body').run(this.sessionId, JSON.stringify(state)) }
  protected saveSegment(segment: ResidentSegment) { this.db.prepare('INSERT INTO views VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(segment.id, segment.runOperationId, JSON.stringify(segment)) }
  get(includeActive = true): ResidentContextState {
    const { activeSegmentId, selectedForInput: _input, temporary: _temporary, recentMainline: _mainline, ...state } = this.pointer()
    const row = includeActive && activeSegmentId ? this.db.prepare('SELECT body FROM views WHERE id=?').get(activeSegmentId) as { body: string } | undefined : undefined
    if (includeActive && activeSegmentId && !row) throw new Error('context_view_missing: Committed recovery pointer is unavailable; explicitly select valid work to rebuild')
    return { ...state, focus: { ...state.focus, anchors: state.focus.topicId ? this.associations(state.focus.topicId).filter(ref => ref.pinned).map(ref => ({ sessionId: ref.sessionId, messageId: ref.messageId, expectedContentHash: ref.contentHash, range: ref.range })) : [] },
      ...(row ? { activeSegment: JSON.parse(row.body) } : {}) }
  }
  branch(id: string): ContextBranch {
    const row = this.db.prepare('SELECT body FROM branches WHERE session_id=? AND id=?').get(this.sessionId, id) as { body: string } | undefined
    if (!row) throw new Error('context_branch_unavailable: Branch does not belong to this workspace/Session')
    return JSON.parse(row.body)
  }
  topic(id: string): ResidentTopic {
    const branch = this.branch(id), refs = this.associations(id)
    return { ...branch, anchors: refs.filter(r => r.sessionId !== this.sessionId), originalInputIds: refs.filter(r => r.sessionId === this.sessionId).map(r => r.messageId) }
  }
  protected saveBranch(branch: ContextBranch) { this.db.prepare('INSERT INTO branches VALUES(?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET body=excluded.body').run(this.sessionId, branch.id, JSON.stringify(branch)) }
  associations(branchId: string): Association[] {
    return (this.db.prepare('SELECT body FROM associations WHERE session_id=? AND branch_id=? ORDER BY rowid').all(this.sessionId, branchId) as Array<{ body: string }>).map(row => JSON.parse(row.body) as Association).filter(r => r.active)
  }
  private saveAssociation(branchId: string, ref: Association) {
    this.db.prepare('INSERT INTO associations VALUES(?,?,?,?) ON CONFLICT(session_id,branch_id,source_key) DO UPDATE SET body=excluded.body')
      .run(this.sessionId, branchId, JSON.stringify([ref.sessionId, ref.messageId, ref.range]), JSON.stringify(ref))
  }
  checkpoint(branchId: string, projectId?: string): ContextCheckpoint | undefined {
    const row = this.db.prepare("SELECT body FROM checkpoints WHERE session_id=? AND branch_id=? AND (branch_id!='__main__' OR json_extract(body,'$.projectId') IS ?) ORDER BY rowid DESC LIMIT 1").get(this.sessionId, branchId, projectId ?? null) as { body: string } | undefined
    return row ? JSON.parse(row.body) : undefined
  }
  protected directory(query = '', offset = 0, limit = 12) {
    const filter = `session_id=? AND (?='' OR instr(lower(json_extract(body,'$.label')),lower(?))>0)`
    const total = (this.db.prepare(`SELECT count(*) AS n FROM branches WHERE ${filter}`).get(this.sessionId, query, query) as { n: number }).n
    const items = (this.db.prepare(`SELECT body FROM branches WHERE ${filter} ORDER BY json_extract(body,'$.updatedAt') DESC,id LIMIT ? OFFSET ?`).all(this.sessionId, query, query, limit, offset) as Array<{ body: string }>).map(row => JSON.parse(row.body) as ContextBranch)
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null }
  }
  command(command: ResidentContextCommand, messages: readonly Message[], currentInputId?: string, currentProjectId?: string): ResidentContextState {
    if (command.action === 'get') return this.get()
    if (command.action === 'branches' || command.action === 'topics') {
      if (command.action === 'branches' && command.branchId) {
        this.branch(command.branchId)
        const refs = this.associations(command.branchId), offset = command.offset ?? 0, limit = command.limit ?? 12
        return { ...this.get(), branchSources: { branchId: command.branchId, items: refs.slice(offset, offset + limit), total: refs.length,
          nextOffset: offset + limit < refs.length ? offset + limit : null } }
      }
      const branches = this.directory(command.action === 'branches' ? command.query : '', command.offset, command.limit)
      return { ...this.get(), branches, topics: { items: branches.items.map(b => ({ ...b, anchorCount: this.associations(b.id).length, originalInputCount: this.associations(b.id).filter(r => r.sessionId === this.sessionId).length })), nextOffset: branches.nextOffset } }
    }
    const input = messages.find(m => m.id === currentInputId) ?? messages.findLast(m => m.role === 'user' && !m.hidden && !m.inputSource)
    if (command.action === 'select' && command.temporary && input?.inputSource?.kind !== 'resident_event') throw new Error('context_temporary_event_required: Temporary selection is only for Host inbox events. For a direct user resumption select without temporary to update foreground work')
    const projectId = currentInputId && input?.projectScope ? input.projectScope.projectId ?? undefined : currentProjectId
    const state = this.pointer(), fingerprint = JSON.stringify(command)
    const requestId = 'requestId' in command ? command.requestId : undefined
    const prior = requestId ? this.db.prepare('SELECT fingerprint,result_id FROM context_commands WHERE session_id=? AND id=?').get(this.sessionId, requestId) as { fingerprint: string; result_id: string } | undefined : undefined
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('context_command_conflict: requestId already has different content'); return this.get() }
    return this.db.transaction(() => {
      let ids: string[] = [], resultId = ''
      if (command.action === 'create' || command.action === 'focus') {
        if (command.projectId !== undefined && command.projectId !== projectId) throw new Error('context_project_conflict: Select the project before creating its branch')
        const branch: ContextBranch = { id: randomUUID(), sessionId: this.sessionId, label: command.label, projectId: command.projectId ?? projectId, revision: 1, state: 'active', createdAt: Date.now(), updatedAt: Date.now() }
        this.saveBranch(branch); ids = [branch.id]; resultId = branch.id
        if (command.action === 'create' && input && !input.inputSource) this.link(branch.id, { sessionId: this.sessionId, messageId: input.id }, 'requirement')
        if (command.action === 'focus') for (const source of command.anchors) this.link(branch.id, source, 'evidence', true)
      } else if (command.action === 'select' || command.action === 'resume') ids = command.action === 'select' ? command.branchIds : [command.topicId]
      else if (command.action === 'hibernate') {
        for (const id of command.branchIds) this.saveBranch({ ...this.branch(id), state: 'dormant' })
        state.selectedBranchIds = (state.selectedBranchIds ?? []).filter(id => !command.branchIds.includes(id))
      } else if (command.action === 'associate' || command.action === 'anchors') {
        const targets = command.action === 'associate' ? command.branchIds : state.selectedBranchIds ?? []
        if (!targets.length) throw new Error('context_branch_required: Select a branch before associating sources')
        const refs = command.action === 'anchors' ? command.anchors : [command.source ?? (input ? { sessionId: this.sessionId, messageId: input.id } : undefined)]
        if (refs.some(r => !r)) throw new Error('context_input_unavailable: No committed input to associate')
        if (command.action === 'associate' && command.role === 'requirement' && (state.selectedBranchIds?.length ?? 0) > 1 && command.branchIds.length === 1
          && !command.source?.quote && !command.source?.range) throw new Error('context_range_required: For mixed work, use source.quote for only this work clause, and supersedes.quote for only the changed original clause; preserve all other requirements')
        if (command.action === 'associate') for (const id of command.moveFromBranchIds ?? []) {
          const branch = this.branch(id)
          const before = this.requirementSignature(id)
          for (const ref of refs) {
            const old = this.associations(id).find(item => item.sessionId === ref!.sessionId && item.messageId === ref!.messageId && JSON.stringify(item.range) === JSON.stringify(ref!.range))
            if (!old) throw new Error('context_attribution_conflict: Original association is absent; refresh before correcting it')
            this.saveAssociation(id, { ...old, active: false })
          }
          this.saveBranch({ ...branch, revision: branch.revision + (this.requirementSignature(id) === before ? 0 : 1), updatedAt: Date.now() })
        }
        for (const id of targets) {
          const branch = this.branch(id)
          const before = this.requirementSignature(id)
          if (command.action === 'anchors') for (const old of this.associations(id).filter(r => r.pinned)) this.saveAssociation(id, { ...old, active: false })
          if (command.action === 'associate') for (const old of command.supersedes ?? []) {
            const oldSource = this.memory.readSource(old), oldRange = this.resolveRange(old, oldSource.content)
            const existing = this.associations(id).filter(r => r.role === 'requirement' && r.sessionId === old.sessionId && r.messageId === old.messageId && (!oldRange || !r.range || r.range.offset < oldRange.end && r.range.end > oldRange.offset))
            if (!existing.length) throw new Error('context_revision_conflict: Superseded requirement is not associated with this branch')
            // Every overlapping reference is retired. Replacing only the first
            // would allow a narrower duplicate to resurrect the old clause.
            for (const prior of existing) {
              if (prior.contentHash && prior.contentHash !== oldSource.contentHash) throw new Error('context_revision_conflict: Superseded source version changed')
              this.saveAssociation(id, { ...prior, active: false })
              if (oldRange) {
                const range = prior.range ?? { offset: 0, end: oldSource.content.length }
                if (range.offset < oldRange.offset) this.saveAssociation(id, { ...prior, range: { offset: range.offset, end: oldRange.offset }, active: true })
                if (oldRange.end < range.end) this.saveAssociation(id, { ...prior, range: { offset: oldRange.end, end: range.end }, active: true })
              }
            }
          }
          for (const ref of refs) this.link(id, ref!, command.action === 'anchors' ? 'evidence' : command.role, command.action === 'anchors')
          this.saveBranch({ ...branch, revision: branch.revision + (this.requirementSignature(id) === before ? 0 : 1), updatedAt: Date.now() })
        }
      } else if (command.action === 'checkpoint') {
        const branch = command.branchId ? this.branch(command.branchId) : { id: '__main__', revision: 0, projectId }
        if (branch.projectId !== projectId) throw new Error('context_project_conflict: Checkpoint belongs to a different project')
        const view = this.get().activeSegment
        // Checkpoint creation runs inside the current model request. That request
        // has already been sent, so its entered material snapshot is the evidence
        // the model actually saw; waiting for a committed outcome would reject a
        // checkpoint immediately after select/associate in the same turn. Reads
        // completed through tools are tracked on the active segment; the tool that
        // is still executing is never added there.
        const materialRequest = view && view.inputMessageId === currentInputId
          ? view.requests.findLast(request => request.disposition === 'entered' || request.disposition === 'committed') : undefined
        const consumed = [...(materialRequest?.dependencies.sources ?? []), ...(view?.dependencies.sources ?? [])]
        const refs: Array<ResidentSource & { contentHash?: string }> = [...(command.branchId ? materialReferences(this.associations(branch.id)).filter(ref => ref.role === 'requirement' || consumed.some(source => source.materialMode !== 'reference' && source.sessionId === ref.sessionId && source.messageId === ref.messageId)) : state.recentMainline ?? []), ...command.sources ?? []]
        const coverage = refs.map(ref => {
          const source = this.memory.readSource({ ...ref, expectedContentHash: ref.contentHash ?? ref.expectedContentHash })
          const range = this.resolveRange(ref, source.content)
          const fullRange = range ?? { offset: 0, end: source.content.length }
          if (currentInputId && !consumed.some(read => read.materialMode !== 'reference' && read.sessionId === ref.sessionId && read.messageId === ref.messageId && read.contentHash === source.contentHash
            && (!read.ranges?.length || read.ranges.some(r => r.offset <= fullRange.offset && r.end >= fullRange.end)))) throw new Error('context_checkpoint_unread: Read the exact requirement/source in the current model request before claiming its checkpoint coverage. After select or associate, continue to the next model step before saving the checkpoint')
          if (source.projectId !== undefined && source.projectId !== projectId) throw new Error('context_project_conflict: Checkpoint source belongs to a different project')
          return { sessionId: ref.sessionId, messageId: ref.messageId, range, contentHash: source.contentHash, cursor: getSourceReader(this.workspace.rootPath).describe(ref.sessionId, ref.messageId).cursor }
        })
        const checkpoint: ContextCheckpoint = { id: randomUUID(), branchId: branch.id, projectId, revision: branch.revision, conclusions: command.conclusions,
          unresolved: command.unresolved, next: command.next, coverage, createdAt: Date.now(), dependencies: { sources: coverage.map(source => ({ sessionId: source.sessionId, messageId: source.messageId, contentHash: source.contentHash })),
            memories: [...(materialRequest?.dependencies.memories ?? []), ...(view?.dependencies.memories ?? [])],
            scenarios: [...(materialRequest?.dependencies.scenarios ?? []), ...(view?.dependencies.scenarios ?? [])],
            knowledge: [...(materialRequest?.dependencies.knowledge ?? []), ...(view?.dependencies.knowledge ?? [])] } }
        this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?)').run(this.sessionId, branch.id, checkpoint.id, JSON.stringify(checkpoint)); resultId = checkpoint.id
      }
      if (ids.length) {
        for (const id of ids) {
          const branch = this.branch(id)
          if (command.action === 'resume' && command.anchors) {
            for (const old of this.associations(id).filter(ref => ref.pinned)) this.saveAssociation(id, { ...old, active: false })
            for (const ref of command.anchors) this.link(id, ref, 'evidence', true)
          }
          if (branch.projectId !== projectId) throw new Error('context_project_conflict: Branch belongs to a different project')
          for (const ref of this.associations(id)) if (!this.memory.isSourceSuppressed(ref)) this.memory.readSource({ ...ref, expectedContentHash: ref.contentHash })
          this.saveBranch({ ...branch, state: 'active', updatedAt: Date.now() })
        }
        if (command.action === 'select' && command.temporary && currentInputId) state.temporary = { inputId: currentInputId, branchIds: ids }
        else { state.selectedBranchIds = ids; state.selectedForInput = currentInputId ?? '*' }
        if (!(command.action === 'select' && command.temporary)) { const branch = this.branch(ids[0]!); state.focus = { label: branch.label, topicId: branch.id, projectId: branch.projectId, anchors: [] } }
      }
      if (requestId) this.db.prepare('INSERT INTO context_commands VALUES(?,?,?,?)').run(this.sessionId, requestId, fingerprint, resultId)
      if (command.action !== 'checkpoint') state.activeSegmentId = undefined
      this.savePointer({ ...state, revision: state.revision + 1 })
      return this.get()
    })()
  }
  private link(branchId: string, ref: ResidentSource, role: Association['role'], pinned = false) {
    const source = this.memory.readSource(ref), branch = this.branch(branchId)
    if (source.projectId !== undefined && source.projectId !== branch.projectId) throw new Error('context_project_conflict: Source project differs from branch project')
    if (role === 'requirement' && !source.directUser) throw new Error('context_requirement_source: Requirements must cite direct user originals; reports and tool results are evidence')
    const range = this.resolveRange(ref, source.content), { quote: _quote, ...reference } = ref
    this.saveAssociation(branchId, { ...reference, range, contentHash: source.contentHash, role, active: true, branchRevision: branch.revision, pinned })
  }
  private resolveRange(ref: ResidentSource, content: string) {
    if (ref.quote) {
      const offset = content.indexOf(ref.quote)
      if (offset < 0 || content.indexOf(ref.quote, offset + 1) >= 0) throw new Error('context_quote_ambiguous: Quote must match exactly once in the original; read it again or provide an exact range')
      return { offset, end: offset + ref.quote.length }
    }
    if (ref.range && ref.range.end > content.length) throw new Error('context_range_conflict: Source range exceeds original')
    return ref.range
  }
  private requirementSignature(branchId: string) {
    return JSON.stringify(materialReferences(this.associations(branchId)).filter(ref => ref.role === 'requirement')
      .map(ref => JSON.stringify([ref.sessionId, ref.messageId, ref.contentHash, ref.range])).sort())
  }
  segmentForRun(runOperationId: string): ResidentSegment | undefined {
    const row = this.db.prepare('SELECT body FROM views WHERE run_id=?').get(runOperationId) as { body: string } | undefined
    return row ? JSON.parse(row.body) : undefined
  }
  revisionsValid(revisions: Record<string, number> = {}) { return Object.entries(revisions).every(([id, revision]) => this.branch(id).revision === revision) }
  recordTurn(messages: readonly Message[], inputIds: readonly string[]) {
    const segment = this.get().activeSegment
    if (!segment || !inputIds.includes(segment.inputMessageId)) return
    const ids = segment.branchIds ?? [], start = messages.findIndex(m => m.id === segment.inputMessageId)
    if (start < 0) return
    this.db.transaction(() => {
      if (!ids.length && !messages[start]?.inputSource) {
        const current = this.pointer()
        this.savePointer({ ...current, recentMainline: [...current.recentMainline ?? [], ...messages.slice(start).filter(m => !m.hidden && (m.role === 'user' || m.role === 'assistant' && !m.isIntermediate)).map(m => ({ sessionId: this.sessionId, messageId: m.id }))].slice(-4) })
      }
      for (const id of ids) for (const message of messages.slice(start + 1).filter(m => ['assistant', 'tool'].includes(m.role) && !m.hidden)) {
        this.link(id, { sessionId: this.sessionId, messageId: message.id }, ids.length > 1 ? 'shared' : 'evidence')
      }
    })()
  }
  /** A Worker keeps only explicitly selected sources. Branch revisions carry relevant corrections, never focus/hibernation. */
  taskMaterials(branchIds: string[], sources: ResidentSource[] = []): ResidentDependencies {
    for (const id of branchIds) if (this.branch(id).imported && !this.associations(id).some(ref => ref.role === 'requirement')) throw new Error('context_legacy_scope_required: Imported work has unclassified historical references; read its sources and associate the current requirements before delegation')
    const refs = [...branchIds.flatMap(id => materialReferences(this.associations(this.branch(id).id)).filter(r => r.role === 'requirement')), ...sources]
    const resolved = refs.map(ref => { const source = this.memory.readSource({ ...ref, expectedContentHash: 'contentHash' in ref ? ref.contentHash as string : ref.expectedContentHash }); const range = this.resolveRange(ref, source.content); return { sessionId: ref.sessionId, messageId: ref.messageId, contentHash: source.contentHash, projectId: source.projectId ?? null, ...(range ? { ranges: [range] } : {}) } })
    return { sources: [...new Map(resolved.map(source => [JSON.stringify(source), source])).values()], memories: [] }
  }
}
