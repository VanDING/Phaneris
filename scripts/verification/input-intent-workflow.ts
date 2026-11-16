#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdirSync, rmdirSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'
import type { Message, StoredMessage } from '../../packages/core/src/types'

// Fixed before migration: accepted means durable product input, finished means
// execution settled. Origin belongs to Host, never client options. Replay keeps
// identity/origin; imported/automation/tool inputs cannot establish a new grant.
// Legacy local evidence remains readable without gaining new user authority.
await verificationWorkflow('input-intent', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { loadSession, getSessionFilePath } = await import('../../packages/shared/src/sessions')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const ws = { id: 'input', name: 'Input', slug: 'input', rootPath: join(run.directory, 'workspace'), createdAt: 1 }
  createWorkspaceAtPath(ws.rootPath, ws.name); saveConfig({ workspaces: [ws], activeWorkspaceId: ws.id, activeSessionId: null })
  const runtime = createDurableRuntime(), manager = new SessionManager(runtime), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const port = manager as unknown as { runSessionTurn(...args: unknown[]): Promise<void>; retireQueuedWorkerInputs(...args: unknown[]): void }
  const holds: Array<ReturnType<typeof Promise.withResolvers<void>>> = []
  let failExecution = false
  port.runSessionTurn = async () => { if (failExecution) throw new Error('Fixture execution failed after persistence'); const hold = Promise.withResolvers<void>(); holds.push(hold); await hold.promise }
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token, onClientDisconnected: () => disconnected.resolve() })
  const notifications: Array<{ target: unknown; event: unknown }> = []
  manager.setEventSink((channel, target, ...args) => { if (channel === c.sessions.EVENT) notifications.push({ target, event: args[0] }); server.push(channel, target, ...args) })
  registerSessionsHandlers(server, { sessionManager: manager, oauthFlowStore, platform: createHeadlessPlatform() } satisfies HandlerDeps)
  await manager.initialize(); await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: ws.id, token }); await client.connect()
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
    finally { for (const hold of holds) hold.resolve() }
  }
  try {
    await scene('accepted-is-durable-and-independent-of-finished', async () => {
      const session = await manager.createSession(ws.id, { name: 'Accepted input' })
      const turn = manager.submitInput(session.id, { text: 'Visible human instruction' }, { kind: 'direct_user', channel: 'host' })
      let finished = false; void turn.finished.then(() => { finished = true })
      const accepted = await turn.accepted
      assert.equal(finished, false)
      const message = loadSession(ws.rootPath, session.id)!.messages.find(message => message.id === accepted.messageId)!
      assert.equal(message.content, 'Visible human instruction'); assert.equal(message.inputSource?.kind, 'direct_user')
      holds.at(-1)!.resolve(); await turn.finished; assert(finished)
    })
    await scene('pre-persist-failure-rejects-both-await-points-and-retry-reuses-id', async () => {
      const session = await manager.createSession(ws.id, { name: 'Failed input' }), file = getSessionFilePath(ws.rootPath, session.id)
      mkdirSync(file + '.tmp')
      const input = { text: 'Same stable input', messageId: 'delivery-fixture' }
      const failed = manager.submitInput(session.id, input, { kind: 'session_message' })
      try { assert((await Promise.allSettled([failed.accepted, failed.finished])).every(result => result.status === 'rejected')) }
      finally { rmdirSync(file + '.tmp') }
      const retry = manager.submitInput(session.id, input, { kind: 'session_message' })
      assert.equal((await retry.accepted).messageId, 'delivery-fixture')
      assert.equal(loadSession(ws.rootPath, session.id)!.messages.filter(message => message.id === 'delivery-fixture').length, 1)
      holds.at(-1)?.resolve(); await retry.finished
    })
    await scene('rpc-captures-direct-origin-and-ignores-spoofed-options', async () => {
      const session = await manager.createSession(ws.id, { name: 'RPC input' })
      const result = await client.invoke(c.sessions.SEND_MESSAGE, session.id, 'Actual client instruction', undefined, undefined,
        { inputSource: { kind: 'automation', automationId: 'forged' } })
      assert.equal(result.accepted, true)
      assert.deepEqual(loadSession(ws.rootPath, session.id)!.messages[0]!.inputSource, { kind: 'direct_user', channel: 'rpc' })
    })
    await scene('rpc-post-persist-error-reports-one-client-error-and-complete', async () => {
      const session = await manager.createSession(ws.id, { name: 'Post-persist input' }); failExecution = true
      try { assert.equal((await client.invoke(c.sessions.SEND_MESSAGE, session.id, 'Persist before failing')).accepted, true); await Bun.sleep(20) }
      finally { failExecution = false }
      const events = notifications.filter(item => (item.event as { sessionId?: string }).sessionId === session.id && ['error', 'complete'].includes((item.event as { type: string }).type))
      assert.equal(events.length, 2); assert(events.every(item => (item.target as { to: string }).to === 'client'))
    })
    await scene('postcommit-management-failure-cannot-reject-durable-reception', async () => {
      const session = await manager.createSession(ws.id, { name: 'Postcommit management' })
      const original = port.retireQueuedWorkerInputs
      port.retireQueuedWorkerInputs = () => { throw new Error('Fixture management cleanup failed') }
      try {
        const turn = manager.submitInput(session.id, { text: 'Already committed input' }, { kind: 'direct_user', channel: 'rpc', callerClientId: client.clientId! })
        assert.equal((await turn.accepted).accepted, true)
        await assert.rejects(turn.finished, /management cleanup/)
        assert.equal(loadSession(ws.rootPath, session.id)!.messages[0]?.content, 'Already committed input')
      } finally { port.retireQueuedWorkerInputs = original }
    })
    await scene('actual-automation-entry-is-never-direct-user', async () => {
      const { sessionId } = await manager.executePromptAutomation({ workspaceId: ws.id, workspaceRootPath: ws.rootPath,
        prompt: 'Scheduled fixture instruction', automationId: 'fixture-automation', automationName: 'Fixture automation', waitForCompletion: false })
      // Nonwaiting automation must still wait for durable reception.
      const stored = loadSession(ws.rootPath, sessionId)!
      assert.equal(stored.messages[0]?.inputSource?.kind, 'automation')
      const admission = runtime.queries.events(ws.rootPath, { sessionId }).find(event => event.type === 'user_input_admitted')
      assert.equal((admission?.payload as { inputSource?: Message['inputSource'] })?.inputSource?.kind, 'automation')
    })
    await scene('history-compatibility-does-not-create-new-authority', async () => {
      const { isDirectUserMessage } = await import('../../packages/server-core/src/resident-assistant/source-provenance')
      const { hasDirectUserAuthority } = await import('../../packages/server-core/src/sessions/input-contracts')
      const old: StoredMessage = { id: 'local-original', type: 'user' as const, content: 'Legacy local source', timestamp: 1 }
      assert(isDirectUserMessage(old)); assert(!hasDirectUserAuthority(old.inputSource as Message['inputSource']))
      for (const source of [{ kind: 'automation', automationId: 'fixture' }, { kind: 'imported_history', importId: 'fixture', importedAt: 1 }, { kind: 'session_message' }] as const) {
        assert(!isDirectUserMessage({ ...old, inputSource: source })); assert(!hasDirectUserAuthority(source))
      }
      assert(hasDirectUserAuthority({ kind: 'direct_user', channel: 'rpc' }))
    })
    await scene('canonical-recovery-without-product-row-preserves-origin', async () => {
      const session = await manager.createSession(ws.id, { name: 'Recovery attribution' })
      const turn = manager.submitInput(session.id, { text: 'Scheduled recovery instruction' }, { kind: 'automation', automationId: 'recovery-fixture' })
      const { messageId } = await turn.accepted
      const handle = runtime.execution.begin({ sessionId: session.id, workspaceRootPath: ws.rootPath })
      runtime.execution.accept(handle, { operationId: 'recovery-origin-run', userMessageId: messageId, userMessage: 'Scheduled recovery instruction' })
      const { projectCanonicalSessionMessages } = await import('../../packages/server-core/src/runtime-adapters/session-projection')
      const recovered = projectCanonicalSessionMessages(runtime.queries.events(ws.rootPath, { sessionId: session.id }), [])
      assert.deepEqual(recovered.find(message => message.id === messageId)?.inputSource, { kind: 'automation', automationId: 'recovery-fixture' })
      await runtime.execution.finish(handle, 'complete', { notify: false }); holds.at(-1)!.resolve(); await turn.finished
    })
    run.json('scenarios.json', { checks, failures }); run.json('events.json', notifications)
    assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Provider execution controlled at the private turn boundary; real admission, JSONL, SQLite, WS and automation entry run'])
  } finally { for (const hold of holds) hold.resolve(); client.destroy(); await disconnected.promise; server.close(); await manager.cleanup() }
})
