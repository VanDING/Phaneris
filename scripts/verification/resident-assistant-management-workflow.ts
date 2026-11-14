import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import { createResidentTaskHost, taskModelResponse } from './fixtures/resident-task-host'

// TM14/TM16/TM17: real model/tool boundaries with deterministic decisions;
// paid model autonomy is measured separately after these invariants pass.
await verificationWorkflow('resident-assistant-management', async run => {
  const calls: Array<{ name: string; args: unknown }> = [], requests: Array<{ main: boolean; text: string; at: number }> = []
  let holdA = Promise.withResolvers<void>(), holdB = Promise.withResolvers<void>(), aStarted = false, bStarted = false
  const held = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  const fixture = await createResidentTaskHost(run.directory, async (body, request) => {
    const text = JSON.stringify(body.messages), main = text.includes('resident_assistant_role')
    requests.push({ main, text, at: Date.now() })
    assert(requests.length < 160, 'Management fixture request budget')
    if (main) return taskModelResponse(body, 'MANAGEMENT_DELIVERY', calls.shift())
    const marker = [...held.keys()].find(marker => text.includes(marker) && !text.includes('BOUNDARY_REVISION_NEW'))
    if (marker) await Promise.race([held.get(marker)!.promise, new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }))])
    if (text.includes('PACKET_A_ONLY') && !text.includes('REVISION_A_LIMIT11')) {
      aStarted = true
      await Promise.race([holdA.promise, new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }))])
    }
    if (text.includes('PACKET_B_ONLY')) {
      bStarted = true
      await Promise.race([holdB.promise, new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }))])
    }
    return taskModelResponse(body, text.includes('BOUNDARY_REVISION_NEW') ? 'BOUNDARY_REVISION_VERIFIED' : text.includes('REVISION_A_LIMIT11') ? 'A_LIMIT11_VERIFIED' : 'ORIGINAL_RESULT')
  })
  const scenes: string[] = [], evidence: unknown[] = [], { until } = fixture
  const sourceRead = (result: { sessionId: string; messageId: string }) => ({ name: 'mcp__session__assistant_memory_read', args: result })
  try {
    const a = await fixture.dispatch('manage-a', { context: { branchIds: [] }, instructions: 'PACKET_A_ONLY: original limit 5. Produce a text report.' })
    const b = await fixture.dispatch('manage-b', { context: { branchIds: [] }, instructions: 'PACKET_B_ONLY: independent limit 6. Produce a text report.' })
    await until(() => aStarted && bStarted)
    const before = (await fixture.work(a.id)).execution!.attempts[0]!.operationId
    const revision = { commandId: 'queued-revision-a', id: a.id, expectedSeq: (await fixture.work(a.id)).seq, action: 'message', message: 'REVISION_A_LIMIT11: widen only A to 11; finish its original report.' }
    calls.push({ name: 'mcp__session__assistant_worker_control', args: { command: revision } })
    await fixture.sendMain('将 A 的上限放宽到 11，B 保持原要求。请传达修订并继续推进。')
    const queued = await fixture.work(a.id)
    assert.equal(queued.state, 'submitted')
    assert.equal(queued.execution?.attempts[0]?.operationId, before, 'Ordinary communication must not interrupt the active attempt')
    assert.equal(queued.controls?.find(item => item.commandId === revision.commandId)?.delivery, 'queued')
    assert((await fixture.manager.getSession(b.sessionId!))!.isProcessing, 'A revision must not interrupt B')
    evidence.push(queued)
    holdA.resolve()
    await until(async () => (await fixture.work(a.id)).state === 'result_ready')
    const revised = await fixture.work(a.id)
    assert.equal((await fixture.manager.getSession(revised.result!.sessionId))!.messages.find(message => message.id === revised.result!.messageId)?.content, 'A_LIMIT11_VERIFIED')
    assert(revised.controls?.find(item => item.commandId === revision.commandId)?.processedAt)
    assert(!requests.filter(item => !item.main && item.text.includes('PACKET_A_ONLY')).some(item => item.text.includes('PACKET_B_ONLY')))
    const replay = await fixture.control(revision)
    assert.equal(replay.command.phase, 'applied')
    scenes.push('TM16-ordinary-revision-queues-without-stopping-the-original-attempt', 'TM16-worker-consumption-and-final-result-use-the-revised-requirement', 'TM16-replayed-message-does-not-execute-again')

    // An internal event resumes its original authorization after the user has
    // moved on. It must first read/review the old result and retain that origin.
    const initialOrigin = a.originMessageId
    await fixture.sendMain('切换到独立议题 NEW_FOREGROUND_B，不扩展 A 的授权范围。')
    const currentA = await fixture.work(a.id)
    calls.push(sourceRead(currentA.result!), { name: 'mcp__session__assistant_delivery_ack', args: { eventIds: [], reviews: [{
      delegationId: a.id, expectedSeq: currentA.seq, result: { messageId: currentA.result!.messageId, sessionId: currentA.result!.sessionId }, outcome: 'rework', reason: 'Original report requires an authorized follow-up correction.' }] } },
    { name: 'mcp__session__assistant_delegate', args: { requestId: 'follow-original-a', title: 'Follow original A', instructions: 'Complete the unfinished correction within the original goal.',
      goalQuote: fixture.goal, continuationOf: a.id, targetSessionId: a.sessionId!, config: {} } })
    await fixture.sendMain('按 A 原授权继续修订，不重新派发已完成的工作。')
    assert.notEqual((await fixture.manager.getSession(fixture.assistant.id))!.messages.findLast(message => message.role === 'tool')?.isError, true, 'Result identity is independent of JSON property order')
    await until(async () => (await fixture.page()).items.some(item => item.requestId === 'follow-original-a'))
    const follow = (await fixture.page()).items.find(item => item.requestId === 'follow-original-a')!
    assert.equal(follow.originMessageId, initialOrigin); assert.equal(follow.sessionId, a.sessionId)
    await until(async () => (await fixture.work(follow.id)).state === 'result_ready')
    await assert.rejects(fixture.dispatch('repeat-original-a', { continuationOf: a.id, goalQuote: fixture.goal, targetSessionId: a.sessionId!, instructions: 'Repeat old work', config: {} }), /already.*continuation/i)
    await assert.rejects(fixture.dispatch('outside-original-grant', { continuationOf: follow.id, goalQuote: 'NEW_FOREGROUND_B', instructions: 'Expand outside A', config: {} }), /review|original|scope|quote/i)
    evidence.push(follow)
    scenes.push('TM17-reviewed-follow-up-keeps-original-user-origin-and-session', 'TM17-follow-up-cannot-borrow-a-newer-unrelated-user-goal', 'TM17-one-result-cannot-dispatch-duplicate-followups-under-new-request-ids')

    holdB.resolve(); await until(async () => (await fixture.work(b.id)).state === 'result_ready')
    // The actual next inbox wakeup drives native delegation without a new user
    // message; no direct callback bypasses the assistant role gate.
    const resultB = await fixture.work(b.id)
    const followB = Promise.withResolvers<void>(); held.set('B_AUTHORIZED_FOLLOWUP_HOLD', followB)
    calls.push(sourceRead(resultB.result!), { name: 'mcp__session__assistant_delivery_ack', args: { eventIds: [], reviews: [{
      delegationId: b.id, expectedSeq: resultB.seq, result: resultB.result!, outcome: 'accepted', reason: 'Verified against original text-report requirements.' }] } },
    { name: 'mcp__session__assistant_delegate', args: { requestId: 'inbox-follow-b', title: 'Authorized B follow-up', instructions: 'B_AUTHORIZED_FOLLOWUP_HOLD: continue unfinished work within the original report goal.',
      goalQuote: fixture.goal, continuationOf: b.id, targetSessionId: b.sessionId!, config: {} } })
    await until(async () => {
      const page = await fixture.manager.getAssistantWork('alpha', { after: 0, limit: 20 })
      return page.items.some(item => item.requestId === 'inbox-follow-b')
    }, 45000)
    const internal = (await fixture.manager.getAssistantWork('alpha', { after: 0, limit: 20 })).items.find(item => item.requestId === 'inbox-follow-b')!
    assert.equal(internal.originMessageId, b.originMessageId)
    await until(async () => (await fixture.work(internal.id)).runtime?.isProcessing === true)
    assert.equal((await fixture.work(internal.id)).sessionStatus, 'todo', 'An authorized next stage reopens its same Session before execution')
    followB.resolve()
    await until(async () => (await fixture.work(internal.id)).state === 'result_ready')
    evidence.push(internal)
    scenes.push('TM17-internal-result-event-can-advance-a-host-verified-original-grant')
    scenes.push('TM06-accepted-followup-reopens-the-original-session-while-running')
    const summaries = requests.filter(item => item.main && item.text.includes('<resident_tasks>'))
    assert(summaries.length && summaries.some(item => item.text.includes(a.id) && item.text.includes(b.id)))
    const overviews = () => requests.filter(item => item.main).flatMap(item => {
      const messages = JSON.parse(item.text) as Array<{ content: string | Array<{ text?: string }> | null }>
      return messages.flatMap(message => typeof message.content === 'string' ? [message.content] : (message.content ?? []).map(part => part.text ?? ''))
        .flatMap(text => { const match = text.match(/<resident_tasks>\n([^]*?)\n<\/resident_tasks>/); return match ? [JSON.parse(match[1]!)] : [] })
    })
    assert(overviews().some(item => item.scheduling?.capacity === 4))
    scenes.push('TM14-real-main-requests-receive-bounded-runtime-task-overviews')
    const clauseA = 'SCOPED_A: complete this isolated report.', privateB = 'ISOLATED_B_PRIVATE_DRAFT: unrelated confidential synthetic discussion.'
    await fixture.sendMain(`${clauseA}\n${privateB}`)
    const mixed = (await fixture.manager.getSession(fixture.assistant.id))!.messages.findLast(message => message.role === 'user' && !message.inputSource)!
    const branch = await fixture.manager.assistantContext('alpha', { action: 'create', requestId: 'scoped-revision', label: 'Scoped A' })
    const branchId = branch.focus.topicId!, ref = { sessionId: fixture.assistant.id, messageId: mixed.id }
    // Intentionally leave the original mixed source broad. The Host must
    // intersect its task material with the exact pinned authorization quote.
    const scoped = await fixture.dispatch('scoped-revision', { startPaused: true, goalQuote: clauseA, context: { branchIds: [branchId] }, instructions: 'SCOPED_A only' })
    const revisedClause = 'SCOPED_A: BOUNDARY_REVISION_NEW; complete this isolated report.'
    await fixture.sendMain(`${revisedClause}\n${privateB}`)
    const correction = (await fixture.manager.getSession(fixture.assistant.id))!.messages.findLast(message => message.role === 'user' && !message.inputSource)!
    await fixture.manager.assistantContext('alpha', { action: 'associate', branchIds: [branchId], role: 'requirement',
      source: { sessionId: fixture.assistant.id, messageId: correction.id, quote: revisedClause }, supersedes: [ref] })
    const correctedAt = requests.length
    await fixture.control({ commandId: 'scoped-correction', id: scoped.id, expectedSeq: (await fixture.work(scoped.id)).seq, action: 'message', message: 'BOUNDARY_REVISION_NEW' })
    await fixture.control({ commandId: 'scoped-resume', id: scoped.id, expectedSeq: (await fixture.work(scoped.id)).seq, action: 'resume' })
    await until(async () => (await fixture.work(scoped.id)).state === 'result_ready')
    const scopedRequests = requests.slice(correctedAt).filter(request => !request.main)
    assert(scopedRequests.length && scopedRequests.every(request => request.text.includes('BOUNDARY_REVISION_NEW') && !request.text.includes('ISOLATED_B_PRIVATE_DRAFT')))
    scenes.push('TM16-revision-preserves-exact-A-source-ranges-from-a-mixed-A-B-input')
    await fixture.sendMain(fixture.goal)
    for (let index = 0; index < 23; index++) await fixture.dispatch(`bounded-${index}`, { startPaused: true, context: { branchIds: [] }, instructions: `Pending distinct report ${index}` })
    await fixture.sendMain('请查看当前任务现场，不启动暂停的工作。')
    const bounded = overviews().at(-1)!
    assert.equal(bounded.items.length, 20); assert(bounded.total >= 23); assert.equal(bounded.omitted, bounded.total - 20)
    assert(bounded.items.every((item: { ageMs: number; runtime?: { source: string } }) => item.ageMs >= 0 && (!item.runtime || item.runtime.source === 'runtime')))
    evidence.push(bounded)
    scenes.push('TM14-overview-remains-bounded-with-explicit-omitted-count-and-host-clock')
    await fixture.sendMain(fixture.goal)
    for (const boundary of ['restart', 'pause', 'cancel']) {
      const marker = `BOUNDARY_ORIGINAL_${boundary}`, release = Promise.withResolvers<void>(); held.set(marker, release)
      const task = await fixture.dispatch(`boundary-${boundary}`, { context: { branchIds: [] }, instructions: marker })
      await until(async () => (await fixture.work(task.id)).runtime?.isProcessing === true)
      await fixture.control({ commandId: `${boundary}-queue`, id: task.id, expectedSeq: (await fixture.work(task.id)).seq, action: 'message', message: 'BOUNDARY_REVISION_NEW' })
      if (boundary === 'pause') await fixture.control({ commandId: 'pause-queued-revision', id: task.id, expectedSeq: (await fixture.work(task.id)).seq, action: 'pause' })
      if (boundary === 'cancel') await fixture.cancel(task.id)
      await fixture.restart(); release.resolve()
      if (boundary === 'pause') {
        assert.equal((await fixture.work(task.id)).state, 'paused')
        await fixture.control({ commandId: 'resume-paused-revision', id: task.id, expectedSeq: (await fixture.work(task.id)).seq, action: 'resume' })
      }
      if (boundary === 'cancel') {
        assert.equal((await fixture.work(task.id)).state, 'cancelled')
        assert(!(await fixture.manager.getSession(task.sessionId!))!.isProcessing)
      } else {
        await until(async () => (await fixture.work(task.id)).state === 'result_ready')
        const latest = await fixture.work(task.id)
        assert.equal((await fixture.manager.getSession(latest.result!.sessionId))!.messages.find(message => message.id === latest.result!.messageId)?.content, 'BOUNDARY_REVISION_VERIFIED')
        evidence.push(latest)
      }
      scenes.push(`TM10-queued-revision-${boundary}-retains-original-intent-without-implicit-replay`)
    }
    run.complete(scenes, ['Paid model decisions (separate live workflow)'])
  } finally { holdA.resolve(); holdB.resolve(); for (const release of held.values()) release.resolve(); run.json('management-evidence.json', { scenes, evidence, requests }); await fixture.close() }
})
