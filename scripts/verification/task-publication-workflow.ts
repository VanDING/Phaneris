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
await verificationWorkflow('task-publication', async run => {
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
    for (const [name, planning] of [
      ['progress', { progress: 101 }], ['dependency', { dependencyIds: ['absent-dependency'] }],
      ['parent', { parentId: foreign.id }],
    ] as const) await scene(`invalid-${name}-precedes-every-publication-effect`, async () => {
      const id = `reject-${name}`, before = manager.getSessions(a.id).length
      await assert.rejects(publish(id, { planning }))
      assert(!listTaskSlugs(a.rootPath).includes(id)); assert.equal(manager.getSessions(a.id).length, before)
    })
    await scene('invalid-attach-preserves-spec-card-and-binding', async () => {
      const { createProject } = await import('../../packages/shared/src/projects')
      const project = createProject(a.rootPath, { name: 'Keep project' })
      const id = 'bad-attached-plan', target = await manager.createSession(a.id, { name: 'Keep me', projectId: project.id })
      saveTaskSpec(a.rootPath, spec(id, 'Previous spec'))
      await assert.rejects(publish(id, { attachToExistingSession: target.id, planning: { progress: -1, statusId: 'done' } }))
      assert.equal(loadTaskSpec(a.rootPath, id)?.spec?.title, 'Previous spec')
      const current = await manager.getSession(target.id)
      assert.equal(current?.name, 'Keep me'); assert.equal(current?.taskSlug, undefined); assert.equal(current?.projectId, project.id)
    })
    await scene('same-slug-edit-reconciles-the-existing-card', async () => {
      const target = await manager.createSession(a.id, { name: 'Original card' })
      await publish('edit-card', { attachToExistingSession: target.id })
      await publish('edit-card', { attachToExistingSession: target.id, yaml: JSON.stringify(spec('edit-card', 'Edited card')) })
      assert.equal((await manager.getSession(target.id))?.name, 'Edited card')
    })
    await scene('agent-handler-concurrent-capture-allocates-distinct-slugs', async () => {
      const { handleCreateTask } = await import('../../packages/session-tools-core/src/handlers/create-task')
      const context = { createTask: (input: import('../../packages/session-tools-core/src/context').CreateTaskInput) => manager.getWorkspaceTaskPublisher(a.id).capture(input) }
      const responses = await Promise.all([handleCreateTask(context, { title: 'Concurrent capture', description: 'First' }), handleCreateTask(context, { title: 'Concurrent capture', description: 'Second' })])
      assert(responses.every(response => !response.isError), JSON.stringify(responses))
      const captures = manager.getSessions(a.id).filter(session => session.name === 'Concurrent capture')
      assert.equal(captures.length, 2); assert.equal(new Set(captures.map(session => session.taskSlug)).size, 2)
      for (const capture of captures) assert(loadTaskSpec(a.rootPath, capture.taskSlug!)?.valid)
    })
    await scene('agent-invalid-planning-leaves-no-spec-or-card', async () => {
      const before = manager.getSessions(a.id).length, slugs = listTaskSlugs(a.rootPath)
      await assert.rejects(manager.getWorkspaceTaskPublisher(a.id).capture({ title: 'Invalid agent capture', description: 'No effects', progress: 900 }))
      assert.deepEqual(listTaskSlugs(a.rootPath), slugs); assert.equal(manager.getSessions(a.id).length, before)
    })
    await scene('stable-agent-tool-identity-retries-the-same-capture', async () => {
      const { handleCreateTask } = await import('../../packages/session-tools-core/src/handlers/create-task')
      const context = { toolExecutionId: 'durable-tool-stable-capture', createTask: (input: import('../../packages/session-tools-core/src/context').CreateTaskInput, options?: { operationId?: string }) => manager.getWorkspaceTaskPublisher(a.id).capture(input, options) }
      const input = { title: 'Stable tool capture', description: 'Only one operation' }
      const first = await handleCreateTask(context, input), second = await handleCreateTask(context, input)
      assert(!first.isError && !second.isError, JSON.stringify([first, second]))
      assert.equal(manager.getSessions(a.id).filter(session => session.name === input.title).length, 1)
    })
    await scene('rpc-operation-id-cannot-be-reused-for-different-input', async () => {
      const operationId = crypto.randomUUID(), first = await publish('explicit-operation', { operationId })
      await assert.rejects(publish('explicit-operation', { operationId, yaml: JSON.stringify(spec('explicit-operation', 'Different intent')) }), /operationId|intent/i)
      assert.equal(loadTaskSpec(a.rootPath, 'explicit-operation')?.spec?.title, 'explicit-operation')
      assert.equal(manager.getSessions(a.id).filter(session => session.taskSlug === 'explicit-operation').length, 1)
      assert(first)
    })
    await scene('invalid-operation-id-is-rejected-at-the-wire-boundary', async () => {
      await assert.rejects(publish('invalid-operation-id', { operationId: 123 }), /Invalid RPC arguments|operationId/i)
      assert(!listTaskSlugs(a.rootPath).includes('invalid-operation-id'))
    })
    await scene('legacy-null-target-and-planning-remain-accepted', async () => {
      const result = await publish('legacy-null', { orchestratorSessionId: null, attachToExistingSession: null, planning: null, operationId: null }) as { orchestratorSessionId: string }
      assert(result.orchestratorSessionId)
    })
    await scene('unknown-agent-references-are-kept-and-warned', async () => {
      const captured = await manager.getWorkspaceTaskPublisher(a.id).capture({ title: 'Missing references', description: 'Warn only', sources: ['absent-source'], skills: ['absent-skill'] })
      assert(captured.warnings.some(value => value.includes('absent-source')))
      assert(captured.warnings.some(value => value.includes('absent-skill')))
      assert.deepEqual(loadTaskSpec(a.rootPath, captured.slug)?.spec?.sources, ['absent-source'])
    })
    run.json('scenarios.json', { checks, failures })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['Publication interruption/restart and external concurrent editing are tracked in the recovery batch', 'No paid model or external account'])
  } finally {
    client.destroy()
    await disconnected.promise
    server.close()
    await manager.cleanup()
  }
})
