/** Real SessionManager/SQLite + a held decision endpoint; never calls a paid provider. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-input-continuity', async evidence => {
  const config = join(evidence.directory, 'config'), rootPath = join(evidence.directory, 'workspace')
  mkdirSync(config, { recursive: true })
  mkdirSync(join(rootPath, 'skills', 'research'), { recursive: true })
  writeFileSync(join(rootPath, 'skills', 'research', 'SKILL.md'), '---\nname: research\ndescription: Research reports\n---\nRead evidence.')
  process.env.PHANERIS_CONFIG_DIR = config
  process.env.NODE_ENV = 'test'
  let gate = Promise.withResolvers<void>(), received = Promise.withResolvers<void>()
  let requests = 0
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any
    requests++
    received.resolve()
    await gate.promise
    return Response.json({ model: body.model, answers: { needed: { type: 'choice', choice: 'skill:research', confidence: .99,
      probabilities: { none: .01, 'skill:research': .99 } }, outcome: { type: 'choice', choice: 'finished', confidence: .99,
      probabilities: { finished: .99, needs_input: .005, blocked: .005 } } }, usage: { input_tokens: 7, output_tokens: 3 } })
  } })
  const workspace = { id: 'continuity', name: 'Continuity', rootPath, createdAt: 1 }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id,
    llmConnections: [{ slug: 'steer-fixture', name: 'Steer fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, midStreamBehavior: 'steer' },
      { slug: 'queue-fixture', name: 'Queue fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, midStreamBehavior: 'queue' }],
    decisionLayer: { enabled: true, provider: 'custom', baseUrl: api.url.href, model: 'fixture',
      features: { suggestions: true, adaptiveThinking: false, midTurnMessages: true, largeResults: true, turnOutcome: true } } }))
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createSession } = await import('../../packages/shared/src/sessions/storage')
  const { buildHandoffSeed } = await import('../../packages/shared/src/agent/context-policy')
  const manager = new SessionManager() as any
  const session = await createSession(rootPath, { name: 'Continuity fixture' })
  const managed = createManagedSession(session, workspace as never, { messagesLoaded: true }) as any
  manager.registerManagedSession(managed)
  const events: any[] = []
  manager.eventSink = (_channel: unknown, _target: unknown, event: any) => events.push(event)
  const handle = manager.durableRuntime.execution.begin({ sessionId: session.id, workspaceRootPath: rootPath })
  manager.durableRuntime.execution.accept(handle, { operationId: 'continuity-run', userMessageId: 'original', userMessage: 'Research the report' })
  managed.messages.push({ id: 'original', role: 'user', content: 'Research the report', timestamp: 1 })
  const checks: string[] = []
  try {
    const pending = manager.startPreTurnDecisions(managed, 'Research the report')
    const result = await Promise.race([pending, Bun.sleep(500).then(() => { throw new Error('Optional suggestion blocked the main request') })])
    assert.equal(result.suggestionHint, null)
    await Promise.race([received.promise, Bun.sleep(3000).then(() => { throw new Error('Suggestion fixture was not called') })])
    assert.equal(managed.turnSuggestionHint, null)
    checks.push('HC09 real host returns before held optional decision response')
    gate.resolve()
    for (let i = 0; i < 100 && !events.some(e => e.type === 'info'); i++) await Bun.sleep(10)
    assert(events.some(e => e.type === 'info'), 'Advice should be displayed in the UI')
    assert.equal(managed.turnSuggestionHint, null, 'Advice must never enter the main prompt')
    checks.push('HC09 suggestions remain UI-only with no implicit skill activation')
    const correction = 'Keep chapter three. Only change the conclusion.'
    const { PiRuntimeDriver } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
    const steered: string[] = []
    manager.durableRuntime.execution.installDriver(session.id, new PiRuntimeDriver({ canSteerNow: () => true,
      isCompactionInFlight: () => false, redirectConfirmed: async (message: string) => { steered.push(message); return { disposition: 'handled' } },
      forceAbort: () => {}, dispose: () => {}, destroy: () => {} } as never))
    await manager.sendMessage(session.id, correction)
    assert.deepEqual(steered, [correction], 'Configured steering must bypass the enabled legacy classifier')
    assert.equal(requests, 1)
    managed.llmConnection = 'queue-fixture'
    await manager.sendMessage(session.id, 'A separate queued request')
    assert.equal(steered.length, 1)
    assert.equal(managed.messages.at(-1).isQueued, true)
    assert.equal(requests, 1)
    checks.push('HC09 real host preserves steer/queue preference while legacy classification is enabled')
    const adviceBefore = events.filter(event => event.type === 'info').length
    gate = Promise.withResolvers<void>(); received = Promise.withResolvers<void>()
    await manager.startPreTurnDecisions(managed, 'Research the report again')
    await Promise.race([received.promise, Bun.sleep(3000).then(() => { throw new Error('Late advice fixture was not called') })])
    managed.llmConnection = 'steer-fixture'
    await manager.sendMessage(session.id, 'New correction: do not use the earlier recommendation.')
    gate.resolve()
    for (let i = 0; i < 100 && managed.preTurnDecisionAbort; i++) await Bun.sleep(10)
    assert.equal(events.filter(event => event.type === 'info').length, adviceBefore)
    checks.push('HC09 advice based on an earlier user revision is discarded')
    const approval = 'Plan approved: original immutable scope hash ABC.'
    const seed = buildHandoffSeed({ document: 'Generated narrative', rootSessionId: session.id, previousSessionId: session.id,
      sessionPath: join(rootPath, 'sessions', session.id, 'session.jsonl'), documentPath: 'handoff.md', handoffsPath: rootPath,
      lateMessages: [correction], continuity: { task: { description: 'Research report', acceptanceCriteria: 'Check citations' },
        messages: [{ id: 'approval', content: approval }, { id: 'late', content: correction }] } })
    assert(seed.includes(correction) && seed.includes(approval) && seed.includes('Check citations'))
    assert(seed.indexOf(correction) < seed.indexOf('Generated narrative'))
    checks.push('HC12 host continuity preserves original corrections, scope and task criteria')
    managed.description = 'Keep the original research goal'
    managed.acceptanceCriteria = 'Verify every citation'
    managed.progress = 40
    managed.messages.push({ id: 'correction', role: 'user', content: correction, timestamp: 2, isQueued: true })
    const documentPath = join(rootPath, 'handoff.md')
    writeFileSync(documentPath, '# Goal\nContinue the report.\n# Completed\nNo external changes.\n# State\nThe original chapter three is preserved.\n# Next\nOnly revise the conclusion and verify citations.\n# References\nUse the original session history and all preserved user instructions.\n')
    managed.contextHandoff = { id: 'handoff', phase: 'ready', documentPath, cutoffMessageId: 'original' }
    let successorSeed = ''
    manager.sendMessage = async (_id: string, message: string, ...args: any[]) => { successorSeed = message; args[5]?.('admitted') }
    await manager.startContextSuccessor(managed)
    const child = [...manager.sessions.values()].find((candidate: any) => candidate.handoffFromSessionId === session.id) as any
    assert(child, 'Real host must create a successor')
    assert.equal(child.description, managed.description)
    assert.equal(child.acceptanceCriteria, managed.acceptanceCriteria)
    assert.equal(child.progress, 40)
    assert(successorSeed.includes(correction))
    assert.equal(managed.contextHandoff.phase, 'complete')
    checks.push('HC12 real successor creation preserves task fields and forwards late correction')
    const reviewStored = await createSession(rootPath, { name: 'Unverified outcome' })
    const review = createManagedSession(reviewStored, workspace as never, { messagesLoaded: true }) as any
    manager.registerManagedSession(review)
    review.sessionStatus = 'todo'
    review.acceptanceCriteria = 'A real output artifact has been verified'
    review.messages.push({ id: 'unverified-final', role: 'assistant', content: 'Everything is complete.', timestamp: 3 })
    const beforeOutcome = requests
    await manager.applyTurnOutcome(review, 'unverified-final')
    assert.equal(requests, beforeOutcome + 1, 'The finished classifier must actually run')
    assert.equal(review.sessionStatus, 'todo', 'A finished label cannot close a session or manufacture acceptance')
    checks.push('HC15 an overconfident finished classifier does not close an unverified session')
    evidence.json('input-continuity.json', { checks, requests, advice: events.filter(e => e.type === 'info'), seed,
      scope: 'Real host decision scheduling and SQLite accounting; handoff seed contract, not live model quality' })
    evidence.complete(checks, ['live model quality', 'native UI steering during external effects', 'cross-platform packaging'])
    console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
  } finally {
    gate.resolve()
    await manager.cleanup()
    const { getDecisionRecorder } = await import('../../packages/shared/src/decisions')
    await getDecisionRecorder().flush()
    api.stop(true)
  }
})
