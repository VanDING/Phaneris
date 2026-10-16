import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { verificationWorkflow } from './verification-artifacts'
import type { AgentMcpServerConfig } from '../../packages/shared/src/agent/backend/types'
import type { PageActionRequest, PageActionResult, PageRenderLease } from '@phaneris/core'

await verificationWorkflow('project-governance-round2-services', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'profile')
  mkdirSync(process.env.PHANERIS_CONFIG_DIR, { recursive: true })
  const { McpClientPool } = await import('../../packages/shared/src/mcp/mcp-pool')
  const { CraftMcpClient } = await import('../../packages/shared/src/mcp/client')
  const checks: Array<{ id: string; pass: boolean; error?: string }> = []
  const observations: Record<string, unknown> = {}
  const check = async (id: string, fn: () => unknown | Promise<unknown>) => {
    try { await fn(); checks.push({ id, pass: true }) }
    catch (error) { checks.push({ id, pass: false, error: String(error) }) }
    run.json('checks.json', checks); run.json('observations.json', observations)
  }
  const wait = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 15_000
    while (!condition()) { assert(Date.now() < deadline, message); await Bun.sleep(10) }
  }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  const withPool = async (id: string, fn: (pool: InstanceType<typeof McpClientPool>, config: (env?: Record<string, string>) => AgentMcpServerConfig, pids: () => number[]) => Promise<void>) => {
    const log = join(run.directory, id + '.jsonl')
    const pids = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.event === 'spawn').map(e => e.pid as number) : []
    const config = (env: Record<string, string> = {}): AgentMcpServerConfig => ({ type: 'stdio', command: process.execPath,
      args: [join(import.meta.dir, 'fixtures/governance-round2-mcp.ts')], env: { PHANERIS_R2_MCP_LOG: log, ...env } })
    const pool = new McpClientPool()
    try { await fn(pool, config, pids) }
    finally { await pool.disconnectAll(); for (const pid of pids()) if (alive(pid)) process.kill(pid) }
  }
  await check('M01-single-source-concurrent-stdio-and-release', () => withPool('M01', async (pool, config, pids) => {
    const cfg = config({ PHANERIS_R2_INIT_DELAY: '150' })
    await Promise.all(Array.from({ length: 8 }, () => pool.ensureConnected('same', cfg)))
    observations.M01 = { spawned: pids() }
    assert.equal(pids().length, 1, 'Concurrent acquisition must share one child')
    await pool.disconnectAll()
    assert(pids().every(pid => !alive(pid)), 'Disconnect must wait until the child has exited')
  }))
  for (const all of [false, true]) await check(all ? 'M02-all-disconnect-during-connect' : 'M02-one-disconnect-during-connect', () => withPool(all ? 'M02all' : 'M02one', async (pool, config, pids) => {
    const connecting = pool.ensureConnected('same', config({ PHANERIS_R2_INIT_DELAY: '300' })).then(() => 'resolved', error => String(error))
    await wait(() => pids().length > 0, 'Child did not start')
    if (all) await pool.disconnectAll(); else await pool.disconnect('same')
    const outcome = await connecting
    observations[all ? 'M02all' : 'M02one'] = { outcome, alive: pids().filter(alive), connected: pool.isConnected('same') }
    assert(!pool.isConnected('same'), 'A late connection must not re-enter a disconnected pool')
    assert(pids().every(pid => !alive(pid)))
    await pool.disconnectAll()
    await pool.ensureConnected('same', config())
    assert(pool.isConnected('same'), 'The pool remains reusable after disconnectAll')
  }))
  await check('M03-independent-source-concurrency', () => withPool('M03', async (pool, config, pids) => {
    const gate = join(run.directory, 'M03.gate')
    const cfg = config({ PHANERIS_R2_GATE: gate })
    const first = pool.ensureConnected('one', cfg), second = pool.ensureConnected('two', cfg)
    try { await wait(() => pids().length === 2, 'Different sources were globally serialized') }
    finally { writeFileSync(gate, 'open') }
    await Promise.all([first, second]); await pool.disconnect('one')
    assert(pool.isConnected('two')); assert.equal(pids().filter(alive).length, 1)
  }))
  await check('M04-config-change-during-connect', () => withPool('M04', async (pool, config, pids) => {
    const first = pool.ensureConnected('same', config({ PHANERIS_R2_INIT_DELAY: '250', PHANERIS_R2_MARKER: 'old' })).catch(error => String(error))
    await wait(() => pids().length === 1, 'Old connection did not start')
    const second = pool.ensureConnected('same', config({ PHANERIS_R2_MARKER: 'new' }))
    await Promise.all([first, second])
    const identity = JSON.parse(await pool.readResource('same', 'fixture://identity')) as { pid: number; marker: string }
    observations.M04 = { identity, spawned: pids(), alive: pids().filter(alive) }
    assert.equal(identity.marker, 'new'); assert.equal(pids().filter(alive).length, 1)
  }))
  await check('M05-failed-discovery-closes-and-retries', () => withPool('M05', async (pool, config, pids) => {
    await assert.rejects(pool.ensureConnected('same', config({ PHANERIS_R2_FAIL_TOOLS: 'true' })), /catalog failure/)
    assert(!pool.isConnected('same')); assert(pids().every(pid => !alive(pid)))
    await pool.ensureConnected('same', config()); assert(pool.isConnected('same'))
  }))
  await check('M06-initial-catalog-once-and-explicit-refresh', async () => {
    const methods: string[] = []; let toolName = 'first'
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      const message = await request.json() as { id?: number; method: string }; methods.push(message.method)
      if (message.id === undefined) return new Response(null, { status: 202 })
      return Response.json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'round2-http', version: '1' } }
        : { tools: [{ name: toolName, inputSchema: { type: 'object', properties: {} } }] } })
    } })
    const client = new CraftMcpClient({ transport: 'http', url: `http://127.0.0.1:${server.port}/mcp` })
    try {
      assert.equal((await client.listTools())[0]?.name, 'first')
      observations.M06 = { initialRequests: [...methods] }
      assert.equal(methods.filter(m => m === 'tools/list').length, 1)
      toolName = 'second'; assert.equal((await client.listTools())[0]?.name, 'second')
      assert.equal(methods.filter(m => m === 'tools/list').length, 2)
    } finally { await client.close(); server.stop(true) }
  })
  await check('M08-in-process-concurrent-and-release', async () => {
    const pool = new McpClientPool(), mcp = new McpServer({ name: 'round2-api', version: '1' })
    mcp.registerTool('echo', { inputSchema: {} }, async () => ({ content: [{ type: 'text' as const, text: 'fixture' }] }))
    try {
      const outcomes = await Promise.allSettled([pool.connectInProcess('api', mcp), pool.connectInProcess('api', mcp)])
      assert(outcomes.every(o => o.status === 'fulfilled'), JSON.stringify(outcomes))
      assert(pool.isConnected('api')); await pool.disconnectAll(); assert(!pool.isConnected('api'))
    } finally { await pool.disconnectAll() }
  })
  await check('M08-in-process-disconnect-during-initialization', async () => {
    const pool = new McpClientPool(), mcp = new McpServer({ name: 'round2-delayed-api', version: '1' })
    mcp.registerTool('echo', { inputSchema: {} }, async () => ({ content: [{ type: 'text' as const, text: 'fixture' }] }))
    const connect = mcp.connect.bind(mcp)
    let started = false
    mcp.connect = async transport => { started = true; await Bun.sleep(50); await connect(transport) }
    const pending = pool.connectInProcess('api', mcp).then(() => 'resolved', error => String(error))
    try {
      await wait(() => started, 'In-process initialization did not start')
      await pool.disconnectAll()
      assert.match(await pending, /cancelled/); assert(!pool.isConnected('api'))
    } finally { await pool.disconnectAll() }
  })

  const { registerPagesHandlers } = await import('../../packages/server-core/src/handlers/rpc/pages')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { createPage, addPageGrant } = await import('../../packages/shared/src/pages/storage')
  const { saveSourceConfig } = await import('../../packages/shared/src/sources/storage')
  const workspaces = ['a', 'b', 'c'].map(id => ({ id, name: id, rootPath: join(run.directory, id), createdAt: 1 }))
  writeFileSync(join(process.env.PHANERIS_CONFIG_DIR, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'a', llmConnections: [], setupDeferred: true }))
  const endpoint = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ marker: 'approved-fixture' }) })
  const pages = workspaces.map(ws => {
    const page = createPage(ws.rootPath, { name: 'Local fixture', content: '<p>fixture</p>' })
    saveSourceConfig(ws.rootPath, { id: 'fixture', slug: 'fixture', name: 'fixture', type: 'api', provider: 'custom', enabled: true,
      isAuthenticated: true, connectionStatus: 'connected', createdAt: 1, updatedAt: 1,
      api: { baseUrl: `http://127.0.0.1:${endpoint.port}`, authType: 'none' } })
    return { page, grant: addPageGrant(ws.rootPath, page.slug, { action: { kind: 'api', sourceSlug: 'fixture', method: 'GET', pathPattern: '/probe' } }) }
  })
  const logs: string[] = [], platform = createHeadlessPlatform()
  let failCreation = false
  platform.logger = { info: (...args: unknown[]) => {
    const message = args.join(' ')
    if (failCreation && message.includes('Created page action broker')) { failCreation = false; throw new Error('Synthetic initialization failure') }
    logs.push(message)
  }, debug() {}, warn() {}, error() {} }
  const rpc = new WsRpcServer({ port: 0 })
  registerPagesHandlers(rpc, { platform } as Parameters<typeof registerPagesHandlers>[1]); await rpc.listen()
  const clients = [0, 1].map(() => new WsRpcClient(`ws://127.0.0.1:${rpc.port}`, { workspaceId: 'a', autoReconnect: false }))
  type LeaseResult = { lease: PageRenderLease; content: string }
  const invokeAction = (index: number, ws: number, lease: PageRenderLease, patch: Partial<PageActionRequest> = {}) => clients[index % 2].invoke(RPC_CHANNELS.pages.EXECUTE_ACTION, workspaces[ws].id,
    { requestId: crypto.randomUUID(), pageSlug: pages[ws].page.slug, leaseId: lease.leaseId, nonce: lease.nonce,
      grantId: pages[ws].grant.id, invocation: { kind: 'api', method: 'GET', path: '/probe' }, ...patch }) as Promise<PageActionResult>
  try {
    await Promise.all(clients.map(c => c.invoke(RPC_CHANNELS.pages.GET, 'a')))
    await check('P01-eight-first-leases-execute-approved-api', async () => {
      const leases = await Promise.all(Array.from({ length: 8 }, (_, i) => clients[i % 2].invoke(RPC_CHANNELS.pages.CREATE_LEASE, 'a', pages[0].page.slug))) as LeaseResult[]
      const results = await Promise.all(leases.map(({ lease }, i) => invokeAction(i, 0, lease)))
      observations.P01 = { brokerCreations: logs.filter(l => l.includes('Created page action broker')).length, results }
      assert(results.every(result => result.ok), JSON.stringify(results))
      assert.equal(logs.filter(l => l.includes('Created page action broker')).length, 1)
    })
    await check('P02-workspace-isolation-release-nonce-replay', async () => {
      const a = await clients[0].invoke(RPC_CHANNELS.pages.CREATE_LEASE, 'a', pages[0].page.slug) as LeaseResult
      const b = await clients[1].invoke(RPC_CHANNELS.pages.CREATE_LEASE, 'b', pages[1].page.slug) as LeaseResult
      assert((await invokeAction(1, 1, b.lease)).ok)
      assert.match((await invokeAction(0, 1, a.lease)).error!, /lease-not-found/)
      assert.match((await invokeAction(0, 0, a.lease, { nonce: 'wrong' })).error!, /nonce-mismatch/)
      const requestId = crypto.randomUUID()
      assert((await invokeAction(0, 0, a.lease, { requestId })).ok)
      assert.match((await invokeAction(0, 0, a.lease, { requestId })).error!, /replay/)
      await clients[0].invoke(RPC_CHANNELS.pages.RELEASE_LEASE, 'a', a.lease.leaseId)
      assert.match((await invokeAction(0, 0, a.lease)).error!, /lease-not-found/)
    })
    await check('P03-failed-initialization-retries', async () => {
      failCreation = true
      await assert.rejects(clients[0].invoke(RPC_CHANNELS.pages.CREATE_LEASE, 'c', pages[2].page.slug), /Synthetic initialization failure/)
      const retry = await clients[0].invoke(RPC_CHANNELS.pages.CREATE_LEASE, 'c', pages[2].page.slug) as LeaseResult
      assert((await invokeAction(0, 2, retry.lease)).ok)
    })
  } finally { clients.forEach(c => c.destroy()); rpc.close(); endpoint.stop(true) }
  run.json('checks.json', checks); run.json('observations.json', observations)
  assert(checks.every(c => c.pass), JSON.stringify(checks.filter(c => !c.pass)))
  run.complete(checks.map(c => c.id), ['Other operating systems', 'External accounts', 'Production module-loader failures (initialization failure uses the injected platform logger)'])
})
