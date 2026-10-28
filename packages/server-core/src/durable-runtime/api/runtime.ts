import type { RuntimeEvent, DurableToolPrepareRequest, DurableToolOutcomeRequest, DurableModelPrepareRequest, DurableModelOutcomeRequest } from '@phaneris/shared/durable-runtime'
import { DurableRuntimeCoordinator } from '../coordinator.js'
import { RuntimeHost } from '../execution/host.js'
import { maintainDailyBackups } from '../daily-backups.js'
import { withinDeadline } from '../execution/deadline.js'
import { RuntimeReceiptJournal } from '../receipt-journal.js'
import { RuntimeDatabaseError } from '../store.js'
import { runDatabaseTask } from '../database-maintenance.js'

function isStorageFailure(error: unknown): boolean {
  const cause = (error instanceof RuntimeDatabaseError ? error.cause : error) as { name?: string; code?: string } | undefined
  return cause?.name === 'SQLiteError' || !!cause?.code?.startsWith('SQLITE_')
    || ['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EIO', 'EBUSY'].includes(cause?.code ?? '')
}

/** Capability views over one authority; no view exposes the SQLite Store. */
export function createDurableRuntime(options: { shutdownDeadlineMs?: number } = {}) {
  const kernel = new DurableRuntimeCoordinator()
  const receipts = new RuntimeReceiptJournal(async (workspace, receipt) => {
    if (receipt.kind === 'model') return kernel.commitModelOutcome(workspace, receipt.request)
    const execution = (receipt.request.result as { execution?: { status?: string } } | undefined)?.execution
    if (execution?.status === 'not_dispatched' && !kernel.storeFor(workspace).getToolRecoveryEvidence(receipt.request.operationId)) return
    return kernel.commitToolOutcome(workspace, receipt.request)
  })
  const commitToolOutcome: DurableRuntimeCoordinator['commitToolOutcome'] = async (workspace, request) => {
    try { return await kernel.commitToolOutcome(workspace, request) }
    catch (error) {
      if (!isStorageFailure(error)) throw error
      try { receipts.retain(workspace, { kind: 'tool', request }); return { deferred: true } }
      catch { throw error }
    }
  }
  const commitModelOutcome: DurableRuntimeCoordinator['commitModelOutcome'] = async (workspace, request) => {
    try { return await kernel.commitModelOutcome(workspace, request) }
    catch (error) {
      if (!isStorageFailure(error)) throw error
      try { receipts.retain(workspace, { kind: 'model', request }); return { deferred: true } }
      catch { throw error }
    }
  }
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
  let initialMaintenance: ReturnType<typeof setTimeout> | undefined
  const maintenanceJobs = new Map<string, Promise<void>>()
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
    completeRun: guarded((workspace: string, operationId: string, reason: Parameters<DurableRuntimeCoordinator['completeRun']>[2]) =>
      receipts.pending(workspace, undefined, operationId) ? { kind: 'parked' as const, operationId, reason } : kernel.completeRun(workspace, operationId, reason)),
    recoverInterruptedModel: bind('recoverInterruptedModel'),
  })
  const effects = Object.freeze({
    trackAuxiliary, retainAuxiliary,
    boundaryFor: (workspace: string) => ({
      prepare: admission(async (request: DurableToolPrepareRequest) => { await receipts.flush(workspace); return kernel.prepareTool(workspace, request) }),
      commitOutcome: guarded((request: DurableToolOutcomeRequest) => commitToolOutcome(workspace, request)) }),
    modelBoundaryFor: (workspace: string) => ({ prepare: admission(async (request: DurableModelPrepareRequest) => { await receipts.flush(workspace); return kernel.prepareModel(workspace, request) }),
      commitOutcome: guarded((request: DurableModelOutcomeRequest) => commitModelOutcome(workspace, request)),
      recordObservation: guarded((request: Parameters<DurableRuntimeCoordinator['recordSdkObservation']>[1]) => {
        try { return kernel.recordSdkObservation(workspace, request) }
        finally { if (request.event === 'outcome_receipt_retained') receipts.watch(workspace) }
      }) }),
    prepareTool: admission(async (...args: Parameters<DurableRuntimeCoordinator['prepareTool']>) => { await receipts.flush(args[0]); return kernel.prepareTool(...args) }),
    commitToolOutcome: guarded(commitToolOutcome),
    prepareModel: admission(async (...args: Parameters<DurableRuntimeCoordinator['prepareModel']>) => { await receipts.flush(args[0]); return kernel.prepareModel(...args) }),
    commitModelOutcome: guarded(commitModelOutcome), recordSdkObservation: bind('recordSdkObservation'),
  })
  const queries = Object.freeze({
    getCanonicalSessionProjection: bind('getCanonicalSessionProjection'), getCanonicalModelContext: bind('getCanonicalModelContext'),
    hasPendingReceipts: guarded((workspace: string, sessionId?: string) => receipts.pending(workspace, sessionId)),
    consumedInputIds: guarded((workspace: string, sessionId: string) => receipts.consumedInputIds(workspace, sessionId)),
    storageStatus: bind('storageStatus'),
    inputAdmission: bind('getInputAdmission'),
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
  const maintain = (workspace: string): Promise<void> => {
    const existing = maintenanceJobs.get(workspace)
    if (existing) return existing
    const controller = new AbortController()
    const pending = trackAuxiliary(async () => {
      const path = kernel.storeFor(workspace).databasePath
      if (path === ':memory:') return
      const fresh = await maintainDailyBackups(workspace, async destination => {
        await runDatabaseTask(path, { kind: 'backup', destination }, controller.signal)
      })
      await runDatabaseTask(path, { kind: 'maintain', projectionRetentionMs: 30 * 24 * 60 * 60 * 1000,
        vacuum: fresh && new Date().getUTCDay() === 0 && !execution.hasActiveExecutions(workspace) }, controller.signal)
    }, () => controller.abort()).finally(() => maintenanceJobs.delete(workspace))
    maintenanceJobs.set(workspace, pending)
    return pending
  }
  const admin = Object.freeze({
    checkDatabaseIntegrity: bind('checkDatabaseIntegrity'), backupDatabase: bind('backupDatabase'),
    maintainWorkspace: admission(maintain),
    maintainDatabase: admission(bind('maintainDatabase')),
    restoreDatabase: admission((...args: Parameters<DurableRuntimeCoordinator['restoreDatabase']>) => {
      if (execution.hasActiveExecutions(args[0]) || auxiliaries.size) throw new Error('Drain Runtime execution before database restore')
      const result = kernel.restoreDatabase(...args)
      execution.invalidateRestoredWorkspace(args[0])
      return result
    }), recoverWorkspace: admission(bind('recoverWorkspace')),
    start: admission(async (workspaces: string[], onMaintenanceError: (workspace: string, error: unknown) => void) => {
      const reports = []
      for (const workspace of workspaces) {
        try {
          const controller = new AbortController()
          await trackAuxiliary(() => kernel.initializeWorkspace(workspace, controller.signal), () => controller.abort())
          if (draining) throw new Error('Durable Runtime admission is closed')
          receipts.watch(workspace)
          const status = kernel.storageStatus(workspace)
          if (status.recovery) onMaintenanceError(workspace, new Error(`Runtime storage recovered automatically: ${status.recovery.reason}`))
          reports.push(kernel.recoverWorkspace(workspace))
        } catch (error) {
          onMaintenanceError(workspace, error)
          reports.push({ workspaceRootPath: workspace, recoveredAt: Date.now(), items: [] })
        }
      }
      if (!maintenanceTimer && !draining) {
        const run = () => { for (const workspace of workspaces) void maintain(workspace).catch(error => { if (!draining) onMaintenanceError(workspace, error) }) }
        initialMaintenance = setTimeout(run, 1000)
        initialMaintenance.unref()
        maintenanceTimer = setInterval(run, 6 * 60 * 60 * 1000)
        maintenanceTimer.unref()
      }
      return reports
    }),
  })
  const quiesce = () => {
    draining = true
    execution.closeAdmission()
  }
  const close = () => closing ??= (async () => {
    quiesce()
    if (maintenanceTimer) clearInterval(maintenanceTimer)
    if (initialMaintenance) clearTimeout(initialMaintenance)
    for (const cancel of auxiliaries.values()) try { cancel?.() } catch { /* Drain the remaining effects even if cancellation fails. */ }
    await Promise.all([execution.shutdown(), withinDeadline(Promise.allSettled([...auxiliaries.keys()]), deadlineMs)])
    await receipts.close()
    closed = true
    kernel.closeAll()
  })()
  return Object.freeze({ commands, effects, queries, evidence, admin, execution, quiesce, close })
}

export type DurableRuntime = ReturnType<typeof createDurableRuntime>
