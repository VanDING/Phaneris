import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-layout', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha')
  mkdirSync(root, { recursive: true }); process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Layout fixture', rootPath: root, createdAt: 1 }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, llmConnections: [] }))
  writeFileSync(join(root, 'config.json'), JSON.stringify(workspace))
  const id = '261105-existing-assistant', ordinaryId = '261105-ordinary', legacy = join(root, 'sessions', id)
  const seed = (directory: string, sessionId: string, resident: boolean) => {
    mkdirSync(join(directory, 'attachments'), { recursive: true })
    writeFileSync(join(directory, 'attachments', 'proof.txt'), 'ATTACHMENT_IDENTITY_KEPT')
    writeFileSync(join(directory, 'session.jsonl'), [
      { id: sessionId, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, ...(resident ? { sessionKind: 'resident_assistant', hidden: true } : {}),
        name: resident ? 'Original assistant' : 'Ordinary task', sdkCwd: directory, sdkSessionId: 'ORIGINAL_SDK_ID' },
      { id: 'layout-user', type: 'user', timestamp: 1, content: 'LAYOUT_ORIGINAL_CONVERSATION {{SESSION_PATH}}/attachments/proof.txt' },
    ].map(value => JSON.stringify(value)).join('\n') + '\n')
  }
  seed(legacy, id, true); seed(join(root, 'sessions', ordinaryId), ordinaryId, false)
  const original = readFileSync(join(legacy, 'session.jsonl'))
  const oldMemory = join(root, 'memory', 'memory.db'); mkdirSync(join(root, 'memory'))
  const childCode = `const { Database }=require('bun:sqlite');const db=new Database(${JSON.stringify(oldMemory)});db.exec("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;CREATE TABLE owner(singleton INTEGER PRIMARY KEY,workspace_id TEXT);INSERT INTO owner VALUES(1,'alpha');CREATE TABLE layout_wal_proof(value TEXT);INSERT INTO layout_wal_proof VALUES('COMMITTED_IN_WAL');");console.log('ready');setInterval(()=>{},1000);`
  const writer = Bun.spawn([process.execPath, '-e', childCode], { stdout: 'pipe', stderr: 'pipe' })
  const reader = writer.stdout.getReader(); assert((await reader.read()).value?.length); reader.releaseLock()
  assert(existsSync(`${oldMemory}-wal`)); writer.kill(); await writer.exited
  const { openSqliteDatabase: seedDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const oldSourceHash = createHash('sha256').update(`LAYOUT_ORIGINAL_CONVERSATION ${legacy.replaceAll('\\', '/')}/attachments/proof.txt`).digest('hex')
  const oldRow = { id: 'layout-existing-memory', workspaceId: 'alpha', key: 'layout-source', kind: 'fact', basis: 'user_stated', state: 'active',
    revision: 1, createdAt: 1, updatedAt: 1, content: 'Existing evidence keeps its identity after a layout relocation.',
    sources: [{ sessionId: id, messageId: 'layout-user', contentHash: oldSourceHash }] }
  const seeded = seedDatabase(oldMemory)
  seeded.exec('CREATE TABLE memories(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL UNIQUE,body TEXT NOT NULL)')
  seeded.prepare('INSERT INTO memories VALUES(?,?,?)').run(oldRow.id, 'layout-source', JSON.stringify(oldRow)); seeded.close()
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { getSessionPath, loadSession, saveSession, listSessions } = await import('@phaneris/shared/sessions')
  const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const scenes: string[] = []
  let manager!: InstanceType<typeof SessionManager>
  const boot = () => bootstrapServer({ serverToken: 'layout-fixture-local-token', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  let host = await boot(), client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'layout-fixture-local-token', autoReconnect: false })
  await client.connect()
  try {
    assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, id)
    const native = join(root, 'assistant', 'sessions', id)
    assert.equal(getSessionPath(root, id), native, 'Existing resident Session must resolve to assistant/sessions')
    assert.deepEqual(readFileSync(join(native, 'session.jsonl')), original)
    assert(!existsSync(legacy), 'Legacy location cannot remain a writable alias')
    assert.equal(readFileSync(join(native, 'attachments', 'proof.txt'), 'utf8'), 'ATTACHMENT_IDENTITY_KEPT')
    assert.equal(getSessionPath(root, ordinaryId), join(root, 'sessions', ordinaryId))
    assert.equal(loadSession(root, id)?.sdkSessionId, 'ORIGINAL_SDK_ID')
    assert.equal(loadSession(root, id)?.sdkCwd, legacy)
    const memory = manager.getAssistantMemoryStore('alpha')
    assert.equal(memory.query({ ids: [oldRow.id] }).items[0]?.redacted, false, 'Moving the same Session cannot withdraw unchanged source evidence')
    const sourceAfterMove = memory.readSource({ sessionId: id, messageId: 'layout-user', expectedContentHash: oldSourceHash })
    assert.equal(sourceAfterMove.contentHash, createHash('sha256').update('LAYOUT_ORIGINAL_CONVERSATION {{SESSION_PATH}}/attachments/proof.txt').digest('hex'))
    scenes.push('F12-portable-source-identity-survives-layout-relocation-with-existing-memory')
    const download = join(native, 'downloads', 'layout-result.md'); mkdirSync(join(native, 'downloads'), { recursive: true }); writeFileSync(download, 'NATIVE_ARTIFACT_REVISION')
    const artifact = await client.invoke(RPC_CHANNELS.artifacts.REGISTER_CURRENT, 'alpha', { sessionId: id, sourcePath: download })
    const artifactView = await client.invoke(RPC_CHANNELS.artifacts.GET, 'alpha', artifact.artifact.id)
    assert(artifactView?.activePath)
    assert.equal(readFileSync(artifactView.activePath, 'utf8'), 'NATIVE_ARTIFACT_REVISION')
    assert(artifactView.activePath.startsWith(native)); assert(!existsSync(legacy))
    assert((await client.invoke(RPC_CHANNELS.artifacts.LIST, 'alpha')).some(item => item.artifact.id === artifact.artifact.id))
    scenes.push('F11-artifact-storage-and-workspace-listing-follow-native-session-location')
    scenes.push('F01-same-session-sdk-message-and-attachment-identity', 'F02-ordinary-session-location-preserved')
    const database = openSqliteDatabase(join(root, 'assistant', 'memory', 'memory.db'))
    assert.equal((database.prepare('SELECT value FROM layout_wal_proof').get() as { value: string }).value, 'COMMITTED_IN_WAL')
    assert.equal((database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok'); database.close()
    assert(!existsSync(oldMemory), 'Old memory path is retired rather than dual-written')
    const loaded = loadSession(root, id)!; loaded.name = 'Persisted at native location'; await saveSession(loaded)
    loaded.messages[0]!.content = 'SUBSTANTIVELY_CHANGED_SOURCE'; await saveSession(loaded)
    assert.equal(memory.inspect({ id: oldRow.id, expectedRevision: 1 }).record.redacted, true)
    assert.throws(() => memory.readSource({ sessionId: id, messageId: 'layout-user', expectedContentHash: oldSourceHash }), /hash changed/i)
    scenes.push('F13-source-identity-alias-does-not-hide-substantive-edits')
    assert(!existsSync(legacy)); assert.equal(listSessions(root).filter(session => session.sessionKind === 'resident_assistant').length, 1)
    scenes.push('F03-wal-consistent-memory-migration', 'F04-native-resolver-is-the-only-writer')
    const { ResidentAssistantService } = await import('../../packages/server-core/src/resident-assistant/service')
    assert.throws(() => new ResidentAssistantService(workspace), /writer|owner|lease|active/i)
    scenes.push('F05-second-assistant-writer-rejected')
    const settings = await client.invoke(RPC_CHANNELS.workspace.SETTINGS_GET, 'alpha')
    assert.equal(settings?.assistantMemory?.learning, 'automatic')
    await client.invoke(RPC_CHANNELS.workspace.SETTINGS_UPDATE, 'alpha', 'assistantMemory', { version: 1, learning: 'paused', use: false })
    assert.equal((await client.invoke(RPC_CHANNELS.workspace.SETTINGS_GET, 'alpha'))?.assistantMemory?.use, false)
    const beforeRejectedPolicy = readFileSync(join(root, 'config.json'), 'utf8')
    await assert.rejects(client.invoke(RPC_CHANNELS.workspace.SETTINGS_UPDATE, 'alpha', 'assistantMemory', { version: 1, learning: 'automatic', use: 'false' }), /policy|configuration/i)
    assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), beforeRejectedPolicy)
    await client.invoke(RPC_CHANNELS.workspace.SETTINGS_UPDATE, 'alpha', 'assistantMemory', { version: 1, learning: 'automatic', use: true })
    scenes.push('F10-learning-policy-reuses-validated-workspace-settings')
    const live = openSqliteDatabase(join(root, 'assistant', 'memory', 'memory.db'))
    live.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO layout_wal_proof VALUES('LATE_COMMITTED_WAL')")
    const { createWorkspaceBackup, verifyWorkspaceBackup } = await import('../../packages/server-core/src/services/workspace-backup')
    const backupPath = join(run.directory, 'workspace-backup')
    const backup = createWorkspaceBackup(root, backupPath)
    assert(!backup.files.some(file => /\.db-(wal|shm)$/.test(file.path) || file.path.endsWith('.writer.lock')), 'Backup snapshots assistant databases and excludes live ownership')
    assert(verifyWorkspaceBackup(backupPath).ok)
    const snapshot = openSqliteDatabase(join(backupPath, 'assistant', 'memory', 'memory.db'))
    assert.equal((snapshot.prepare('SELECT count(*) AS count FROM layout_wal_proof').get() as { count: number }).count, 2); snapshot.close(); live.close()
    scenes.push('F07-live-backup-includes-committed-wal-without-sidecars-or-writer-lease')
    client.destroy(); await host.stop()
    const { acquireAssistantWriter } = await import('../../packages/server-core/src/resident-assistant/storage-lease')
    const { migrateAssistantStorage } = await import('../../packages/server-core/src/resident-assistant/storage-migration')
    const faultWorkspaces = ['prepared', 'session_moved', 'memory_published'].map((phase, index) => ({ id: `fault${index}`, name: phase, rootPath: join(config, `fault${index}`), createdAt: 1 }))
    for (const entry of faultWorkspaces) {
      const oldSession = join(entry.rootPath, 'sessions', '261105-interrupted-' + entry.id)
      mkdirSync(oldSession, { recursive: true }); mkdirSync(join(entry.rootPath, 'memory'))
      writeFileSync(join(entry.rootPath, 'config.json'), JSON.stringify(entry))
      writeFileSync(join(oldSession, 'session.jsonl'), JSON.stringify({ id: '261105-interrupted-' + entry.id, workspaceRootPath: entry.rootPath, sessionKind: 'resident_assistant', hidden: true, createdAt: 1, lastUsedAt: 1 }) + '\n')
      const db = openSqliteDatabase(join(entry.rootPath, 'memory', 'memory.db'))
      db.exec('CREATE TABLE owner(singleton INTEGER PRIMARY KEY,workspace_id TEXT); CREATE TABLE proof(value TEXT)')
      db.prepare('INSERT INTO owner VALUES(1,?)').run(entry.id); db.prepare('INSERT INTO proof VALUES(?)').run(entry.name); db.close()
      const release = acquireAssistantWriter(entry.rootPath)
      try { assert.throws(() => migrateAssistantStorage(entry, phase => { if (phase === entry.name) throw new Error('INJECTED_INTERRUPTION') }), /INJECTED_INTERRUPTION/) }
      finally { release() }
      writeFileSync(join(entry.rootPath, 'assistant', '.writer.lock'), JSON.stringify({ version: 1, pid: writer.pid, nonce: 'crashed-fixture-writer' }))
    }
    const conflict = { id: 'conflict', name: 'Conflicting storage', rootPath: join(config, 'conflict'), createdAt: 1 }
    mkdirSync(join(conflict.rootPath, 'memory'), { recursive: true }); mkdirSync(join(conflict.rootPath, 'assistant', 'memory'), { recursive: true })
    writeFileSync(join(conflict.rootPath, 'memory', 'memory.db'), 'LEGACY_STORE_MUST_REMAIN')
    writeFileSync(join(conflict.rootPath, 'assistant', 'memory', 'memory.db'), 'NATIVE_STORE_MUST_REMAIN')
    writeFileSync(join(conflict.rootPath, 'config.json'), JSON.stringify(conflict))
    writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [conflict, workspace, ...faultWorkspaces], activeWorkspaceId: 'alpha', setupDeferred: true, llmConnections: [] }))
    host = await boot()
    client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'layout-fixture-local-token', autoReconnect: false }); await client.connect()
    assert.equal((await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')).id, id)
    assert.equal(loadSession(root, id)?.name, 'Persisted at native location')
    assert.equal(listSessions(root).length, 2)
    scenes.push('F06-restart-does-not-clone-the-assistant')
    await assert.rejects(manager.getOrCreateResidentAssistant('conflict'), /competing|conflict|Both/i)
    const bad = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'conflict', token: 'layout-fixture-local-token', autoReconnect: false }); await bad.connect()
    try { await assert.rejects(bad.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'conflict', {}), /competing|conflict|Both/i) } finally { bad.destroy() }
    assert.equal(readFileSync(join(conflict.rootPath, 'memory', 'memory.db'), 'utf8'), 'LEGACY_STORE_MUST_REMAIN')
    assert.equal(readFileSync(join(conflict.rootPath, 'assistant', 'memory', 'memory.db'), 'utf8'), 'NATIVE_STORE_MUST_REMAIN')
    scenes.push('F09-conflicting-workspace-is-quarantined-without-blocking-other-workspaces-or-overwriting-stores')
    for (const entry of faultWorkspaces) {
      assert.equal((await manager.getOrCreateResidentAssistant(entry.id)).id, '261105-interrupted-' + entry.id)
      assert(!existsSync(join(entry.rootPath, 'sessions', '261105-interrupted-' + entry.id)))
      const recovered = openSqliteDatabase(join(entry.rootPath, 'assistant', 'memory', 'memory.db'))
      assert.equal((recovered.prepare('SELECT value FROM proof').get() as { value: string }).value, entry.name); recovered.close()
      scenes.push(`F08-resume-after-${entry.name}`)
    }
    run.json('layout-evidence.json', { scenes, id, originalSha256: createHash('sha256').update(original).digest('hex'), entries: readdirSync(join(root, 'assistant')) })
    run.complete(scenes, ['Real user workspace migration', 'Legacy applications that do not participate in the writer lease'])
  } finally { client.destroy(); await host.stop() }
})

