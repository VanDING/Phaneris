import type { HandlerFn } from '../../../packages/server-core/src/transport/types'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveConfig } from '@phaneris/shared/config/repository'
import { createWorkspaceAtPath } from '@phaneris/shared/workspaces/storage'
import { listTaskSlugs, loadTaskSpec } from '@phaneris/shared/tasks'
import { SessionManager } from '@phaneris/server-core/sessions'
import { createDurableRuntime } from '@phaneris/server-core/durable-runtime'
import { WsRpcServer } from '@phaneris/server-core/transport'
import { registerTasksHandlers } from '../../../packages/server-core/src/handlers/rpc/tasks'
import { createHeadlessPlatform } from '../../../packages/server-core/src/runtime/platform-headless'
import { OAuthFlowStore } from '@phaneris/shared/auth'

const config = process.env.PHANERIS_CONFIG_DIR!, root = join(config, 'workspace')
if (!existsSync(join(config, 'config.json'))) {
  mkdirSync(config, { recursive: true }); createWorkspaceAtPath(root, 'Publication recovery')
  saveConfig({ workspaces: [{ id: 'publication', name: 'Publication recovery', slug: 'workspace', rootPath: root, createdAt: 1 }], activeWorkspaceId: 'publication', activeSessionId: null })
}
const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
const fault = process.env.PHANERIS_PUBLICATION_FAULT, slug = process.env.PHANERIS_PUBLICATION_SLUG
const create = manager.createSession.bind(manager), apply = manager.applyTaskPublicationPlanning.bind(manager)
manager.createSession = async (...args) => {
  const result = await create(...args)
  if (args[1]?.taskSlug === slug) {
    await manager.flushAllSessions()
    if (fault === 'created') process.exit(77)
    if (fault === 'hold-created') {
      writeFileSync(join(config, 'fault-held'), result.id)
      while (!existsSync(join(config, 'fault-release'))) await Bun.sleep(20)
    }
  }
  return result
}
manager.applyTaskPublicationPlanning = async (...args) => {
  await apply(...args)
  if (fault === 'planned') { await manager.flushAllSessions(); process.exit(78) }
}
const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true,
  validateToken: async value => value === process.env.PHANERIS_SERVER_TOKEN })
const register = server.handle.bind(server)
server.handle = (channel: string, handler: HandlerFn) => register(channel, async (ctx, ...args) => {
  const result = await handler(ctx, ...args)
  if (fault === 'receipt' && channel === 'tasks:create') process.exit(79)
  return result
})
registerTasksHandlers(server, { sessionManager: manager, oauthFlowStore, platform: createHeadlessPlatform() })
server.handle('publication:facts', () => ({ sessions: manager.getSessions('publication'),
  specs: listTaskSlugs(root).map(id => ({ id, title: loadTaskSpec(root, id)?.spec?.title })) }))
server.handle('publication:rename', (_ctx, id: string, title: string) => manager.renameSession(id, title))
await manager.initialize(); await server.listen()
console.log(`PHANERIS_SERVER_URL=ws://127.0.0.1:${server.port}`)
process.on('SIGTERM', () => { void manager.cleanup().finally(() => process.exit(0)) })
