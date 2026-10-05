/** Persisted image defaults → actual provider resolution → loopback Images API. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..'), output = join(root, '.cache/ai-settings-refinement')
mkdirSync(output, { recursive: true })
const fixture = mkdtempSync(join(output, 'images-'))
const workspaceRoot = join(fixture, 'workspace')
mkdirSync(workspaceRoot)
writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ id: 'image-fixture', name: 'Image fixture', defaults: { defaultLlmConnection: 'router', model: 'anthropic/claude-sonnet-4.6' } }))
process.env.PHANERIS_CONFIG_DIR = fixture
const received: unknown[] = [], records: Array<{ id: string; pass: boolean; error?: string }> = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  received.push(await request.json()); return Response.json({ created: 1, data: [{ b64_json: 'iVBORw0KGgo=' }], output_format: 'png' })
} })
writeFileSync(join(fixture, 'config.json'), JSON.stringify({ workspaces: [{ id: 'image-fixture', name: 'Image fixture', rootPath: workspaceRoot, createdAt: Date.now() }], activeWorkspaceId: null, activeSessionId: null, defaultLlmConnection: 'openai',
  llmConnections: [{ slug: 'openai', name: 'OpenAI', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key', baseUrl: api.url.href + 'v1', defaultModel: 'gpt-5.4', models: ['gpt-5.4'] },
    { slug: 'router', name: 'OpenRouter', providerType: 'pi', piAuthProvider: 'openrouter', authType: 'api_key', defaultModel: 'anthropic/claude-sonnet-4.6', models: ['anthropic/claude-sonnet-4.6'] }] }))
async function check(id: string, action: () => Promise<void>) { try { await action(); records.push({ id, pass: true }) } catch (error) { records.push({ id, pass: false, error: String(error) }) } }
try {
  const storage = await import('../../packages/shared/src/config/storage')
  const images = await import('../../packages/server-core/src/services/image-generation')
  await check('Image defaults persist independently from conversation models', async () => {
    storage.setImageGenerationSettings({ connectionSlug: 'openai', model: 'gpt-image-1' })
    assert.deepEqual(storage.getImageGenerationSettings(), { connectionSlug: 'openai', model: 'gpt-image-1' })
    const selected = await images.resolveConfiguredImageGeneration({ connections: storage.getLlmConnections(), getApiKey: async () => 'fixture-key' })
    assert.equal(selected.model, 'gpt-image-1')
    await images.generateImage({ provider: 'openai', apiKey: selected.apiKey, baseUrl: selected.connection.baseUrl }, { prompt: 'fixture', model: selected.model })
    assert.equal((received[0] as { model: string }).model, 'gpt-image-1')
    assert.equal(storage.getLlmConnections()[0]!.defaultModel, 'gpt-5.4')
  })
  await check('A broken explicit default never falls back to another account', async () => {
    storage.setImageGenerationSettings({ connectionSlug: 'router' })
    await assert.rejects(() => images.resolveConfiguredImageGeneration({ connections: storage.getLlmConnections(), getApiKey: async slug => slug === 'openai' ? 'fixture' : null }), /missing/i)
  })
  await check('Automatic selection and effective model are visible in backend status', async () => {
    storage.setImageGenerationSettings({})
    const status = await images.getImageGenerationStatus({ connections: storage.getLlmConnections(), getApiKey: async () => 'fixture' })
    assert.equal(status.effective?.connectionSlug, 'openai'); assert.equal(status.effective?.model, 'gpt-image-2')
    assert(status.connections.every(connection => connection.models.length > 0))
  })
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { registerSettingsHandlers } = await import('../../packages/server-core/src/handlers/rpc/settings')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol/channels')
  const { getCredentialManager } = await import('../../packages/shared/src/credentials')
  const { loadWorkspaceConfig } = await import('../../packages/shared/src/workspaces')
  const credential = 'fixture-image-secret-never-in-status'
  await getCredentialManager().setLlmApiKey('openai', credential)
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async token => token === 'image-fixture-token' })
  registerSettingsHandlers(server, { platform: { logger: { info: () => {} } } } as any)
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { mode: 'remote', token: 'image-fixture-token', autoReconnect: false })
  client.connect()
  try {
    await check('Authenticated settings RPC persists image defaults and exposes no credential', async () => {
      const saved: any = await client.invoke(RPC_CHANNELS.settings.SET_IMAGE_GENERATION_SETTINGS, { connectionSlug: 'openai', model: 'gpt-image-1' })
      assert.equal(saved.effective.model, 'gpt-image-1')
      const reloaded: any = await client.invoke(RPC_CHANNELS.settings.GET_IMAGE_GENERATION_SETTINGS)
      assert.deepEqual(reloaded.settings, storage.getImageGenerationSettings())
      assert(!JSON.stringify(reloaded).includes(credential))
    })
    await check('RPC rejects removed connections and incompatible models without changing saved defaults', async () => {
      const before = storage.getImageGenerationSettings()
      await assert.rejects(client.invoke(RPC_CHANNELS.settings.SET_IMAGE_GENERATION_SETTINGS, { connectionSlug: 'removed' }))
      await assert.rejects(client.invoke(RPC_CHANNELS.settings.SET_IMAGE_GENERATION_SETTINGS, { connectionSlug: 'openai', model: 'gpt-5.4' }))
      await assert.rejects(client.invoke(RPC_CHANNELS.settings.SET_IMAGE_GENERATION_SETTINGS, { model: 'gpt-image-1' }))
      assert.deepEqual(storage.getImageGenerationSettings(), before)
    })
    await check('Workspace connection RPC clears a foreign model atomically on disk', async () => {
      await client.invoke(RPC_CHANNELS.workspace.SETTINGS_UPDATE, 'image-fixture', 'defaultLlmConnection', 'openai')
      const config = loadWorkspaceConfig(workspaceRoot)!
      assert.equal(config.defaults!.defaultLlmConnection, 'openai'); assert.equal(config.defaults!.model, undefined)
    })
    await check('RPC status keeps an explicit account with missing credentials unavailable', async () => {
      const status: any = await client.invoke(RPC_CHANNELS.settings.SET_IMAGE_GENERATION_SETTINGS, { connectionSlug: 'router' })
      assert.equal(status.settings.connectionSlug, 'router'); assert.equal(status.effective, undefined); assert(status.error)
    })
  } finally { client.destroy(); await server.close() }
} finally {
  api.stop(true); writeFileSync(join(output, 'images-latest.json'), JSON.stringify({ fixture, records, received }, null, 2))
}
console.log(JSON.stringify({ records, received })); process.exit(records.every(record => record.pass) ? 0 : 1)
