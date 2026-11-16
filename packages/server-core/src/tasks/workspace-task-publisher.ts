import { randomUUID } from 'node:crypto'
import { loadProjectById } from '@phaneris/shared/projects'
import { publicationHash, publicationSpecHash, currentSpecHash, readPublicationRecords, writePublicationRecord, encodePreparedPlanning, decodePreparedPlanning, withPublicationWriter, type PublicationRecord, type PreparedTaskPlanning } from './publication-journal'
import { listTaskSlugs, parseTaskSpec, saveTaskSpec, uniqueTaskSlug, type TaskSpec } from '@phaneris/shared/tasks'
import { loadWorkspaceSources } from '@phaneris/shared/sources'
import { loadAllSkills } from '@phaneris/shared/skills'
import type { CreateTaskInput } from '@phaneris/session-tools-core'
import type { TaskPlanningInput } from '@phaneris/shared/protocol'
import type { PlanningUpdate } from '../planning/workspace-planning'
import type { ISessionManager } from '../handlers/session-manager-interface'
import { finishTaskOrchestrator, taskSessionOptions, type CreateTaskFromSpecResult } from './create-task'

export type TaskPublicationTarget = { kind: 'fresh' } | { kind: 'attach' | 'draft'; sessionId: string }
export type { PreparedTaskPlanning } from './publication-journal'

interface PublicationHost extends Pick<ISessionManager, 'waitForInit' | 'getSessions' | 'getSessionWorkspaceId' |
  'createSession' | 'bindExistingSessionToTask' | 'adoptGeneratedTaskOrchestrator' | 'applyTaskLabel' | 'setSessionSources'> {
  createTaskPublicationSession(workspaceId: string, options: ReturnType<typeof taskSessionOptions>, publicationId: string): ReturnType<ISessionManager['createSession']>
  findTaskPublicationSession(workspaceId: string, publicationId: string): ReturnType<ISessionManager['getSessions']>[number] | undefined
  readTaskPublicationSession(workspaceId: string, sessionId: string): Record<string, unknown> | undefined
  flushSession(sessionId: string): Promise<void>
  prepareTaskPublicationPlanning(workspaceId: string, sessionId: string | undefined, patch: PlanningUpdate): PreparedTaskPlanning
  applyTaskPublicationPlanning(sessionId: string, planning: PreparedTaskPlanning): Promise<void>
}

/** The workspace owns allocation, complete preflight, binding and setup order. */
export function createWorkspaceTaskPublisher(workspaceId: string, workspaceRoot: string, host: PublicationHost) {
  let tail = Promise.resolve()
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => withPublicationWriter(workspaceRoot, operation))
    tail = result.then(() => {}, () => {})
    return result
  }

  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  function assertSpecOwned(record: PublicationRecord): void {
    const current = currentSpecHash(workspaceRoot, record.spec.id)
    if (current !== record.specHash && !(record.stage === 'prepared' && current === record.previousSpecHash)) {
      throw new Error(`Task specification changed during publication ${record.id}; retained for recovery`)
    }
  }
  function assertTargetUnchanged(record: PublicationRecord): void {
    const id = record.sessionId ?? (record.resolvedTarget.kind !== 'fresh' ? record.resolvedTarget.sessionId : undefined)
    if (!id) return
    const live = host.getSessions(workspaceId).find(session => session.id === id)
    const disk = host.readTaskPublicationSession(workspaceId, id)
    if (!live || !disk) throw new Error(`Task publication target is missing: ${id}`)
    for (const [snapshot, baseline] of [[Object.fromEntries(Object.entries(live)), record.baseline], [disk, record.diskBaseline ?? record.baseline]]) for (const [field, desired] of Object.entries(record.desired)) {
      if (!same(snapshot[field], baseline[field]) && !same(snapshot[field], desired)) {
        throw new Error(`Task publication target changed (${field}); retained for recovery: ${id}`)
      }
    }
  }
  async function resume(record: PublicationRecord): Promise<CreateTaskFromSpecResult> {
    assertSpecOwned(record)
    if (record.stage === 'complete') return record.result!
    const checkpoint = (stage: PublicationRecord['stage']) => { record.stage = stage; writePublicationRecord(workspaceRoot, record) }
    if (record.stage === 'prepared') {
      assertTargetUnchanged(record)
      if (currentSpecHash(workspaceRoot, record.spec.id) !== record.specHash) saveTaskSpec(workspaceRoot, record.spec)
      checkpoint('spec_written')
    }
    if (record.stage === 'spec_written') {
      assertTargetUnchanged(record)
      const target = record.resolvedTarget, options = { ...taskSessionOptions(record.spec),
        ...(record.spec.sources?.length ? { enabledSourceSlugs: record.spec.sources } : {}) }
      if (target.kind === 'attach') {
        if (!await host.bindExistingSessionToTask(target.sessionId, record.spec.id, options)) throw new Error(`Task publication attach failed: ${target.sessionId}`)
        record.sessionId = target.sessionId
      } else if (target.kind === 'draft') {
        if (!await host.adoptGeneratedTaskOrchestrator(target.sessionId, record.spec.id, options)) throw new Error(`Task publication draft changed: ${target.sessionId}`)
        record.sessionId = target.sessionId
      } else record.sessionId = (await host.createTaskPublicationSession(workspaceId, options, record.id)).id
      assertSpecOwned(record); assertTargetUnchanged(record); checkpoint('bound')
    }
    if (record.stage === 'bound') {
      assertTargetUnchanged(record)
      const prepared = decodePreparedPlanning(record.prepared)
      if (prepared) await host.applyTaskPublicationPlanning(record.sessionId!, prepared)
      assertSpecOwned(record); assertTargetUnchanged(record); checkpoint('planned')
    }
    const retained: string[] = []
    const setup = await finishTaskOrchestrator({
      applyTaskLabel: id => host.applyTaskLabel(id),
      setSessionSources: async (id, sources) => {
        const live = host.getSessions(workspaceId).find(session => session.id === id)?.enabledSourceSlugs
        const disk = host.readTaskPublicationSession(workspaceId, id)?.enabledSourceSlugs
        const unchanged = (value: unknown, baseline: unknown) => same(value ?? [], baseline ?? []) || same(value ?? [], sources)
        if (!unchanged(live, record.baseline.enabledSourceSlugs) || !unchanged(disk, record.baseline.sourceSelectionOnDisk)) {
          retained.push('Source selection changed during publication; the current selection was retained.')
          return
        }
        await host.setSessionSources(id, sources)
      },
    }, record.sessionId!, record.spec)
    await host.flushSession(record.sessionId!)
    setup.warnings.push(...retained)
    assertSpecOwned(record)
    record.result = { slug: record.spec.id, orchestratorSessionId: record.sessionId!, ...setup }
    checkpoint('complete')
    return record.result
  }

  async function publish(spec: TaskSpec, target: TaskPublicationTarget, planning?: PlanningUpdate,
    source: 'rpc' | 'capture' = 'rpc', operationId?: string): Promise<CreateTaskFromSpecResult> {
    await host.waitForInit()
    const records = readPublicationRecords(workspaceRoot, workspaceId)
    const intentHash = publicationHash(JSON.stringify({ spec, target, planning }))
    const id = operationId ? publicationHash(source + ':' + operationId) : undefined
    const previous = id ? records.find(record => record.id === id)
      : source === 'rpc' ? records.findLast(record => record.source === source && record.intentHash === intentHash
        && (record.stage !== 'complete' || currentSpecHash(workspaceRoot, spec.id) === record.specHash
          && (record.resolvedTarget.kind === 'fresh' ? host.findTaskPublicationSession(workspaceId, record.id)
            : host.getSessions(workspaceId).some(session => session.id === record.sessionId)))) : undefined
    if (previous) {
      if (previous.intentHash !== intentHash) throw new Error('Task publication operationId was reused for a different intent')
      return resume(previous)
    }
    const sessionId = target.kind === 'fresh' ? undefined : target.sessionId
    const existing = sessionId ? host.getSessions(workspaceId).find(session => session.id === sessionId) : undefined
    const owner = sessionId ? host.getSessionWorkspaceId(sessionId) : undefined
    if (owner && owner !== workspaceId) throw new Error(`Session ${sessionId} does not belong to workspace ${workspaceId}`)
    if (target.kind === 'attach' && (!existing || existing.taskSlug && existing.taskSlug !== spec.id)) {
      throw new Error(`Cannot attach task "${spec.id}" to session ${sessionId}: session is missing or already bound to a different task.`)
    }
    if (spec.project && !loadProjectById(workspaceRoot, spec.project)) throw new Error(`Project ${spec.project} not found in workspace ${workspaceId}`)
    const canAdopt = target.kind === 'draft' && existing && (existing.taskSlug === spec.id || !existing.taskSlug && existing.taskDraft)
    const resolvedTarget: TaskPublicationTarget = target.kind === 'attach' || canAdopt ? target : { kind: 'fresh' }
    const plannedId = resolvedTarget.kind !== 'fresh' ? resolvedTarget.sessionId : undefined
    if (records.some(record => record.stage !== 'complete' && (record.spec.id === spec.id
      || plannedId && record.resolvedTarget.kind !== 'fresh' && record.resolvedTarget.sessionId === plannedId))) {
      throw new Error('An unfinished task publication owns this specification or target; resume that intent first')
    }
    const prepared = planning ? host.prepareTaskPublicationPlanning(workspaceId, plannedId, planning) : undefined
    const options = taskSessionOptions(spec)
    const desired = resolvedTarget.kind === 'fresh' ? {} : { name: spec.title, taskSlug: spec.id, taskDraft: false,
      ...(spec.project !== undefined ? { projectId: spec.project } : {}), ...(spec.cwd ? { workingDirectory: spec.cwd } : {}),
      ...(spec.defaults?.model ? { model: spec.defaults.model } : {}),
      ...(spec.defaults?.llmConnection && !(plannedId && host.readTaskPublicationSession(workspaceId, plannedId)?.connectionLocked) ? { llmConnection: spec.defaults.llmConnection } : {}),
      ...(spec.defaults?.permissionMode ? { permissionMode: spec.defaults.permissionMode } : {}) }
    Object.assign(desired, prepared?.patch, prepared?.statusId ? { sessionStatus: prepared.statusId } : {})
    const snapshot: Record<string, unknown> = existing ? Object.fromEntries(Object.entries(existing)) : { sessionStatus: options.sessionStatus }
    const baseline = { ...Object.fromEntries(Object.keys(desired).map(key => [key, snapshot[key] ?? null])),
      enabledSourceSlugs: existing?.enabledSourceSlugs ?? null,
      sourceSelectionOnDisk: plannedId ? host.readTaskPublicationSession(workspaceId, plannedId)?.enabledSourceSlugs ?? null : null }
    const disk = plannedId ? host.readTaskPublicationSession(workspaceId, plannedId) ?? {} : snapshot
    const diskBaseline = Object.fromEntries(Object.keys(desired).map(key => [key, disk[key] ?? null]))
    const record: PublicationRecord = { version: 1, id: id ?? randomUUID(), workspaceId, intentHash, source, createdAt: Date.now(),
      spec, target, resolvedTarget, prepared: encodePreparedPlanning(prepared), baseline, diskBaseline,
      desired: Object.fromEntries(Object.entries(desired).map(([key, value]) => [key, value ?? null])),
      previousSpecHash: currentSpecHash(workspaceRoot, spec.id), specHash: publicationSpecHash(spec), stage: 'prepared' }
    assertTargetUnchanged(record)
    writePublicationRecord(workspaceRoot, record)
    return resume(record)
  }

  return {
    async recover(): Promise<Array<{ id: string; error: string }>> {
      await host.waitForInit()
      if (!readPublicationRecords(workspaceRoot, workspaceId).some(record => record.stage !== 'complete')) return []
      return serialize(async () => {
        const failures: Array<{ id: string; error: string }> = []
        for (const record of readPublicationRecords(workspaceRoot, workspaceId).filter(record => record.stage !== 'complete')) {
          try { await resume(record) } catch (error) { failures.push({ id: record.id, error: String(error) }) }
        }
        return failures
      })
    },
    publish(input: { spec: TaskSpec; target: TaskPublicationTarget; planning?: TaskPlanningInput; operationId?: string }): Promise<CreateTaskFromSpecResult> {
      const planning = input.planning
      return serialize(() => publish(input.spec, input.target, planning && {
        ...('startAt' in planning ? { startAt: planning.startAt } : {}), ...('dueAt' in planning ? { dueAt: planning.dueAt } : {}),
        ...('progress' in planning ? { progress: planning.progress } : {}), ...('isMilestone' in planning ? { isMilestone: planning.isMilestone } : {}),
        ...('parentId' in planning ? { parentId: planning.parentId } : {}), ...('dependencyIds' in planning ? { dependencyIds: planning.dependencyIds } : {}),
        ...(planning.statusId ? { statusId: planning.statusId } : {}),
      }, 'rpc', input.operationId))
    },
    capture(input: CreateTaskInput, options?: { operationId?: string }): Promise<CreateTaskFromSpecResult> {
      return serialize(async () => {
        await host.waitForInit()
        const records = readPublicationRecords(workspaceRoot, workspaceId)
        const previous = options?.operationId && records.find(record => record.id === publicationHash('capture:' + options.operationId))
        const slug = previous ? previous.spec.id : uniqueTaskSlug(input.title, new Set([...listTaskSlugs(workspaceRoot), ...records.filter(record => record.stage !== 'complete').map(record => record.spec.id)]))
        const parsed = parseTaskSpec({
          id: slug, title: input.title, goal: input.description,
          ...(input.acceptanceCriteria ? { acceptance_criteria: input.acceptanceCriteria } : {}),
          ...(input.projectId ? { project: input.projectId } : {}), ...(input.workingDirectory ? { cwd: input.workingDirectory } : {}),
          ...(input.sources?.length ? { sources: input.sources } : {}), ...(input.skills?.length ? { skills: input.skills } : {}),
          ...(input.model || input.llmConnection ? { defaults: { ...(input.model ? { model: input.model } : {}), ...(input.llmConnection ? { llmConnection: input.llmConnection } : {}) } } : {}),
          nodes: [{ id: 'main', title: input.title, prompt: input.description }],
        })
        if (!parsed.success) throw new Error(`Invalid task spec: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
        const warnings: string[] = []
        if (input.sources?.length) {
          const available = new Set(loadWorkspaceSources(workspaceRoot).map(source => source.config.slug))
          const missing = input.sources.filter(source => !available.has(source))
          if (missing.length) warnings.push(`Unknown sources (kept in the spec, but they don't exist in this workspace): ${missing.join(', ')}`)
        }
        if (input.skills?.length) {
          const available = new Set(loadAllSkills(workspaceRoot).map(skill => skill.slug))
          const missing = input.skills.filter(skill => !available.has(skill))
          if (missing.length) warnings.push(`Unknown skills (kept in the spec, but they don't exist in this workspace): ${missing.join(', ')}`)
        }
        const result = await publish(parsed.data, { kind: 'fresh' }, {
          description: input.description, acceptanceCriteria: input.acceptanceCriteria, startAt: input.startAt, dueAt: input.dueAt,
          progress: input.progress, dependencyIds: input.dependencySessionIds, parentId: input.parentSessionId, isMilestone: input.isMilestone,
        }, 'capture', options?.operationId)
        return { ...result, warnings: [...warnings, ...result.warnings] }
      })
    },
  }
}
export type WorkspaceTaskPublisher = ReturnType<typeof createWorkspaceTaskPublisher>
