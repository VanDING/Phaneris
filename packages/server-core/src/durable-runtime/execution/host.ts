import type { AcceptDurableRunInput, DurableRunSettlement, DurableRunStopReason } from '../coordinator.js'
import type { DurableSdkObservation } from '@phaneris/shared/durable-runtime'
import { withinDeadline } from './deadline.js'

export interface RuntimeScope { sessionId: string; workspaceRootPath: string }
export interface RuntimeExecutionHandle extends RuntimeScope { readonly generation: number }
export interface RuntimeDriverEvent { type: string }
/** A required durable commit failed; a projection observer cannot waive it. */
export class RuntimeCommitFailure extends Error {
  constructor(cause: unknown) { super('Required Runtime commit failed', { cause }); this.name = 'RuntimeCommitFailure' }
}
export interface RuntimeInputReceipt { disposition: 'saved' | 'started' | 'queued' | 'handled' | 'rejected' | 'unknown'; reason?: string }
export interface RuntimeDriver {
  run(input: unknown, context: RuntimeExecutionHandle & { operationId: string; turnId: string }): AsyncIterable<RuntimeDriverEvent>
  stop(reason: string): void
  dispose(): void | Promise<void>
  steer?(input: unknown): Promise<RuntimeInputReceipt>
}
export interface RuntimeQueueInput { message: string; messageId?: string; mergeWith?: object }
export interface RuntimeQueueBatch<T extends RuntimeQueueInput = RuntimeQueueInput> { first: T; entries: T[]; next: T }
export type RuntimeSettlement = DurableRunSettlement | { kind: 'commit_failed'; operationId?: string; error: unknown } | { kind: 'stale' } | { kind: 'deferred' } | { kind: 'idle'; reason: DurableRunStopReason }
export interface RuntimeSettled { handle: RuntimeExecutionHandle; result: RuntimeSettlement; reason: DurableRunStopReason; queueLength: number; drained: boolean }
export interface RuntimeObserver {
  state?(processing: boolean): void
  event?(event: RuntimeDriverEvent, handle: RuntimeExecutionHandle): void | 'defer' | Promise<void | 'defer'>
  settled?(event: RuntimeSettled): void | Promise<void>
  error?(error: unknown): void
}
export interface RuntimeSessionView {
  readonly isProcessing: boolean
  readonly generation: number
  readonly stopRequested: boolean
  readonly activeRunOperationId?: string
  readonly blocked: boolean
  readonly driver: RuntimeDriver | null
}
interface Slot {
  scope?: RuntimeScope; generation: number; processing: boolean; stopRequested: boolean
  activeRun?: string; turnId?: string; blocked: boolean; driver: RuntimeDriver | null
  creating?: Promise<RuntimeDriver>; driving?: Promise<RuntimeSettlement>; settling?: Promise<RuntimeSettlement>
  queue: RuntimeQueueInput[]; observers: Set<RuntimeObserver>
  dispatcher?: (batch: RuntimeQueueBatch) => void | Promise<void>
  view: RuntimeSessionView
  admission?: Promise<unknown>
  settledResult?: RuntimeSettlement
  stopTimer?: ReturnType<typeof setTimeout>
  interruption?: { promise: Promise<RuntimeSettlement>; resolve: (result: RuntimeSettlement) => void }
  queueScheduled?: boolean
  releasing?: boolean
  advanceQueueOnStop?: boolean
}
interface Commands {
  acceptRun(input: AcceptDurableRunInput): unknown
  completeRun(workspace: string, operationId: string, reason: DurableRunStopReason): DurableRunSettlement
  commitAdditionalUserMessage(input: { workspaceRootPath: string; sessionId: string; turnId: string; operationId: string; messageId: string; content: string; createdAt: number }): unknown
}
interface Queries {
  operations(workspace: string, sessionId?: string): Array<{ operationId: string; phase: string; kind: string }>
  events(workspace: string, options: { sessionId?: string; operationId?: string }): Array<{ type: string; payload: unknown }>
}

/** Sole foreground owner; product observers cannot change a committed conclusion. */
export class RuntimeHost {
  private readonly slots = new Map<string, Slot>()
  private readonly auxiliaryDrivers = new Set<RuntimeDriver>()
  private closing = false
  constructor(private readonly commands: Commands, private readonly queries: Queries,
    private readonly observations: { recordSdkObservation(workspace: string, observation: DurableSdkObservation): number },
    private readonly deadlineMs = 5000) {}
  private slot(sessionId: string): Slot {
    let slot = this.slots.get(sessionId)
    if (!slot) {
      if (this.closing) throw new Error('Runtime admission is closed')
      slot = { generation: 0, processing: false, stopRequested: false, blocked: false, driver: null, queue: [], observers: new Set(), view: undefined! }
      const s = slot
      slot.view = Object.freeze({
        get isProcessing() { return s.processing }, get generation() { return s.generation },
        get stopRequested() { return s.stopRequested }, get activeRunOperationId() { return s.activeRun },
        get blocked() { return s.blocked }, get driver() { return s.driver },
      })
      this.slots.set(sessionId, slot)
    }
    return slot
  }
  view(sessionId: string): RuntimeSessionView { return this.slot(sessionId).view }
  async admission<T>(sessionId: string, transition: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('Runtime admission is closed')
    const s = this.slot(sessionId), previous = s.admission
    const current = (async () => {
      await previous?.catch(() => undefined)
      await s.settling
      if (!s.processing) await s.driving
      if (this.closing || s.releasing) throw new Error('Runtime admission is closed')
      return transition()
    })()
    s.admission = current
    try { return await current } finally { if (s.admission === current) s.admission = undefined }
  }
  subscribe(sessionId: string, observer: RuntimeObserver): () => void {
    const s = this.slot(sessionId); s.observers.add(observer); return () => s.observers.delete(observer)
  }
  private report(s: Slot, error: unknown) { for (const o of [...s.observers]) try { o.error?.(error) } catch { /* Diagnostics are isolated. */ } }
  private processing(s: Slot, value: boolean) {
    if (s.processing === value) return
    s.processing = value
    for (const o of [...s.observers]) try { o.state?.(value) } catch (error) { this.report(s, error) }
  }
  begin(scope: RuntimeScope): RuntimeExecutionHandle {
    if (this.closing) throw new Error('Runtime admission is closed')
    const s = this.slot(scope.sessionId)
    if (s.scope && s.scope.workspaceRootPath !== scope.workspaceRootPath) throw new Error('Runtime session workspace scope mismatch')
    if (s.processing || s.driving || s.settling || s.blocked || s.activeRun || s.releasing) throw new Error('Runtime foreground slot is occupied or requires recovery')
    s.scope = { ...scope }; s.generation++; s.stopRequested = false; s.advanceQueueOnStop = true; s.settledResult = undefined; this.processing(s, true)
    return Object.freeze({ ...scope, generation: s.generation })
  }
  current(sessionId: string): RuntimeExecutionHandle | undefined {
    const s = this.slots.get(sessionId); return s?.scope ? Object.freeze({ ...s.scope, generation: s.generation }) : undefined
  }
  isCurrent(h: RuntimeExecutionHandle): boolean { const s = this.slots.get(h.sessionId); return !!s && s.generation === h.generation && s.scope?.workspaceRootPath === h.workspaceRootPath }
  accept(h: RuntimeExecutionHandle, input: { operationId: string; userMessageId: string; userMessage: string; turnId?: string }): void {
    if (!this.isCurrent(h)) throw new Error('Stale Runtime execution handle')
    const s = this.slot(h.sessionId)
    if (!s.processing || s.stopRequested || s.blocked || s.activeRun) throw new Error('Runtime foreground is not accepting a run')
    this.commands.acceptRun({ ...h, ...input, turnId: input.turnId ?? input.userMessageId })
    s.activeRun = input.operationId; s.turnId = input.turnId ?? input.userMessageId
  }
  async ensureDriver(sessionId: string, factory: () => Promise<RuntimeDriver>): Promise<RuntimeDriver> {
    if (this.closing) throw new Error('Runtime admission is closed')
    const s = this.slot(sessionId)
    if (s.creating) return s.creating
    if (s.driver) return s.driver
    const creating = factory().then(async driver => {
      if (this.closing || s.releasing || this.slots.get(sessionId) !== s) { await withinDeadline(Promise.resolve(driver.dispose()), this.deadlineMs); throw new Error('Runtime driver creation cancelled') }
      s.driver = driver; return driver
    }, async error => {
      const partial = s.driver; s.driver = null
      if (partial) await withinDeadline(Promise.resolve().then(() => partial.dispose()), this.deadlineMs).catch(disposeError => this.report(s, disposeError))
      throw error
    })
    s.creating = creating
    try { return await creating } finally { if (s.creating === creating) s.creating = undefined }
  }
  installDriver(sessionId: string, driver: RuntimeDriver): void {
    const s = this.slot(sessionId)
    if (this.closing || s.releasing) {
      void withinDeadline(Promise.resolve().then(() => driver.dispose()), this.deadlineMs).catch(error => this.report(s, error))
      throw new Error('Runtime admission is closed')
    }
    if (s.driver && s.driver !== driver) throw new Error('Dispose Runtime driver before replacement')
    s.driver = driver
  }
  async disposeDriver(sessionId: string): Promise<void> {
    const s = this.slot(sessionId), driver = s.driver; s.driver = null
    if (driver) await withinDeadline(Promise.resolve().then(() => driver.dispose()), this.deadlineMs)
  }
  retainDriver(driver: RuntimeDriver): () => Promise<void> {
    if (this.closing) throw new Error('Runtime driver admission is closed')
    this.auxiliaryDrivers.add(driver)
    return async () => {
      if (!this.auxiliaryDrivers.delete(driver)) return
      await withinDeadline(Promise.resolve().then(() => driver.dispose()), this.deadlineMs)
    }
  }
  requestStop(sessionId: string, reason = 'user_stop', options: { advanceQueue?: boolean } = {}): void {
    const s = this.slot(sessionId); s.stopRequested = true
    s.advanceQueueOnStop = options.advanceQueue ?? true
    try { s.driver?.stop(reason) } catch (error) { this.report(s, error) }
    const h = this.current(sessionId)
    if (!h || !s.processing || s.stopTimer) return
    s.stopTimer = setTimeout(() => {
      if (!this.isCurrent(h) || !s.processing || !s.stopRequested) return
      // A non-cooperative driver loses its slot before a replacement can start.
      const driver = s.driver; s.driver = null; s.driving = undefined
      void this.finish(h, 'timeout').then(result => s.interruption?.resolve(result))
      if (driver) void withinDeadline(Promise.resolve().then(() => driver.dispose()), this.deadlineMs).catch(error => this.report(s, error))
    }, this.deadlineMs)
    s.stopTimer.unref()
  }
  resetStop(sessionId: string): void { const s = this.slot(sessionId); if (!s.processing) s.stopRequested = false }
  enqueue<T extends RuntimeQueueInput>(sessionId: string, entry: T): void {
    if (this.closing) throw new Error('Runtime admission is closed')
    const s = this.slot(sessionId)
    if (!entry.messageId || !s.queue.some(item => item.messageId === entry.messageId)) s.queue.push(entry)
  }
  queued<T extends RuntimeQueueInput>(sessionId: string): readonly T[] { return this.slot(sessionId).queue.slice() as T[] }
  removeQueued(sessionId: string, entry: RuntimeQueueInput): void { const queue = this.slot(sessionId).queue, index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1) }
  amendQueued(sessionId: string, entry: RuntimeQueueInput, patch: { mergeWith?: object }): boolean {
    if (!this.slot(sessionId).queue.includes(entry)) return false
    Object.assign(entry, patch); return true
  }
  clearQueue(sessionId: string): void { this.slot(sessionId).queue.length = 0 }
  setQueueDispatcher<T extends RuntimeQueueInput>(sessionId: string, dispatch: (batch: RuntimeQueueBatch<T>) => void | Promise<void>): void { this.slot(sessionId).dispatcher = dispatch as (batch: RuntimeQueueBatch) => void | Promise<void> }
  resumeQueue(sessionId: string): void {
    const s = this.slot(sessionId)
    if (this.closing || s.releasing || s.processing || s.blocked || s.settling || s.activeRun || s.queueScheduled || !s.dispatcher || !s.queue.length) return
    s.queueScheduled = true
    setImmediate(() => {
      s.queueScheduled = false
      if (this.closing || s.releasing || s.processing || s.blocked || s.settling || s.activeRun || !s.queue.length) return
      if (s.admission) { void s.admission.catch(() => undefined).then(() => this.resumeQueue(sessionId)); return }
      const first = s.queue.shift()!, entries = [first]
      while (s.queue[0]?.mergeWith === entries.at(-1)) entries.push(s.queue.shift()!)
      const next = entries.length > 1 ? { ...first, message: entries.map(item => item.message).join('\n\n') } : first
      Promise.resolve().then(() => s.dispatcher!({ first, entries, next })).catch(error => this.report(s, error))
    })
  }
  async steer(sessionId: string, input: unknown, original: { messageId: string; content: string; createdAt: number }, queued?: RuntimeQueueInput): Promise<RuntimeInputReceipt> {
    const s = this.slot(sessionId), generation = s.generation, runId = s.activeRun
    if (!s.processing || s.stopRequested || s.blocked || !s.driver?.steer || !runId || !s.scope) return { disposition: 'rejected', reason: 'foreground_unavailable' }
    const observe = (event: string, data: Record<string, unknown>) => this.observations.recordSdkObservation(s.scope!.workspaceRootPath, {
      observationId: `${original.messageId}:${generation}:${event}`, sessionId, turnId: s.turnId, runOperationId: runId,
      event, capturedAt: Date.now(), data: { inputId: original.messageId, ...data },
    })
    observe('input_delivery_attempted', {})
    let receipt: RuntimeInputReceipt
    try { receipt = await s.driver.steer(input) }
    catch (error) { this.report(s, error); receipt = { disposition: 'unknown', reason: 'driver_delivery_failed_after_attempt' } }
    if (!receipt || !['saved', 'started', 'queued', 'handled', 'rejected', 'unknown'].includes(receipt.disposition)) {
      receipt = { disposition: 'unknown', reason: 'invalid_driver_receipt' }
    }
    if (s.generation !== generation || s.activeRun !== runId) {
      if (queued) this.removeQueued(sessionId, queued)
      return { disposition: 'unknown', reason: 'foreground_changed_during_delivery' }
    }
    try { observe('input_delivery_received', { disposition: receipt.disposition, reason: receipt.reason }) }
    catch (error) { this.report(s, error); receipt = { disposition: 'unknown', reason: 'delivery_receipt_not_committed' } }
    const accepted = ['started', 'queued', 'handled'].includes(receipt.disposition)
    if (accepted && runId && s.scope) try {
      this.commands.commitAdditionalUserMessage({ workspaceRootPath: s.scope.workspaceRootPath, sessionId,
        turnId: s.turnId ?? runId, operationId: runId, ...original })
    } catch (error) { this.report(s, error); receipt = { disposition: 'unknown', reason: 'delivered_input_commit_failed' } }
    if (queued && (accepted || receipt.disposition === 'unknown')) this.removeQueued(sessionId, queued)
    return receipt
  }
  recoverQueued<T extends RuntimeQueueInput>(scope: RuntimeScope, candidates: Array<T & { reception?: RuntimeInputReceipt }>): { queued: number; held: number } {
    this.recoverSession(scope)
    const events = this.queries.events(scope.workspaceRootPath, { sessionId: scope.sessionId })
    const committed = new Set(events.filter(event => event.type === 'user_message_committed').map(event => (event.payload as { messageId?: string }).messageId))
    const admitted = new Set(events.filter(event => event.type === 'user_input_admitted'
      && (event.payload as { deliveryTrackingVersion?: number }).deliveryTrackingVersion === 1).map(event => (event.payload as { messageId?: string }).messageId))
    const attempts = new Set<string>(), receipts = new Map<string, string>()
    for (const event of events.filter(event => event.type === 'sdk_observation')) {
      const payload = event.payload as { event?: string; data?: { inputId?: string; disposition?: string } }
      const id = payload.data?.inputId
      if (!id) continue
      if (payload.event === 'input_delivery_attempted') attempts.add(id)
      if (payload.event === 'input_delivery_received' && payload.data?.disposition) receipts.set(id, payload.data.disposition)
    }
    let queued = 0, held = 0
    for (const candidate of candidates) {
      const id = candidate.messageId
      if (!id || committed.has(id) || !admitted.has(id)
        || (attempts.has(id) && receipts.get(id) !== 'rejected')
        || (candidate.reception && !['saved', 'rejected'].includes(candidate.reception.disposition))) { held++; continue }
      this.enqueue(scope.sessionId, candidate); queued++
    }
    return { queued, held }
  }
  finish(h: RuntimeExecutionHandle, reason: DurableRunStopReason, options: { notify?: boolean; advanceQueue?: boolean } = {}): Promise<RuntimeSettlement> {
    if (!this.isCurrent(h)) return Promise.resolve({ kind: 'stale' })
    const s = this.slot(h.sessionId)
    const advanceQueue = options.advanceQueue ?? s.advanceQueueOnStop ?? true
    if (s.settling) return s.settling
    if (s.settledResult && s.settledResult.kind !== 'commit_failed') return Promise.resolve(s.settledResult)
    const settling = (async (): Promise<RuntimeSettlement> => {
      let result: RuntimeSettlement
      try {
        let finalReason = s.stopRequested && reason === 'complete' ? 'interrupted' : reason
        if (finalReason === 'complete' && s.activeRun) {
          const outcome = this.queries.events(h.workspaceRootPath, { operationId: s.activeRun }).findLast(event => event.type === 'model_outcome_committed')
          const stopReason = (outcome?.payload as { stopReason?: string } | undefined)?.stopReason
          if (['length', 'error', 'refusal'].includes(stopReason ?? '')) finalReason = 'error'
          if (stopReason === 'aborted') finalReason = 'interrupted'
        }
        result = s.activeRun ? this.commands.completeRun(h.workspaceRootPath, s.activeRun, finalReason) : { kind: 'idle', reason: finalReason === 'complete' ? 'error' : finalReason }
      }
      catch (error) { s.blocked = true; this.processing(s, false); this.report(s, error); return { kind: 'commit_failed', operationId: s.activeRun, error } }
      s.blocked = result.kind === 'parked' || result.kind === 'absent'
      if (!s.blocked) s.activeRun = undefined
      this.processing(s, false)
      if (s.stopTimer) { clearTimeout(s.stopTimer); s.stopTimer = undefined }
      const committedReason = result.kind === 'terminal' || result.kind === 'idle' ? result.reason : 'interrupted'
      const notification: RuntimeSettled = { handle: h, result, reason: committedReason, queueLength: s.queue.length, drained: !s.queue.length }
      if (options.notify !== false) for (const o of [...s.observers]) try {
        // Notifications are wake-ups after commit, never part of the ownership lock.
        const pending = o.settled?.(notification)
        if (pending) void Promise.resolve(pending).catch(error => this.report(s, error))
      } catch (error) { this.report(s, error) }
      s.stopRequested = false; s.settledResult = result; return result
    })()
    s.settling = settling
    return settling.finally(() => { if (s.settling === settling) s.settling = undefined; if (this.isCurrent(h) && advanceQueue && !s.blocked) this.resumeQueue(h.sessionId) })
  }
  drive(h: RuntimeExecutionHandle, driver: RuntimeDriver, input: unknown): Promise<RuntimeSettlement> {
    const s = this.slot(h.sessionId)
    if (!this.isCurrent(h) || !s.processing || !s.activeRun) return Promise.resolve({ kind: 'stale' })
    if (s.driving) throw new Error('Runtime driver is already consuming this foreground slot')
    const operationId = s.activeRun, turnId = s.turnId!
    let deferred = false
    const interruption = Promise.withResolvers<RuntimeSettlement>()
    s.interruption = interruption
    const driving = (async (): Promise<RuntimeSettlement> => {
      try {
        for await (const event of driver.run(input, { ...h, operationId, turnId })) {
          if (!this.isCurrent(h) || !s.processing) continue
          for (const o of [...s.observers]) try { if (await o.event?.(event, h) === 'defer') deferred = true } catch (error) {
            if (error instanceof RuntimeCommitFailure) throw error
            this.report(s, error)
          }
          if (event.type === 'complete') return deferred ? { kind: 'deferred' } : !s.processing ? { kind: 'stale' } : await this.finish(h, s.stopRequested ? 'interrupted' : 'complete')
        }
        return deferred ? { kind: 'deferred' } : !this.isCurrent(h) || !s.processing ? { kind: 'stale' } : await this.finish(h, 'interrupted')
      } catch (error) {
        this.report(s, error)
        if (error instanceof RuntimeCommitFailure) {
          // Keep the identity and queue held for repair; never publish success.
          try { driver.stop('runtime_commit_failure') } catch (stopError) { this.report(s, stopError) }
          s.blocked = true; this.processing(s, false)
          if (s.stopTimer) { clearTimeout(s.stopTimer); s.stopTimer = undefined }
          return { kind: 'commit_failed', operationId: s.activeRun, error }
        }
        const aborted = error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))
        return await this.finish(h, aborted || s.stopRequested ? 'interrupted' : 'error')
      }
    })()
    const ownedDriving = Promise.race([driving, interruption.promise]).finally(() => {
      if (s.driving === ownedDriving) s.driving = undefined
      if (s.interruption === interruption) s.interruption = undefined
    })
    s.driving = ownedDriving
    return ownedDriving
  }
  recoverSession(scope: RuntimeScope): void {
    this.bindSession(scope)
    const s = this.slot(scope.sessionId)
    if (s.processing) return
    const parked = this.queries.operations(scope.workspaceRootPath, scope.sessionId).find(state => state.kind === 'agent_turn' && state.phase === 'recovery_parked')
    if (parked) { s.activeRun = parked.operationId; s.blocked = true }
  }
  bindSession(scope: RuntimeScope): void {
    const s = this.slot(scope.sessionId)
    if (s.scope && s.scope.workspaceRootPath !== scope.workspaceRootPath) throw new Error('Runtime session workspace scope mismatch')
    s.scope = { ...scope }
  }
  async settleForReplacement(h: RuntimeExecutionHandle): Promise<RuntimeSettlement> {
    if (!this.isCurrent(h)) return { kind: 'stale' }
    const s = this.slot(h.sessionId)
    // Retry is admitted only after the old driver has drained and its facts settle.
    await withinDeadline<unknown>(s.driving ?? Promise.resolve(), this.deadlineMs)
    const result = await this.finish(h, 'interrupted', { notify: false, advanceQueue: false })
    if (result.kind === 'terminal' || result.kind === 'idle') {
      await this.disposeDriver(h.sessionId)
      s.driving = undefined
    }
    return result
  }
  refreshRecovery(sessionId: string): void {
    const s = this.slot(sessionId)
    if (!s.scope || s.processing) return
    const operations = this.queries.operations(s.scope.workspaceRootPath, sessionId)
    const active = operations.find(state => state.operationId === s.activeRun)
    if (s.activeRun && active?.phase === 'checkpoint') {
      const result = this.commands.completeRun(s.scope.workspaceRootPath, s.activeRun, 'interrupted')
      if (result.kind === 'terminal') { s.activeRun = undefined; s.blocked = false; s.settledResult = undefined }
    } else if (s.activeRun && !active) { s.activeRun = undefined; s.blocked = false; s.settledResult = undefined }
  }
  hasActiveExecutions(workspace?: string): boolean {
    return this.auxiliaryDrivers.size > 0 || [...this.slots.values()].some(s => (!workspace || s.scope?.workspaceRootPath === workspace)
      && !!(s.processing || s.activeRun || s.driver || s.queue.length || s.driving || s.creating || s.admission || s.settling))
  }
  invalidateRestoredWorkspace(workspace: string): void {
    if (this.hasActiveExecutions(workspace)) throw new Error('Drain Runtime execution before database restore')
    for (const s of this.slots.values()) if (s.scope?.workspaceRootPath === workspace) {
      s.generation++; s.settledResult = undefined; s.turnId = undefined; s.stopRequested = false; s.blocked = false
    }
  }
  async releaseSession(sessionId: string): Promise<void> {
    const s = this.slots.get(sessionId)
    if (!s) return
    s.releasing = true
    this.requestStop(sessionId)
    await withinDeadline(Promise.allSettled([s.driving, s.creating, s.admission, s.settling]), this.deadlineMs)
    if (s.scope && s.activeRun) await withinDeadline(this.finish({ ...s.scope, generation: s.generation }, 'interrupted', { notify: false, advanceQueue: false }), this.deadlineMs)
    await this.disposeDriver(sessionId)
    if (s.stopTimer) clearTimeout(s.stopTimer)
    s.generation++; s.observers.clear(); this.slots.delete(sessionId)
  }
  async shutdown(): Promise<void> {
    this.closing = true
    const drivers = [...this.auxiliaryDrivers]; this.auxiliaryDrivers.clear()
    for (const driver of drivers) try { driver.stop('shutdown') } catch { /* Continue draining other drivers. */ }
    await Promise.allSettled([
      ...[...this.slots.keys()].map(sessionId => this.releaseSession(sessionId)),
      ...drivers.map(driver => withinDeadline(Promise.resolve().then(() => driver.dispose()), this.deadlineMs)),
    ])
  }
}
