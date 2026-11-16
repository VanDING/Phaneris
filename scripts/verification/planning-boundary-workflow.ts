#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Before the domain migration: one read per list; reject a complete invalid
// patch before changing title/project/status/column; preserve legacy calendar
// title/preview and schedule-only delete; work-item deletion removes its Session.
await verificationWorkflow('planning-boundary', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveSession, loadSession, getSessionFilePath } = await import('../../packages/shared/src/sessions')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { registerWorkItemHandlers } = await import('../../packages/server-core/src/handlers/rpc/work-items')
  const { registerCalendarHandlers } = await import('../../packages/server-core/src/handlers/rpc/calendar')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, slug: id, rootPath: join(run.directory, id), createdAt: 1 }))
  for (const ws of workspaces) createWorkspaceAtPath(ws.rootPath, ws.name)
  const ws = workspaces[0]!
  saveConfig({ workspaces, activeWorkspaceId: ws.id, activeSessionId: null })
  const preview = 'LONG_PREVIEW_'.repeat(50), tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  for (const [id, extra] of [['blank', {}], ['long', { messages: [{ id: 'original', type: 'user', content: preview, timestamp: 1 }] }],
    ['hidden', { hidden: true }], ['archived', { isArchived: true, archivedAt: 2 }], ['draft', { taskDraft: true }]] as const) {
    await saveSession({ id, workspaceRootPath: ws.rootPath, createdAt: 1, lastUsedAt: 1, tokenUsage,
      startAt: '2026-10-31', dueAt: '2026-11-02', ...extra, messages: [...('messages' in extra ? extra.messages : [])] })
  }
  // Older/external header writers may retain an unbounded preview. Current
  // saveSession truncates it; preserve the documented legacy read contract.
  const legacyFile = getSessionFilePath(ws.rootPath, 'long'), legacyBytes = readFileSync(legacyFile)
  const newline = legacyBytes.indexOf(10), header = JSON.parse(legacyBytes.subarray(0, newline).toString())
  writeFileSync(legacyFile, Buffer.concat([Buffer.from(JSON.stringify({ ...header, preview }) + '\n'), legacyBytes.subarray(newline + 1)]))
  const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const auth = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === auth,
    onClientDisconnected: () => disconnected.resolve() })
  const deps = { sessionManager: manager, oauthFlowStore, platform: createHeadlessPlatform() } satisfies HandlerDeps
  registerWorkItemHandlers(server, deps); registerCalendarHandlers(server, deps)
  await manager.initialize(); await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token: auth, workspaceId: ws.id }); await client.connect()
  const originalGet = manager.getSessions.bind(manager); let reads = 0
  manager.getSessions = id => { reads++; return originalGet(id) }
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    await scene('work-item-list-takes-one-session-snapshot', async () => {
      reads = 0; const items = await client.invoke(c.workItems.LIST, ws.id)
      assert.deepEqual(items.map(item => item.id).sort(), ['blank', 'long']); assert.equal(reads, 1)
    })
    await scene('legacy-calendar-retains-title-preview-dates-and-visibility', async () => {
      const items = await client.invoke(c.workItems.LIST, ws.id)
      const entries = await client.invoke(c.calendar.LIST, ws.id) as Array<{ id: string; title: string; date: string; endDate: string; allDay: boolean }>
      assert.deepEqual(entries.map(entry => entry.id).sort(), ['blank', 'long'])
      assert.equal(entries.find(entry => entry.id === 'blank')!.title, 'Untitled schedule')
      assert.equal(items.find(item => item.id === 'blank')!.title, 'Untitled task')
      assert.equal(entries.find(entry => entry.id === 'long')!.title, preview)
      assert.equal(items.find(item => item.id === 'long')!.title, preview.slice(0, 240))
      assert(entries.every(entry => entry.date === '2026-10-31' && entry.endDate === '2026-11-02' && entry.allDay))
    })
    for (const [id, patch] of [['reversed', { startAt: '2026-11-04', dueAt: '2026-11-03' }],
      ['dependency', { dependencyIds: ['missing'] }], ['progress', { progress: 101 }], ['parent-cycle', { parentId: 'blank' }]] as const) {
      await scene(`invalid-${id}-cannot-leave-half-updated-metadata`, async () => {
        const target = await manager.createSession(ws.id, { name: 'Original metadata', startAt: '2026-11-01', dueAt: '2026-11-02' })
        const before = loadSession(ws.rootPath, target.id)!
        await assert.rejects(client.invoke(c.workItems.UPDATE, ws.id, target.id, { title: 'Uncommitted name', projectId: 'Uncommitted project', statusId: 'done', columnId: 'Uncommitted column', ...patch,
          ...(id === 'parent-cycle' ? { parentId: target.id } : {}) }))
        const after = loadSession(ws.rootPath, target.id)!
        for (const field of ['name', 'projectId', 'sessionStatus', 'kanbanColumn', 'startAt', 'dueAt', 'progress', 'parentSessionId'] as const) assert.equal(after[field], before[field], field)
      })
    }
    await scene('invalid-legacy-clock-creates-no-card', async () => {
      const before = originalGet(ws.id).length
      await assert.rejects(client.invoke(c.calendar.CREATE, ws.id, { title: 'Bad clock', date: '2026-11-01', time: '25:99', allDay: false }))
      assert.equal(originalGet(ws.id).length, before)
    })
    await scene('legacy-extra-write-fields-accepted-but-not-associated', async () => {
      const item = await client.invoke(c.workItems.CREATE, ws.id, { title: 'Standalone', sessionIds: ['blank'], primarySessionId: 'blank', statusId: 'todo', columnId: 'physical-column' })
      assert.deepEqual(item.sessionIds, [item.id]); assert.equal(item.primarySessionId, item.id)
      assert.equal(item.columnId, 'physical-column'); assert.equal(item.statusId, 'todo')
    })
    await scene('null-clears-and-omission-preserves', async () => {
      await client.invoke(c.workItems.UPDATE, ws.id, 'long', { description: 'Retained note', projectId: 'project', progress: 40 })
      const unchanged = await client.invoke(c.workItems.UPDATE, ws.id, 'long', { title: 'Named' })
      assert.equal(unchanged?.description, 'Retained note'); assert.equal(unchanged?.progress, 40)
      const cleared = await client.invoke(c.workItems.UPDATE, ws.id, 'long', { description: null, projectId: null, progress: null })
      assert.equal(cleared?.description, undefined); assert.equal(cleared?.projectId, undefined); assert.equal(cleared?.progress, undefined)
    })
    await scene('two-deletion-intents-retain-old-wire-behavior', async () => {
      assert.equal(await client.invoke(c.calendar.DELETE, ws.id, 'long'), undefined)
      assert(loadSession(ws.rootPath, 'long')); assert.equal(loadSession(ws.rootPath, 'long')!.dueAt, undefined)
      assert.equal(await client.invoke(c.workItems.DELETE, ws.id, 'long'), undefined); assert.equal(loadSession(ws.rootPath, 'long'), null)
    })
    run.json('scenarios.json', { checks, failures }); assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Timeline/DST arithmetic and full Board interactions are covered by their dedicated workflows'])
  } finally { client.destroy(); await disconnected.promise; server.close(); await manager.cleanup() }
})
