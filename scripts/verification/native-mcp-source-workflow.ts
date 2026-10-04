/** Same real Source through host and native Pi MCP transport. No ambient config or OAuth. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpExtension } from '@earendil-works/pi-coding-agent'
import { McpClientPool } from '../../packages/shared/src/mcp/mcp-pool'
import { McpPoolServer } from '../../packages/shared/src/mcp/pool-server'
const root = resolve(import.meta.dir, '../..'), output = resolve(root, '.cache/capability-integration')
mkdirSync(output, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-native-mcp-')), records: any[] = [], notices: any[] = []
let executed = 0
const source = new McpServer({ name: 'source-fixture', version: '1' })
source.registerTool('read', { description: 'Read the fixture report', inputSchema: {}, outputSchema: { value: z.number(), citation: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false } }, async () => {
  executed++; return { content: [{ type: 'text', text: 'full fixture text' }, { type: 'resource_link', uri: 'https://example.invalid/report', name: 'Report' }],
    structuredContent: { value: 42, citation: 'https://example.invalid/report' } }
})
const pool = new McpClientPool(), bridge = new McpPoolServer(pool)
const handlers = new Map<string, any>(), definitions = new Map<string, any>()
const renderers: any[] = []
let active: string[] = [], configReads = 0, configWrites = 0
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), '..')
const { McpOAuthCredentialStore } = await import(pathToFileURL(resolve(sdkRoot, 'dist/extensions/mcp/oauth.js')).href)
const { InMemoryAuthStorageBackend } = await import(pathToFileURL(resolve(sdkRoot, 'dist/core/auth-storage.js')).href)
const pi = { on(name: string, fn: any) { handlers.set(name, fn) }, registerTool(tool: any) { definitions.set(tool.name, tool) },
  registerToolRenderer(renderer: any) { renderers.push(renderer) },
  registerCommand() {}, getMcpServers() { return [] }, getAllTools() { return [...definitions.values()] },
  getActiveTools() { return active }, setActiveTools(names: string[]) { active = names } }
const ctx = { cwd: fixture, hasUI: false, signal: new AbortController().signal, ui: { notify(...args: any[]) { notices.push(args) } } }
async function check(id: string, action: () => Promise<any>) { try { records.push({ id, pass: true, observation: await action() }) } catch (error) { records.push({ id, pass: false, error: String(error) }) } }
const timings: any = {}
try {
  let started = performance.now(); await pool.connectInProcess('fixture', source); timings.hostConnectMs = performance.now() - started
  const url = await bridge.start()
  createMcpExtension({ credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()), logPath: join(fixture, 'native.log'),
    loadConfig() { configReads++; return { servers: [{ name: 'sources', source: 'host-fixture', scope: 'extension', config: { url, exposure: 'direct' } }], errors: [], autoEnableCodemode: false } },
    updateConfig() { configWrites++; throw new Error('Unexpected configuration write') }, openUrl() { throw new Error('Unexpected OAuth browser') }, startupWaitMs: 5000 } as any)(pi as any)
  started = performance.now(); await handlers.get('session_start')({ type: 'session_start' }, ctx)
  await handlers.get('before_agent_start')({ type: 'before_agent_start', systemPromptOptions: { sections: {} } }, ctx)
  timings.nativeConnectMs = performance.now() - started
  const tool = definitions.get('mcp__sources__fixture__read')
  await check('Native Pi discovers the same output schema and annotations through the host Source', async () => {
    assert.equal(renderers.length, 1, 'Native MCP renderer registration was not captured by the host fixture')
    assert(tool, `Native tool missing: ${JSON.stringify(notices)}`)
    assert(pool.getProxyToolDefs()[0]?.outputSchema)
    assert(tool.outputSchema?.properties?.structuredContent, 'HTTP bridge dropped outputSchema')
    assert.equal(tool.annotations?.readOnlyHint, true)
    return { host: pool.getProxyToolDefs()[0], native: { name: tool.name, outputSchema: tool.outputSchema, annotations: tool.annotations } }
  })
  await check('Host and native transport both preserve structured data and resource references', async () => {
    started = performance.now(); const host = await pool.callTool('mcp__fixture__read', {}); timings.hostCallMs = performance.now() - started
    started = performance.now(); const native = await tool.execute('source-check', {}, ctx.signal, undefined, ctx); timings.nativeCallMs = performance.now() - started
    assert.deepEqual(host.structuredContent, { value: 42, citation: 'https://example.invalid/report' })
    const serialized = JSON.stringify(native)
    assert(serialized.includes('structuredContent'), 'HTTP bridge dropped structuredContent')
    assert(serialized.includes('resource_link'), 'HTTP bridge dropped resource reference')
    assert.equal(executed, 2)
    return { host, native }
  })
  await check('Concurrent and repeated native HTTP calls have independent protocol instances', async () => {
    const before = executed
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      tool.execute(`parallel-${index}`, {}, ctx.signal, undefined, ctx)))
    assert.equal(executed - before, 8)
    for (const result of results) {
      assert.notEqual(result.isError, true)
      assert(JSON.stringify(result).includes('"value":42'))
    }
    return { concurrentCalls: results.length, executed: executed - before }
  })
  await check('Withdrawing the host Source prevents native cached definitions from executing it', async () => {
    await pool.disconnect('fixture'); const count = executed
    const result = await tool.execute('withdrawn-check', {}, ctx.signal, undefined, ctx)
    assert.equal(executed, count); assert.equal(result.isError, true)
    assert.equal(pool.getProxyToolDefs().length, 0)
    return { executed, result }
  })
  await check('Source configuration and credentials keep one host owner; native shutdown releases its connection', async () => {
    await handlers.get('session_shutdown')({ type: 'session_shutdown' }, ctx)
    assert.equal(configReads, 1); assert.equal(configWrites, 0)
    assert(!existsSync(join(fixture, 'mcp.json'))); assert(!existsSync(join(fixture, 'mcp-auth.json')))
    return { configReads, configWrites, ambientCredentials: false }
  })
} catch (error) { records.push({ id: 'Native MCP workflow setup', pass: false, error: String(error) }) }
finally {
  await handlers.get('session_shutdown')?.({ type: 'session_shutdown' }, ctx)
  await bridge.stop(); await pool.disconnectAll()
  writeFileSync(resolve(output, 'native-mcp-source.json'), JSON.stringify({ records, timings, notices, fixture,
    scope: 'Same in-process Source, actual HTTP transport and native extension; one local timing sample, no OAuth/remote/recovery performance claim' }, null, 2))
}
console.log(JSON.stringify({ records, timings })); process.exit(records.every(record => record.pass) ? 0 : 1)
