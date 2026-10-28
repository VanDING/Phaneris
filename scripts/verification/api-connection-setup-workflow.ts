#!/usr/bin/env bun
/** Browser → shipped onboarding/settings → real RPC handlers → local provider → persisted config. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'
import type { RpcServer } from '../../packages/server-core/src/transport'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'
import type { PlatformServices } from '../../packages/server-core/src/runtime/platform'
import type { StreamFn } from '@earendil-works/pi-agent-core'

await verificationWorkflow('api-connection-setup', async run => {
  const root = resolve(import.meta.dir, '../..'), config = join(run.directory, 'config')
  mkdirSync(config); process.env.PHANERIS_CONFIG_DIR = config
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [], llmConnections: [], setupDeferred: true }))
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const { registerLlmConnectionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/llm-connections')
  const { registerSettingsHandlers } = await import('../../packages/server-core/src/handlers/rpc/settings')
  const { getLlmConnections, getLlmConnection, updateLlmConnection } = await import('../../packages/shared/src/config/connections')
  const { registerPiModelResolver, getMiniModel } = await import('../../packages/shared/src/config/llm-connections')
  const { getPiModelsForAuthProvider, getAllPiModels } = await import('../../packages/shared/src/config/models-pi')
  const { initModelRefreshService, setFetcherPlatform } = await import('../../packages/server-core/src/model-fetchers')
  const { getCredentialManager } = await import('../../packages/shared/src/credentials')
  registerPiModelResolver(provider => provider ? getPiModelsForAuthProvider(provider) : getAllPiModels())
  const logs: unknown[] = [], providerRequests: Array<{ path: string; body?: Record<string, unknown> }> = []
  const logger = Object.fromEntries(['info', 'warn', 'debug', 'error'].map(level => [level, (...args: unknown[]) => logs.push({ level, args })]))
  const platform = { appRootPath: root, isPackaged: false, logger } as unknown as PlatformServices
  setFetcherPlatform(platform)
  const refresh = initModelRefreshService(async slug => ({ apiKey: await getCredentialManager().getLlmApiKey(slug) ?? undefined }))
  const handlers = new Map<string, (context: unknown, ...args: unknown[]) => unknown>()
  const server = { handle: (channel: string, handler: (context: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as RpcServer
  const deps = { platform, oauthFlowStore: {}, sessionManager: {
    reinitializeAuth: async () => {}, refreshConnectionRuntime: async () => {}, refreshCompactionThreshold: async () => {},
  } } as unknown as HandlerDeps
  registerLlmConnectionsHandlers(server, deps); registerSettingsHandlers(server, deps)
  const methods: Record<string, string> = {
    setupLlmConnection: RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
    testLlmConnectionSetup: RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
    getCompactionThreshold: RPC_CHANNELS.caching.GET_COMPACTION_THRESHOLD,
    setCompactionThreshold: RPC_CHANNELS.caching.SET_COMPACTION_THRESHOLD,
    getImageGenerationSettings: RPC_CHANNELS.settings.GET_IMAGE_GENERATION_SETTINGS,
    setImageGenerationSettings: RPC_CHANNELS.settings.SET_IMAGE_GENERATION_SETTINGS,
  }
  let failSave = false
  const invoke = (method: string, ...args: unknown[]) => handlers.get(methods[method]!)!({}, ...args)
  const snapshot = () => getLlmConnections().map((connection, index) => ({ ...connection, isDefault: index === 0, isAuthenticated: true }))
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
    if (request.method === 'OPTIONS') return new Response(null, { headers })
    if (path === '/rpc') {
      const { method, args } = await request.json() as { method: string; args: unknown[] }
      try {
        if (method === 'snapshot') return Response.json(snapshot(), { headers })
        if (method === 'failSave') { failSave = !!args[0]; return Response.json(null, { headers }) }
        if (method === 'setupLlmConnection' && failSave) return Response.json({ success: false, error: 'Fixture save failed' }, { headers })
        return Response.json(await invoke(method, ...args) ?? null, { headers })
      } catch (error) { return Response.json({ error: String(error) }, { status: 500, headers }) }
    }
    if (request.method === 'GET') {
      providerRequests.push({ path })
      if (path.includes('/denied/')) return Response.json({ error: 'unauthorized' }, { status: 401 })
      if (path.includes('/empty/')) return Response.json({ data: [] })
      return Response.json({ data: [
        { id: 'messages-only', supported_endpoints: ['/messages'] },
        { id: 'image-only', supported_endpoints: ['/images/generations'] },
        { id: 'deepseek/deepseek-v4-flash', name: 'Main model', context_length: 1_000_000, supported_endpoints: ['/chat/completions'] },
        { id: 'fixture-small', name: 'Small model', max_tokens: 8192, supported_endpoints: ['/chat/completions'] },
      ] })
    }
    const body = await request.json() as Record<string, unknown>
    providerRequests.push({ path, body })
    if (path.endsWith('/images/generations')) return Response.json({ created: 1, data: [{ b64_json: png }] })
    if (body.max_tokens && Number(body.max_tokens) > 393216 || body.max_completion_tokens && Number(body.max_completion_tokens) > 393216) {
      return Response.json({ error: { message: 'max_tokens exceeds maximum 393216' } }, { status: 400 })
    }
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } } : {}) })}\n\n`
    if (body.stream) return new Response(chunk({ role: 'assistant', content: 'ok' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    return Response.json({ id: 'fixture', model: body.model, choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1 } })
  } })
  const host = `http://127.0.0.1:${api.port}`
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1100, height: 950 } })
  const page = await context.newPage(), errors: string[] = [], checks: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000)
  await context.tracing.start({ screenshots: true, snapshots: true })
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/api-connection-setup.tsx' })
  const load = async (query = '') => {
    await page.goto(`${fixture.url}?host=${encodeURIComponent(host)}&${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.apiConnectionFixture?.ready)
  }
  const chooseProvider = async (name: string) => {
    await page.getByTestId('api-key-preset-trigger').click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  const check = async (name: string, action: () => Promise<void>) => { await action(); checks.push(name); console.log(`PASS ${name}`) }
  const chooseSetting = async (id: string, text: string) => {
    await page.locator(id).click()
    await page.locator('[data-option]').filter({ hasText: text }).first().click()
  }
  try {
    await check('Native providers require no model fields or catalog request', async () => {
      await load('view=form'); await page.locator('#api-key').fill('fixture-key')
      for (const provider of ['OpenAI', 'OpenRouter', 'OpenCode', 'DeepSeek', 'Minimax Global']) {
        await chooseProvider(provider)
        assert.equal(await page.locator('#base-url, #connection-default-model').count(), 0)
        await page.getByRole('button', { name: 'Submit', exact: true }).click()
      }
      const state = await page.evaluate(() => window.apiConnectionFixture)
      assert.equal(state.submissions.length, 5)
      assert(state.submissions.every(data => !data.models && !data.connectionDefaultModel && data.apiKey === 'fixture-key'))
      assert(!state.calls.some(call => call.method === 'getPiProviderModels'))
    })
    await check('Key edits retain saved models and utility; switching providers drops them', async () => {
      await load('view=form&edit=1'); await page.locator('#api-key').fill('rotated-fixture-key')
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      let submitted = await page.evaluate(() => window.apiConnectionFixture.submissions.at(-1)!)
      assert.deepEqual(submitted.models, ['pi/kimi-main', 'pi/kimi-small', 'pi/off-catalog']); assert.equal(submitted.utilityModel, 'pi/kimi-small')
      await chooseProvider('OpenCode'); await page.getByRole('button', { name: 'Submit', exact: true }).click()
      submitted = await page.evaluate(() => window.apiConnectionFixture.submissions.at(-1)!)
      assert.equal(submitted.models, undefined); assert.equal(submitted.utilityModel, undefined)
    })
    await check('Wizard navigation has one opaque step without overlapping fades', async () => {
      await load()
      for (let index = 0; index < 3; index++) {
        await page.getByRole('button', { name: /I use other provider/ }).click()
        assert.equal(await page.locator('[data-onboarding-step]').count(), 1)
        assert.equal(await page.locator('[data-onboarding-step]').evaluate(el => getComputedStyle(el).opacity), '1')
        assert.equal(await page.locator('[data-content-swap]').count(), 0)
        await page.getByRole('button', { name: 'Back', exact: true }).click()
      }
    })
    await check('Blank custom models discover before validation and persist the model tested', async () => {
      await page.getByRole('button', { name: /I use other provider/ }).click(); await chooseProvider('Custom')
      assert.equal(await page.locator('#connection-default-model').isVisible(), false)
      await page.locator('#base-url').fill(`${host}/v1`); await page.locator('#api-key').fill('fixture-key')
      await page.screenshot({ path: join(run.directory, 'custom-setup.png') })
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('button', { name: 'Get Started', exact: true }).waitFor({ timeout: 60000 })
      const connection = getLlmConnections()[0]!
      assert.equal(connection.defaultModel, 'deepseek/deepseek-v4-flash')
      assert(!connection.models?.some(model => (typeof model === 'string' ? model : model.id) === 'messages-only'))
      assert(providerRequests.findIndex(request => request.path.endsWith('/models')) < providerRequests.findIndex(request => request.body))
      assert(providerRequests.some(request => request.body?.model === connection.defaultModel))
      const model = connection.models?.find(model => typeof model !== 'string' && model.id === connection.defaultModel)
      assert(model && typeof model !== 'string'); assert.equal(model.maxTokens, 16384)
    })
    await check('Live model discovery repairs stale cross-provider output caps', async () => {
      const connection = getLlmConnections()[0]!
      updateLlmConnection(connection.slug, { models: connection.models!.map(model => typeof model === 'string' ? model : { ...model, maxTokens: 943718 }) })
      await refresh.refreshNow(connection.slug)
      const models = getLlmConnection(connection.slug)!.models!
      assert.equal((models[0] as { maxTokens: number }).maxTokens, 16384)
      assert.equal((models[1] as { maxTokens: number }).maxTokens, 8192)
    })
    await check('Missing lists do not guess or save models; manual fallback remains available', async () => {
      await load(); await page.getByRole('button', { name: /I use other provider/ }).click(); await chooseProvider('Custom')
      await page.locator('#base-url').fill(`${host}/empty/v1`); await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByText(/Unable to discover models/).waitFor(); assert.equal(getLlmConnections().length, 1)
      await page.locator('summary').click(); await page.locator('#connection-default-model').fill('fallback-model')
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('button', { name: 'Get Started', exact: true }).waitFor({ timeout: 60000 })
      assert.equal(getLlmConnections()[1]!.defaultModel, 'fallback-model')
    })
    await check('Auxiliary model persists, clears and reports rejected writes', async () => {
      await load('view=settings')
      const section = page.locator('[data-ai-settings-section="utility"]')
      await section.getByRole('button', { name: 'Default model for call_llm', exact: true }).click()
      await page.locator('[data-option]').filter({ hasText: 'Small model' }).click()
      await page.waitForFunction(() => window.apiConnectionFixture.connections[0]?.utilityModel === 'fixture-small')
      assert.equal(getMiniModel(getLlmConnections()[0]!), 'fixture-small')
      await section.getByRole('button', { name: 'Default model for call_llm', exact: true }).click()
      await page.locator('[data-option]').filter({ hasText: 'Automatic' }).click()
      await page.waitForFunction(() => !window.apiConnectionFixture.connections[0]?.utilityModel)
      assert.equal(getMiniModel(getLlmConnections()[0]!), 'deepseek/deepseek-v4-flash')
      failSave = true
      await section.getByRole('button', { name: 'Default model for call_llm', exact: true }).click()
      await page.locator('[data-option]').filter({ hasText: 'Small model' }).click()
      await section.getByRole('alert').waitFor(); assert.equal(getLlmConnections()[0]!.utilityModel, undefined); failSave = false
    })
    await check('Percentage thresholds persist, scale per model, retain legacy and clear', async () => {
      await chooseSetting('#compaction-threshold-select', '80%')
      await page.waitForFunction(() => document.querySelector('#compaction-threshold-select')?.textContent?.includes('80%'))
      const { getCompactionThreshold } = await import('../../packages/shared/src/config/appearance')
      const { CompactionThresholdController } = await import('../../packages/pi-agent-server/src/compaction-threshold')
      const { SettingsManager } = await import('@earendil-works/pi-coding-agent')
      const reserves: number[] = []
      const controller = new CompactionThresholdController(SettingsManager.inMemory({}), () => undefined, async (_key, reserve) => { reserves.push(reserve) })
      await controller.update(getCompactionThreshold(), { id: 'small', provider: 'custom', contextWindow: 200000 })
      await controller.refreshModel({ id: 'large', provider: 'custom', contextWindow: 400000 })
      assert.deepEqual(reserves, [40000, 80000]); run.json('compaction-runtime.json', { saved: getCompactionThreshold(), reserves })
      await invoke('setCompactionThreshold', 40000); await load('view=settings')
      assert((await page.locator('#compaction-threshold-select').innerText()).includes('40000'))
      await chooseSetting('#compaction-threshold-select', 'SDK default')
      await page.waitForFunction(() => document.querySelector('#compaction-threshold-select')?.textContent?.includes('SDK default'))
      assert.equal(getCompactionThreshold(), null)
    })
    await check('Connection icons reflect provider or endpoint rather than the default model', async () => {
      await page.locator('[data-icon-name="Command Goat"] img').waitFor()
      const sources = await page.locator('[data-icon-name] img').evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src))
      assert.equal(sources.length, 3); assert.equal(new Set(sources).size, 3)
      assert.equal(await page.locator('[data-icon-name="Private Gateway"] img').count(), 0)
      await page.screenshot({ path: join(run.directory, 'utility-and-percentage.png') })
    })
    await check('Compatible Images API uses explicit connection/model and standard base64 response', async () => {
      const connection = getLlmConnections()[0]!
      await invoke('setImageGenerationSettings', { connectionSlug: connection.slug, model: 'fixture-image' })
      const { generateImage, resolveConfiguredImageGeneration } = await import('../../packages/server-core/src/services/image-generation')
      const selected = await resolveConfiguredImageGeneration({ connections: getLlmConnections(), getApiKey: slug => getCredentialManager().getLlmApiKey(slug) })
      assert.equal(selected.model, 'fixture-image')
      const image = await generateImage({ provider: 'openai-compatible', apiKey: selected.apiKey, baseUrl: connection.baseUrl, maxRetries: 0 }, { prompt: 'Verification fixture', model: selected.model })
      writeFileSync(join(run.directory, 'compatible-image.png'), image.bytes)
      const sent = providerRequests.findLast(request => request.path.endsWith('/images/generations'))!
      assert.equal(sent.body?.response_format, 'b64_json'); assert.equal(sent.body?.model, 'fixture-image'); assert(!('output_format' in sent.body!))
    })
    await check('Native image capabilities follow the current provider contract', async () => {
      const { getImageModels, generateImageWithOpenAI } = await import('../../packages/server-core/src/services/image-generation')
      const models = await getImageModels({ slug: 'image', name: 'OpenAI', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1 })
      assert(!models.some(model => model.id === 'gpt-image-1'))
      const image = await generateImageWithOpenAI({ apiKey: 'fixture-key', baseUrl: `${host}/v1`, maxRetries: 0 },
        { prompt: 'Transparent fixture', model: 'gpt-image-2', background: 'transparent' })
      assert.equal(image.format, 'png')
      const sent = providerRequests.at(-1)!.body!
      assert.equal(sent.background, 'transparent')
    })
    await check('Default custom chat omits output caps while explicit limits remain effective', async () => {
      const { withCustomEndpointOutputPolicy } = await import('../../packages/pi-agent-server/src/custom-endpoint-output-policy')
      const { streamSimple } = await import('@earendil-works/pi-ai/compat')
      const { buildCustomEndpointModelDef } = await import('../../packages/pi-agent-server/src/custom-endpoint-models')
      const stream = withCustomEndpointOutputPolicy(streamSimple as StreamFn)
      const model = { ...buildCustomEndpointModelDef('fixture-main', { baseUrl: `${host}/v1` }, { maxTokens: 943718 }, 'openai-completions'),
        api: 'openai-completions' as const, provider: 'custom-endpoint', baseUrl: `${host}/v1` }
      const { normalizeContext } = await import('@earendil-works/pi-ai')
      const transcript = normalizeContext({ messages: [{ role: 'user' as const, content: 'Say ok', timestamp: 1 }] })
      const implicit = await (await stream(model, transcript, { apiKey: 'fixture-key' })).result()
      assert.equal(implicit.stopReason, 'stop', implicit.errorMessage)
      const sent = providerRequests.at(-1)!.body!
      assert.equal(sent.max_tokens, undefined); assert.equal(sent.max_completion_tokens, undefined)
      const explicit = await (await stream(model, transcript, { apiKey: 'fixture-key', maxTokens: 123 })).result()
      assert.equal(explicit.stopReason, 'stop', explicit.errorMessage)
      const capped = providerRequests.at(-1)!.body!
      assert.equal(capped.max_completion_tokens ?? capped.max_tokens, 123)
    })
    await check('Chinese dark and narrow layouts retain visible usable controls', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await load('view=settings&mode=dark&lang=zh-Hans')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)
      assert((await page.innerText('body')).includes('call_llm 默认模型'))
      await page.screenshot({ path: join(run.directory, 'settings-dark-narrow.png'), fullPage: true })
      await load('view=form&mode=dark&lang=zh-Hans'); await chooseProvider('Custom')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)
      await page.screenshot({ path: join(run.directory, 'custom-dark-narrow.png'), fullPage: true })
    })
    await check('Native provider setup seeds its own catalog and normalizes utility model IDs', async () => {
      const result = await invoke('setupLlmConnection', { slug: 'pi-api-key-3', credential: 'fixture-native-key',
        baseUrl: '', piAuthProvider: 'opencode-go', brandId: 'opencode-go', modelSelectionMode: 'automaticallySyncedFromProvider' }) as { success: boolean; error?: string }
      assert(result.success, result.error)
      const connection = getLlmConnection('pi-api-key-3')!
      assert.equal(connection.providerType, 'pi'); assert.equal(connection.piAuthProvider, 'opencode-go')
      assert(connection.models?.some(model => (typeof model === 'string' ? model : model.id) === connection.defaultModel))
      const selected = connection.models![0]!, id = typeof selected === 'string' ? selected : selected.id
      await invoke('setupLlmConnection', { slug: connection.slug, updateOnly: true, utilityModel: id.replace(/^pi\//, '') })
      assert.equal(getLlmConnection(connection.slug)!.utilityModel, id)
      assert.equal(getMiniModel(getLlmConnection(connection.slug)!), id)
    })
    assert.deepEqual(errors, [])
    run.complete(checks, ['Real paid provider generation, live Command Goat credentials, physical Windows compositor, native macOS/Linux. Local HTTP and real browser/SDK/RPC/storage paths are exercised; desktop transport and session-manager notifications are bridged.'])
  } finally {
    run.json('acceptance.json', { checks, pageErrors: errors, providerRequests, logs, savedConfig: JSON.parse(readFileSync(join(config, 'config.json'), 'utf8')) })
    await context.tracing.stop({ path: join(run.directory, 'trace.zip') })
    await context.close(); await launched.close(); await fixture.close(); api.stop(true); refresh.stopAll()
    console.log(JSON.stringify({ passed: checks.length, output: run.directory }))
  }
})
