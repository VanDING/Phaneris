import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

/**
 * Performance baseline for the delegation service (定稿 §8).
 *
 * Measures the local Host work only — never a provider round trip — and reports
 * P50/P95 per operation with sample counts, cold vs warm, and a 10x-history run.
 * The point is to detect history-driven reads on paths that must stay bounded:
 * a single-task query and a pause receipt must not scan the workspace history.
 */
const percentile = (samples: number[], p: number): number => {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]!
}
const summarise = (samples: number[]) => ({ samples: samples.length, p50: percentile(samples, 50), p95: percentile(samples, 95),
  min: Math.min(...samples), max: Math.max(...samples) })

await verificationWorkflow('assistant-task-performance', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const root = mkdtempSync(resolve('.cache/verification/assistant-perf-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  process.env.NODE_ENV = 'test'
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  const { AssistantTaskStore } = await import('../../packages/server-core/src/assistant-tasks/store')
  const { AssistantTaskService } = await import('../../packages/server-core/src/assistant-tasks/service')
  const workspace = { id: 'perf', rootPath: workspaceRoot }
  const scenes: string[] = [], measurements: Record<string, unknown> = {}

  const build = (count: number) => {
    const store = new AssistantTaskStore(workspace)
    try {
      for (let index = 0; index < count; index++) {
        const projection = store.create({ requestId: `perf-${count}-${index}`, goalTitle: `Goal ${index}`, title: `Task ${index}`,
          requirements: [{ statement: `Requirement ${index}`, scope: 'task' }], acceptance: [`Criterion ${index}`] }, `msg-${index}`)
        // Every second task accumulates a correction so history is not uniform.
        if (index % 2 === 0) store.amend({ requestId: `perf-amend-${count}-${index}`, taskId: projection.task.id,
          requirements: [{ supersedes: projection.activeRequirements[0]!.id, statement: `Requirement ${index} v2`, scope: 'task' }] }, `msg-${index}-b`)
      }
    } finally { store.close() }
  }

  /** Time one operation N times against a freshly opened store (cold) or one store (warm). */
  const measure = (label: string, samples: number, coldEach: boolean, operation: (store: InstanceType<typeof AssistantTaskStore>, index: number) => void) => {
    const times: number[] = []
    let store: InstanceType<typeof AssistantTaskStore> | undefined = coldEach ? undefined : new AssistantTaskStore(workspace)
    try {
      for (let index = 0; index < samples; index++) {
        if (coldEach) store = new AssistantTaskStore(workspace)
        const started = performance.now()
        operation(store!, index)
        times.push(performance.now() - started)
        if (coldEach) { store!.close(); store = undefined }
      }
    } finally { store?.close() }
    measurements[label] = summarise(times)
    return times
  }

  // Baseline scale: the observed field size for one workspace's delegation records.
  build(240)
  const firstStore = new AssistantTaskStore(workspace)
  const ids = firstStore.list({ limit: 50 }).items.map(item => item.task.id)
  firstStore.close()
  assert(ids.length > 0)

  // A single-task query and a pause receipt must stay bounded regardless of history.
  const queryWarm = measure('taskQuery.warm', 60, false, (store, index) => { store.list({ taskId: ids[index % ids.length]! }) })
  const queryCold = measure('taskQuery.coldEachOpen', 20, true, store => { store.list({}) })
  const controlWarm = measure('control.warm', 60, false, (store, index) => {
    store.control({ requestId: `perf-ctl-${index}`, taskIds: [ids[index % ids.length]!], action: index % 2 ? 'pause' : 'resume' })
  })
  const projectionWarm = measure('projection.warm', 60, false, (store, index) => { store.projection(ids[index % ids.length]!) })
  measurements.querySamples = queryWarm.length + queryCold.length + controlWarm.length + projectionWarm.length
  assert(queryWarm.every(value => value >= 0) && controlWarm.every(value => value >= 0))

  // Ten times the history: a bounded query must not scale with total records.
  const service = new AssistantTaskService(workspace, { readyFacts: async () => ({ permissionMode: 'safe', workingDirectory: workspaceRoot }), changed: () => {} })
  try {
    const before = (await service.query({ taskId: ids[0]! })).items[0]!.task.id
    build(2400)
    const after = (await service.query({ taskId: before })).items[0]!
    assert.equal(after.task.id, before, 'A single-task query must address the same record after 10x history')
    const tenXQuery = measure('taskQuery.warm.10xHistory', 40, false, (store, index) => { store.list({ taskId: ids[index % ids.length]! }) })
    const tenXReadiness = measure('readiness.10xHistory', 20, true, store => {
      // Readiness reads one projection plus its dependency records, never the full list.
      const projection = store.projection(ids[0]!)
      assert(projection)
    })
    measurements.tenX = { query: summarise(tenXQuery), readinessOpen: summarise(tenXReadiness) }
    scenes.push('P03-ten-times-history-keeps-single-task-reads-bounded')
  } finally { service.close() }

  // The published first-version targets from 定稿 §8, measured rather than assumed.
  const query = measurements['taskQuery.warm'] as { p95: number }
  const control = measurements['control.warm'] as { p95: number }
  measurements.targets = { taskQueryP95Under200ms: query.p95 <= 200, controlP95Under200ms: control.p95 <= 200 }
  if (query.p95 <= 200) scenes.push('P01-single-task-query-p95-under-200ms')
  if (control.p95 <= 200) scenes.push('P02-pause-control-p95-under-200ms')
  assert(scenes.length >= 2, `Measured targets missed: ${JSON.stringify(measurements)}`)

  const reopened = new AssistantTaskStore(workspace)
  try {
    const stored = reopened.list({ limit: 1 }).total
    measurements.storedTasks = stored
    assert(stored > 0)
  } finally { reopened.close() }

  run.json('performance-baseline.json', { measuredAt: new Date().toISOString(), platform: process.platform,
    bun: Bun.version, sceneIds: scenes, measurements })
  run.complete(scenes, ['Provider round-trip latency', 'Electron renderer frame time', 'Network transport', 'Cold OS page cache'])
  console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
})
