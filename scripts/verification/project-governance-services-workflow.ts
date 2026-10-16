import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { AgentMcpServerConfig } from '../../packages/shared/src/agent/backend/types'
import type { SessionSearchResult } from '../../packages/server-core/src/services/search'

await verificationWorkflow('project-governance-services', async run => {
  const config = join(run.directory, 'config')
  mkdirSync(config, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  const services = await import('../../packages/server-core/src/services/search')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { registerSessionsHandlers, cleanupSessionFileWatchForClient } = await import('../../packages/server-core/src/handlers/rpc/sessions')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const { McpClientPool } = await import('../../packages/shared/src/mcp/mcp-pool')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth/oauth-flow-store')
  const checks: Array<{ id: string; pass: boolean; error?: string }> = []
  const check = async (id: string, action: () => unknown | Promise<unknown>) => {
    try { await action(); checks.push({ id, pass: true }) }
    catch (error) { checks.push({ id, pass: false, error: String(error).slice(0, 1500) }) }
    run.json('checks.json', checks)
  }
  const platform = createHeadlessPlatform()
  platform.logger = { info() {}, debug() {}, warn() {}, error() {} }
  services.setSearchPlatform(platform)
  const workspaces = ['a', 'b'].map(id => ({ id, slug: id, name: id, rootPath: join(run.directory, id), createdAt: 1 }))
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, llmConnections: [], activeWorkspaceId: 'a', setupDeferred: true }))
  function writeMessage(workspace: string, id: string, content: unknown, extra: object = {}) {
    const directory = join(workspace, 'sessions', id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.jsonl'), JSON.stringify({ id }) + '\n' + JSON.stringify({ type: 'user', content, ...extra }) + '\n')
  }
  for (const workspace of workspaces) for (let i = 0; i < 200; i++) {
    writeMessage(workspace.rootPath, 'session-' + i, 'needle ' + 'content '.repeat(128))
  }
  const manager = new SessionManager()
  const internal = manager as unknown as { registerManagedSession(value: ReturnType<typeof createManagedSession>): void }
  internal.registerManagedSession(createManagedSession({ id: 'hidden', hidden: true }, workspaces[0]))
  writeMessage(workspaces[0].rootPath, 'hidden', 'needle')
  const server = new WsRpcServer({ port: 0, onClientDisconnected: cleanupSessionFileWatchForClient })
  const oauthFlowStore = new OAuthFlowStore()
  registerSessionsHandlers(server, { sessionManager: manager, platform, oauthFlowStore })
  await server.listen()
  const left = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: 'a', autoReconnect: false })
  const right = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: 'b', autoReconnect: false })
  const search = (client: InstanceType<typeof WsRpcClient>, workspace: string, query = 'needle') =>
    client.invoke(RPC_CHANNELS.sessions.SEARCH_CONTENT, workspace, query) as Promise<SessionSearchResult[]>
  try {
    await check('S01-two-rpc-clients-independent-workspaces-and-shared-workspace', async () => {
      assert.equal((await search(left, 'a')).length, 200)
      assert.equal((await search(right, 'b')).length, 200)
      for (const secondWorkspace of ['b', 'a']) for (let i = 0; i < 3; i++) {
        const [a, b] = await Promise.all([search(left, 'a'), search(right, secondWorkspace)])
        assert.equal(a.length, 200)
        assert.equal(b.length, 200)
        assert(!a.some(result => result.sessionId === 'hidden'))
      }
    })
    await check('S02-plain-base64-and-text-with-encoded-attachments', async () => {
      writeMessage(workspaces[0].rootPath, 'plain', 'Explain base64 encoding, ordinary text only.')
      writeMessage(workspaces[0].rootPath, 'mixed', 'Explain this attached picture', { attachments: [{ data: 'ENCODEDNOISE', type: 'base64' }] })
      writeMessage(workspaces[0].rootPath, 'blocks', [{ type: 'text', text: 'Explain this block' }, { type: 'image', source: { type: 'base64', data: 'ENCODEDNOISE' } }])
      const results = await search(left, 'a', 'Explain')
      assert.deepEqual(results.map(result => result.sessionId).sort(), ['blocks', 'mixed', 'plain'])
      assert(results.every(result => result.matches[0].snippet.includes('Explain')))
      assert.equal((await search(left, 'a', 'ENCODEDNOISE')).length, 0)
      assert.equal((await search(left, 'a', 'no-such-fixture-text')).length, 0)
    })
    await check('S03-same-owner-cancels-old-search-and-blank-query', async () => {
      const directory = join(workspaces[1].rootPath, 'sessions')
      const options = { clientId: 'fixture-owner' }
      const previous = services.searchSessions('needle', directory, options)
      const current = services.searchSessions('needle', directory, options)
      const [old, latest] = await Promise.all([previous, current])
      assert.equal(latest.length, 200)
      assert(old.length < 200, 'A still-running search from the same owner should be cancelled')
      const pending = services.searchSessions('needle', directory, options)
      assert.deepEqual(await services.searchSessions('', directory, options), [])
      assert((await pending).length < 200)
      const disconnected = services.searchSessions('needle', directory, options)
      cleanupSessionFileWatchForClient(options.clientId)
      assert((await disconnected).length < 200, 'The disconnect hook must settle the owned subprocess')
    })
  } finally { left.destroy(); right.destroy(); server.close(); oauthFlowStore.dispose(); await manager.cleanup() }

  const requests: Array<{ method: string; key: string | null; auth: string | null; path: string }> = []
  const mcp = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    const rpc = await request.json() as { id?: number; method: string }
    requests.push({ method: rpc.method, key: request.headers.get('x-api-key'), auth: request.headers.get('authorization'), path: new URL(request.url).pathname })
    if (rpc.id === undefined) return new Response(null, { status: 202 })
    let result: unknown
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { resources: {} }, serverInfo: { name: 'governance-http', version: '1' } }
    else if (rpc.method === 'resources/list') result = { resources: [] }
    else if (rpc.method === 'resources/templates/list') result = { resourceTemplates: [] }
    else if (rpc.method === 'resources/read') result = { contents: [{ uri: 'fixture://config', text: JSON.stringify(requests.at(-1)) }] }
    else return Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } })
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
  } })
  const pool = new McpClientPool()
  const url = `http://127.0.0.1:${mcp.port}/mcp`
  const read = async () => JSON.parse(await pool.readResource('http', 'fixture://config')) as { key: string; auth: string; path: string }
  const connections = () => requests.filter(request => request.method === 'initialize').length
  try {
    await check('M01-http-header-sync-ensure-and-url-updates', async () => {
      await pool.sync({ http: { type: 'http', url, headers: { 'X-Api-Key': 'old' } } })
      assert.equal((await read()).key, 'old')
      await pool.sync({ http: { type: 'http', url, headers: { 'X-Api-Key': 'new' } } })
      assert.equal((await read()).key, 'new')
      await pool.ensureConnected('http', { type: 'http', url, headers: { 'X-Api-Key': 'newest', authorization: 'Bearer synthetic' } })
      assert.equal((await read()).auth, 'Bearer synthetic')
      const count = connections()
      await pool.ensureConnected('http', { type: 'http', url, headers: { Authorization: 'Bearer synthetic', 'x-api-key': 'newest' } })
      assert.equal(connections(), count)
      await pool.ensureConnected('http', { type: 'http', url: url + '-changed', headers: { 'x-api-key': 'newest' } })
      assert.equal((await read()).path, '/mcp-changed')
    })
    await check('M02-mutating-caller-config-does-not-mutate-active-config', async () => {
      const configuration: AgentMcpServerConfig = { type: 'http', url, headers: { 'X-Api-Key': 'initial' } }
      await pool.ensureConnected('http', configuration)
      const count = connections()
      configuration.headers!['X-Api-Key'] = 'mutated'
      await pool.ensureConnected('http', configuration)
      assert.equal(connections(), count + 1)
      assert.equal((await read()).key, 'mutated')
    })
    await check('M03-stdio-argument-environment-and-cwd-updates', async () => {
      const fixture = join(import.meta.dir, 'fixtures/governance-mcp-stdio.ts')
      const first = join(run.directory, 'stdio-first'), second = join(run.directory, 'stdio-second')
      mkdirSync(first); mkdirSync(second)
      const config: AgentMcpServerConfig = { type: 'stdio', command: process.execPath, args: [fixture, 'old'], env: { PHANERIS_VERIFY_MCP_VALUE: 'old' }, cwd: first }
      await pool.ensureConnected('stdio', config)
      const old = JSON.parse(await pool.readResource('stdio', 'fixture://config'))
      assert.equal(old.argument, 'old')
      let current = config
      for (const update of [{ args: [fixture, 'new'] }, { env: { PHANERIS_VERIFY_MCP_VALUE: 'new' } }, { cwd: second }]) {
        current = { ...current, ...update }
        await pool.ensureConnected('stdio', current)
        const observed = JSON.parse(await pool.readResource('stdio', 'fixture://config'))
        assert.equal(observed.argument, current.args![1])
        assert.equal(observed.marker, current.env!.PHANERIS_VERIFY_MCP_VALUE)
        assert.equal(observed.cwd, current.cwd)
      }
    })
  } finally { await pool.disconnectAll(); mcp.stop(true) }
  run.json('mcp-requests.json', requests)
  assert(checks.every(check => check.pass), JSON.stringify(checks.filter(check => !check.pass)))
  run.complete(checks.map(check => check.id), ['Live external MCP services', 'Other operating systems', 'Long-running resource stress'])
})
