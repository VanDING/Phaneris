import type { DurableRuntime } from '../durable-runtime/index.js'

export class TaskRuntimeFacts {
  constructor(private readonly runtime: DurableRuntime) {}

  /**
   * Commit one TaskRunner state transition before updating its JSONL/file
   * compatibility projections. The ordinal is owned by the task state machine
   * and makes a replay of the same transition idempotent.
   */
  commitTaskRunFact(input: {
    workspaceRootPath: string
    sessionId: string
    taskSlug: string
    runId: string
    ordinal: number
    entry: import('@phaneris/shared/tasks').RunLogEntry
  }): number {
    const operationId = `taskrun:${input.taskSlug}:${input.runId}`
    const runtime = this.runtime
    if (!runtime.queries.operations(input.workspaceRootPath).find(state => state.operationId === operationId)) {
      if (input.entry.kind !== 'run-started') {
        throw new Error(`Canonical task run ${input.taskSlug}:${input.runId} has no run-started fact`)
      }
      runtime.commands.acceptRun({
        workspaceRootPath: input.workspaceRootPath,
        sessionId: input.sessionId,
        turnId: operationId,
        operationId,
        userMessageId: `${operationId}:definition`,
        userMessage: `Task run ${input.taskSlug}/${input.runId}`,
        kind: 'task_run',
        modelVisible: false,
        acceptedAt: Date.parse(input.entry.t) || Date.now(),
      })
    }
    const createdAt = Date.parse(input.entry.t) || Date.now()
    const [seq] = runtime.evidence.appendExternalFacts(input.workspaceRootPath, [{
      eventId: `${operationId}:fact:${input.ordinal}`,
      sessionId: input.sessionId,
      turnId: operationId,
      operationId,
      type: 'task_fact_committed',
      schemaVersion: 1,
      modelVisible: false,
      partial: false,
      payload: {
        taskSlug: input.taskSlug,
        runId: input.runId,
        ordinal: input.ordinal,
        entry: input.entry,
      },
      createdAt,
    }])
    if (input.entry.kind === 'run-completed' || input.entry.kind === 'run-failed' || input.entry.kind === 'run-stopped') {
      runtime.commands.completeRun(
        input.workspaceRootPath,
        operationId,
        input.entry.kind === 'run-completed' ? 'complete' : input.entry.kind === 'run-stopped' ? 'interrupted' : 'error',
      )
    }
    return seq ?? 0
  }

  /** Replay canonical TaskRunner facts in their committed order. */
  listTaskRunFacts(
    workspaceRootPath: string,
    taskSlug: string,
    runId: string,
  ): import('@phaneris/shared/tasks').RunLogEntry[] {
    const runtime = this.runtime
    const facts: Array<{ ordinal: number; entry: import('@phaneris/shared/tasks').RunLogEntry }> = []
    let afterSeq = 0
    while (true) {
      const batch = runtime.queries.events(workspaceRootPath, { afterSeq, limit: 10_000 })
      if (batch.length === 0) break
      for (const event of batch) {
        if (event.type !== 'task_fact_committed') continue
        const payload = event.payload as {
          taskSlug?: string
          runId?: string
          ordinal?: number
          entry?: import('@phaneris/shared/tasks').RunLogEntry
        }
        if (payload.taskSlug === taskSlug && payload.runId === runId && payload.entry && typeof payload.ordinal === 'number') {
          facts.push({ ordinal: payload.ordinal, entry: payload.entry })
        }
      }
      afterSeq = batch.at(-1)?.seq ?? afterSeq
      if (batch.length < 10_000) break
    }
    return facts.sort((a, b) => a.ordinal - b.ordinal).map(fact => fact.entry)
  }

}
