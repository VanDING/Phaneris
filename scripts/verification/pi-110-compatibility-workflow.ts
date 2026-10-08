/** Upgrade contracts specified before implementation; real SDK, store and isolated Vault. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-pi-110-'))
process.env.PHANERIS_CONFIG_DIR = fixture
process.env.NODE_ENV = 'test'
const checks: any[] = []
async function check(id: string, run: () => any) {
  try { checks.push({ id, pass: true, observation: await run() }) }
  catch (error) { checks.push({ id, pass: false, error: String(error) }) }
}
await check('the complete native SDK family is exactly 1.1.0', async () => {
  const packages = ['pi-agent-core','pi-ai','pi-coding-agent','pi-codemode','pi-server','pi-mcp','pi-protocol','pi-telemetry','pi-tui','chord']
  const versions = Object.fromEntries(packages.map(name => [name, JSON.parse(readFileSync(join(root, 'node_modules/@earendil-works', name, 'package.json'), 'utf8')).version]))
  assert(Object.values(versions).every(v => v === '1.1.0'))
  return versions
})
await check('legacy Azure provider resolves native Azure while API and Vault identity remain stable', async () => {
  const { normalizePiProvider } = await import('../../packages/shared/src/config/pi-provider-compat.ts')
  const { getPiModelsForAuthProvider } = await import('../../packages/shared/src/config/models-pi.ts')
  const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent')
  const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai')
  const { resolvePiModel } = await import('../../packages/pi-agent-server/src/model-resolution.ts')
  const credentials = new InMemoryCredentialStore()
  await credentials.modify('azure', async () => ({ type: 'api_key', key: 'inert-azure-fixture' }))
  const runtime = await ModelRuntime.create({ credentials, allowModelNetwork: false })
  const registry = new ModelRegistry(runtime)
  assert.equal(normalizePiProvider('azure-openai-responses'), 'azure')
  const models = getPiModelsForAuthProvider('azure-openai-responses')
  assert(models.length > 0)
  const selected = resolvePiModel(registry, models[0].id, 'azure-openai-responses')!
  assert.equal(selected.provider, 'azure')
  assert.equal(selected.api, 'azure-openai-responses')
  assert.equal(resolvePiModel(registry, 'pi/not-a-real-model', 'azure-openai-responses'), undefined)
  return { provider: selected.provider, api: selected.api, catalogCount: models.length }
})
await check('rotation persists once despite cancellation and an aborted lock waiter', async () => {
  const { HostCredentialStore } = await import('../../packages/pi-agent-server/src/host-credential-store.ts')
  const { createModels, createProvider } = await import('@earendil-works/pi-ai/models')
  const { getCredentialManager } = await import('../../packages/shared/src/credentials/index.ts')
  const vault = getCredentialManager()
  const slug = 'rotation-fixture'
  await vault.setLlmOAuth(slug, { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0 })
  let rotations = 0, persisted = 0, release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const store = new HostCredentialStore(async (_provider, credential) => {
    persisted++
    await vault.setLlmOAuth(slug, { accessToken: credential.access, refreshToken: credential.refresh, expiresAt: credential.expires })
  })
  await store.inject('fixture-oauth', { type: 'oauth', access: 'old', refresh: 'old-refresh', expires: 0 })
  const rotationApi = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    rotations++; await gate
    return Response.json({ type: 'oauth', access: 'new', refresh: 'new-refresh', expires: Date.now() + 600000 })
  } })
  const models = createModels({ credentials: store })
  models.setProvider(createProvider({ id: 'fixture-oauth', models: [], api: { stream: () => { throw Error('Not used') }, streamSimple: () => { throw Error('Not used') } }, auth: { oauth: {
    name: 'Fixture', login: async () => { throw Error('Not used') },
    refresh: async (_current, signal) => await (await fetch(rotationApi.url, { signal })).json() as any,
    toAuth: async credential => ({ apiKey: credential.access }),
  } } }))
  const controller = new AbortController()
  const rotate = models.getAuth('fixture-oauth', { signal: controller.signal })
  const cancelledCaller = assert.rejects(rotate)
  while (rotations === 0) await Bun.sleep(1)
  const waiter = models.getAuth('fixture-oauth', { signal: controller.signal })
  controller.abort()
  await assert.rejects(waiter)
  release()
  await cancelledCaller
  const end = Date.now() + 3000
  while ((await store.read('fixture-oauth') as any)?.access !== 'new') {
    if (Date.now() > end) throw Error('Rotation did not settle into the store')
    await Bun.sleep(10)
  }
  rotationApi.stop(true)
  assert.equal((await vault.getLlmOAuth(slug))?.refreshToken, 'new-refresh')
  assert.equal((await store.read('fixture-oauth') as any).access, 'new')
  assert.equal(rotations, 1)
  assert.equal(persisted, 1)
  return { rotations, persisted, vaultUpdated: true }
})
const output = resolve(process.argv[2] ?? join(root, '.cache/pi-110-implementation/compatibility.json'))
mkdirSync(resolve(output, '..'), { recursive: true })
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: 'pi-110-compatibility-v1', checks }, null, 2) + '\n')
console.log(JSON.stringify({ output, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length }))
process.exit(checks.some(c => !c.pass) ? 1 : 0)
