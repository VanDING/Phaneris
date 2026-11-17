#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Before migration: UI and Agent mutations must each announce one committed
// list, refresh the watcher, and schedule posters only for changed HTML. An
// external edit still announces; missing grants and rejected changes do not.
// Postcommit notification failure must not invite a duplicate mutation retry.
await verificationWorkflow('pages-mutation', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  process.env.PHANERIS_IS_PACKAGED = '0'
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { registerPagesHandlers } = await import('../../packages/server-core/src/handlers/rpc/pages')
  const { buildPagesToolCallbacks } = await import('../../packages/server-core/src/pages/tool-callbacks')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const ws = { id: 'pages', name: 'Pages', slug: 'pages', rootPath: join(run.directory, 'workspace'), createdAt: 1 }
  createWorkspaceAtPath(ws.rootPath, ws.name)
  saveConfig({ workspaces: [ws], activeWorkspaceId: ws.id, activeSessionId: null })
  const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  const events: unknown[][] = [], posters: string[] = []
  const realPush = server.push.bind(server)
  server.push = (channel, target, ...args) => { if (channel === c.pages.CHANGED) events.push(args); realPush(channel, target, ...args) }
  manager.setEventSink((channel, target, ...args) => server.push(channel, target, ...args))
  manager.enqueuePageThumbnail = (_id, _root, slug) => { posters.push(slug) }
  registerPagesHandlers(server, { sessionManager: manager, oauthFlowStore, platform: createHeadlessPlatform() } satisfies HandlerDeps)
  await server.listen(); await manager.initialize()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: ws.id, token }); await client.connect()
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const settle = () => Bun.sleep(650)
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await settle(); events.length = 0; posters.length = 0; await action(); checks.push(id) }
    catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    await scene('rpc-create-content-once-after-watcher', async () => {
      await client.invoke(c.pages.CREATE, ws.id, { name: 'RPC page', content: '<p>first</p>' })
      await settle(); assert.equal(events.length, 1); assert.deepEqual(posters, ['rpc-page'])
    })
    await scene('rpc-metadata-no-poster-once', async () => {
      await client.invoke(c.pages.UPDATE, ws.id, 'rpc-page', { description: 'changed' })
      await settle(); assert.equal(events.length, 1); assert.equal(posters.length, 0)
    })
    await scene('rpc-content-poster-once', async () => {
      await client.invoke(c.pages.SET_CONTENT, ws.id, 'rpc-page', '<p>second</p>')
      await settle(); assert.equal(events.length, 1); assert.deepEqual(posters, ['rpc-page'])
    })
    await scene('grant-miss-and-invalid-change-have-no-notification', async () => {
      assert.equal(await client.invoke(c.pages.REVOKE_GRANT, ws.id, 'rpc-page', 'missing'), false)
      await assert.rejects(client.invoke(c.pages.UPDATE, ws.id, 'missing', { name: 'Bad' }))
      await settle(); assert.equal(events.length, 0); assert.equal(posters.length, 0)
    })
    await scene('external-config-edit-notifies', async () => {
      const file = join(ws.rootPath, 'pages', 'rpc-page', 'page.json'), config = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...config, description: 'External edit', updatedAt: Date.now() }))
      await settle(); assert.equal(events.length, 1)
    })
    await scene('explicit-regenerate-retains-native-intent', async () => {
      assert.equal(await client.invoke(c.pages.REGENERATE_THUMBNAIL, ws.id, 'rpc-page'), true)
      assert.deepEqual(posters, ['rpc-page']); assert.equal(events.length, 0)
    })
    // Intention injected to Agent; no grant or publication surface.
    const tools = () => buildPagesToolCallbacks({ workspaceId: ws.id, workspaceRootPath: ws.rootPath, pages: manager.getWorkspacePages(ws.id) })
    await scene('agent-create-and-content-notifies-once', async () => {
      await tools().createPage({ name: 'Agent page', content: '<p>agent</p>' })
      await settle(); assert.equal(events.length, 1); assert.deepEqual(posters, ['agent-page'])
    })
    await scene('agent-combined-metadata-content-completes-once', async () => {
      await tools().updatePage('agent-page', { description: 'Agent updated', content: '<p>new</p>' })
      await settle(); assert.equal(events.length, 1); assert.deepEqual(posters, ['agent-page'])
    })
    await scene('agent-data-write-does-not-trigger-poster', async () => {
      await tools().writePageData('agent-page', { set: { total: 42 } })
      await settle(); assert.equal(events.length, 1); assert.equal(posters.length, 0)
    })
    await scene('agent-and-rpc-delete-share-completion', async () => {
      await tools().deletePage('agent-page'); await settle(); assert.equal(events.length, 1)
      events.length = 0
      await client.invoke(c.pages.DELETE, ws.id, 'rpc-page'); await settle(); assert.equal(events.length, 1)
    })
    await scene('headless-and-postcommit-notify-failure-retain-success', async () => {
      const { createWorkspacePages } = await import('../../packages/server-core/src/pages/workspace-pages')
      const warnings: string[] = []
      const pages = createWorkspacePages(ws, { notify: () => { throw new Error('watcher fixture') }, changed: () => { throw new Error('push fixture') }, log: msg => warnings.push(msg) })
      const page = await pages.create({ name: 'Committed page', content: '<p>ok</p>' })
      assert.equal(page.slug, 'committed-page'); assert.equal(warnings.length, 2)
      assert((await tools().getPage(page.slug))?.hasContent)
    })
    run.json('scenarios.json', { checks, failures })
    assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['No real remote publication; remote failure warnings covered by existing publisher and tool storage tests'])
  } finally { client.destroy(); await disconnected.promise; server.close(); await manager.cleanup() }
})
