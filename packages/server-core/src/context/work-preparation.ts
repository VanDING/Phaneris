import { createHash, randomUUID } from 'node:crypto'
import type { Message } from '@phaneris/core/types'
import type { ResidentContextCommand, ResidentContextState, ResidentDependencies, ResidentSource, ResidentWorkPreparation } from '@phaneris/session-tools-core/resident-context-contracts'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import { isDirectUserSource } from '../sessions/input-contracts'
import { ContextMetadataStore, materialReferences, type Association } from './metadata-store'

export const preparationHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
export interface WorkContinuation { id: string; branchIds: string[]; requirements: ResidentWorkPreparation['requirements'] }

/** Command progress and exact source references, owned by workspace/context.db.
 * Recording requirements and publishing a usable view are separate commits. */
export class WorkPreparationStore extends ContextMetadataStore {
  toolReceipt(operationId: string): ResidentContextState | undefined {
    const row = this.db.prepare('SELECT command_id,result_json FROM context_tool_receipts WHERE session_id=? AND operation_id=?')
      .get(this.sessionId, operationId) as { command_id: string | null; result_json: string | null } | undefined
    if (!row) return undefined
    return row.result_json ? JSON.parse(row.result_json) as ResidentContextState : undefined
  }
  private retainToolReceipt(operationId: string | undefined, result: ResidentContextState, commandId?: string): void {
    if (operationId) this.db.prepare('INSERT OR IGNORE INTO context_tool_receipts VALUES(?,?,?,?)').run(operationId, this.sessionId,
      commandId ?? null, JSON.stringify({ ...result, activeSegment: undefined,
        ...(commandId ? { preparation: this.workPreparation(commandId) } : {}) }))
  }
  workPreparation(id: string): ResidentWorkPreparation | undefined {
    const row = this.db.prepare('SELECT body FROM context_commands WHERE session_id=? AND id=?').get(this.sessionId, id) as { body: string | null } | undefined
    return row?.body ? JSON.parse(row.body) as ResidentWorkPreparation : undefined
  }
  protected preparationForInput(inputId: string): ResidentWorkPreparation | undefined {
    const row = this.db.prepare(`SELECT body FROM context_commands WHERE session_id=? AND json_extract(body,'$.inputId')=?
      AND json_extract(body,'$.state') IS NOT NULL ORDER BY json_extract(body,'$.generation') DESC LIMIT 1`).get(this.sessionId, inputId) as { body: string } | undefined
    return row ? JSON.parse(row.body) as ResidentWorkPreparation : undefined
  }
  protected savePreparation(preparation: ResidentWorkPreparation): void {
    this.db.prepare('UPDATE context_commands SET body=? WHERE session_id=? AND id=?').run(JSON.stringify(preparation), this.sessionId, preparation.id)
  }
  override get(includeActive = true): ResidentContextState {
    const state = super.get(includeActive), id = this.pointer().preparationId
    return { ...state, ...(id ? { preparation: this.workPreparation(id) } : {}) }
  }
  protected override contextChanged(command: ResidentContextCommand, inputId?: string): void {
    if (command.action !== 'checkpoint' && inputId) {
      const preparation = this.preparationForInput(inputId)
      if (preparation) this.savePreparation({ ...preparation, state: 'superseded' })
    }
  }
  override command(command: ResidentContextCommand, messages: readonly Message[], currentInputId?: string, currentProjectId?: string, operationId?: string, continuation?: WorkContinuation): ResidentContextState {
    if (command.action === 'receipt' || command.action === 'reconcile') throw new Error('context_runtime_required: Receipt inspection requires the Runtime owner')
    const receipt = operationId ? this.toolReceipt(operationId) : undefined
    if (receipt) return receipt
    if (command.action === 'preparation') return { ...super.get(false), preparation: this.workPreparation(command.requestId) }
    if (command.action === 'recover') {
      const preparation = this.workPreparation(command.requestId)
      if (!preparation || preparation.inputId !== currentInputId) throw new Error('work_input_conflict: Recovery belongs to another input')
      if (preparation.generation !== command.expectedGeneration || preparation.state === 'superseded') throw new Error('work_generation_conflict: Read current command progress before recovery')
      this.db.transaction(() => {
        if (preparation.state !== 'ready') this.savePreparation({ ...preparation, state: 'recorded', error: undefined })
        this.retainToolReceipt(operationId, super.get(false), preparation.id)
      })()
      return { ...super.get(false), preparation: this.workPreparation(command.requestId) }
    }
    if (command.action !== 'prepare') {
      return super.command(command, messages, currentInputId, currentProjectId, operationId)
    }
    const input = messages.find(message => message.id === currentInputId)
    if (!input) throw new Error('work_input_unavailable: Preparation requires the committed current input')
    const temporary = input.inputSource?.kind === 'resident_event'
    if (command.target.kind === 'create' && !isDirectUserSource(input.inputSource)) throw new Error('context_event_scope_required: Internal continuations retain their original work; only a direct user input defines a new goal')
    if (command.temporary && !temporary) throw new Error('context_temporary_event_required: Only original Host events may select temporarily')
    const fingerprint = preparationHash({ command, inputId: input.id })
    const previous = this.db.prepare('SELECT fingerprint FROM context_commands WHERE session_id=? AND id=?').get(this.sessionId, command.requestId) as { fingerprint: string } | undefined
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('context_command_conflict: Preparation identity already has different requirements or input')
      this.retainToolReceipt(operationId, super.get(false), command.requestId)
      return { ...super.get(false), preparation: this.workPreparation(command.requestId) }
    }
    const projectId = input.projectScope ? input.projectScope.projectId ?? undefined : currentProjectId
    const pointer = this.pointer(), now = Date.now()
    const branchIds = command.target.kind === 'create' ? [randomUUID()] : command.target.kind === 'select' ? command.target.branchIds
      : temporary && pointer.temporary?.inputId === input.id ? pointer.temporary.branchIds : pointer.selectedBranchIds ?? []
    if (!branchIds.length) throw new Error('context_branch_required: Select work or create an independent goal')
    if (command.continuationOf && (continuation?.id !== command.continuationOf || preparationHash([...branchIds].sort()) !== preparationHash([...continuation.branchIds].sort()))) {
      throw new Error('work_continuation_conflict: Prepare the original execution branches using its Host grant')
    }
    const branches = branchIds.map(id => command.target.kind === 'create'
      ? { id, sessionId: this.sessionId, label: command.target.label, projectId, revision: 1, state: 'active' as const, createdAt: now, updatedAt: now,
        origin: { sessionId: this.sessionId, messageId: input.id, contentHash: this.memory.readSource({ sessionId: this.sessionId, messageId: input.id }).contentHash } }
      : this.branch(id))
    if (branches.some(branch => branch.projectId !== projectId)) throw new Error('context_project_conflict: Selected work belongs to another project')
    const changes = command.requirements ?? (isDirectUserSource(input.inputSource) ? [{ scope: 'input' as const }] : [])
    if (branchIds.length > 1 && changes.some(change => !change.branchId || !change.source?.quote && !change.source?.range)) {
      throw new Error('context_range_required: Attribute exact clauses to their work in mixed inputs')
    }
    const resolved = changes.map(change => {
      const branchId = change.branchId ?? branchIds[0]!
      if (!branchIds.includes(branchId)) throw new Error(command.target.kind === 'create'
        ? 'context_attribution_conflict: For target=create, omit requirements.branchId; the Host assigns it. Keep every quoted requirement and its input/work scope when correcting this call.'
        : 'context_attribution_conflict: Requirement is outside selected work')
      const reference = change.source ?? { sessionId: this.sessionId, messageId: input.id }
      const source = this.memory.readSource(reference)
      if (!source.directUser) throw new Error('context_requirement_source: Requirements require original direct user evidence')
      if (source.projectId !== undefined && source.projectId !== projectId) throw new Error('context_project_conflict: Requirement belongs to another project')
      if (change.scope === 'input' && (reference.sessionId !== this.sessionId || reference.messageId !== input.id)) {
        throw new Error('work_input_conflict: One-time requirements must come from this current user input')
      }
      const range = this.resolveRange(reference, source.content), { quote: _quote, ...ref } = reference
      if (change.scope === 'work' && (!change.workScopeQuote || !source.content.slice(range?.offset ?? 0, range?.end ?? source.content.length).includes(change.workScopeQuote))) {
        throw new Error('context_work_scope_required: Preserve this invocation in input scope unless its source clause explicitly defines the work or authorizes a lasting change. For work scope cite those exact words as workScopeQuote within source.quote/range. Today/this once/greeting overrides are input scope; keep other quoted requirements when correcting the call.')
      }
      const supersedes = (change.supersedes ?? []).map(old => {
        const original = this.memory.readSource(old), oldRange = this.resolveRange(old, original.content)
        return { ...old, range: oldRange, contentHash: original.contentHash, fullCharacters: original.content.length }
      })
      return { branchId, scope: change.scope, source: { ...ref, range, contentHash: source.contentHash }, workScopeQuote: change.workScopeQuote, supersedes }
    })
    const retained = [...this.preparationForInput(input.id)?.requirements.filter(requirement => branchIds.includes(requirement.branchId)
      && (requirement.scope !== 'input' || requirement.source.sessionId === this.sessionId && requirement.source.messageId === input.id)) ?? [],
      ...continuation?.requirements ?? []]
    const requirements = [...retained.filter(old => !resolved.some(change => change.branchId === old.branchId && change.scope === old.scope
      && change.source.sessionId === old.source.sessionId && change.source.messageId === old.source.messageId)), ...resolved.map(({ supersedes: _supersedes, ...change }) => change)]
    const generation = ((this.db.prepare(`SELECT MAX(json_extract(body,'$.generation')) AS generation FROM context_commands WHERE session_id=?`).get(this.sessionId) as { generation: number | null }).generation ?? 0) + 1
    const preparation: ResidentWorkPreparation = { id: command.requestId, inputId: input.id, generation, state: 'recorded', temporary, continuationOf: command.continuationOf,
      branchIds, branchRevisions: {}, requirements, requirementsHash: '', createdAt: now }
    this.db.transaction(() => {
      if (this.pointer().revision !== pointer.revision) throw new Error('work_generation_conflict: Foreground changed during preparation')
      for (const branch of branches) {
        if (command.target.kind !== 'create' && this.branch(branch.id).revision !== branch.revision) throw new Error('context_revision_conflict: Requirements changed during preparation')
        this.saveBranch(branch)
      }
      for (const change of resolved.filter(item => item.scope === 'work')) {
        const before = preparationHash(materialReferences(this.associations(change.branchId)).filter(ref => ref.role === 'requirement'))
        for (const original of change.supersedes) {
          const existing = this.associations(change.branchId).filter(ref => ref.role === 'requirement' && ref.sessionId === original.sessionId
            && ref.messageId === original.messageId && (!original.range || !ref.range || ref.range.offset < original.range.end && ref.range.end > original.range.offset))
          if (!existing.length) throw new Error('context_revision_conflict: Superseded requirement is not part of this work')
          for (const old of existing) {
            if (old.contentHash !== original.contentHash) throw new Error('context_revision_conflict: Superseded source changed')
            this.saveAssociation(change.branchId, { ...old, active: false })
            if (original.range) {
              const range = old.range ?? { offset: 0, end: original.fullCharacters }
              if (range.offset < original.range.offset) this.saveAssociation(change.branchId, { ...old, range: { offset: range.offset, end: original.range.offset } })
              if (range.end > original.range.end) this.saveAssociation(change.branchId, { ...old, range: { offset: original.range.end, end: range.end } })
            }
          }
        }
        const association: Association = { ...change.source, role: 'requirement', active: true, branchRevision: this.branch(change.branchId).revision }
        this.saveAssociation(change.branchId, association)
        const after = preparationHash(materialReferences(this.associations(change.branchId)).filter(ref => ref.role === 'requirement'))
        if (before !== after) this.saveBranch({ ...this.branch(change.branchId), revision: this.branch(change.branchId).revision + 1 })
      }
      preparation.branchRevisions = Object.fromEntries(branchIds.map(id => [id, this.branch(id).revision]))
      preparation.requirementsHash = preparationHash({ requirements, branchRevisions: preparation.branchRevisions })
      this.db.prepare('INSERT INTO context_commands(session_id,id,fingerprint,result_id,body) VALUES(?,?,?,?,?)')
        .run(this.sessionId, preparation.id, fingerprint, preparation.id, JSON.stringify(preparation))
      if (!temporary) this.savePointer({ ...pointer, preparationId: preparation.id, revision: pointer.revision + 1 })
      this.retainToolReceipt(operationId, super.get(false), preparation.id)
    })()
    return { ...super.get(false), preparation }
  }
  protected publishPreparation(preparation: ResidentWorkPreparation, dependencies: ResidentDependencies): ResidentWorkPreparation {
    const latest = this.preparationForInput(preparation.inputId)
    if (latest?.generation !== preparation.generation || latest.state === 'superseded') throw new Error('work_generation_conflict: Preparation was superseded')
    if (!Object.entries(preparation.branchRevisions).every(([id, revision]) => this.branch(id).revision === revision)) throw new Error('context_revision_conflict: Prepared requirements changed')
    const ready: ResidentWorkPreparation = { ...preparation, state: 'ready', error: undefined,
      materialsHash: preparationHash({ dependencies, requirementsHash: preparation.requirementsHash }) }
    this.savePreparation(ready)
    if (!ready.temporary) {
      const pointer = this.pointer(), branch = this.branch(ready.branchIds[0]!)
      this.savePointer({ ...pointer, preparationId: ready.id, selectedBranchIds: ready.branchIds, selectedForInput: ready.inputId,
        focus: { label: branch.label, topicId: branch.id, projectId: branch.projectId, anchors: [] } })
    }
    return ready
  }
  protected failPreparation(preparation: ResidentWorkPreparation, error: unknown): void {
    const latest = this.preparationForInput(preparation.inputId)
    if (latest?.generation === preparation.generation) this.savePreparation({ ...preparation, state: 'blocked', error: error instanceof Error ? error.message : String(error) })
  }
  directUserPreparation(id: string, inputId: string): ResidentWorkPreparation {
    const work = this.workPreparation(id)
    if (!work || work.inputId !== inputId || work.state !== 'ready' || work.temporary
      || !Object.entries(work.branchRevisions).every(([branch, revision]) => this.branch(branch).revision === revision)) {
      throw new Error('work_not_prepared: Direct user dispatch needs current, scoped material preparation')
    }
    const source = this.memory.readSource({ sessionId: this.sessionId, messageId: inputId })
    if (!source.directUser) throw new Error('work_input_conflict: Direct user preparation cannot come from an internal event')
    return work
  }
}
