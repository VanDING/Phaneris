#!/usr/bin/env bun
/**
 * Upgrade 0.15.3 / Pi SDK 1.3.0 — MCP acceptance (M1, M2, M3).
 *
 * Three scenes, each driving the real production path (McpClientPool →
 * CraftMcpClient → @modelcontextprotocol/sdk transports) against servers this
 * workflow starts itself on 127.0.0.1 — no third-party endpoint, no provider:
 *
 *   mcp-stdio  The committed stdio fixture as a real child process. Proves the
 *              proxy tool names built by `proxyToolName`, the definition set a
 *              model receives (`getProxyToolDefs`, plus the `McpPoolServer`
 *              surface the external model SDKs actually read), description and
 *              input-schema passthrough, the echo round trip through
 *              `callTool`, dot sanitization (both in the joined source key and
 *              in a dotted TOOL name) and the documented post-sanitization
 *              collision rule (#864).
 *   mcp-http   An independent Streamable HTTP MCP server implementing
 *              initialize / tools/list / tools/call, connected through the
 *              production HTTP transport and called end to end.
 *   mcp-oauth  A server that answers 401 + WWW-Authenticate forever. Proves the
 *              connect fails closed with a readable error inside a bounded time,
 *              that the transport error still carries status 401, that no
 *              pending OAuth flow is started or leaked for that source, that a
 *              retry does not hang, and that cleanup leaves no open connection.
 *              It also pins where the production classifier loses that signal:
 *              a 401 whose body is RFC 6750 `{"error":"invalid_token"}` is
 *              classified `failed`, while the same 401 with a plain-text
 *              `Unauthorized` body is classified `needs-auth`
 *              (packages/shared/src/mcp/validation.ts:130-141 matches message
 *              text, and @modelcontextprotocol/sdk 1.32.1 keeps the status only
 *              on `StreamableHTTPError.code`). Reported, not fixed.
 *
 * The committed fixture is NOT modified (`scripts/verification/fixtures/
 * governance-round2-mcp.ts` serves a single `echo` tool and is shared with
 * project-governance-round2-services-workflow.ts), so the tool name containing a
 * dot is served by a workflow-owned stdio child written into the run directory.
 *
 * Usage: bun run scripts/verification/upgrade-0153-mcp-workflow.ts
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VerificationRun } from './verification-artifacts'

/** Real stdio MCP child owned by this workflow: a dotted tool name plus its sanitized twin. */
const DOTTED_STDIO_FIXTURE = `/** Workflow-owned stdio MCP fixture: a dotted tool name (and its colliding twin).
 *  Started as a real subprocess by the production pool; one JSON line per event. */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const log = event => appendFileSync(process.env.PHANERIS_MCP_DOTTED_LOG, JSON.stringify({ pid: process.pid, ...event }) + '\\n')
log({ event: 'spawn' })
setInterval(() => {}, 60000)
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  log({ event: 'request', method: request.method })
  if (request.id === undefined) continue
  let result
  if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'dotted-tool-fixture', version: '1' } }
  else if (request.method === 'tools/list') result = { tools: [
    { name: 'foo.bar', description: 'Echo the arguments for a dotted tool name', inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { message: { type: 'string', description: 'Text to echo' } }, required: ['message'] } },
    { name: 'foo_bar', description: 'Colliding twin that sanitization maps onto foo.bar', inputSchema: { type: 'object', properties: {} } },
  ] }
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify({ invoked: request.params.name, arguments: request.params.arguments }) }] }
  else continue
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n')
}
`

const UNTESTED = [
  'live third-party MCP servers, accounts and provider APIs — every server here is a loopback fixture this workflow starts itself',
  'interactive OAuth consent, callback handling and token exchange — the flow store is driven through the production starter with an injected prepare, so no authorization server is contacted',
  'MCP prompts/resources surfaces (already covered by the registered upstream-015-core workflow, scenes U15-10..U15-13)',
  'macOS/Linux execution, non-loopback transports and the SSE transport',
  'the committed stdio fixture was not modified: its tool list is fixed at `echo`, so the tool name containing a dot is served by a workflow-owned stdio child recorded in mcp-stdio.json',
]

const evidence = new VerificationRun('upgrade-0153-mcp')
const scenes: string[] = []
const results: Array<{ scene: string; pass: boolean; error?: string }> = []
const mcpStdio: Record<string, unknown> = { scene: 'mcp-stdio', fixtureModified: false }
const mcpHttp: Record<string, unknown> = { scene: 'mcp-http' }
const mcpOauth: Record<string, unknown> = { scene: 'mcp-oauth' }
const cleanup: {
  poolConnectedSlugs?: string[]
  pidExitStatus: Array<{ source: string; pid: number; aliveAfterCleanup: boolean; msToExit: number }>
  errors: string[]
} = { pidExitStatus: [], errors: [] }
let failure: unknown
const fail = (error: unknown) => { failure ??= error }

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const waitForDeath = async (pid: number, timeoutMs = 10_000) => {
  const started = Date.now()
  while (alive(pid) && Date.now() - started < timeoutMs) await Bun.sleep(20)
  return { alive: alive(pid), ms: Date.now() - started }
}
const readEvents = (log: string) => existsSync(log)
  ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { pid: number; event: string; method?: string })
  : []
const spawnPids = (log: string) => readEvents(log).filter(event => event.event === 'spawn').map(event => event.pid)

try {
  evidence.checkArguments()
  const workspace = join(evidence.directory, 'workspace')
  const sessionPath = join(workspace, 'sessions', 'mcp')
  mkdirSync(sessionPath, { recursive: true })
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    id: 'upgrade_0153', name: 'Upgrade 0153', slug: 'upgrade-0153',
    defaults: { permissionMode: 'safe', cyclablePermissionModes: ['safe', 'allow-all'], enabledSourceSlugs: [] },
    localMcpServers: { enabled: true }, createdAt: Date.now(), updatedAt: Date.now(),
  }))
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'profile')
  mkdirSync(process.env.PHANERIS_CONFIG_DIR, { recursive: true })

  const { McpClientPool } = await import('../../packages/shared/src/mcp/mcp-pool')
  const { proxyToolName } = await import('../../packages/shared/src/mcp/proxy-tool-name')
  const { validateMcpConnection } = await import('../../packages/shared/src/mcp/validation')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth/oauth-flow-store')
  const { createOAuthFlowStarter } = await import('../../packages/server-core/src/handlers/rpc/oauth')

  const pool = new McpClientPool({ workspaceRootPath: workspace, sessionPath })
  const servers: Array<{ stop(force?: boolean): void }> = []
  const stdioSources: Array<{ slug: string; log: string }> = []
  const scene = async (id: string, body: () => Promise<void>) => {
    try { await body(); scenes.push(id); results.push({ scene: id, pass: true }) }
    catch (error) { results.push({ scene: id, pass: false, error: error instanceof Error ? error.message : String(error) }) }
  }

  try {
    // ── M1 — stdio source, real proxy-tool round trip ────────────────────────
    await scene('mcp-stdio', async () => {
      const committedFixture = join(import.meta.dir, 'fixtures/governance-round2-mcp.ts')
      assert(existsSync(committedFixture), `committed stdio fixture missing: ${committedFixture}`)
      const dottedFixture = join(evidence.directory, 'dotted-tool-mcp-fixture.ts')
      writeFileSync(dottedFixture, DOTTED_STDIO_FIXTURE)
      const fixtureLog = join(evidence.directory, 'mcp-stdio-fixture.jsonl')
      const sanitizedLog = join(evidence.directory, 'mcp-stdio-sanitized-slug.jsonl')
      const dottedLog = join(evidence.directory, 'mcp-stdio-dotted-tool.jsonl')
      const committed = (log: string, label = 'committed-fixture') => {
        stdioSources.push({ slug: label, log })
        return { type: 'stdio' as const, command: process.execPath, args: [committedFixture], env: { PHANERIS_R2_MCP_LOG: log } }
      }
      const dotted = () => {
        stdioSources.push({ slug: 'dotted-tool-fixture', log: dottedLog })
        return { type: 'stdio' as const, command: process.execPath, args: [dottedFixture], env: { PHANERIS_MCP_DOTTED_LOG: dottedLog } }
      }

      // (a) the committed fixture as a real stdio child through the production pool.
      await pool.ensureConnected('fixture', committed(fixtureLog))
      assert(pool.isConnected('fixture'), 'the stdio fixture must connect through the production pool')
      const served = pool.getTools('fixture')
      assert.equal(served.length, 1)
      assert.equal(served[0]!.name, 'echo')
      const proxyName = proxyToolName('fixture', served[0]!.name)
      assert.equal(proxyName, 'mcp__fixture__echo', 'the exposed name must come from proxyToolName')

      // (b) the definition set a model receives.
      const defs = pool.getProxyToolDefs()
      assert.deepEqual(defs.map(def => def.name), ['mcp__fixture__echo'])
      assert(defs.every(def => pool.isProxyTool(def.name)), 'every emitted proxy def must be dispatchable (#864)')
      const def = defs[0]!
      assert.deepEqual(def.inputSchema, { type: 'object', properties: {} }, 'the served input schema passes through')
      assert.equal(def.description, 'Tool from fixture', 'a tool without a description gets the pool fallback')
      assert.deepEqual(def.namespace, { name: 'mcp__fixture', description: 'Connected source: fixture' })
      assert.equal(def.exposure, 'deferred')

      // (c) dispatch through the pool returns the fixture payload.
      const echo = await pool.callTool(proxyName, { message: 'stdio-round-trip' })
      assert.equal(echo.isError, false)
      assert.equal(echo.content, 'fixture result', 'the fixture echo payload must come back verbatim')
      assert.equal(echo.contentBlocks?.[0]?.['text'], 'fixture result')

      // The pool's own MCP surface — what an external model SDK actually reads.
      const { McpPoolServer } = await import('../../packages/shared/src/mcp/pool-server')
      const { CraftMcpClient } = await import('../../packages/shared/src/mcp/client')
      const bridge = new McpPoolServer(pool)
      const bridgeUrl = await bridge.start()
      const modelClient = new CraftMcpClient({ transport: 'http', url: bridgeUrl })
      let modelSurface: Record<string, unknown>
      try {
        const modelTools = await modelClient.listTools()
        const modelTool = modelTools.find(tool => tool.name === 'fixture__echo')
        assert(modelTool, `model-facing pool surface must expose the proxy tool: ${JSON.stringify(modelTools.map(tool => tool.name))}`)
        assert.equal(modelTool.description, def.description)
        assert.deepEqual(modelTool.inputSchema, def.inputSchema)
        const modelEcho = await modelClient.callTool('fixture__echo', { message: 'model-surface' }) as { content?: Array<{ text?: string }> }
        assert.equal(modelEcho.content?.[0]?.text, 'fixture result')
        modelSurface = { url: bridgeUrl, tools: modelTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })), echo: modelEcho }
      } finally { await modelClient.close(); await bridge.stop() }

      // A dot in the joined source key is sanitized by the real registration path,
      // with the names the committed fixture serves.
      const dottedSlug = 'committed.fixture'
      await pool.ensureConnected(dottedSlug, committed(sanitizedLog, 'committed-fixture-dotted-slug'))
      const sanitizedSlugName = proxyToolName(dottedSlug, 'echo')
      assert.equal(sanitizedSlugName, 'mcp__committed_fixture__echo')
      assert.match(sanitizedSlugName, /^[a-zA-Z0-9_-]+$/, 'the exposed name must be provider-safe')
      assert(pool.getProxyToolDefs([dottedSlug]).some(candidate => candidate.name === sanitizedSlugName))
      const sanitizedEcho = await pool.callTool(sanitizedSlugName, {})
      assert.equal(sanitizedEcho.content, 'fixture result')

      // A dotted TOOL name: `foo.bar` → `foo_bar`, dispatched to the untouched original.
      const warnings: string[] = []
      const warn = console.warn
      console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); warn(...args) }
      try { await pool.ensureConnected('dotted', dotted()) } finally { console.warn = warn }
      assert.deepEqual(pool.getTools('dotted').map(tool => tool.name), ['foo.bar', 'foo_bar'])
      const dottedServedNames = pool.getTools('dotted').map(tool => tool.name)
      const dottedProxy = proxyToolName('dotted', 'foo.bar')
      assert.equal(dottedProxy, 'mcp__dotted__foo_bar', 'a dot in a tool name must become _')
      const dottedDefs = pool.getProxyToolDefs(['dotted'])
      assert.deepEqual(dottedDefs.map(candidate => candidate.name), [dottedProxy], 'the colliding twin must not emit a second def')
      assert.equal(dottedDefs[0]!.description, 'Echo the arguments for a dotted tool name', 'description passthrough')
      assert.deepEqual(dottedDefs[0]!.inputSchema, { type: 'object', properties: { message: { type: 'string', description: 'Text to echo' } }, required: ['message'] }, '$schema is stripped, the rest passes through')
      assert(warnings.some(line => line.includes('Proxy name collision on mcp__dotted__foo_bar')), `a skipped duplicate must warn: ${JSON.stringify(warnings)}`)
      const dottedEcho = await pool.callTool(dottedProxy, { message: 'dotted-round-trip' })
      assert.equal(dottedEcho.isError, false)
      assert.deepEqual(JSON.parse(dottedEcho.content), { invoked: 'foo.bar', arguments: { message: 'dotted-round-trip' } }, 'dispatch must reach the untouched original name')

      // Disconnect each stdio source and prove the child exits.
      const pids = stdioSources.flatMap(source => spawnPids(source.log))
      for (const slug of ['fixture', dottedSlug, 'dotted']) {
        await pool.disconnect(slug)
        assert.equal(pool.isConnected(slug), false, `${slug} must be released`)
      }
      assert.equal(pids.length, 3, `three stdio children must have been spawned: ${JSON.stringify(pids)}`)
      const exits: Array<Record<string, unknown>> = []
      for (const pid of pids) {
        const death = await waitForDeath(pid)
        exits.push({ pid, aliveAfterDisconnect: death.alive, msToExit: death.ms })
        assert.equal(death.alive, false, `stdio child ${pid} must exit once the pool disconnects`)
      }
      const orphaned = await pool.callTool(proxyName, {})
      assert.equal(orphaned.isError, true)
      assert.match(orphaned.content, /Unknown MCP proxy tool/, 'disconnect must drop the dispatch entry')

      const fixtureSha256 = createHash('sha256').update(readFileSync(committedFixture)).digest('hex')
      let headSha256: string | null = null
      try { headSha256 = createHash('sha256').update(execFileSync('git', ['show', 'HEAD:scripts/verification/fixtures/governance-round2-mcp.ts'], { cwd: join(import.meta.dir, '../..') })).digest('hex') } catch { headSha256 = null }
      Object.assign(mcpStdio, {
        fixture: committedFixture, fixtureSha256, fixtureMatchesHead: headSha256 === null ? null : headSha256 === fixtureSha256,
        dottedFixture, dottedFixtureNote: 'workflow-owned stdio child written into the run directory; the committed fixture has no configurable tool name and is shared with project-governance-round2-services-workflow',
        servedToolNames: { committed: served.map(tool => tool.name), dotted: dottedServedNames },
        proxyToolNames: { committed: proxyName, sanitizedSlug: sanitizedSlugName, dottedTool: dottedProxy },
        proxyToolDefs: { committed: def, dotted: dottedDefs[0] },
        modelSurface,
        echoPayloads: { committed: echo, sanitizedSlug: sanitizedEcho, dotted: JSON.parse(dottedEcho.content) },
        collisionWarning: warnings.filter(line => line.includes('Proxy name collision')),
        pidExitStatus: exits,
        disconnectedProxyToolError: orphaned.content,
      })
    })

    // ── M2 — HTTP source, real tool round trip ───────────────────────────────
    await scene('mcp-http', async () => {
      const requests: Array<{ method: string; path: string; tool: string | null }> = []
      const server = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        async fetch(request) {
          if (request.method !== 'POST') return new Response(null, { status: 405 })
          const rpc = await request.json() as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } }
          requests.push({ method: rpc.method, path: new URL(request.url).pathname, tool: rpc.params?.name ?? null })
          if (rpc.id === undefined) return new Response(null, { status: 202 })
          let result: unknown
          if (rpc.method === 'initialize') {
            result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-tools-fixture', version: '1' }, instructions: 'HTTP fixture instructions' }
          } else if (rpc.method === 'tools/list') {
            result = { tools: [{ name: 'http_echo', description: 'Echo the arguments through the Streamable HTTP transport', inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'Text to echo' } }, required: ['message'] } }] }
          } else if (rpc.method === 'tools/call') {
            result = { content: [{ type: 'text', text: JSON.stringify({ tool: rpc.params?.name, received: rpc.params?.arguments }) }] }
          } else {
            return Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } })
          }
          return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
        },
      })
      servers.push(server)
      const url = `http://127.0.0.1:${server.port}/mcp`
      const started = performance.now()
      await pool.ensureConnected('httpfixture', { type: 'http', url })
      const connectMs = Math.round(performance.now() - started)
      assert(pool.isConnected('httpfixture'), 'the HTTP source must connect through the production transport')
      assert.deepEqual(pool.getTools('httpfixture').map(tool => tool.name), ['http_echo'])
      const name = proxyToolName('httpfixture', 'http_echo')
      assert.equal(name, 'mcp__httpfixture__http_echo')
      const def = pool.getProxyToolDefs(['httpfixture']).find(candidate => candidate.name === name)
      assert(def, 'the HTTP tool must be exposed as a proxy def')
      assert.equal(def.description, 'Echo the arguments through the Streamable HTTP transport')
      assert.deepEqual(def.inputSchema, { type: 'object', properties: { message: { type: 'string', description: 'Text to echo' } }, required: ['message'] })

      const callStarted = performance.now()
      const echo = await pool.callTool(name, { message: 'http-round-trip' })
      const callMs = Math.round(performance.now() - callStarted)
      assert.equal(echo.isError, false)
      assert.deepEqual(JSON.parse(echo.content), { tool: 'http_echo', received: { message: 'http-round-trip' } }, 'the HTTP tool must echo the arguments end to end')

      const httpTools = pool.getTools('httpfixture').map(tool => tool.name)
      await pool.disconnect('httpfixture')
      assert.equal(pool.isConnected('httpfixture'), false)
      const afterDisconnect = await pool.callTool(name, {})
      assert.equal(afterDisconnect.isError, true)

      Object.assign(mcpHttp, {
        url, connectMs, callMs, requests,
        tools: httpTools,
        proxyToolName: name, proxyToolDef: def,
        echoPayload: JSON.parse(echo.content),
        disconnectedProxyToolError: afterDisconnect.content,
        toolCallUsedOriginalName: requests.filter(entry => entry.method === 'tools/call').every(entry => entry.tool === 'http_echo'),
      })
    })

    // ── M3 — OAuth-required server fails closed, bounded, without leaking ────
    await scene('mcp-oauth', async () => {
      const requests: Array<{ method: string; path: string; authorization: string | null }> = []
      // One server, every shape the auth classifier must tell apart: an RFC 6750
      // JSON body and a plain-text body that the old message-only classifier
      // happened to recognize, an empty 401, a 403, a 500 and a healthy endpoint.
      let serverPort = 0
      const server = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        async fetch(request: Request): Promise<Response> {
          const path = new URL(request.url).pathname
          requests.push({ method: request.method, path, authorization: request.headers.get('authorization') })
          const challenge = `Bearer error="invalid_token", resource_metadata="http://127.0.0.1:${serverPort}/.well-known/oauth-protected-resource"`
          if (path === '/mcp-plain') {
            return new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain', 'WWW-Authenticate': challenge } })
          }
          if (path === '/mcp-empty') {
            return new Response(null, { status: 401, headers: { 'WWW-Authenticate': challenge } })
          }
          if (path === '/mcp-403') {
            return new Response('Forbidden', { status: 403, headers: { 'WWW-Authenticate': challenge } })
          }
          if (path === '/mcp-500') {
            return new Response('Internal Server Error', { status: 500 })
          }
          if (path === '/mcp-ok') {
            // A healthy MCP endpoint: initialize + tools/list only.
            const body = await request.json().catch(() => null) as { id?: unknown; method?: string } | null
            const result = body?.method === 'initialize'
              ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
              : { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }] }
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 1, result }), { headers: { 'content-type': 'application/json' } })
          }
          return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'The access token is missing or invalid' }), {
            status: 401,
            headers: { 'content-type': 'application/json', 'WWW-Authenticate': challenge },
          })
        },
      })
      serverPort = server.port ?? 0
      servers.push(server)
      const url = `http://127.0.0.1:${server.port}/mcp`
      const plainUrl = `http://127.0.0.1:${server.port}/mcp-plain`
      const emptyUrl = `http://127.0.0.1:${server.port}/mcp-empty`
      const forbiddenUrl = `http://127.0.0.1:${server.port}/mcp-403`
      const failingUrl = `http://127.0.0.1:${server.port}/mcp-500`
      const healthyUrl = `http://127.0.0.1:${server.port}/mcp-ok`
      const workspaceId = 'upgrade-0153'
      const sourceSlug = 'oauth-required'
      const store = new OAuthFlowStore()
      let prepares = 0
      const starter = createOAuthFlowStarter({
        flowStore: store,
        logger: { info() {} },
        prepare: async () => {
          prepares++
          return { state: 'synthetic-state', authUrl: 'http://127.0.0.1/authorize', codeVerifier: 'synthetic', provider: 'mcp', tokenEndpoint: 'http://127.0.0.1/token', clientId: 'synthetic-client', redirectUri: 'http://127.0.0.1/callback' } as never
        },
      })
      try {
        // Control: the production accessor really does see a pending flow, so the
        // "no pending flow left" assertion below is not vacuous.
        const control = await starter({ workspaceId, clientId: 'owner', sourceSlug, source: { config: { slug: sourceSlug }, workspaceId } as never, joinLive: true })
        assert('state' in control)
        assert(store.getLiveForSource(workspaceId, sourceSlug), 'control: a started flow must be visible to getLiveForSource')
        assert.equal(store.size, 1)
        store.remove(control.state)
        assert.equal(store.getLiveForSource(workspaceId, sourceSlug), null)
        assert.equal(store.size, 0)
        const preparesBeforeConnect = prepares

        const attempt = async (target = url) => {
          const attemptStarted = performance.now()
          let message = '', code: number | undefined
          try { await pool.ensureConnected(sourceSlug, { type: 'http', url: target }) }
          catch (error) {
            message = error instanceof Error ? error.message : String(error)
            code = (error as { code?: number } | null)?.code
          }
          return { elapsedMs: Math.round(performance.now() - attemptStarted), message, code }
        }
        const first = await attempt()
        assert(first.message.length > 0, 'a connect to an OAuth-required server must fail, not hang')
        assert.match(first.message, /invalid_token/i, `the error must carry the server's auth detail: ${first.message}`)
        assert.equal(first.code, 401, `the transport error must carry the HTTP status: ${JSON.stringify(first)}`)
        assert(first.elapsedMs < 30_000, `the connect must be bounded, took ${first.elapsedMs}ms`)
        assert(!pool.isConnected(sourceSlug), 'a failed connect must not register a connection')
        assert.deepEqual(pool.getProxyToolDefs([sourceSlug]), [], 'a failed connect must expose no tools')

        const second = await attempt()
        assert(second.message.length > 0, 'a retry must fail again instead of hanging')
        assert.equal(second.code, 401)
        assert(second.elapsedMs < 30_000, `the retry must be bounded, took ${second.elapsedMs}ms`)
        assert(!pool.isConnected(sourceSlug))

        // Production classifier (the surface source_test uses): every auth shape
        // must classify as needs-auth, and nothing else may.
        const validationStarted = performance.now()
        const validation = await validateMcpConnection({ mcpUrl: url })
        const validationMs = Math.round(performance.now() - validationStarted)
        assert.equal(validation.success, false, 'the production validator must fail closed')
        assert.match(validation.error ?? '', /invalid_token/i, `the validator must surface the readable auth failure: ${JSON.stringify(validation)}`)
        assert.equal(validation.errorType, 'needs-auth', `an RFC 6750 401 must classify as needs-auth: ${JSON.stringify(validation)}`)

        // Same server, body that spells the failure out: the text fallback path.
        const plainValidation = await validateMcpConnection({ mcpUrl: plainUrl })
        assert.equal(plainValidation.success, false)
        assert.equal(plainValidation.errorType, 'needs-auth', `a 401 whose body says Unauthorized must classify as needs-auth: ${JSON.stringify(plainValidation)}`)

        // A 401 with NO body at all: the status only exists on the transport error.
        const emptyValidation = await validateMcpConnection({ mcpUrl: emptyUrl })
        assert.equal(emptyValidation.success, false)
        assert.equal(emptyValidation.errorType, 'needs-auth', `a body-less 401 must classify as needs-auth: ${JSON.stringify(emptyValidation)}`)

        // 403 is the other authentication status.
        const forbiddenValidation = await validateMcpConnection({ mcpUrl: forbiddenUrl })
        assert.equal(forbiddenValidation.success, false)
        assert.equal(forbiddenValidation.errorType, 'needs-auth', `a 403 must classify as needs-auth: ${JSON.stringify(forbiddenValidation)}`)

        // A server error is not a missing credential.
        const serverErrorValidation = await validateMcpConnection({ mcpUrl: failingUrl })
        assert.equal(serverErrorValidation.success, false)
        assert.notEqual(serverErrorValidation.errorType, 'needs-auth', `a 500 must not be reported as a login problem: ${JSON.stringify(serverErrorValidation)}`)

        // Neither is an unreachable endpoint (no listener on that port).
        const unreachableValidation = await validateMcpConnection({ mcpUrl: 'http://127.0.0.1:1/mcp' })
        assert.equal(unreachableValidation.success, false)
        assert.notEqual(unreachableValidation.errorType, 'needs-auth', `a refused connection must not be reported as a login problem: ${JSON.stringify(unreachableValidation)}`)

        // And a healthy authenticated endpoint still succeeds.
        const healthyValidation = await validateMcpConnection({ mcpUrl: healthyUrl })
        assert.equal(healthyValidation.success, true, `a healthy MCP server must validate: ${JSON.stringify(healthyValidation)}`)

        assert.equal(prepares, preparesBeforeConnect, 'a failing connect must not start an authorization flow')
        assert.equal(store.size, 0, 'a failing connect must leave no pending flow behind')
        assert.equal(store.getLiveForSource(workspaceId, sourceSlug), null, 'no pending auth request may remain for that source')
        assert(requests.length >= 3, `each attempt must reach the server: ${JSON.stringify(requests)}`)
        assert(requests.every(entry => ['/mcp', '/mcp-plain', '/mcp-empty', '/mcp-403', '/mcp-500', '/mcp-ok'].includes(entry.path) && entry.method === 'POST'), `no OAuth discovery/authorize request may be attempted: ${JSON.stringify(requests)}`)
        assert(!requests.some(entry => entry.path.includes('.well-known') || entry.path.includes('/register') || entry.path.includes('/authorize') || entry.path.includes('/token')), `no OAuth endpoint may be contacted: ${JSON.stringify(requests)}`)
        assert(requests.every(entry => entry.authorization === null), 'no credential may be sent to an endpoint that never authorized')

        Object.assign(mcpOauth, {
          url, plainUrl, emptyUrl, forbiddenUrl, failingUrl, healthyUrl, workspaceId, sourceSlug,
          challenge: `Bearer error="invalid_token", resource_metadata="http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource"`,
          attempts: { first, second },
          productionClassifier: {
            rfc6750Body: { validationMs, success: validation.success, errorType: validation.errorType, error: validation.error, tools: validation.tools ?? null },
            plainTextBody: { success: plainValidation.success, errorType: plainValidation.errorType, error: plainValidation.error },
            emptyBody401: { success: emptyValidation.success, errorType: emptyValidation.errorType, error: emptyValidation.error },
            forbidden403: { success: forbiddenValidation.success, errorType: forbiddenValidation.errorType, error: forbiddenValidation.error },
            serverError500: { success: serverErrorValidation.success, errorType: serverErrorValidation.errorType, error: serverErrorValidation.error },
            unreachable: { success: unreachableValidation.success, errorType: unreachableValidation.errorType, error: unreachableValidation.error },
            healthy: { success: healthyValidation.success, errorType: healthyValidation.errorType ?? null, tools: healthyValidation.tools ?? null },
            statusOnTransportError: first.code,
            note: 'transport status (error.code) is read first; the message regex stays as the fallback for transports that carry no status',
          },
          flowStore: { sizeBefore: 1, sizeAfterConnect: store.size, liveForSourceAfterConnect: store.getLiveForSource(workspaceId, sourceSlug), authorizationFlowsStarted: prepares, startedByConnect: prepares - preparesBeforeConnect },
          requests: requests.map(entry => ({ ...entry, authorization: entry.authorization === null ? 'absent' : 'present' })),
          connectedAfterConnect: pool.isConnected(sourceSlug),
        })
      } finally { store.dispose() }
    })

    const failedScenes = results.filter(record => !record.pass)
    if (failedScenes.length > 0) fail(new Error(`Scene failures: ${JSON.stringify(failedScenes)}`))
  } finally {
    try { await pool.disconnectAll() } catch (error) { cleanup.errors.push(`disconnectAll: ${String(error)}`) }
    for (const server of servers) { try { server.stop(true) } catch (error) { cleanup.errors.push(`server.stop: ${String(error)}`) } }
    const seen = new Set<number>()
    for (const source of stdioSources) {
      for (const pid of spawnPids(source.log)) {
        if (seen.has(pid)) continue
        seen.add(pid)
        if (alive(pid)) { try { process.kill(pid) } catch { /* already gone */ } }
        const death = await waitForDeath(pid)
        cleanup.pidExitStatus.push({ source: source.slug, pid, aliveAfterCleanup: death.alive, msToExit: death.ms })
      }
    }
    cleanup.poolConnectedSlugs = pool.getConnectedSlugs()
  }

  try {
    assert.deepEqual(cleanup.poolConnectedSlugs, [], 'disconnectAll must release every pool client')
    assert.equal(cleanup.errors.length, 0, JSON.stringify(cleanup.errors))
    assert(cleanup.pidExitStatus.length > 0, 'no stdio child pid was observed')
    assert(cleanup.pidExitStatus.every(entry => !entry.aliveAfterCleanup), `orphan stdio children: ${JSON.stringify(cleanup.pidExitStatus)}`)
  } catch (error) { fail(error) }

  Object.assign(mcpStdio, { cleanup: { pidExitStatus: cleanup.pidExitStatus, poolConnectedSlugs: cleanup.poolConnectedSlugs } })
  Object.assign(mcpOauth, { cleanup: { pidExitStatus: cleanup.pidExitStatus, poolConnectedSlugs: cleanup.poolConnectedSlugs, errors: cleanup.errors } })
  if (!failure) {
    if (scenes.length !== 3 || new Set(scenes).size !== 3) fail(new Error(`Expected three distinct scenes, got ${JSON.stringify(scenes)}`))
    else evidence.complete(scenes, UNTESTED)
  }
} catch (error) { fail(error) }

evidence.json('mcp-stdio.json', mcpStdio)
evidence.json('mcp-http.json', mcpHttp)
evidence.json('mcp-oauth.json', mcpOauth)
evidence.json('summary.json', {
  workflow: 'upgrade-0153-mcp', scenes, results, cleanup,
  artifacts: { stdio: 'mcp-stdio.json', http: 'mcp-http.json', oauth: 'mcp-oauth.json' },
  untested: UNTESTED,
})
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
