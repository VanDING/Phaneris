import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import { createResidentTaskHost, taskModelResponse } from './fixtures/resident-task-host'

// TM15 is fixed before changing permission propagation or validity diagnostics.
await verificationWorkflow('resident-assistant-configuration', async run => {
  let release = Promise.withResolvers<void>(), started = false
  const requests: Array<{ at: number; worker: boolean; body: unknown }> = []
  const fixture = await createResidentTaskHost(run.directory, async (body, request) => {
    const text = JSON.stringify(body.messages), worker = !text.includes('resident_assistant_role')
    requests.push({ at: Date.now(), worker, body })
    if (worker && text.includes('HOLD_CONFIGURATION') && !text.includes('<worker_control>')) {
      started = true
      await Promise.race([release.promise, new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }))])
    }
    return taskModelResponse(body, worker ? 'CONFIGURATION_RESULT' : 'CONFIGURATION_ACK')
  })
  const scenes: string[] = [], evidence: unknown[] = []
  const { until } = fixture
  const settle = (id: string) => until(async () => (await fixture.work(id)).state === 'result_ready')
  const command = async (id: string, action: string) => fixture.control({ commandId: crypto.randomUUID(), id, expectedSeq: (await fixture.work(id)).seq, action })
  try {
    const staged = await fixture.dispatch('configured-before-start', { startPaused: true, config: { permissionMode: 'ask', thinkingLevel: 'off', workingDirectory: 'none' } })
    fixture.manager.setSessionPermissionMode(staged.sessionId!, 'allow-all')
    await until(async () => { const work = await fixture.work(staged.id); return work.effectiveConfig?.permissionMode === 'allow-all' && !work.pendingControlId })
    assert.equal((await fixture.manager.getSession(staged.sessionId!))!.permissionMode, 'allow-all')
    await command(staged.id, 'resume'); await settle(staged.id)
    evidence.push(await fixture.work(staged.id))
    scenes.push('TM15-worker-session-mode-and-staged-snapshot-share-one-change')

    const clamped = await fixture.dispatch('clamp-before-start', { startPaused: true, config: { permissionMode: 'allow-all', thinkingLevel: 'off', workingDirectory: 'none' } })
    await fixture.manager.setAssistantExecutionMode('alpha', 'safe')
    await command(clamped.id, 'resume'); await settle(clamped.id)
    const state = await fixture.work(clamped.id)
    assert.equal(state.effectiveConfig?.permissionMode, 'safe')
    assert.equal((await fixture.manager.getSession(state.sessionId!))!.permissionMode, 'safe')
    evidence.push(state)
    scenes.push('TM15-launch-clamp-keeps-session-and-effective-config-consistent')

    await fixture.manager.setAssistantExecutionMode('alpha', 'allow-all')
    const changing = await fixture.dispatch('mode-during-request', { instructions: 'HOLD_CONFIGURATION: finish the same original goal.',
      config: { permissionMode: 'allow-all', thinkingLevel: 'off', workingDirectory: 'none' } })
    await until(() => started)
    fixture.manager.setSessionPermissionMode(changing.sessionId!, 'safe')
    release.resolve()
    await settle(changing.id)
    const updated = await fixture.work(changing.id)
    assert.equal(updated.effectiveConfig?.permissionMode, 'safe')
    assert.equal((await fixture.manager.getSession(changing.sessionId!))!.permissionMode, 'safe')
    assert(updated.controls?.some(control => control.action === 'configure' && control.actor === 'user' && control.phase === 'applied'))
    evidence.push(updated)
    scenes.push('TM15-running-user-mode-change-continues-within-the-original-session')

    started = false; release = Promise.withResolvers<void>()
    const tightened = await fixture.dispatch('ceiling-during-response', { instructions: 'HOLD_CONFIGURATION: inspect only current authorization.',
      config: { permissionMode: 'allow-all', thinkingLevel: 'off', workingDirectory: 'none' } })
    await until(() => started)
    await fixture.manager.setAssistantExecutionMode('alpha', 'safe')
    release.resolve()
    await until(async () => ['failed', 'needs_attention'].includes((await fixture.work(tightened.id)).state))
    const invalid = await fixture.work(tightened.id)
    assert.equal(invalid.invalidation?.code, 'permission_ceiling_tightened')
    assert.equal(invalid.invalidation?.boundary, 'response')
    assert(invalid.invalidation?.providerRequestId)
    evidence.push(invalid)
    scenes.push('TM15-response-fence-records-the-exact-permission-ceiling-reason')
    const resumed = await fixture.control({ commandId: crypto.randomUUID(), id: tightened.id, expectedSeq: invalid.seq, action: 'configure', config: { permissionMode: 'safe' } })
    assert.equal(resumed.command.phase, 'applied'); await settle(tightened.id)
    scenes.push('TM15-fenced-request-can-continue-with-current-legitimate-configuration')

    // Selecting and hibernating an unrelated branch must not invalidate a Worker.
    const originalGoal = '只读核对这项独立工作，代号 ORIGINAL_BRANCH；输出文字结果。'
    await fixture.sendMain(originalGoal)
    const branch = await fixture.manager.assistantContext('alpha', { action: 'create', requestId: 'original-branch', label: 'Original work' })
    const originalBranch = branch.focus.topicId!; assert(originalBranch)
    started = false; release = Promise.withResolvers<void>()
    const isolated = await fixture.dispatch('unrelated-context', { goalQuote: originalGoal,
      context: { branchIds: [originalBranch] }, instructions: 'HOLD_CONFIGURATION: retain this task packet.' })
    await until(() => started)
    await fixture.sendMain('另一项独立讨论，代号 UNRELATED_BRANCH；仅确认。')
    const unrelated = await fixture.manager.assistantContext('alpha', { action: 'create', requestId: 'unrelated-branch', label: 'Unrelated discussion' })
    await fixture.manager.assistantContext('alpha', { action: 'hibernate', branchIds: [unrelated.focus.topicId!] })
    release.resolve(); await settle(isolated.id)
    evidence.push({ branch, work: await fixture.work(isolated.id) })
    scenes.push('TM15-unrelated-focus-does-not-invalidate-a-worker-material-packet')
    run.complete(scenes, ['Paid model management quality (separate live workflow)', 'Provider-side cancellation of already dispatched effects'])
  } finally { release.resolve(); run.json('configuration-evidence.json', { scenes, evidence, requests }); await fixture.close() }
})
