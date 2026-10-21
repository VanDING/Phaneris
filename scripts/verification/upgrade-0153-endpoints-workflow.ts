#!/usr/bin/env bun
/**
 * Endpoint and user-model acceptance (EP-01…EP-06 / R4).
 *
 * The first pass rewrote retired default URLs by dropping `customEndpoint`
 * entirely. That silently re-routed explicit custom connections to the native
 * catalog — where their models are never registered — so off-catalog IDs became
 * unavailable and per-model overrides stopped applying. This workflow pins the
 * contract down with four connections read through the real config path, a real
 * Pi subprocess, and a loopback provider:
 *
 *   - a native provider on its retired default loses only the stale URL;
 *   - an explicit custom endpoint keeps its protocol, its models (including ones
 *     the catalog does not list) and its default, and only its dead URL moves;
 *   - a user's own gateway is never touched, whatever its protocol;
 *   - reading connections never writes the stored config back.
 *
 * Usage: bun run scripts/verification/upgrade-0153-endpoints-workflow.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const evidence = new VerificationRun('upgrade-0153-endpoints')
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const scenes: string[] = []
let failure: unknown

type RpcServer = import('@phaneris/server-core/transport').RpcServer

try {
  evidence.checkArguments()

  const home = mkdtempSync(join(tmpdir(), 'phaneris-endpoints-'))
  const configDir = join(home, 'config')
  const workspaceRoot = join(home, 'workspace')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({
    id: 'ws_endpoints', name: 'Endpoints', slug: 'endpoints',
    defaults: { permissionMode: 'safe', cyclablePermissionModes: ['safe', 'allow-all'], enabledSourceSlugs: [] },
    localMcpServers: { enabled: true }, createdAt: Date.now(), updatedAt: Date.now(),
  }))

  const customModel = {
    id: 'my-own-model', contextWindow: 200_000, maxTokens: 32_000, supportsImages: true,
  }
  const storedConnections = [
    {
      slug: 'kimi-native', name: 'Kimi native', providerType: 'pi', authType: 'api_key',
      piAuthProvider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding',
    },
    {
      slug: 'opencode-legacy', name: 'OpenCode legacy', providerType: 'pi_compat', authType: 'api_key_with_endpoint',
      piAuthProvider: 'opencode', baseUrl: 'https://opencode.ai/zen/v1',
      customEndpoint: { api: 'openai-completions' },
      models: ['my-own-model', 'claude-opus-4-6'], defaultModel: 'my-own-model',
      modelSelectionMode: 'userDefined3Tier',
    },
    {
      slug: 'user-gateway', name: 'My gateway', providerType: 'pi_compat', authType: 'api_key_with_endpoint',
      piAuthProvider: 'anthropic', baseUrl: 'https://my-gateway.example/anthropic',
      customEndpoint: { api: 'anthropic-messages' }, models: ['claude-opus-4-8'], defaultModel: 'claude-opus-4-8',
    },
    {
      slug: 'opencode-fresh', name: 'OpenCode new', providerType: 'pi', authType: 'api_key',
      piAuthProvider: 'opencode', models: ['claude-opus-4-6'], defaultModel: 'claude-opus-4-6',
    },
  ]
  const configPath = join(configDir, 'config.json')
  const initialConfig = JSON.stringify({
    workspaces: [{ id: 'endpoints', name: 'Endpoints', rootPath: workspaceRoot }],
    activeWorkspaceId: 'endpoints',
    defaultLlmConnection: 'opencode-legacy',
    llmConnections: storedConnections,
  })
  writeFileSync(configPath, initialConfig)
  const storedHash = sha256(initialConfig)

  process.env.PHANERIS_CONFIG_DIR = configDir
  process.env.NODE_ENV = 'test'
  process.env.HOME = home
  process.env.USERPROFILE = home

  const { getLlmConnections } = await import('@phaneris/shared/config/connections')
  const { normalizeRetiredNativeEndpoint, isRetiredNativeEndpoint } = await import('@phaneris/shared/config/legacy-endpoints')
  const { resolveDefaultCatalogModel } = await import('../../apps/electron/src/renderer/components/apisetup/tier-models')

  const connections = getLlmConnections()
  const bySlug = Object.fromEntries(connections.map(connection => [connection.slug, connection]))

  // --- native provider: only the stale URL goes away ----------------------
  const kimi = bySlug['kimi-native']!
  assert.equal(kimi.baseUrl, undefined, 'the retired native default must be dropped so the catalog applies')
  assert.equal(kimi.providerType, 'pi')
  assert.equal(kimi.piAuthProvider, 'kimi-coding')

  // --- explicit custom endpoint: protocol, models and default survive -----
  const legacy = bySlug['opencode-legacy']!
  assert.deepEqual(legacy.customEndpoint, { api: 'openai-completions' },
    'an explicit custom protocol must NOT be dropped when its URL moves')
  assert.equal(legacy.baseUrl, 'https://opencode.ai/inference/v1', 'only the dead URL is rewritten')
  assert.deepEqual(legacy.models, ['my-own-model', 'claude-opus-4-6'], 'the user model list must survive')
  assert.equal(legacy.defaultModel, 'my-own-model', 'the default must not be replaced by a catalog entry')
  assert.equal(legacy.providerType, 'pi_compat', 'the connection stays a custom endpoint')

  // --- a user's own gateway is untouched ----------------------------------
  assert.deepEqual(bySlug['user-gateway'], storedConnections[2], 'a user endpoint must be returned verbatim')
  // --- a fresh native OpenCode connection is untouched --------------------
  assert.deepEqual(bySlug['opencode-fresh'], storedConnections[3], 'a native connection without a retired URL is untouched')

  // --- the explicit rules, exercised directly -----------------------------
  assert.equal(isRetiredNativeEndpoint('kimi-coding', 'https://api.kimi.com/coding/'), true)
  assert.equal(isRetiredNativeEndpoint('kimi-coding', 'https://api.kimi.com/coding/v1'), false)
  assert.equal(isRetiredNativeEndpoint('opencode', 'https://opencode.ai/zen/v1'), true)
  assert.equal(isRetiredNativeEndpoint('opencode', 'https://opencode.ai/inference/v1'), false)
  for (const provider of ['opencode', 'opencode-go']) {
    const moved = normalizeRetiredNativeEndpoint({ providerType: 'pi_compat', piAuthProvider: provider,
      baseUrl: 'https://opencode.ai/zen/go/v1', customEndpoint: { api: 'openai-completions' as const }, models: ['my-own-model'] })
    const expected = provider === 'opencode-go' ? 'https://opencode.ai/inference/go/v1' : 'https://opencode.ai/inference/v1'
    assert.equal(moved.baseUrl, expected)
    assert.deepEqual(moved.models, ['my-own-model'])
    for (const url of ['https://opencode.ai/zen/go/v1/custom', 'https://opencode.ai:8443/zen/go/v1', 'https://gateway.example/zen/go/v1']) {
      assert.equal(normalizeRetiredNativeEndpoint({ piAuthProvider: provider, baseUrl: url }).baseUrl, url)
    }
  }
  const unknownProtocol = normalizeRetiredNativeEndpoint({
    providerType: 'pi_compat', piAuthProvider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding',
    customEndpoint: { api: 'anthropic-messages' },
  })
  assert.equal(unknownProtocol.baseUrl, 'https://api.kimi.com/coding',
    'when no current endpoint is known for that protocol, the connection is left as stored')

  // --- reading must not write the config back -----------------------------
  assert.equal(sha256(readFileSync(configPath, 'utf8')), storedHash,
    'getLlmConnections must normalize for the reader only, never persist')
  scenes.push('connections-normalized-without-losing-models')

  // --- the UI default resolver keeps an off-catalog default ---------------
  const catalog = [{ id: 'catalog-first', name: 'Catalog First', costInput: 1, costOutput: 2, contextWindow: 1, reasoning: false }]
  assert.equal(resolveDefaultCatalogModel(catalog, 'my-own-model'), 'my-own-model',
    'an off-catalog saved default must not be swapped for the catalog head')
  assert.equal(resolveDefaultCatalogModel(catalog, undefined), 'catalog-first')
  assert.equal(resolveDefaultCatalogModel(catalog, 'catalog-first'), 'catalog-first')
  scenes.push('default-model-not-swapped-by-catalog')

  // --- a real Pi subprocess runs the off-catalog model over loopback -------
  const requests: { model?: string; path?: string; maxTokens?: number }[] = []
  const inference = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const body = await request.json() as { model?: string; max_tokens?: number }
      requests.push({ model: body.model, path: new URL(request.url).pathname, maxTokens: body.max_tokens })
      const event = (delta: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
        id: `endpoint-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(finishReason ? { usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } } : {}),
      })}\n\n`
      return new Response(event({ role: 'assistant' }) + event({ content: 'ENDPOINT_FIXTURE' }) + event({}, 'stop') + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })

  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  const sessionPath = join(workspaceRoot, 'sessions', 'endpoint-session')
  mkdirSync(sessionPath, { recursive: true })
  const agent = new PiAgent({
    provider: 'pi', providerType: 'pi_compat', authType: 'api_key',
    model: 'pi/my-own-model', miniModel: 'pi/my-own-model',
    workspace: { id: 'endpoints', name: 'Endpoints', rootPath: workspaceRoot },
    session: { id: 'endpoint-session', workspaceRootPath: workspaceRoot, createdAt: 1, lastUsedAt: 1 },
    isHeadless: true, contextPolicy: 'manual',
    runtime: {
      paths: { piServer: join(root, 'packages/pi-agent-server/dist/index.js'), node: process.execPath },
      // The normalized connection keeps its custom endpoint (protocol + models);
      // only the host is swapped for the loopback so the request can be recorded.
      baseUrl: inference.url.href,
      customEndpoint: legacy.customEndpoint,
      customModels: [customModel],
    },
    envOverrides: { HOME: home, USERPROFILE: home, PHANERIS_CONFIG_DIR: configDir, NODE_ENV: 'test' },
  } as any) as any

  const wire: any[] = []
  const handleLine = agent.handleLine.bind(agent)
  agent.handleLine = (line: string) => { try { wire.push(JSON.parse(line)) } catch { } return handleLine(line) }
  try {
    await agent.ensureSubprocess()
    agent.send({ type: 'prompt', id: 'endpoint-turn', message: 'hello from the endpoints workflow' })
    const deadline = Date.now() + 90_000
    while (!wire.some(row => row.type === 'event' && row.event?.type === 'agent_settled')) {
      assert(Date.now() < deadline, 'Pi subprocess deadline')
      const errors = wire.filter(row => row.type === 'error')
      assert.equal(errors.length, 0, JSON.stringify(errors))
      await Bun.sleep(25)
    }
  } finally {
    await agent.disposeForRestart()
    agent.destroy()
    inference.stop(true)
  }
  assert(requests.length > 0, 'the off-catalog model must reach the provider')
  assert.equal(requests[0]!.model, 'my-own-model',
    `the custom model ID must be sent as-is (got ${requests[0]!.model})`)
  assert(requests[0]!.path?.includes('/chat/completions') ?? false, `custom endpoint protocol must be used (${requests[0]!.path})`)

  evidence.json('endpoints.json', {
    stored: storedConnections.map(connection => ({ slug: connection.slug, baseUrl: connection.baseUrl, protocol: connection.customEndpoint?.api ?? null })),
    normalized: connections.map(connection => ({
      slug: connection.slug, providerType: connection.providerType, baseUrl: connection.baseUrl ?? null,
      protocol: connection.customEndpoint?.api ?? null, models: connection.models ?? null, defaultModel: connection.defaultModel ?? null,
    })),
    rules: { unknownProtocolLeftAlone: unknownProtocol.baseUrl, configUnchanged: true },
    subprocess: { requests, modelRegistered: true },
  })
  scenes.push('pi-subprocess-runs-off-catalog-model')

  const headerRequests: unknown[] = []
  const routing = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    await request.text()
    headerRequests.push({ session: request.headers.get('x-opencode-session'), custom: request.headers.get('x-acceptance') })
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'headers', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: 'assistant', content: 'ROUTING_DONE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  try {
    const { normalizeContext } = await import('@earendil-works/pi-ai')
    const { opencodeProvider } = await import('@earendil-works/pi-ai/providers/opencode')
    const { opencodeGoProvider } = await import('@earendil-works/pi-ai/providers/opencode-go')
    for (const provider of [opencodeProvider(), opencodeGoProvider()]) {
      const native = provider.getModels().find(model => model.api === 'openai-completions')
      assert(native, `${provider.id} must expose its native Chat Completions route`)
      for (let call = 0; call < 3; call++) {
        const message = await provider.streamSimple({ ...native, baseUrl: routing.url.href }, normalizeContext({ messages: [{ role: 'user', content: 'route', timestamp: Date.now() }] }), {
          apiKey: 'loopback-only', sessionId: `${provider.id}-stable`, maxTokens: 16, headers: { 'x-acceptance': 'kept', ...(call === 2 ? { 'X-OpenCode-Session': 'explicit-user-session' } : {}) },
        }).result()
        assert.equal(message.stopReason, 'stop', JSON.stringify(message))
      }
    }
    assert.deepEqual(headerRequests, ['opencode', 'opencode-go'].flatMap(provider => [
      { session: `${provider}-stable`, custom: 'kept' }, { session: `${provider}-stable`, custom: 'kept' }, { session: 'explicit-user-session', custom: 'kept' },
    ]))
    evidence.json('opencode-session-headers.json', { headerRequests, boundary: 'native SDK provider streams with only baseUrl redirected to loopback; exact retired Go URLs and custom URL exclusions checked above' })
    scenes.push('native-opencode-and-go-stable-session-and-custom-headers')
  } finally { routing.stop(true) }

  evidence.complete(scenes, [
    'live Kimi/OpenCode accounts (no credentials used; loopback only)',
    'macOS/Linux execution',
    'the API-key setup form in a real Electron window',
  ])
} catch (error) { failure = error }
evidence.json('summary.json', { scenes })
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
