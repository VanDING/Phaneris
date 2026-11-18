import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveConfig } from '@phaneris/shared/config/repository'
import { loadWorkspaceSources } from '@phaneris/shared/sources'
import { loadAllSkills } from '@phaneris/shared/skills'
import { summarizePluginsForRenderer } from '@phaneris/shared/plugins'
import { RPC_CHANNELS as channel } from '@phaneris/shared/protocol'
import { WsRpcClient, WsRpcServer } from '@phaneris/server-core/transport'
import { ConfigWatcher } from '../../../packages/shared/src/config/watcher'
import type { HandlerDeps } from '../../../packages/server-core/src/handlers/handler-deps'
import { createHeadlessPlatform } from '../../../packages/server-core/src/runtime/platform-headless'
import { registerSkillsHandlers } from '../../../packages/server-core/src/handlers/rpc/skills'
import { registerSourcesHandlers } from '../../../packages/server-core/src/handlers/rpc/sources'
import { registerPluginsHandlers } from '../../../packages/server-core/src/handlers/rpc/plugins'
import { registerWorkspaceCoreHandlers } from '../../../packages/server-core/src/handlers/rpc/workspace'

const workspaceId = 'resource-icons-fixture'
const rootPath = join(process.env.PHANERIS_CONFIG_DIR!, 'workspace')
for (const type of ['sources', 'skills', 'plugins']) mkdirSync(join(rootPath, type, 'icon-check'), { recursive: true })
writeFileSync(join(rootPath, 'sources/icon-check/config.json'), JSON.stringify({
  slug: 'icon-check', name: 'Project files', type: 'local', provider: 'local', enabled: true, local: { path: rootPath },
}))
writeFileSync(join(rootPath, 'skills/icon-check/SKILL.md'), '---\nname: Document writer\ndescription: Write documents\n---\nWrite clearly.\n')
writeFileSync(join(rootPath, 'plugins/icon-check/plugin.json'), JSON.stringify({
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'icon-check', description: 'Document tools',
}))
saveConfig({
  workspaces: [{ id: workspaceId, slug: 'workspace', name: 'Icon verification', rootPath, createdAt: 1 }],
  activeWorkspaceId: workspaceId,
  activeSessionId: null,
})

const rpc = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
const deps = { platform: createHeadlessPlatform() } as HandlerDeps
registerSkillsHandlers(rpc, deps)
registerSourcesHandlers(rpc, deps)
registerPluginsHandlers(rpc, deps)
registerWorkspaceCoreHandlers(rpc, deps)
const target = { to: 'workspace', workspaceId } as const
const watcher = new ConfigWatcher(rootPath, {
  onSourceIconChange: () => rpc.push(channel.sources.CHANGED, target, workspaceId, loadWorkspaceSources(rootPath)),
  onSkillChange: () => rpc.push(channel.skills.CHANGED, target, workspaceId, loadAllSkills(rootPath)),
  onPluginsChange: ({ plugins, errors }) => rpc.push(channel.plugins.CHANGED, target, workspaceId, {
    plugins: summarizePluginsForRenderer(plugins), errors,
  }),
})
watcher.start()
await rpc.listen()
const client = new WsRpcClient(`ws://127.0.0.1:${rpc.port}`, { workspaceId })
client.connect()
await client.invoke(channel.sources.GET, workspaceId)

const changeChannels = {
  sources: channel.sources.CHANGED,
  skills: channel.skills.CHANGED,
  plugins: channel.plugins.CHANGED,
} as const
const events: Array<{ channel: string; args: unknown[] }> = []
for (const name of Object.values(changeChannels)) client.on(name, (...args) => events.push({ channel: name, args }))
const bridge = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const { channel: method, args } = await request.json()
    if (method === 'fixture:writeIcon') {
      const [type, shape] = args as [keyof typeof changeChannels, 'circle' | 'rect']
      if (!Object.hasOwn(changeChannels, type) || !['circle', 'rect'].includes(shape)) return new Response(null, { status: 400 })
      events.length = 0
      const contents = shape === 'circle' ? '<circle cx="12" cy="12" r="9" fill="currentColor"/>'
        : '<rect x="3" y="3" width="18" height="18" fill="currentColor"/>'
      const path = join(rootPath, type, 'icon-check', 'icon.svg')
      writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${contents}</svg>`)
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (events.some(event => event.channel === changeChannels[type])) return Response.json({ events: events.splice(0) })
        await Bun.sleep(25)
      }
      return Response.json({ error: 'Config watcher did not announce the icon update' }, { status: 504 })
    }
    if (method !== channel.sources.GET && method !== channel.skills.GET
        && method !== channel.plugins.LIST && method !== channel.workspace.READ_IMAGE) {
      return Response.json({ error: 'Fixture method not found' }, { status: 404 })
    }
    return Response.json({ value: await client.invoke(method, ...args), events: [] })
  },
})
console.log(`RESOURCE_ICONS_PORT=${bridge.port}`)
