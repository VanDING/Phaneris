import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as legacy from '../../../packages/shared/src/config/storage.ts'

const dir = process.env.PHANERIS_CONFIG_DIR!
const checks: string[] = []
const path = join(dir, 'config.json')
const seed = { workspaces: [], activeWorkspaceId: null, activeSessionId: null,
  llmConnections: [{ slug: 'old', name: 'Old', providerType: 'openai', authType: 'oauth', defaultModel: 'gpt-5' }],
  defaultLlmConnection: 'old' }
writeFileSync(path, '{broken')
assert.equal(legacy.loadStoredConfig(), null)
assert.equal(readFileSync(path, 'utf8'), '{broken')
checks.push('corrupt-preserved')
writeFileSync(path, JSON.stringify(seed))
legacy.migrateLegacyLlmConnectionsConfig()
const migrated = readFileSync(path, 'utf8')
legacy.migrateLegacyLlmConnectionsConfig()
assert.equal(readFileSync(path, 'utf8'), migrated)
checks.push('migration-idempotent')
await Promise.all([
  Promise.resolve().then(() => legacy.setNotificationsEnabled(false)),
  Promise.resolve().then(() => legacy.setSpellCheck(true)),
  Promise.resolve().then(() => legacy.setSendMessageKey('cmd-enter')),
])
assert.equal(legacy.getNotificationsEnabled(), false)
assert.equal(legacy.getSpellCheck(), true)
assert.equal(legacy.getSendMessageKey(), 'cmd-enter')
checks.push('concurrent-in-process-settings')
legacy.setSessionDraft('windows', { text: 'Draft', attachments: [{ name: 'report.pdf', path: 'C:\\work\\report.pdf' }] })
assert.equal(legacy.getSessionDraft('windows')?.text, 'Draft')
assert.equal(legacy.getAllSessionDrafts().windows?.attachments?.[0]?.path, 'C:\\work\\report.pdf')
checks.push('windows-draft')
assert.equal(legacy.loadConfigDefaults().defaults.sendMessageKey, 'enter')
checks.push('without-bundled-assets')
const preferences = await import('../../../packages/shared/src/config/appearance.ts')
const connections = await import('../../../packages/shared/src/config/connections.ts')
const repository = await import('../../../packages/shared/src/config/repository.ts')
assert.equal(preferences.setNotificationsEnabled, legacy.setNotificationsEnabled)
assert.equal(repository.saveConfig, legacy.saveConfig)
assert.equal(connections.getLlmConnection, legacy.getLlmConnection)
preferences.setNotificationsEnabled(true)
assert.equal(legacy.getNotificationsEnabled(), true)
checks.push('compatibility-owner-identity')
const before = connections.getLlmConnection('old')!
const beforeName = before.name
assert(connections.updateLlmConnection('old', { name: 'Refreshed' }))
assert.equal(legacy.getLlmConnection('old')?.name, 'Refreshed')
assert.equal(before.name, beforeName)
assert.equal(legacy.loadStoredConfig()?.defaultLlmConnection, 'old')
checks.push('connection-refresh')
const { getCredentialManager, CredentialManager } = await import('../../../packages/shared/src/credentials/index.ts')
const credentials = getCredentialManager()
await legacy.setRemoteServerToken('remote', 'fixture-secret')
// Inject the actual persistence failure below CredentialManager's boolean compatibility API.
const backend = (credentials as unknown as { backend: { saveStoreSync: (...args: unknown[]) => void } }).backend
const saveStore = backend.saveStoreSync
backend.saveStoreSync = () => { throw new Error('fixture credential unavailable') }
try {
  await assert.rejects(legacy.deleteRemoteServerToken('remote'), /credential unavailable/)
  assert.equal(legacy.getRemoteServerTokenSync('remote'), 'fixture-secret')
  assert.equal((await credentials.get({ type: 'remote_server_token', workspaceId: 'remote' }))?.value, 'fixture-secret')
  assert.equal((await new CredentialManager().get({ type: 'remote_server_token', workspaceId: 'remote' }))?.value, 'fixture-secret')
} finally { backend.saveStoreSync = saveStore }
await legacy.deleteRemoteServerToken('remote')
await legacy.deleteRemoteServerToken('remote')
assert.equal(legacy.getRemoteServerTokenSync('remote'), undefined)
checks.push('credential-failure-preserves-cache-and-vault')
const storedWorkspace = { id: 'remote-remove', slug: 'remote-remove', name: 'Remote', rootPath: join(dir, 'remote-workspace'), createdAt: 1,
  remoteServer: { url: 'ws://127.0.0.1:1', remoteWorkspaceId: 'remote' } }
const beforeWorkspace = readFileSync(path, 'utf8')
const configuration = legacy.loadStoredConfig()!
configuration.workspaces.push(storedWorkspace)
legacy.saveConfig(configuration)
await legacy.setRemoteServerToken(storedWorkspace.id, 'remove-secret')
const beforeRemoval = readFileSync(path, 'utf8')
backend.saveStoreSync = () => { throw new Error('fixture credential removal unavailable') }
try {
  await assert.rejects(legacy.removeWorkspace(storedWorkspace.id), /credential removal unavailable/)
  assert.equal(readFileSync(path, 'utf8'), beforeRemoval)
  assert.equal(legacy.getRemoteServerTokenSync(storedWorkspace.id), 'remove-secret')
} finally { backend.saveStoreSync = saveStore }
await legacy.removeWorkspace(storedWorkspace.id)
checks.push('workspace-credential-failure-preserves-config-and-cache')
const sentinel = join(dir, 'workspaces', 'preserved', 'session.jsonl')
mkdirSync(join(sentinel, '..'), { recursive: true }); writeFileSync(sentinel, 'preserved conversation')
const { registerAuthHandlers } = await import('../../../packages/server-core/src/handlers/rpc/auth.ts')
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
registerAuthHandlers({ handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as never,
  { platform: { logger: { info() {}, error() {} } } } as never)
const logout = handlers.get('auth:logout')!
await logout({}, { confirm: true })
assert.equal(existsSync(path), false)
assert.equal(readFileSync(sentinel, 'utf8'), 'preserved conversation')
checks.push('logout-config-owner-preserves-workspace-data')
writeFileSync(path, beforeWorkspace)
const persisted = JSON.parse(readFileSync(path, 'utf8'))
assert(!JSON.stringify(persisted).includes('fixture-secret'))
console.log(JSON.stringify({ dir, checks, persisted }))
