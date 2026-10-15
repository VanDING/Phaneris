import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('upstream-015-orchestration', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'profile')
  const checks: Array<{ id: string; pass: boolean; error?: string }> = []
  const check = async (id: string, fn: () => Promise<void>) => { try { await fn(); checks.push({ id, pass: true }) } catch (error) { checks.push({ id, pass: false, error: String(error) }) } }
  await check('U15-14-oauth-one-preparation-and-workspace-isolation', async () => {
    const { OAuthFlowStore } = await import('../../packages/shared/src/auth/oauth-flow-store')
    const { createOAuthFlowStarter, completeOAuthFlow } = await import('../../packages/server-core/src/handlers/rpc/oauth')
    const store = new OAuthFlowStore()
    let prepares = 0, exchanges = 0
    const starter = createOAuthFlowStarter({ flowStore: store, logger: { info() {} }, prepare: async () => {
      prepares++; await Bun.sleep(10)
      return { state: `state-${prepares}`, authUrl: 'https://example.invalid/authorize', codeVerifier: 'synthetic', provider: 'google', tokenEndpoint: 'https://example.invalid/token', clientId: 'synthetic', redirectUri: 'http://127.0.0.1/callback' } as never
    } })
    const request = (workspaceId: string, sessionId: string) => ({ workspaceId, clientId: 'owner', sourceSlug: 'same', source: { config: { slug: 'same' }, workspaceId } as never, sessionId, authRequestId: `auth-${sessionId}`, joinLive: true })
    try {
      const [first, second] = await Promise.all([starter(request('a', 'one')), starter(request('a', 'two'))])
      assert.equal(prepares, 1); assert.equal(first.flowId, second.flowId); assert('joined' in second)
      const other = await starter(request('b', 'three')); assert.notEqual(other.flowId, first.flowId)
      assert.deepEqual(store.getStatus(first.flowId, 'b'), { live: false })
      assert('state' in first)
      const resumed: unknown[] = []
      await completeOAuthFlow({ code: 'synthetic-code', state: first.state, flowStore: store,
        credManager: { async exchangeAndStore() { exchanges++; return { success: true, email: 'synthetic@example.invalid' } } },
        sessionManager: { async completeAuthRequest() {}, completeAuthRequestsForSource(workspaceId, slug, _result, requests) { resumed.push({ workspaceId, slug, requests }); return ['one', 'two'] } },
        pushSourcesChanged() {}, logger: { info() {} }, workspaceId: 'a', clientId: 'owner' })
      assert.equal(exchanges, 1); assert.equal(resumed.length, 1)
      assert.equal((resumed[0] as { requests: unknown[] }).requests.length, 2)
      run.json('oauth-flows.json', { prepares, exchanges, resumed, status: store.getStatus(first.flowId, 'a') })
    } finally { store.dispose() }
  })
  const tasks = await import('../../packages/shared/src/tasks')
  const { TaskRunner } = await import('../../packages/server-core/src/tasks/TaskRunner')
  const tick = () => Bun.sleep(20)
  function fixture(id: string, nodes: unknown[]) {
    const workspace = join(run.directory, id); mkdirSync(workspace, { recursive: true })
    const listeners = new Set<(event: import('../../packages/server-core/src/domain/session-completion').SessionCompletionEvent) => void>()
    const dispatched: Array<{ sessionId: string; text: string }> = []
    const created: string[] = []
    const host: import('../../packages/server-core/src/tasks/TaskRunner').ConductorSessionHost = {
      async createSession(_workspace, options) { const id = `${options.name}-${created.length}`; created.push(id); return { id } },
      async sendMessage(sessionId, text) { dispatched.push({ sessionId, text }) },
      async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
      getSessionFinalText() { return 'OLD TURN MUST NOT BE REUSED' }, getSessionWorkingDirectory() { return workspace },
      onSessionComplete(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const spec = tasks.parseTaskSpec({ id: 'fixture', title: 'Fixture', goal: 'Verify task contracts', defaults: { permissionMode: 'safe' }, nodes })
    assert(spec.success); tasks.saveTaskSpec(workspace, spec.data)
    const runner = new TaskRunner({ host, workspaceId: 'fixture', workspaceRoot: workspace })
    runner.run('fixture', { runId: 'run', verifyOnComplete: false })
    return { workspace, runner, created, dispatched, emit(sessionId: string, reason: 'complete' | 'interrupted', finalText?: string) {
      for (const listener of [...listeners]) listener({ workspaceId: 'fixture', sessionId, reason, finalText })
    }, state() { return runner.getRunState('fixture', 'run') }, stop() { return runner.stop('fixture', 'run') } }
  }
  await check('U15-16-empty-turn-does-not-reuse-history', async () => {
    const f = fixture('empty', [{ id: 'a', title: 'a', prompt: 'a', outputs: [{ name: 'report' }], retry: { limit: 0 } }])
    try { await tick(); f.emit(f.created[0]!, 'complete'); await tick(); assert.notEqual(f.state()?.nodes[0]?.state, 'done') }
    finally { await f.stop() }
  })
  await check('U15-18-interrupted-step-retains-explicit-recovery', async () => {
    const f = fixture('stopped', [{ id: 'a', title: 'a', prompt: 'a' }, { id: 'b', title: 'b', prompt: 'b', depends_on: ['a'] }])
    try {
      await tick(); const sessionId = f.created[0]!; f.emit(sessionId, 'interrupted'); await tick()
      assert.equal(f.created.length, 1); assert.notEqual(f.state()?.nodes[0]?.state, 'done')
      f.emit(sessionId, 'complete', 'User-guided completion.'); await tick()
      assert.equal(f.created.length, 1); assert.notEqual(f.state()?.nodes[0]?.state, 'done')
      run.json('task-stopped.json', { dispatched: f.dispatched, log: tasks.readRunLog(f.workspace, 'fixture', 'run') })
    } finally { await f.stop() }
  })
  await check('U15-17-dependency-replies-and-explicit-reference-once', async () => {
    const f = fixture('dependencies', [{ id: 'a', title: 'a', prompt: 'a' }, { id: 'b', title: 'b', prompt: '${nodes.a.output}', depends_on: ['a'] }])
    try {
      await tick(); f.emit(f.created[0]!, 'complete', 'UNIQUE UPSTREAM REPORT'); await tick()
      assert.equal(f.dispatched[1]!.text.split('UNIQUE UPSTREAM REPORT').length - 1, 1)
      f.emit(f.created[1]!, 'complete', 'Accepted.'); await tick(); assert.equal(f.state()?.status, 'completed')
    } finally { await f.stop() }
  })
  await check('U15-19-active-generation-and-idle-timeout', async () => {
    const { waitForTurnReply } = await import('../../packages/server-core/src/handlers/rpc/tasks')
    const complete = new Set<(event: import('../../packages/server-core/src/domain/session-completion').SessionCompletionEvent) => void>(), activity = new Set<() => void>()
    const sessions = { onSessionComplete(listener: (event: import('../../packages/server-core/src/domain/session-completion').SessionCompletionEvent) => void) { complete.add(listener); return () => complete.delete(listener) },
      onSessionActivity(_session: string, listener: () => void) { activity.add(listener); return () => activity.delete(listener) } }
    const pending = waitForTurnReply(sessions, 'generate', async () => {
      for (let index = 0; index < 4; index++) { await Bun.sleep(8); for (const listener of activity) listener() }
      for (const listener of [...complete]) listener({ workspaceId: 'fixture', sessionId: 'generate', reason: 'complete', finalText: 'yaml: result' })
    }, { idleMs: 20, maxMs: 200 })
    assert.equal(await pending, 'yaml: result'); assert.equal(activity.size + complete.size, 0)
    await assert.rejects(waitForTurnReply(sessions, 'stalled', () => {}, { idleMs: 15, maxMs: 150 }), /stalled/)
    assert.equal(activity.size + complete.size, 0)
  })
  run.json('upstream-015-orchestration.json', { checks })
  run.complete(checks.filter(item => item.pass).map(item => item.id), ['Live OAuth accounts', 'Native browser', 'Provider-backed Task reasoning', 'Signed release'])
  assert(checks.every(item => item.pass), JSON.stringify(checks.filter(item => !item.pass)))
})
