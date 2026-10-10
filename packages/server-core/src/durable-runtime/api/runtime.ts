import type { RuntimeEvent } from '@phaneris/shared/durable-runtime'
import { DurableRuntimeCoordinator } from '../coordinator.js'
import type { ProjectionParityObservation } from '../store.js'
import { RuntimeHost } from '../execution/host.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { withinDeadline } from '../execution/deadline.js'

/** Capability views over one authority; no view exposes the SQLite Store. */
export function createDurableRuntime(options: { shutdownDeadlineMs?: number } = {}) {
  const kernel = new DurableRuntimeCoordinator()
  let closed = false
  let draining = false
  let closing: Promise<void> | undefined
  const deadlineMs = options.shutdownDeadlineMs ?? 5000
  const auxiliaries = new Map<Promise<unknown>, (() => void) | undefined>()
  const trackAuxiliary = <T>(invoke: () => Promise<T>, cancel?: () => void): Promise<T> => {
    if (closed || draining) return Promise.reject(new Error('Durable Runtime auxiliary admission is closed'))
    const pending = Promise.resolve().then(invoke)
    auxiliaries.set(pending, cancel)
    return pending.finally(() => auxiliaries.delete(pending))
  }
  const retainAuxiliary = (): (() => void) => {
    if (closed || draining) throw new Error('Durable Runtime auxiliary admission is closed')
    const pending = Promise.withResolvers<void>()
    auxiliaries.set(pending.promise, undefined)
    return () => { auxiliaries.delete(pending.promise); pending.resolve() }
  }
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined
  const guarded = <T extends (...args: never[]) => unknown>(fn: T): T => ((...args: Parameters<T>) => {
    if (closed) throw new Error('Durable Runtime is closed')
    return fn(...args)
  }) as T
  const bind = <K extends keyof DurableRuntimeCoordinator>(key: K): DurableRuntimeCoordinator[K] =>
    guarded((kernel[key] as (...args: never[]) => unknown).bind(kernel)) as DurableRuntimeCoordinator[K]
  const admission = <T extends (...args: never[]) => unknown>(fn: T): T => guarded(((...args: Parameters<T>) => {
    if (draining) throw new Error('Durable Runtime admission is closed')
    return fn(...args)
  }) as T)
  const commands = Object.freeze({
    acceptRun: guarded((...args: Parameters<DurableRuntimeCoordinator['acceptRun']>) => {
      if (draining) throw new Error('Durable Runtime admission is closed')
      return kernel.acceptRun(...args)
    }), recordUserInputAdmission: admission(bind('recordUserInputAdmission')),
    commitAdditionalUserMessage: bind('commitAdditionalUserMessage'), commitAssistantMessage: bind('commitAssistantMessage'),
    completeRun: bind('completeRun'),
  })
  const effects = Object.freeze({
    trackAuxiliary, retainAuxiliary,
    boundaryFor: (workspace: string) => ({
      prepare: admission(kernel.boundaryFor(workspace).prepare), commitOutcome: guarded(kernel.boundaryFor(workspace).commitOutcome) }),
    modelBoundaryFor: (workspace: string) => ({ prepare: admission(kernel.modelBoundaryFor(workspace).prepare),
      commitOutcome: guarded(kernel.modelBoundaryFor(workspace).commitOutcome),
      recordObservation: guarded(kernel.modelBoundaryFor(workspace).recordObservation!) }),
    prepareTool: admission(bind('prepareTool')), commitToolOutcome: bind('commitToolOutcome'),
    prepareModel: admission(bind('prepareModel')), commitModelOutcome: bind('commitModelOutcome'), recordSdkObservation: bind('recordSdkObservation'),
  })
  const queries = Object.freeze({
    getCanonicalSessionProjection: bind('getCanonicalSessionProjection'), getCanonicalModelContext: bind('getCanonicalModelContext'),
    events: guarded((workspace: string, options: { sessionId?: string; operationId?: string; afterSeq?: number; limit?: number } = {}) =>
      options.limit !== undefined ? kernel.storeFor(workspace).listEvents(options) : kernel.storeFor(workspace).listAllEvents(options)),
    operations: guarded((workspace: string, sessionId?: string) => kernel.storeFor(workspace).listOperations(sessionId)),
    usage: guarded((workspace: string, options: { sessionId?: string; operationId?: string } = {}) => kernel.storeFor(workspace).listUsage(options)),
    unsettledTools: guarded((workspace: string, runOperationId?: string, sessionId?: string) => kernel.storeFor(workspace).listUnsettledToolOperations(runOperationId, sessionId)),
    decisionEvents: guarded((workspace: string, sessionId: string) => kernel.storeFor(workspace).listDecisionEvents(sessionId)),
  })
  const evidence = Object.freeze({
    getRecoveryEvidence: bind('getRecoveryEvidence'), reconcileTool: bind('reconcileTool'), reconcileModel: bind('reconcileModel'),
    queryAndReconcileTool: bind('queryAndReconcileTool'), registerReconciliationAdapter: bind('registerReconciliationAdapter'),
    decisionRecordingSince: guarded((workspace: string, since: number) => kernel.storeFor(workspace).decisionRecordingSince(since)),
    deleteDecisionEvidence: guarded((workspace: string, sessionId: string) => kernel.storeFor(workspace).deleteDecisionEvidence(sessionId)),
    recordProjectionParity: guarded((workspace: string, observation: ProjectionParityObservation) => kernel.storeFor(workspace).recordProjectionParity(observation)),
    // Extension facts cannot synthesize dispatch, outcome, usage or terminal evidence.
    appendExternalFacts: guarded((workspace: string, events: RuntimeEvent[]) => {
      for (const event of events) {
        if (!['task_fact_committed', 'decision_observed', 'legacy_context_imported'].includes(event.type) || event.partial
          || (event.type !== 'legacy_context_imported' && event.modelVisible)) throw new Error('Invalid external Runtime fact')
        if (event.type === 'legacy_context_imported') {
          const payload = event.payload as { provenance?: string; dispatchEvidence?: boolean }
          if (payload.provenance !== 'legacy_cache_unverified' || payload.dispatchEvidence !== false) throw new Error('Legacy facts must declare unverified provenance')
        }
      }
      return kernel.storeFor(workspace).appendEvents(events)
    }),
  })
  const execution = new RuntimeHost(commands, queries, effects, deadlineMs)
  const maintain = (workspace: string) => {
    const day = new Date().toISOString().slice(0, 10)
    const backup = join(workspace, 'runtime', 'backups', `runtime-${day}.db`)
    const fresh = !existsSync(backup)
    if (fresh) kernel.backupDatabase(workspace, backup)
    kernel.maintainDatabase(workspace, { projectionRetentionMs: 30 * 24 * 60 * 60 * 1000, vacuum: fresh && new Date().getUTCDay() === 0 })
  }
  const admin = Object.freeze({
    checkDatabaseIntegrity: bind('checkDatabaseIntegrity'), backupDatabase: bind('backupDatabase'),
    maintainDatabase: admission(bind('maintainDatabase')),
    restoreDatabase: admission((...args: Parameters<DurableRuntimeCoordinator['restoreDatabase']>) => {
      if (execution.hasActiveExecutions(args[0]) || auxiliaries.size) throw new Error('Drain Runtime execution before database restore')
      const result = kernel.restoreDatabase(...args)
      execution.invalidateRestoredWorkspace(args[0])
      return result
    }), recoverWorkspace: admission(bind('recoverWorkspace')),
    start: admission((workspaces: string[], onMaintenanceError: (workspace: string, error: unknown) => void) => {
      const reports = workspaces.map(workspace => {
        const integrity = kernel.checkDatabaseIntegrity(workspace)
        if (!integrity.ok) throw new Error(`Durable Runtime integrity failed: ${integrity.messages.join('; ')}`)
        try { maintain(workspace) } catch (error) { onMaintenanceError(workspace, error) }
        return kernel.recoverWorkspace(workspace)
      })
      if (!maintenanceTimer) {
        maintenanceTimer = setInterval(() => { for (const workspace of workspaces) try { maintain(workspace) } catch (error) { onMaintenanceError(workspace, error) } }, 6 * 60 * 60 * 1000)
        maintenanceTimer.unref()
      }
      return reports
    }),
  })
  const close = () => closing ??= (async () => {
    draining = true
    if (maintenanceTimer) clearInterval(maintenanceTimer)
    for (const cancel of auxiliaries.values()) try { cancel?.() } catch { /* Drain the remaining effects even if cancellation fails. */ }
    await Promise.all([execution.shutdown(), withinDeadline(Promise.allSettled([...auxiliaries.keys()]), deadlineMs)])
    closed = true
    kernel.closeAll()
  })()
  return Object.freeze({ commands, effects, queries, evidence, admin, execution, close })
}

export type DurableRuntime = ReturnType<typeof createDurableRuntime>
