import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { analyzePluginInstall, installPlugin, loadPlugin, buildPluginRoster, formatPluginContextBlock, summarizePluginForRenderer, expandPluginPlaceholders, PLUGIN_MANIFEST_SCHEMA, PLUGIN_EXTENSION_SOURCES_FILE } from '../../packages/shared/src/plugins'
import { loadSkill } from '../../packages/shared/src/skills/storage'

await verificationWorkflow('plugin-consistency', async run => {
  const results: Array<{ id: string; pass: boolean; error?: string }> = []
  const write = (file: string, value: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value) }
  const body = (label: string, name = 'example') => `---\nname: ${name}\ndescription: ${label} description\n---\n${label} body\n`
  function fixture(id: string) {
    const ws = join(run.directory, id, 'workspace'), pkg = join(run.directory, id, 'incoming', 'demo')
    mkdirSync(ws, { recursive: true })
    write(join(pkg, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'demo' }))
    write(join(pkg, 'skills/example/SKILL.md'), body('Native'))
    return { ws, pkg }
  }
  async function scene(id: string, fn: () => unknown | Promise<unknown>) {
    try { await fn(); results.push({ id, pass: true }) } catch (error) { results.push({ id, pass: false, error: String(error) }) }
  }
  await scene('native-roster-same-bytes', () => {
    const { ws, pkg } = fixture('roster'); installPlugin(ws, analyzePluginInstall(ws, pkg))
    write(join(ws, 'plugins/demo/skills/example/SKILL.md'), body('Package changed'))
    write(join(ws, 'skills/example/SKILL.md'), body('Native edited', 'Native edited'))
    const loaded = loadPlugin(ws, 'demo'); assert(loaded.ok)
    const entry = buildPluginRoster(loaded.plugin)[0]; assert(entry)
    assert.equal(entry.name, loadSkill(ws, 'example')?.metadata.name)
    assert.equal(readFileSync(entry.skillMdPath, 'utf8'), body('Native edited', 'Native edited'))
    assert.equal(summarizePluginForRenderer(loaded.plugin).skills[0]?.name, 'Native edited')
    rmSync(join(ws, 'skills/example'), { recursive: true })
    assert.equal(buildPluginRoster(loaded.plugin).length, 0)
    assert.match(formatPluginContextBlock(loaded.plugin), /unavailable|missing/i)
  })
  await scene('invalid-source-before-resource-write', () => {
    const { ws, pkg } = fixture('invalid')
    write(join(pkg, 'mcp.json'), JSON.stringify({ mcpServers: { invalid: { type: 'stdio', command: './bin/server', args: [123] } } }))
    const plan = analyzePluginInstall(ws, pkg)
    assert(![...plan.creates, ...plan.overwrites].some(e => e.slug === 'invalid'))
    assert(plan.warnings.some(e => /args|invalid/i.test(e.message)))
    installPlugin(ws, plan); assert(!existsSync(join(ws, 'sources/invalid')))
  })
  await scene('header-is-not-bearer-auth', () => {
    const { ws, pkg } = fixture('headers')
    write(join(pkg, 'mcp.json'), JSON.stringify({ mcpServers: { public: { type: 'streamable-http', url: 'https://example.invalid/mcp', headers: { 'X-Client': 'phaneris' } } } }))
    installPlugin(ws, analyzePluginInstall(ws, pkg))
    assert.equal(JSON.parse(readFileSync(join(ws, 'sources/public/config.json'), 'utf8')).mcp.authType, 'none')
  })
  await scene('duplicate-source-rejected', () => {
    const { ws, pkg } = fixture('collision')
    write(join(pkg, 'mcp.json'), JSON.stringify({ mcpServers: { duplicate: { type: 'streamable-http', url: 'https://example.invalid/mcp' } } }))
    write(join(pkg, PLUGIN_EXTENSION_SOURCES_FILE), JSON.stringify([{ slug: 'duplicate', type: 'api' }]))
    assert.throws(() => analyzePluginInstall(ws, pkg), /duplicate/i)
    assert(!existsSync(join(ws, 'skills')))
  })
  await scene('extension-without-configuration-visible', () => {
    const { ws, pkg } = fixture('extension')
    write(join(pkg, PLUGIN_EXTENSION_SOURCES_FILE), JSON.stringify([{ slug: 'api', type: 'api' }, { slug: 'local', type: 'local' }]))
    const plan = analyzePluginInstall(ws, pkg); assert(!plan.creates.some(e => e.kind === 'source'))
    installPlugin(ws, plan)
    const loaded = loadPlugin(ws, 'demo'); assert(loaded.ok)
    const dto = summarizePluginForRenderer(loaded.plugin)
    assert(dto.sources.every(e => e.availability === 'needs-configuration'))
  })
  await scene('native-source-readiness-is-not-live-connectivity', () => {
    const { ws, pkg } = fixture('readiness')
    write(join(pkg, 'mcp.json'), JSON.stringify({ mcpServers: { remote: { type: 'streamable-http', url: 'https://example.invalid/mcp' } } }))
    installPlugin(ws, analyzePluginInstall(ws, pkg))
    const loaded = loadPlugin(ws, 'demo'); assert(loaded.ok)
    const file = join(ws, 'sources/remote/config.json'), config = JSON.parse(readFileSync(file, 'utf8'))
    const status = () => summarizePluginForRenderer(loaded.plugin).sources[0]?.availability
    assert.equal(status(), 'not-connected')
    for (const [connectionStatus, expected] of [['failed', 'connection-failed'], ['connected', 'configured'], ['needs_auth', 'needs-authentication']] as const) {
      write(file, JSON.stringify({ ...config, connectionStatus })); assert.equal(status(), expected)
    }
    write(file, JSON.stringify({ ...config, enabled: false })); assert.equal(status(), 'disabled')
    write(file, JSON.stringify({ ...config, connectionStatus: 'local_disabled' })); assert.equal(status(), 'disabled')
    rmSync(file); assert.equal(status(), 'missing')
  })
  await scene('stdio-readiness-requires-an-executable-file', () => {
    const { ws, pkg } = fixture('executable')
    write(join(pkg, 'mcp.json'), JSON.stringify({ mcpServers: { command: { type: 'stdio', command: './bin/server' } } }))
    installPlugin(ws, analyzePluginInstall(ws, pkg))
    const loaded = loadPlugin(ws, 'demo'); assert(loaded.ok)
    const status = () => summarizePluginForRenderer(loaded.plugin).sources[0]?.availability
    assert.equal(status(), 'missing-executable')
    const command = join(ws, 'plugins/demo/bin/server'); mkdirSync(command, { recursive: true }); assert.equal(status(), 'missing-executable')
    rmSync(command, { recursive: true }); write(command, 'fixture-only-command'); assert.equal(status(), 'not-connected')
  })
  await scene('windows-opaque-arguments', () => {
    const root = join(run.directory, 'opaque')
    for (const value of ['https://example.invalid/a/b', '{"url":"https://example.invalid/a"}', '^a/b$', '--root=${PLUGIN_ROOT}/x --url=https://example.invalid/a/b']) {
      assert.equal(expandPluginPlaceholders(value, { pluginRoot: root }), value.replaceAll('${PLUGIN_ROOT}', root))
    }
  })
  await scene('watcher-healthy-content-refresh', async () => {
    const { ws, pkg } = fixture('watcher'); installPlugin(ws, analyzePluginInstall(ws, pkg))
    const { ConfigWatcher } = await import('../../packages/shared/src/config/watcher')
    const versions: string[] = []
    const watcher = new ConfigWatcher(ws, { onPluginsChange: result => { for (const plugin of result.plugins) versions.push(plugin.manifest.version ?? 'initial') } })
    watcher.start()
    try {
      for (const version of ['1.0.0', '2.0.0']) {
        write(join(ws, 'plugins/demo/plugin.json'), JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'demo', version }))
        const deadline = Date.now() + 3000
        while (!versions.includes(version) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40))
        assert(versions.includes(version), `Missing healthy update ${version}`)
      }
    } finally { watcher.stop() }
  })
  for (const failure of ['package', 'target', 'workspace', 'reuse', 'expiry', 'competing'] as const) await scene(`install-confirmation-${failure}`, async () => {
    const api = await import('../../packages/shared/src/plugins/confirmation')
    const { ws, pkg } = fixture(`confirm-${failure}`)
    const plan = api.preparePluginInstall(ws, pkg, failure === 'expiry' ? 0 : undefined)
    if (failure === 'package') write(join(pkg, 'skills/example/SKILL.md'), body('Changed'))
    if (failure === 'target') write(join(ws, 'skills/example/SKILL.md'), body('Handmade'))
    if (failure === 'reuse') api.executePluginInstall(ws, plan.planId)
    if (failure === 'competing') api.executePluginInstall(ws, api.preparePluginInstall(ws, pkg).planId)
    const other = failure === 'workspace' ? fixture('other').ws : ws
    assert.throws(() => api.executePluginInstall(other, plan.planId), /expired|changed|workspace|consumed|plan/i)
    assert.throws(() => api.executePluginInstall(ws, plan.planId), /plan|consumed/i)
  })
  await scene('install-and-uninstall-one-use-plan', async () => {
    const api = await import('../../packages/shared/src/plugins/confirmation')
    const { ws, pkg } = fixture('success')
    api.executePluginInstall(ws, api.preparePluginInstall(ws, pkg).planId)
    const uninstall = api.preparePluginUninstall(ws, 'demo')
    api.executePluginUninstall(ws, uninstall.planId)
    assert(!existsSync(join(ws, 'plugins/demo'))); assert(!existsSync(join(ws, 'skills/example')))
    assert.throws(() => api.executePluginUninstall(ws, uninstall.planId), /plan|consumed/i)
  })
  await scene('uninstall-stale-target-kept', async () => {
    const api = await import('../../packages/shared/src/plugins/confirmation')
    const { ws, pkg } = fixture('uninstall-stale')
    api.executePluginInstall(ws, api.preparePluginInstall(ws, pkg).planId)
    const plan = api.preparePluginUninstall(ws, 'demo')
    write(join(ws, 'skills/example/SKILL.md'), body('Keep user edit'))
    assert.throws(() => api.executePluginUninstall(ws, plan.planId), /changed/i)
    assert.equal(readFileSync(join(ws, 'skills/example/SKILL.md'), 'utf8'), body('Keep user edit'))
  })
  run.json('plugin-consistency.json', results)
  assert(results.every(r => r.pass), JSON.stringify(results.filter(r => !r.pass)))
  run.complete(results.map(r => r.id), ['No real provider or credentials; live connection/authentication remains session-owned. Existing transaction/crash workflows cover rollback separately.'])
})
