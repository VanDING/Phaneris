import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { saveConfig } from '@phaneris/shared/config/repository'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { WsRpcClient, WsRpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../../../packages/server-core/src/handlers/handler-deps'
import { registerResourcesHandlers } from '../../../packages/server-core/src/handlers/rpc/resources'

const workspaceId = 'resource-icons-fixture'
const rootPath = join(process.env.PHANERIS_CONFIG_DIR!, 'workspace')
mkdirSync(rootPath, { recursive: true })
saveConfig({
  workspaces: [{ id: workspaceId, slug: 'workspace', name: 'Icon verification', rootPath, createdAt: 1 }],
  activeWorkspaceId: workspaceId,
  activeSessionId: null,
})
const rpc = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
registerResourcesHandlers(rpc, {} as HandlerDeps)
await rpc.listen()
const client = new WsRpcClient(`ws://127.0.0.1:${rpc.port}`, { workspaceId })
await client.connect()
const events: unknown[][] = []
client.on(RPC_CHANNELS.resources.ICON_CHANGED, (...args) => events.push(args))
const bridge = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const { channel, args } = await request.json()
    if (channel !== RPC_CHANNELS.resources.GET_ICONS && channel !== RPC_CHANNELS.resources.SET_ICON) {
      return Response.json({ error: 'Fixture method not found' }, { status: 404 })
    }
    try {
      const value = await client.invoke(channel, ...args)
      return Response.json({ value, events: events.splice(0) })
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 })
    }
  },
})
console.log(`RESOURCE_ICONS_PORT=${bridge.port}`)
