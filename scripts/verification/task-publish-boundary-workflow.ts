#!/usr/bin/env bun
/** Failure-first contract for task publication's precommit ownership boundary. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Explicit binding must never fall back or overwrite a spec on rejection.
// Foreign draft adoption is rejected; absent draft adoption retains its fallback.
// Malformed/reversed dates must fail before task.yaml or a visible card exists.
await verificationWorkflow('task-publish-boundary', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { listTaskSlugs, loadTaskSpec, saveTaskSpec } = await import('../../packages/shared/src/tasks/storage')
  const { registerTasksHandlers } = await import('../../packages/server-core/src/handlers/rpc/tasks')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const workspaces = ['a', 'b'].map(id => ({ id, slug: id, name: id, rootPath: join(run.directory, id), createdAt: 1 }))
  for (const ws of workspaces) { mkdirSync(ws.rootPath, { recursive: true }); createWorkspaceAtPath(ws.rootPath, ws.name) }
  const a = workspaces[0]!, b = workspaces[1]!
  saveConfig({ workspaces, activeWorkspaceId: a.id, activeSessionId: null })
  const manager = new SessionManager(createDurableRuntime())
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const oauthFlowStore = new OAuthFlowStore()
  oauthFlowStore.dispose()
  registerTasksHandlers(server, { sessionManager: manager, platform: createHeadlessPlatform(), oauthFlowStore } satisfies HandlerDeps)
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: a.id })
  const spec = (id: string, title = id) => ({ id, title, goal: 'Verify isolated publication', runner: 'conduct' as const, nodes: [{ id: 'one', kind: 'session' as const, prompt: 'No model execution' }] })
  const publish = (id: string, extra: object = {}) => client.invoke(c.tasks.CREATE, a.id, { yaml: JSON.stringify(spec(id)), ...extra })
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  try {
    await client.connect()
    await manager.initialize()
    const foreign = await manager.createSession(b.id, { name: 'Foreign unchanged' })
    const foreignDraft = await manager.createSession(b.id, { name: 'Foreign draft', taskDraft: true })
    await scene('missing-explicit-target-leaves-no-spec', async () => {
      await assert.rejects(publish('missing-target', { attachToExistingSession: 'absent' }))
      assert(!listTaskSlugs(a.rootPath).includes('missing-target'))
    })
    await scene('foreign-explicit-target-remains-untouched', async () => {
      await assert.rejects(publish('foreign-target', { attachToExistingSession: foreign.id }))
      assert(!listTaskSlugs(a.rootPath).includes('foreign-target'))
      const current = await manager.getSession(foreign.id)
      assert.equal(current?.name, 'Foreign unchanged')
      assert.equal(current?.taskSlug, undefined)
    })
    await scene('foreign-draft-is-not-adopted', async () => {
      await assert.rejects(publish('foreign-draft', { orchestratorSessionId: foreignDraft.id }))
      assert(!listTaskSlugs(a.rootPath).includes('foreign-draft'))
      assert.equal((await manager.getSession(foreignDraft.id))?.taskDraft, true)
    })
    await scene('rejected-attach-preserves-existing-spec', async () => {
      const original = spec('preserve-spec', 'Previous specification')
      saveTaskSpec(a.rootPath, original)
      await assert.rejects(publish('preserve-spec', { attachToExistingSession: 'absent' }))
      assert.equal(loadTaskSpec(a.rootPath, original.id)?.spec?.title, original.title)
    })
    await scene('incompatible-slug-does-not-publish', async () => {
      const target = await manager.createSession(a.id, { name: 'Bound', taskSlug: 'other-slug' })
      await assert.rejects(publish('conflicting-slug', { attachToExistingSession: target.id }))
      assert(!listTaskSlugs(a.rootPath).includes('conflicting-slug'))
      assert.equal((await manager.getSession(target.id))?.taskSlug, 'other-slug')
    })
    await scene('invalid-date-has-no-side-effects', async () => {
      const before = manager.getSessions(a.id).length
      await assert.rejects(publish('invalid-date', { planning: { startAt: '2026-9-2' } }))
      assert(!listTaskSlugs(a.rootPath).includes('invalid-date'))
      assert.equal(manager.getSessions(a.id).length, before)
    })
    await scene('reversed-range-has-no-side-effects', async () => {
      const before = manager.getSessions(a.id).length
      await assert.rejects(publish('reversed-range', { planning: { startAt: '2026-11-20', dueAt: '2026-11-19' } }))
      assert(!listTaskSlugs(a.rootPath).includes('reversed-range'))
      assert.equal(manager.getSessions(a.id).length, before)
    })
    await scene('valid-bind-and-same-identity-edit', async () => {
      const target = await manager.createSession(a.id, { name: 'Local card' })
      const first = await publish('valid-bind', { attachToExistingSession: target.id }) as { orchestratorSessionId: string }
      const second = await publish('valid-bind', { attachToExistingSession: target.id, yaml: JSON.stringify(spec('valid-bind', 'Edited')) }) as { orchestratorSessionId: string }
      assert.equal(first.orchestratorSessionId, target.id)
      assert.equal(second.orchestratorSessionId, target.id)
      assert.equal(loadTaskSpec(a.rootPath, 'valid-bind')?.spec?.title, 'Edited')
      assert.equal(manager.getSessions(a.id).filter(s => s.taskSlug === 'valid-bind').length, 1)
    })
    await scene('absent-draft-retains-fresh-fallback', async () => {
      const result = await publish('draft-fallback', { orchestratorSessionId: 'discarded-draft' }) as { orchestratorSessionId: string }
      assert(result.orchestratorSessionId)
      assert.equal((await manager.getSession(result.orchestratorSessionId))?.taskSlug, 'draft-fallback')
    })
    run.json('scenarios.json', { checks, failures })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['Full multi-store publication recovery/concurrency is a later implementation batch', 'No paid model or external account'])
  } finally {
    client.destroy()
    await disconnected.promise
    server.close()
    await manager.cleanup()
  }
})
