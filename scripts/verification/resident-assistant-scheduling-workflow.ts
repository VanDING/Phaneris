import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { createResidentTaskHost, taskModelResponse } from './fixtures/resident-task-host'

// TM11–TM14: written before replacing the serial admission gate.
await verificationWorkflow('resident-assistant-scheduling', async run => {
  const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  const intervals: Array<{ tag: string; start: number; end?: number }> = []
  const hold = (tag: string) => { const gate = Promise.withResolvers<void>(); gates.set(tag, gate); return gate }
  const fixture = await createResidentTaskHost(run.directory, async (body, request) => {
    const text = JSON.stringify(body.messages), main = text.includes('resident_assistant_role')
    const tag = !main ? text.match(/RUN_[A-Z0-9]+/)?.[0] : undefined
    const interval = tag ? { tag, start: Date.now(), end: undefined as number | undefined } : undefined
    if (interval) intervals.push(interval)
    if (tag && gates.has(tag)) await Promise.race([gates.get(tag)!.promise, new Promise<void>(resolve => {
      if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
    })])
    if (interval) interval.end = Date.now()
    return taskModelResponse(body, main ? 'SCHEDULING_ACK' : `RESULT_${tag ?? 'WORK'}`)
  })
  const { until } = fixture, scenes: string[] = [], snapshots: unknown[] = []
  const started = (tag: string) => intervals.some(item => item.tag === tag)
  const settled = async (id: string) => until(async () => (await fixture.work(id)).state === 'result_ready')
  const control = async (id: string, action: string, extra = {}) => fixture.control({ commandId: crypto.randomUUID(), id, expectedSeq: (await fixture.work(id)).seq, action, ...extra })
  try {
    // TM11 · Every admitted slot fills, and the request past the ceiling waits
    // for capacity instead of starting. The count comes from the Host's own
    // published capacity, so raising the default never silently stops testing it.
    const ceiling = (await fixture.page()).scheduling?.capacity
    assert.equal(typeof ceiling, 'number', 'the Host publishes its scheduling capacity')
    const batch = []
    for (let n = 0; n <= ceiling!; n++) { hold(`RUN_CAP${n}`); batch.push(await fixture.dispatch(`RUN_CAP${n}`)) }
    await until(() => intervals.filter(item => item.tag.startsWith('RUN_CAP')).length === ceiling!, 30_000)
    assert.equal(intervals.filter(item => item.tag.startsWith('RUN_CAP') && !item.end).length, ceiling)
    const queued = await fixture.work(batch[ceiling!]!.id)
    assert.equal(queued.state, 'accepted'); assert.equal(queued.waitingFor?.reason, 'capacity')
    assert.equal(queued.execution?.coverage, 'not_started')
    const page = await fixture.page()
    assert.equal(page.scheduling?.capacity, ceiling); assert.equal(page.scheduling?.occupied, ceiling)
    snapshots.push(page)
    gates.get('RUN_CAP0')!.resolve()
    await until(() => started(`RUN_CAP${ceiling}`))
    assert(!started(`RUN_CAP${ceiling! + 1}`))
    for (const gate of gates.values()) gate.resolve()
    await Promise.all(batch.map(item => settled(item.id)))
    const first = intervals.find(item => item.tag === 'RUN_CAP0')!
    assert(intervals.filter(item => item.tag.startsWith('RUN_CAP') && item.start < first.end! && item.end! > first.start).length >= ceiling!)
    scenes.push('TM11-every-admitted-slot-fills-and-the-next-request-waits-for-capacity')

    const paused = await fixture.dispatch('RUN_PAUSED', { startPaused: true })
    assert.equal(paused.state, 'paused'); assert(!started('RUN_PAUSED'))
    await fixture.restart()
    assert.equal((await fixture.work(paused.id)).state, 'paused'); assert(!started('RUN_PAUSED'))
    await control(paused.id, 'resume'); await settled(paused.id)
    scenes.push('TM10-planned-pause-survives-restart-and-resumes-original-input')

    const cwd = join(run.directory, 'shared-files'); mkdirSync(cwd)
    const writer = { permissionMode: 'allow-all' as const, thinkingLevel: 'off' as const, workingDirectory: cwd }
    hold('RUN_WRITEA'); hold('RUN_WRITEB'); hold('RUN_CONFLICT')
    const a = await fixture.dispatch('RUN_WRITEA', { config: writer, fileScope: { read: [], write: ['a'] } })
    await until(() => started('RUN_WRITEA'))
    const conflict = await fixture.dispatch('RUN_CONFLICT', { config: writer, fileScope: { read: [], write: ['a/file.txt'] } })
    const independent = await fixture.dispatch('RUN_WRITEB', { config: writer, fileScope: { read: [], write: ['b'] } })
    await until(() => started('RUN_WRITEB'))
    await until(async () => (await fixture.work(conflict.id)).waitingFor?.reason === 'file_scope')
    assert(!started('RUN_CONFLICT'))
    gates.get('RUN_WRITEA')!.resolve(); await settled(a.id)
    await until(() => started('RUN_CONFLICT'))
    gates.get('RUN_CONFLICT')!.resolve(); gates.get('RUN_WRITEB')!.resolve()
    await Promise.all([settled(conflict.id), settled(independent.id)])
    scenes.push('TM12-overlapping-writes-wait-independent-path-starts')
    hold('RUN_READ1'); hold('RUN_READ2')
    const reads = await Promise.all(['RUN_READ1', 'RUN_READ2'].map(id => fixture.dispatch(id, { config: { ...writer, permissionMode: 'safe' } })))
    await until(() => started('RUN_READ1') && started('RUN_READ2'))
    gates.get('RUN_READ1')!.resolve(); gates.get('RUN_READ2')!.resolve()
    await Promise.all(reads.map(item => settled(item.id)))
    scenes.push('TM12-shared-working-directory-allows-concurrent-readers')
    const { acquireFileScopes, releaseFileScopes, snapshotFileScope } = await import('../../packages/server-core/src/tasks/file-scopes')
    const token = {}
    await until(() => acquireFileScopes(token, snapshotFileScope(cwd, { read: [], write: ['leased'] })), 5000)
    const leased = await fixture.dispatch('RUN_LEASED', { config: writer, fileScope: { read: ['leased'], write: [] } })
    await until(async () => (await fixture.work(leased.id)).waitingFor?.reason === 'file_scope')
    assert(!started('RUN_LEASED')); releaseFileScopes(token); await settled(leased.id)
    scenes.push('TM12-reuses-process-file-leases-and-wakes-on-release')

    const predecessor = await fixture.dispatch('RUN_PREDECESSOR'); await settled(predecessor.id)
    const dependent = await fixture.dispatch('RUN_DEPENDENT', { dependencySessionIds: [predecessor.sessionId!] })
    await until(async () => (await fixture.work(dependent.id)).waitingFor?.reason === 'dependency')
    assert(!started('RUN_DEPENDENT'), 'Result-ready is not successful business completion')
    await fixture.manager.setSessionStatus(predecessor.sessionId!, 'done'); await settled(dependent.id)
    scenes.push('TM13-dependency-starts-only-after-predecessor-session-done')
    const cancelled = await fixture.dispatch('RUN_CANCELDEP', { startPaused: true }); await fixture.cancel(cancelled.id)
    const blocked = await fixture.dispatch('RUN_BLOCKDEP', { dependencySessionIds: [cancelled.sessionId!] })
    await until(async () => (await fixture.work(blocked.id)).waitingFor?.reason === 'dependency')
    assert.match((await fixture.work(blocked.id)).waitingFor?.detail ?? '', /cancel/i)
    await assert.rejects(fixture.manager.updateSessionPlanning(cancelled.sessionId!, { dependencySessionIds: [blocked.sessionId!] }), /cycle/i)
    await fixture.manager.deleteSession(cancelled.sessionId!)
    fixture.manager.getSessions('alpha')
    await control(blocked.id, 'plan', { priority: 1 })
    await until(async () => /missing/i.test((await fixture.work(blocked.id)).waitingFor?.detail ?? ''))
    await fixture.cancel(blocked.id)
    scenes.push('TM13-cancelled-missing-and-cyclic-dependencies-cannot-start')

    hold('RUN_PRIORITYHOLD'); hold('RUN_HIGH'); hold('RUN_LOW')
    const lock = await fixture.dispatch('RUN_PRIORITYHOLD', { config: writer })
    await until(() => started('RUN_PRIORITYHOLD'))
    const low = await fixture.dispatch('RUN_LOW', { config: writer }), high = await fixture.dispatch('RUN_HIGH', { config: writer })
    await control(high.id, 'plan', { priority: 90 })
    gates.get('RUN_PRIORITYHOLD')!.resolve(); await settled(lock.id)
    await until(() => started('RUN_HIGH')); assert(!started('RUN_LOW'))
    gates.get('RUN_HIGH')!.resolve(); await settled(high.id); await until(() => started('RUN_LOW'))
    gates.get('RUN_LOW')!.resolve(); await settled(low.id)
    scenes.push('TM16-explicit-priority-arranges-pending-work-without-restarting-running-work')
    const summary = await fixture.page()
    assert(summary.observedAt && summary.scheduling?.capacity === 18)
    snapshots.push(summary)
    scenes.push('TM14-host-clock-and-capacity-projection-are-published')
    run.complete(scenes, ['Paid model management quality (separate live workflow)', 'Operating-system sandboxing; file scopes are scheduling contracts'])
  } finally {
    for (const gate of gates.values()) gate.resolve()
    run.json('scheduling-evidence.json', { scenes, intervals, snapshots })
    await fixture.close()
  }
})
