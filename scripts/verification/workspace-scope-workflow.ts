#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Before implementation: bound A cannot search/mark B or consume B output;
// owner access, global summaries, unbound explicit targets and explicit imports
// remain available. Switching a connection changes its current workspace.
await verificationWorkflow('workspace-scope', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions')
  const { registerWorkspaceCoreHandlers } = await import('../../packages/server-core/src/handlers/rpc/workspace')
  const { setSearchPlatform } = await import('../../packages/server-core/src/services/search')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const workspaces = ['a', 'b'].map(id => ({ id, slug: id, name: id, rootPath: join(run.directory, id), createdAt: 1 }))
  for (const ws of workspaces) createWorkspaceAtPath(ws.rootPath, ws.name)
  const a = workspaces[0]!, b = workspaces[1]!
  saveConfig({ workspaces, activeWorkspaceId: a.id, activeSessionId: null })
  const platform = createHeadlessPlatform(); setSearchPlatform(platform)
  const manager = new SessionManager(createDurableRuntime())
  const token = crypto.randomUUID(), allDisconnected = Promise.withResolvers<void>()
  let disconnected = 0
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => { if (++disconnected === 3) allDisconnected.resolve() } })
  const deps = { platform, sessionManager: manager, oauthFlowStore } satisfies HandlerDeps
  registerSessionsHandlers(server, deps); registerWorkspaceCoreHandlers(server, deps)
  await server.listen()
  const clients = [a.id, b.id, undefined].map(workspaceId => new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId }))
  const [clientA, clientB, legacy] = clients as [InstanceType<typeof CliRpcClient>, InstanceType<typeof CliRpcClient>, InstanceType<typeof CliRpcClient>]
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  const bundle = (id: string) => ({ version: 1 as const, session: { header: { id, createdAt: 1, lastUsedAt: 1,
    workspaceRootPath: b.rootPath, messageCount: 1,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } }, messages: [
    { id: 'input', type: 'user' as const, content: 'scopeprobeuniquephrase', timestamp: 1 },
  ] }, files: [] })
  const task = async (id: string) => {
    const outputFile = join(b.rootPath, `${id}.txt`)
    writeFileSync(outputFile, `owned by b: ${id}`)
    const port = manager as unknown as { sessions: Map<string, unknown>; processEvent(session: unknown, event: unknown): Promise<void> }
    await port.processEvent(port.sessions.get('scope-b'), { type: 'task_completed', taskId: id, outputFile, summary: id, status: 'completed' })
  }
  try {
    await Promise.all(clients.map(client => client.connect()))
    await manager.initialize()
    await manager.importSession(b.id, bundle('scope-b'), 'move')
    await scene('bound-cross-workspace-search-rejected-owner-readable', async () => {
      await assert.rejects(clientA.invoke(c.sessions.SEARCH_CONTENT, b.id, 'scopeprobeuniquephrase'), /workspace/)
      const hits = await clientB.invoke(c.sessions.SEARCH_CONTENT, b.id, 'scopeprobeuniquephrase') as Array<{ sessionId: string }>
      assert(hits.some(hit => hit.sessionId === 'scope-b'))
    })
    await scene('rejected-bulk-read-preserves-unread', async () => {
      await manager.markSessionUnread('scope-b')
      const before = manager.getUnreadSummary().byWorkspace[b.id]
      assert(before > 0)
      await assert.rejects(clientA.invoke(c.sessions.MARK_ALL_READ, b.id), /workspace/)
      assert.equal(manager.getUnreadSummary().byWorkspace[b.id], before)
      await clientB.invoke(c.sessions.MARK_ALL_READ, b.id)
      assert.equal(manager.getUnreadSummary().byWorkspace[b.id] ?? 0, 0)
    })
    await scene('rejected-task-output-remains-consumable-by-owner', async () => {
      await task('owned-output')
      await assert.rejects(clientA.invoke(c.tasks.GET_OUTPUT, 'owned-output'), /workspace/)
      assert.equal(await clientB.invoke(c.tasks.GET_OUTPUT, 'owned-output'), 'owned by b: owned-output')
      assert.equal(await clientB.invoke(c.tasks.GET_OUTPUT, 'owned-output'), null)
    })
    await scene('unbound-explicit-target-compatibility', async () => {
      const hits = await legacy.invoke(c.sessions.SEARCH_CONTENT, b.id, 'scopeprobeuniquephrase') as Array<{ sessionId: string }>
      assert(hits.some(hit => hit.sessionId === 'scope-b'))
      await manager.markSessionUnread('scope-b')
      await legacy.invoke(c.sessions.MARK_ALL_READ, b.id)
      assert.equal(manager.getUnreadSummary().byWorkspace[b.id] ?? 0, 0)
      await task('legacy-output')
      assert.equal(await legacy.invoke(c.tasks.GET_OUTPUT, 'legacy-output'), 'owned by b: legacy-output')
    })
    await scene('global-unread-summary-remains-global', async () => {
      await manager.markSessionUnread('scope-b')
      const summary = await clientA.invoke(c.sessions.GET_UNREAD_SUMMARY) as { byWorkspace: Record<string, number> }
      assert(summary.byWorkspace[b.id]! > 0)
    })
    await scene('explicit-cross-workspace-import-remains-available', async () => {
      await clientA.invoke(c.sessions.IMPORT, b.id, bundle('explicit-import'), 'move')
      assert.equal(manager.getSessionWorkspaceId('explicit-import'), b.id)
    })
    await scene('switched-client-uses-new-workspace', async () => {
      await clientA.invoke(c.window.SWITCH_WORKSPACE, b.id)
      await task('after-switch')
      assert.equal(await clientA.invoke(c.tasks.GET_OUTPUT, 'after-switch'), 'owned by b: after-switch')
      await assert.rejects(clientA.invoke(c.sessions.MARK_ALL_READ, a.id), /workspace/)
    })
    run.json('scenarios.json', { checks, failures })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['Single-server token remains server-wide authority; workspace claims are routing scope, not account isolation'])
  } finally {
    for (const client of clients) client.destroy()
    await allDisconnected.promise
    server.close(); await manager.cleanup()
  }
})
