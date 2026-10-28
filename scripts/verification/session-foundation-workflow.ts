#!/usr/bin/env bun
/** Real SessionManager, Runtime, JSONL and filesystem; model/provider events enter through a controlled port. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import type { AgentEvent, Message } from '@phaneris/core/types'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-foundation', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/storage')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { createSession, loadSession, saveSession, sessionPersistenceQueue } = await import('../../packages/shared/src/sessions/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { reportLegacyProjectionParity } = await import('../../packages/server-core/src/runtime-adapters/projection-audit')
  const rootPath = join(run.directory, 'workspace')
  mkdirSync(rootPath, { recursive: true })
  const workspace = { id: 'foundation-fixture', slug: 'foundation-fixture', createdAt: 1, name: 'Foundation fixture', rootPath }
  createWorkspaceAtPath(rootPath, workspace.name, { permissionMode: 'ask' })
  saveConfig({ workspaces: [workspace], activeWorkspaceId: workspace.id, activeSessionId: null })
  const stored = await createSession(rootPath, { name: 'Committed messages', permissionMode: 'ask' })
  const user: Message = { id: 'input-1', role: 'user', content: 'Inspect the fixture', timestamp: 1 }
  await saveSession({ ...loadSession(rootPath, stored.id)!, messages: [{ ...user, type: 'user' }] })
  const runtime = createDurableRuntime()
  const manager = new SessionManager(runtime)
  type FixturePort = {
    loadSessionsFromDisk(): void
    sessions: Map<string, { id: string; messages: Message[]; messagesLoaded: boolean; name?: string; enabledSourceSlugs?: string[]; hasUnread?: boolean; lastReadMessageId?: string }>
    persistSession(managed: unknown): void
    processEvent(managed: unknown, event: AgentEvent): Promise<void>
  }
  const port = manager as unknown as FixturePort
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  async function scene(id: string, verify: () => Promise<void>) {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  try {
    port.loadSessionsFromDisk()
    await manager.getSession(stored.id)
    const handle = runtime.execution.begin({ sessionId: stored.id, workspaceRootPath: rootPath })
    const runOperationId = 'fixture-run'
    runtime.execution.accept(handle, { operationId: runOperationId, userMessageId: user.id, userMessage: user.content })
    const request = { sessionId: stored.id, turnId: user.id, runOperationId,
      providerRequestId: 'request-1', provider: 'loopback', model: 'fixture', canonicalRequestHash: 'fixture-request' }
    const prepared = await runtime.effects.prepareModel(rootPath, request)
    const committed = await runtime.effects.commitModelOutcome(rootPath, { ...request,
      operationId: prepared.operationId, stopReason: 'stop', content: [{ type: 'text', text: 'Committed answer' }], text: 'Committed answer',
      usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.1 } })
    const event: AgentEvent = { type: 'text_complete', text: 'Committed answer', turnId: user.id,
      durableOperationId: prepared.operationId, durableSeq: committed.committedSeq, promptSnapshot: 'Preserve rich product metadata' }
    await port.processEvent(port.sessions.get(stored.id)!, event)
    const initial = (await manager.getSession(stored.id))!
    const events = runtime.queries.events(rootPath, { sessionId: stored.id })
    const fact = events.find(item => item.type === 'assistant_message_committed')!
    const identity = (fact.payload as { messageId: string }).messageId
    await scene('committed-model-identity', async () => {
      assert.equal(initial.messages.find(message => message.role === 'assistant')?.id, identity)
      assert.equal(reportLegacyProjectionParity(events, initial.messages).issueCount, 0)
      assert.equal(runtime.queries.usage(rootPath, { sessionId: stored.id }).length, 1)
    })
    await runtime.execution.finish(handle, 'complete', { notify: false })
    await sessionPersistenceQueue.flush(stored.id)
    const full = loadSession(rootPath, stored.id)!
    const reload = async () => {
      const reader = new SessionManager(runtime)
      ;(reader as unknown as FixturePort).loadSessionsFromDisk()
      return (await reader.getSession(stored.id))!
    }
    await scene('restart-retains-rich-metadata', async () => {
      const restored = await reload()
      assert.equal(restored.messages.find(message => message.role === 'assistant')?.promptSnapshot, 'Preserve rich product metadata')
    })
    await scene('committed-result-without-product-snapshot', async () => {
      await saveSession({ ...full, messages: full.messages.filter(message => message.type === 'user') })
      const restored = await reload()
      assert.equal(restored.messages.find(message => message.id === identity)?.content, 'Committed answer')
      assert.equal(restored.messages.filter(message => message.role === 'assistant').length, 1)
      assert.equal(runtime.queries.usage(rootPath, { sessionId: stored.id }).length, 1)
      assert.equal(runtime.queries.events(rootPath, { sessionId: stored.id }).filter(item => item.type === 'model_dispatch_committed').length, 1)
    })
    await scene('historical-product-id-preserved', async () => {
      const historical = { ...full, lastReadMessageId: 'historical-product-id', messages: full.messages.map(message =>
        message.type === 'assistant' ? { ...message, id: 'historical-product-id' } : message) }
      await saveSession(historical)
      const restored = await reload()
      assert.equal(restored.messages.find(message => message.role === 'assistant')?.id, 'historical-product-id')
      assert.equal(reportLegacyProjectionParity(events, restored.messages).issueCount, 0)
      assert.equal(restored.messages.find(message => message.role === 'assistant')?.promptSnapshot, 'Preserve rich product metadata')
    })
    await scene('duplicate-provider-delivery-is-idempotent', async () => {
      await port.processEvent(port.sessions.get(stored.id)!, event)
      assert.equal(port.sessions.get(stored.id)!.messages.filter(message => message.role === 'assistant').length, 1)
      assert.equal(runtime.queries.usage(rootPath, { sessionId: stored.id }).length, 1)
    })
    await scene('unverified-product-history-is-not-discarded', async () => {
      await saveSession({ ...full, messages: [...full.messages,
        { id: 'unverified-history', type: 'assistant', content: 'Retained product history', timestamp: 3 }] })
      const restored = await reload()
      assert.equal(restored.messages.find(message => message.id === 'unverified-history')?.content, 'Retained product history')
    })
    await scene('hydration-does-not-persist-parity-telemetry', async () => {
      const databasePath = join(rootPath, 'runtime', 'runtime.db')
      const database = new Database(databasePath, { readonly: true })
      try {
        const observations = () => database.query('SELECT * FROM projection_parity_observations ORDER BY session_id, cursor').all()
        const before = observations()
        assert.deepEqual(before, [])
        await reload()
        await reload()
        assert.deepEqual(observations(), before)
        run.json('parity-telemetry.json', { before, after: observations() })
      } finally { database.close() }
    })
    await scene('cold-persist-keeps-memory-metadata-and-synchronous-load', async () => {
      await saveSession(full)
      const reader = new SessionManager(runtime)
      const cold = reader as unknown as FixturePort
      cold.loadSessionsFromDisk()
      const managed = cold.sessions.get(stored.id)!
      assert.equal(managed.messagesLoaded, false)
      managed.name = 'Changed while cold'
      managed.enabledSourceSlugs = []
      managed.hasUnread = false
      managed.lastReadMessageId = ''
      cold.persistSession(managed)
      assert.equal(managed.messagesLoaded, true)
      assert(managed.messages.some(message => message.id === identity))
      await sessionPersistenceQueue.flush(stored.id)
      const persisted = loadSession(rootPath, stored.id)!
      assert.equal(persisted.name, 'Changed while cold')
      assert.deepEqual(persisted.enabledSourceSlugs, [])
      assert.equal(persisted.hasUnread, false)
      assert.equal(persisted.lastReadMessageId, '')
      run.json('cold-hydration.json', persisted)
    })
    await scene('canonical-rollback-and-canary-preserve-routing', async () => {
      const beforeMode = process.env.PHANERIS_DURABLE_SESSION_READ
      const beforeCanary = process.env.PHANERIS_DURABLE_SESSION_CANARY
      const results = []
      try {
        for (const [mode, canary, expected] of [
          ['canonical', '', true], ['legacy', '', false], ['shadow', '', false],
          ['canonical', 'another-session', false], ['canonical', stored.id, true],
        ] as const) {
          process.env.PHANERIS_DURABLE_SESSION_READ = mode
          process.env.PHANERIS_DURABLE_SESSION_CANARY = canary
          await saveSession({ ...full, messages: full.messages.filter(message => message.type === 'user') })
          const restored = await reload()
          const recovered = restored.messages.some(message => message.id === identity)
          assert.equal(recovered, expected, `${mode}/${canary}`)
          assert(restored.messages.some(message => message.id === user.id))
          results.push({ mode, canary, recovered })
        }
      } finally {
        if (beforeMode === undefined) delete process.env.PHANERIS_DURABLE_SESSION_READ
        else process.env.PHANERIS_DURABLE_SESSION_READ = beforeMode
        if (beforeCanary === undefined) delete process.env.PHANERIS_DURABLE_SESSION_CANARY
        else process.env.PHANERIS_DURABLE_SESSION_CANARY = beforeCanary
      }
      run.json('session-read-routing.json', results)
    })
    await scene('committed-tool-without-product-snapshot', async () => {
      const session = await manager.createSession(workspace.id, { name: 'Tool recovery fixture' })
      const scope = { sessionId: session.id, workspaceRootPath: rootPath }
      const toolHandle = runtime.execution.begin(scope)
      runtime.execution.accept(toolHandle, { operationId: 'tool-recovery-run', userMessageId: 'tool-input', userMessage: 'Inspect fixture' })
      const request = { sessionId: session.id, runOperationId: 'tool-recovery-run', turnId: 'tool-input',
        providerToolCallId: 'fixture-call', toolName: 'Read', args: { path: 'fixture.txt' } }
      const prepared = await runtime.effects.prepareTool(rootPath, request)
      await runtime.effects.commitToolOutcome(rootPath, { ...request, operationId: prepared.operationId,
        canonicalArgsHash: prepared.canonicalArgsHash, result: 'Committed tool result', isError: false })
      await runtime.execution.finish(toolHandle, 'complete', { notify: false })
      const reader = new SessionManager(runtime)
      ;(reader as unknown as FixturePort).loadSessionsFromDisk()
      const restored = (await reader.getSession(session.id))!
      const tool = restored.messages.find(message => message.toolUseId === 'fixture-call')
      assert.equal(tool?.toolResult, 'Committed tool result')
      assert.equal(tool?.toolStatus, 'completed')
      assert.equal(restored.messages.find(message => message.role === 'user')?.content, 'Inspect fixture')
      run.json('tool-recovery.json', { messages: restored.messages, events: runtime.queries.events(rootPath, { sessionId: session.id }) })
    })
    run.json('messages.json', { identity, events, initial: initial.messages, checks, failures })
    assert.deepEqual(failures, [], 'All Session identity and recovery scenes must pass')
    run.complete(checks, ['live provider APIs', 'native Linux filesystem semantics'])
  } finally {
    await sessionPersistenceQueue.flushAll()
    await runtime.close()
  }
})
