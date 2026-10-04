/** Installed SDK + isolated configuration + real loopback provider. No paid calls.
 * Failure paths were recorded before this workflow in the 1.0.2 assessment.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ModelRuntime, ModelRegistry } from '@earendil-works/pi-coding-agent'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { getBuiltinClassifierModels } from '@earendil-works/pi-ai/providers/all'

const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-pi102-'))
const output = resolve(root, '.cache/capability-integration/pi-1.0.2-upgrade.json')
const records: any[] = [], requests: any[] = []
async function check(id: string, fn: () => any) {
  try { records.push({ id, pass: true, observation: await fn() }) }
  catch (error) { records.push({ id, pass: false, error: String(error) }) }
}
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push(body)
  const event = (delta: any, finish_reason: string | null = null) => `data: ${JSON.stringify({
    id: 'patch-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`
  return new Response(event({ role: 'assistant' }) + event({ content: 'patch verified' })
    + event({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
try {
  await check('All installed Pi family packages are 1.0.2', () => {
    const versions = Object.fromEntries(['pi-ai', 'pi-agent-core', 'pi-coding-agent', 'pi-codemode',
      'pi-server', 'pi-mcp', 'pi-protocol', 'pi-telemetry', 'pi-tui'].map(name => {
      const pkg = JSON.parse(readFileSync(join(root, 'node_modules/@earendil-works', name, 'package.json'), 'utf8'))
      assert.equal(pkg.version, '1.0.2'); return [name, pkg.version]
    }))
    return versions
  })
  const modelsPath = join(fixture, 'models.json')
  writeFileSync(modelsPath, JSON.stringify({ providers: { 'patch-fixture': {
    baseUrl: api.url.href, api: 'openai-completions', apiKey: 'fixture-key', models: [{
      id: 'sampling', reasoning: true, thinkingLevelMap: { off: 'off', high: 'high' },
      samplingParams: { temperature: 1, top_p: .95 },
      samplingParamsByThinkingLevel: { off: { temperature: .7, top_p: .8 }, high: { top_k: 20 } },
    }],
  } } }))
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath,
    allowModelNetwork: false })
  const registry = new ModelRegistry(runtime), physical = registry.find('patch-fixture', 'sampling')!
  assert(physical, 'Configured physical model was not registered')
  const context = { messages: [{ role: 'user' as const, content: 'verify fixed synthetic input', timestamp: 1 }] }
  await check('models.json thinking-level defaults and request overrides reach the real provider', async () => {
    for (const options of [{ reasoning: 'off' as const }, { reasoning: 'high' as const },
      { reasoning: 'high' as const, samplingParams: { top_p: .77 } }]) {
      assert.equal((await runtime.streamSimple(physical, context, { ...options, maxRetries: 0 }).result()).stopReason, 'stop')
    }
    const sampling = requests.map(({ temperature, top_p, top_k }) => ({ temperature, top_p, ...(top_k ? { top_k } : {}) }))
    assert.deepEqual(sampling, [{ temperature: .7, top_p: .8 }, { temperature: 1, top_p: .95, top_k: 20 },
      { temperature: 1, top_p: .77, top_k: 20 }])
    return { sampling, scope: 'Native models.json; Phaneris connection settings do not yet expose these fields.' }
  })
  await check('Virtual selection dispatches a physical model; failed routing sends no provider request', async () => {
    const reasons: string[] = []
    runtime.registerVirtualModel({ provider: 'patch-router', id: 'auto', name: 'Fixture auto',
      route(request) { reasons.push(request.reason); return { model: physical, thinkingLevel: 'high' } } })
    const virtual = registry.find('patch-router', 'auto')!
    const message = await runtime.streamSimple(virtual, context, { maxRetries: 0 }).result()
    assert.equal(message.stopReason, 'stop', message.errorMessage); assert.equal(message.provider, 'patch-fixture')
    assert.equal(message.model, 'sampling'); assert.equal(requests.at(-1).model, 'sampling')
    const count = requests.length
    runtime.registerVirtualModel({ provider: 'patch-router', id: 'blocked', name: 'Fixture blocked',
      route() { throw new Error('fixture route denied') } })
    const failed = await runtime.streamSimple(registry.find('patch-router', 'blocked')!, context, { maxRetries: 0 }).result()
    assert.equal(failed.stopReason, 'error'); assert.equal(requests.length, count)
    return { reasons, dispatchedProvider: message.provider, dispatchedModel: message.model, failedRouteMadeRequest: false,
      scope: 'Native direct runtime primitive; host multi-connection, durable router accounting and session restoration remain unverified.' }
  })
  await check('Trusted project MCP overrides preserve global identity; untrusted projects cannot override', async () => {
    const sdk = resolve(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), '..')
    const { loadMcpConfig } = await import(pathToFileURL(join(sdk, 'dist/extensions/mcp/config.js')).href)
    const agentDir = join(fixture, 'agent'), cwd = join(fixture, 'project')
    mkdirSync(agentDir); mkdirSync(join(cwd, '.pi'), { recursive: true })
    writeFileSync(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { fixture: {
      url: api.url.href, headers: { 'X-Fixture': 'fixture-value' }, exposure: 'direct', oauth: { clientRegistration: 'cimd' },
    } } }))
    writeFileSync(join(cwd, '.pi/mcp.json'), JSON.stringify({ mcpServers: { fixture: {
      enabled: false, exposure: 'deferred', toolExposure: { read: 'direct' },
    } } }))
    const trusted = loadMcpConfig({ agentDir, cwd, projectTrusted: true })
    assert.deepEqual(trusted.errors, []); const merged = trusted.servers[0].config
    assert.equal(merged.url, api.url.href); assert.equal(merged.enabled, false); assert.equal(merged.exposure, 'deferred')
    assert.equal(merged.headers['X-Fixture'], 'fixture-value'); assert.equal(merged.oauth.clientRegistration, 'cimd')
    assert.equal(merged.toolExposure.read, 'direct')
    const untrusted = loadMcpConfig({ agentDir, cwd, projectTrusted: false })
    assert.notEqual(untrusted.servers[0].config.enabled, false); assert.equal(untrusted.servers[0].config.exposure, 'direct')
    return { trustedOverrideApplied: true, globalIdentityPreserved: true, untrustedOverrideApplied: false,
      scope: 'Native config loader only; no real CIMD OAuth sign-in or Phaneris settings migration.' }
  })
  await check('Clef and Clef Flash are native classifiers rather than chat models', () => {
    const models = getBuiltinClassifierModels('cloudflare-workers-ai')
      .filter(m => ['@cf/cloudflare/clef', '@cf/cloudflare/clef-flash'].includes(m.id))
    assert.equal(models.length, 2); assert(models.every(m => m.type === 'classifier'))
    return { models: models.map(m => ({ id: m.id, api: m.api, type: m.type })), scope: 'Catalog and model type; real accuracy and billing not tested.' }
  })
} catch (error) { records.push({ id: 'Workflow setup', pass: false, error: String(error) }) }
finally {
  api.stop(true); mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ createdAt: new Date().toISOString(), sdkVersion: '1.0.2', records,
    providerRequests: requests.length, fixture, paidRequests: 0 }, null, 2))
  console.log(JSON.stringify({ output, records, providerRequests: requests.length }))
}
process.exit(records.every(r => r.pass) ? 0 : 1)
