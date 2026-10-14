/** Offline C02 host: production bootstrap, handlers, SessionManager and Web UI. */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { createWebuiHandler, nodeHttpAdapter } from '@phaneris/server-core/webui'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@phaneris/server-core/handlers/rpc'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { setFetcherPlatform } from '@phaneris/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@phaneris/server-core/services'
import { saveSession, loadSession } from '@phaneris/shared/sessions'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'

const config = process.env.PHANERIS_CONFIG_DIR!, token = process.env.PHANERIS_SERVER_TOKEN!
if (!config || !token) throw new Error('C02 requires an isolated config and fixture token')
const count = Number(process.env.PHANERIS_C02_SIZE ?? 1000), root = resolve(import.meta.dir, '../../..')
const workspace = join(config, 'workspace'), other = join(config, 'other')
for (const path of [workspace, other]) mkdirSync(path, { recursive: true })
const fixtures = Array.from({ length: count }, (_, index) => ({
  id: `planning-${String(index).padStart(5, '0')}`, name: index === 0 ? 'C02 canary' : `C02 task ${index}`,
  createdAt: 1_790_000_000_000 + index, lastUsedAt: 1_790_000_000_000 + index, sessionStatus: 'todo',
  permissionMode: 'safe' as const, description: 'Bounded planning description. '.repeat(32),
  startAt: index === 1 ? undefined : index < 16 ? '2026-10-14' : index % 2 ? undefined : '2030-02-12',
  dueAt: index === 1 ? undefined : index < 16 ? '2026-10-15' : index % 2 ? undefined : '2030-02-14',
  progress: 0, messages: [], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
}))
for (let index = 0; index < fixtures.length; index += 16) await Promise.all(fixtures.slice(index, index + 16).map(session => saveSession({ ...session, workspaceRootPath: workspace, workingDirectory: workspace })))
for (const [id, flags] of [['planning-hidden', { hidden: true }], ['planning-archived', { isArchived: true }], ['planning-draft', { taskDraft: true }]] as const) {
  await saveSession({ ...fixtures[0]!, id, name: id, workspaceRootPath: workspace, workingDirectory: workspace, ...flags })
}
await saveSession({ ...fixtures[0]!, id: 'other-canary', name: 'C02 other workspace', workspaceRootPath: other, workingDirectory: other })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [
  { id: 'planning', name: 'C02 workspace', rootPath: workspace, createdAt: 1 },
  { id: 'other', name: 'C02 other', rootPath: other, createdAt: 1 },
], activeWorkspaceId: 'planning', activeSessionId: null, setupDeferred: true, llmConnections: [] }))
const fixtureSha256 = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex')
let web: ReturnType<typeof createWebuiHandler> | undefined, route: ReturnType<typeof nodeHttpAdapter> | undefined
const lists = new Set<string>([RPC_CHANNELS.workItems.LIST, RPC_CHANNELS.calendar.LIST])
const changes = new Set<string>([RPC_CHANNELS.workItems.CHANGED, RPC_CHANNELS.calendar.CHANGED])
let reads: { channel: string; workspaceId: string; elapsedMs: number; bytes: number; rows: number; startedAt: number }[] = []
let pushes: { channel: string; workspaceId: string; at: number }[] = [], projections: { rows: number; elapsedMs: number }[] = []
let inFlight = 0, maxInFlight = 0, failNextList = false, failNextWrite = false
let failedReads = 0
let failedWrites = 0
let holdNext = false, held: (() => void) | undefined
const originalGet = SessionManager.prototype.getSessions
SessionManager.prototype.getSessions = function (workspaceId) {
  const start = performance.now(), result = originalGet.call(this, workspaceId)
  projections.push({ rows: result.length, elapsedMs: performance.now() - start }); return result
}
const instance = await bootstrapServer({
  serverToken: token, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: join(root, 'apps/electron'),
  validateSessionCookie: async (cookie, request) => await web?.validateSessionCookie(cookie, request) ?? false,
  httpHandler: (request, response) => {
    const host = request.headers.host ?? ''
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ws://${host}; frame-src 'self' blob: data:; object-src 'none'`)
    if (route) route(request, response); else { response.statusCode = 503; response.end() }
  },
  applyPlatformToSubsystems(platform) {
    setFetcherPlatform(platform); setSessionPlatform(platform)
    setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) })
    setSearchPlatform(platform); setImageProcessor(platform.imageProcessor)
  },
  createSessionManager: runtime => new SessionManager(runtime), createHandlerDeps: deps => deps,
  registerAllRpcHandlers(server, deps) {
    const register = server.handle.bind(server), push = server.push.bind(server)
    server.push = (channel, target, ...args) => {
      if (changes.has(channel)) pushes.push({ channel, workspaceId: String(args[0]), at: Date.now() })
      return push(channel, target, ...args)
    }
    server.handle = (channel, handler) => register(channel, async (ctx, ...args) => {
      const isList = lists.has(channel), start = performance.now(), startedAt = Date.now()
      if (isList) { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight) }
      try {
        if (isList && failNextList) { failNextList = false; failedReads++; throw new Error('C02 injected list rejection') }
        if ((channel === RPC_CHANNELS.workItems.UPDATE || channel === RPC_CHANNELS.calendar.UPDATE) && failNextWrite) { failNextWrite = false; failedWrites++; throw new Error('C02 injected write rejection') }
        const result = await handler(ctx, ...args), elapsedMs = performance.now() - start
        if (isList) {
          reads.push({ channel, workspaceId: String(args[0]), elapsedMs, bytes: Buffer.byteLength(JSON.stringify(result)), rows: Array.isArray(result) ? result.length : 0, startedAt })
          if (holdNext) { holdNext = false; await new Promise<void>(resolveHeld => { held = resolveHeld }) }
        }
        return result
      } finally { if (isList) inFlight-- }
    })
    registerCoreRpcHandlers(server, deps)
  },
  initializeSessionManager: manager => manager.initialize(), bindRpcServer: (manager, server) => manager.setRpcServer(server),
  setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
  cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  cleanupClientResources: cleanupSessionFileWatchForClient,
})
const manager = instance.sessionManager
const metrics = () => ({ reads, failedReads, failedWrites, pushes, projections, inFlight, maxInFlight, held: Boolean(held), memory: process.memoryUsage(), fixtureSha256, count })
web = createWebuiHandler({ webuiDir: join(root, 'apps/webui/dist'), secret: token, secureCookies: false, wsProtocol: 'ws', wsPort: instance.port, getHealthCheck: () => ({ status: 'ok' }), logger: instance.platform.logger })
route = nodeHttpAdapter(async request => {
  if (new URL(request.url).pathname !== '/__planning') return web!.fetch(request)
  if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
  try {
    const body = await request.json() as { command: string; id?: string; patch?: Record<string, unknown>; workspaceId?: string }
    switch (body.command) {
      case 'metrics': return Response.json(metrics())
      case 'reset': reads = []; failedReads = 0; failedWrites = 0; pushes = []; projections = []; maxInFlight = inFlight; return Response.json(metrics())
      case 'hold-list': holdNext = true; return Response.json({ ok: true })
      case 'release': held?.(); held = undefined; return Response.json({ ok: true })
      case 'fail-list': failNextList = true; return Response.json({ ok: true })
      case 'fail-write': failNextWrite = true; return Response.json({ ok: true })
      case 'planning': await manager.updateSessionPlanning(body.id ?? 'planning-00000', body.patch ?? { progress: 42 }); return Response.json({ ok: true })
      case 'rename': await manager.renameSession(body.id ?? 'planning-00000', String(body.patch?.name)); return Response.json({ ok: true })
      case 'external-name': {
        await manager.flushAllSessions()
        // Simulate an external file writer, preserving every message byte. The
        // host's own persistence queue would mark this as a self-write instead.
        const path = join(workspace, 'sessions', body.id ?? 'planning-00000', 'session.jsonl')
        const source = readFileSync(path, 'utf8'), boundary = source.indexOf('\n')
        const header = JSON.parse(boundary < 0 ? source : source.slice(0, boundary))
        header.name = String(body.patch?.name)
        writeFileSync(path, JSON.stringify(header) + (boundary < 0 ? '\n' : source.slice(boundary)))
        return Response.json({ ok: true })
      }
      case 'burst':
        // Title edits enqueue persistence and can form a real <250ms burst;
        // planning writes flush to disk individually and may span many windows.
        for (let index = 1; index <= 10; index++) await manager.renameSession('planning-00000', `C02 burst ${index}`)
        await manager.renameSession('other-canary', 'C02 other workspace burst')
        return Response.json({ ok: true })
      case 'facts': {
        await manager.flushAllSessions()
        const id = body.id ?? 'planning-00000', item = loadSession(body.workspaceId === 'other' ? other : workspace, id)
        return Response.json({ id: item?.id, name: item?.name, startAt: item?.startAt, dueAt: item?.dueAt, progress: item?.progress, messageCount: item?.messages.length })
      }
      default: return new Response('Unknown command', { status: 400 })
    }
  } catch (error) { return Response.json({ error: String(error) }, { status: 500 }) }
})
console.log(`PHANERIS_SERVER_URL=ws://127.0.0.1:${instance.port}`)
let stopping = false
const stop = async () => { if (stopping) return; stopping = true; held?.(); held = undefined; web?.dispose(); await instance.stop(); process.exit(0) }
process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop())
