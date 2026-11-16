#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { RpcResult } from '../../packages/shared/src/protocol'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Contract fixed first: deployed wire and Electron/Web bridge completion is void,
// for both existing and absent IDs. Deleting an item removes its backing session.
await verificationWorkflow('work-item-delete', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const completion: RpcResult<typeof c.workItems.DELETE> = undefined
  assert.equal(completion, undefined)
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { registerWorkItemHandlers } = await import('../../packages/server-core/src/handlers/rpc/work-items')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const ws = { id: 'delete-item', slug: 'delete-item', name: 'Delete item', rootPath: join(run.directory, 'workspace'), createdAt: 1 }
  createWorkspaceAtPath(ws.rootPath, ws.name)
  saveConfig({ workspaces: [ws], activeWorkspaceId: ws.id, activeSessionId: null })
  const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  registerWorkItemHandlers(server, { sessionManager: manager, platform: createHeadlessPlatform(), oauthFlowStore } satisfies HandlerDeps)
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: ws.id })
  try {
    await client.connect(); await manager.initialize()
    const session = await manager.createSession(ws.id, { name: 'Disposable item' })
    const existing = await client.invoke(c.workItems.DELETE, ws.id, session.id)
    assert.equal(existing, undefined); assert.equal(await manager.getSession(session.id), null)
    const missing = await client.invoke(c.workItems.DELETE, ws.id, session.id)
    assert.equal(missing, undefined)
    const items = await client.invoke(c.workItems.LIST, ws.id) as Array<{ id: string }>
    assert(!items.some(item => item.id === session.id))
    run.json('deletion.json', { existing: typeof existing, missing: typeof missing, backingSessionRemoved: true, projectionRemoved: true })
    run.complete(['existing-item-void-and-session-removed', 'absent-item-void', 'projection-updated'], ['UI deletion interaction is covered by the planning workflow'])
  } finally { client.destroy(); await disconnected.promise; server.close(); await manager.cleanup() }
})
