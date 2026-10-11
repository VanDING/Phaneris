#!/usr/bin/env bun
/** Failure-first P01–P10 workflow. Each case owns a fresh process, workspace and encrypted store. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { verificationWorkflow } from './verification-artifacts'

const repository = resolve(import.meta.dir, '../..')
const cases = ['skill-copy', 'skill-rename', 'source-backup-copy', 'package-backup-copy',
  'package-rename', 'backup-cleanup', 'credentials-before-rollback', 'missing-backup', 'index-write', 'index-invalidate', 'audit-write', 'credential-cleanup', 'success']
const [mode, scenario, fixture] = process.argv.slice(2)
const hash = (path: string) => createHash('sha256').update(fs.readFileSync(path)).digest('hex')

if (mode === '--inspect') {
  const { setCredentialKeyProvider } = await import('../../packages/shared/src/credentials/backends/secure-storage')
  setCredentialKeyProvider({ id: 'governance-fixture', getKey: () => new Uint8Array(32).fill(7) })
  const { getCredentialManager } = await import('../../packages/shared/src/credentials/manager')
  const found = await getCredentialManager().get({ type: 'source_apikey', workspaceId: 'ws', sourceId: 'old-api' })
  const { readPluginIndex } = await import('../../packages/shared/src/plugins/install')
  const workspace = join(dirname(process.env.PHANERIS_CONFIG_DIR!), 'ws')
  console.log(JSON.stringify({ credentialPresent: found?.value === 'fixture-only-secret', index: readPluginIndex(workspace) }))
} else if (mode === '--case') {
  assert(fixture && scenario && cases.includes(scenario))
  const caseName: string = scenario
  const ws = join(fixture, 'ws'), incoming = join(fixture, 'incoming/demo'), configDir = join(fixture, 'config')
  process.env.PHANERIS_CONFIG_DIR = configDir
  process.env.PHANERIS_PLUGIN_AUDIT_LOG = join(fixture, 'audit.jsonl')
  let armed = false, injected = false, cleaned = 0
  function fault(operation: string, source: unknown, destination?: unknown) {
    if (armed && scenario === 'index-invalidate' && ['write', 'remove'].includes(operation) && String(source).endsWith('_index.json')) {
      injected = true
      throw new Error('Injected index write and invalidation failure')
    }
    if (!armed || injected) return
    const from = String(source).replaceAll('\\', '/'), to = String(destination ?? '').replaceAll('\\', '/')
    const matches = (scenario === 'skill-copy' && operation === 'copy' && to.includes('/.tmp-plugin-new-'))
      || (scenario === 'skill-rename' && operation === 'rename' && from.includes('/.tmp-plugin-shared-'))
      || (scenario === 'source-backup-copy' && operation === 'copy' && to.includes('/old-api.replaced-'))
      || (scenario === 'package-backup-copy' && operation === 'copy' && to.includes('/demo.replaced-'))
      || (['package-rename', 'credentials-before-rollback', 'missing-backup'].includes(caseName) && operation === 'rename' && from.includes('/demo.staging-'))
      || (scenario === 'backup-cleanup' && operation === 'remove' && from.includes('.replaced-') && ++cleaned === 2)
      || (scenario === 'index-write' && operation === 'write' && from.endsWith('/_index.json'))
      || (scenario === 'audit-write' && operation === 'append' && from.endsWith('/audit.jsonl'))
      || (scenario === 'credential-cleanup' && operation === 'rename' && to.endsWith('/credentials.enc'))
    if (matches) {
      injected = true
      if (scenario === 'missing-backup') {
        const skills = join(ws, 'skills')
        const backup = native.readdirSync(skills).find(name => name.startsWith('shared.replaced-'))
        assert(backup, 'Rollback fixture must remove a completed backup')
        native.rmSync(join(skills, backup), { recursive: true })
      }
      if (operation === 'copy') { fs.mkdirSync(to, { recursive: true }); fs.writeFileSync(join(String(to), 'partial'), 'incomplete backup') }
      throw new Error(`Injected ${scenario}`)
    }
  }
  const { mock } = await import('bun:test')
  // Capture native functions before mocking. No installer or credential module is mocked.
  const native = { ...fs }
  const intercepted = { ...native,
    cpSync: (...args: Parameters<typeof fs.cpSync>) => { fault('copy', args[0], args[1]); return native.cpSync(...args) },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => { fault('rename', args[0], args[1]); return native.renameSync(...args) },
    rmSync: (...args: Parameters<typeof fs.rmSync>) => { fault('remove', args[0]); return native.rmSync(...args) },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => { fault('write', args[0]); return native.writeFileSync(...args) },
    appendFileSync: (...args: Parameters<typeof fs.appendFileSync>) => { fault('append', args[0]); return native.appendFileSync(...args) },
  }
  mock.module('node:fs', () => intercepted)
  mock.module('fs', () => intercepted)
  const { installPlugin, analyzePluginInstall, readPluginIndex } = await import('../../packages/shared/src/plugins/install')
  const { PLUGIN_MANIFEST_SCHEMA, PLUGIN_EXTENSION_SOURCES_FILE } = await import('../../packages/shared/src/plugins/types')
  const { saveSourceConfig, loadSourceConfig } = await import('../../packages/shared/src/sources/storage')
  const { getCredentialManager, setCredentialKeyProvider } = await import('../../packages/shared/src/credentials')
  setCredentialKeyProvider({ id: 'governance-fixture', getKey: () => new Uint8Array(32).fill(7) })
  const write = (path: string, content: string) => { native.mkdirSync(dirname(path), { recursive: true }); native.writeFileSync(path, content) }
  const skill = (name: string, version: string) => `---\nname: ${name}\ndescription: ${version}\n---\n${version}\n`
  write(join(incoming, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'demo', version: '2.0.0' }))
  write(join(incoming, 'skills/shared/SKILL.md'), skill('shared', 'new'))
  write(join(incoming, 'skills/new/SKILL.md'), skill('new', 'new'))
  write(join(incoming, PLUGIN_EXTENSION_SOURCES_FILE), JSON.stringify([{ slug: 'old-api', type: 'api' }]))
  write(join(incoming, 'mcp.json'), JSON.stringify({ mcpServers: { 'new-api': { type: 'stdio', command: 'node', args: ['--version'] } } }))
  write(join(ws, 'plugins/demo/plugin.json'), JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'demo', version: '1.0.0' }))
  write(join(ws, 'plugins/demo/data/state.txt'), 'mutable state')
  write(join(ws, 'skills/shared/SKILL.md'), skill('shared', 'old'))
  write(join(ws, 'skills/shared/obsolete.txt'), 'old only')
  saveSourceConfig(ws, { id: 'old-api-id', name: 'Existing source', slug: 'old-api', enabled: true,
    provider: 'demo', type: 'api', api: { baseUrl: 'https://example.invalid', authType: 'bearer' }, createdAt: 1, updatedAt: 1 })
  write(join(ws, 'sources/old-api/guide.md'), 'User guide survives replacement')
  write(join(ws, 'plugins/_index.json'), JSON.stringify({ version: 1, resources: { skills: {}, sources: {} } }))
  await getCredentialManager().set({ type: 'source_apikey', workspaceId: basename(ws), sourceId: 'old-api' }, { value: 'fixture-only-secret' })
  const protectedPaths = ['skills/shared/SKILL.md', 'skills/shared/obsolete.txt', 'sources/old-api/config.json',
    'sources/old-api/guide.md', 'plugins/demo/plugin.json', 'plugins/demo/data/state.txt']
  const before = Object.fromEntries(protectedPaths.map(path => [path, hash(join(ws, path))]))
  const credentialHash = hash(join(configDir, 'credentials.enc'))
  const plan = analyzePluginInstall(ws, incoming)
  armed = true
  let result: ReturnType<typeof installPlugin> | undefined, error: unknown
  try { result = installPlugin(ws, plan) } catch (caught) { error = caught }
  armed = false
  if (scenario !== 'success') assert(injected, 'The intended filesystem failure must actually execute')
  const inspect = Bun.spawn([process.execPath, import.meta.path, '--inspect'], {
    env: { ...process.env, PHANERIS_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe',
  })
  const [inspection, inspectionError, inspectionCode] = await Promise.all([
    new Response(inspect.stdout).text(), new Response(inspect.stderr).text(), inspect.exited,
  ])
  assert.equal(inspectionCode, 0, inspectionError)
  const persisted = JSON.parse(inspection)
  const credentialPresent = persisted.credentialPresent as boolean
  assert.equal((await getCredentialManager().get({ type: 'source_apikey', workspaceId: 'ws', sourceId: 'old-api' }))?.value === 'fixture-only-secret', credentialPresent,
    'Credential cache and persistent state must agree after cleanup failure')
  const rollback = ['skill-copy', 'skill-rename', 'source-backup-copy', 'package-backup-copy', 'package-rename', 'credentials-before-rollback'].includes(scenario)
  if (scenario === 'missing-backup') {
    assert(error && String(error).includes('rollback incomplete'))
    assert((error as { detail?: string }).detail?.includes('Backup missing'))
    assert.equal(native.readFileSync(join(ws, 'skills/shared/SKILL.md'), 'utf8'), skill('shared', 'new'), 'Missing backup cannot authorize deleting the sole surviving target')
    assert.equal(hash(join(ws, 'plugins/demo/data/state.txt')), before['plugins/demo/data/state.txt'])
    assert(credentialPresent)
    assert(!native.existsSync(join(ws, 'skills/new')))
  } else if (rollback) {
    assert(error, 'Pre-commit failures must abort installation')
    for (const path of protectedPaths) assert.equal(hash(join(ws, path)), before[path], `Rollback corrupted ${path}`)
    assert.equal(hash(join(configDir, 'credentials.enc')), credentialHash, 'Rollback must not rewrite the credential store')
    assert(credentialPresent, 'Old credential must be readable in a fresh process')
    assert(!native.existsSync(join(ws, 'skills/new')))
    assert(!native.existsSync(join(ws, 'sources/new-api')))
  } else {
    assert(!error, `Post-commit cleanup must not fail or undo installation: ${String(error)}`)
    assert(result)
    assert.equal(loadSourceConfig(ws, 'old-api')?.api?.authType, 'none')
    assert.equal(native.readFileSync(join(ws, 'skills/shared/SKILL.md'), 'utf8'), skill('shared', 'new'))
    assert(!native.existsSync(join(ws, 'skills/shared/obsolete.txt')))
    assert(native.existsSync(join(ws, 'skills/new/SKILL.md')))
    assert.equal(native.readFileSync(join(ws, 'plugins/demo/data/state.txt'), 'utf8'), 'mutable state')
    assert.equal(hash(join(ws, 'sources/old-api/guide.md')), before['sources/old-api/guide.md'])
    assert.equal(credentialPresent, scenario === 'credential-cleanup')
    if (scenario !== 'success') assert(result.warnings.some(warning => /cleanup|index|audit|credential/i.test(warning.message)))
    assert.deepEqual(readPluginIndex(ws).resources.skills.shared, ['demo'])
    assert.deepEqual(persisted.index.resources.skills.shared, ['demo'], 'A fresh reader must not trust a stale index')
    if (scenario === 'success') {
      const placed = join(ws, 'plugins/demo')
      installPlugin(ws, analyzePluginInstall(ws, placed))
      assert.equal(native.readFileSync(join(placed, 'data/state.txt'), 'utf8'), 'mutable state')
    }
  }
  console.log(JSON.stringify({ scenario, injected, passed: true, rolledBack: rollback, before, credentialPresent,
    credentialFileUnchanged: hash(join(configDir, 'credentials.enc')) === credentialHash, warnings: result?.warnings ?? [] }))
} else {
  await verificationWorkflow('plugin-transaction', async run => {
  const output = run.directory
  const checks: unknown[] = []
  for (const name of cases) {
    const fixture = fs.mkdtempSync(join(tmpdir(), `phaneris-plugin-${name}-`))
    const child = Bun.spawn([process.execPath, import.meta.path, '--case', name, fixture], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    fs.writeFileSync(join(output, `${name}.log`), `${stdout}\n${stderr}`)
    checks.push({ id: name, passed: code === 0, exitCode: code, fixture, result: code === 0 ? JSON.parse(stdout.trim()) : null })
  }
  fs.writeFileSync(join(output, 'plugin-transaction.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks,
    artifacts: fs.readdirSync(output).map(path => ({ path: relative(output, join(output, path)), sha256: hash(join(output, path)) })),
    untested: ['SIGKILL/power loss during installation', 'concurrent installation of the same plugin', 'Windows/Linux native filesystem'] }, null, 2) + '\n')
  console.log(JSON.stringify({ output, passed: checks.filter((check) => (check as { passed: boolean }).passed).length, total: cases.length }))
  const passed = checks.every(check => (check as { passed: boolean }).passed)
  if (passed) run.complete(cases, ['SIGKILL/power loss during installation', 'concurrent installation of the same plugin', 'Windows/Linux native filesystem'])
  assert(passed, `Plugin transaction verification failed; see ${output}`)
  })
}
