import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { lstatSync } from 'node:fs'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { openSqliteDatabase } from '../../../packages/server-core/src/runtime/sqlite'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { getSessionFilePath, saveSession, type StoredMessage } from '@phaneris/shared/sessions'
import { sourceContentHash } from '../../../packages/server-core/src/resident-assistant/source-provenance'

const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
if (!config || !output) throw new Error('An isolated config and evidence root are required')
const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, rootPath: join(config, id), createdAt: 1 }))
const [alpha, beta] = workspaces as [typeof workspaces[number], typeof workspaces[number]]
for (const workspace of workspaces) {
  mkdirSync(workspace.rootPath, { recursive: true })
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace,
    assistantMemory: { version: 1, learning: 'explicit', use: false }, defaults: { permissionMode: 'safe' } }))
}
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'alpha', setupDeferred: true, llmConnections: [] }))

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
const user = (id: string, content: string): StoredMessage => ({ id, type: 'user', content, timestamp: 1 })
async function source(workspace: typeof alpha, id: string, messages: StoredMessage[]) {
  await saveSession({ id, workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1, messages, tokenUsage: usage })
  return { id, messages }
}
const alphaSources = [await source(alpha, 's1', [
  user('ALPHA_L0_ORIGINAL', 'ALPHA_L0_ORIGINAL：这条原文不能被历史索引失败挡住。'),
  { id: 'alpha-assistant', type: 'assistant', content: 'ALPHA_ASSISTANT_EVIDENCE', timestamp: 2 },
  { id: 'alpha-tool', type: 'tool', content: '', toolName: 'read', toolUseId: 'read-one', toolInput: { path: 'evidence.txt' },
    toolResult: 'ALPHA_TOOL_EVIDENCE', toolStatus: 'completed', timestamp: 3 },
  { id: 'alpha-error', type: 'error', content: 'ALPHA_ERROR_EVIDENCE', timestamp: 4 },
  user('ALPHA_SECRET_DO_NOT_INDEX', 'ALPHA_SECRET_DO_NOT_INDEX：这条来源被遗忘后不得出现在历史投影。'),
]), ...await Promise.all(Array.from({ length: 9 }, (_, index) => source(alpha, `s${index + 2}`,
  [user(`ALPHA_MSG_${index + 2}`, `ALPHA_SOURCE_${index + 2} 历史索引来源标记`)])))]
const betaSource = await source(beta, 'b1', [user('BETA_MSG_1', 'BETA_V1_SOURCE 旧 schema1 工作区来源')])

function signature(path: string): string {
  const stat = lstatSync(path, { bigint: true })
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}
function seedBrokenIndex(workspace: typeof alpha, schemaVersion: number, sources: Array<{ id: string; messages: StoredMessage[] }>, checkpoint?: { id: string; sessionId: string; messageId: string; content: string }) {
  const db = openSqliteDatabase(join(workspace.rootPath, 'assistant/memory/memory.db'))
  try {
    db.exec('DELETE FROM history_sessions; DELETE FROM history_messages;')
    db.prepare('INSERT OR REPLACE INTO history_schema VALUES(1,?)').run(schemaVersion)
    db.prepare('UPDATE history_clock SET version=7 WHERE singleton=1').run()
    for (const entry of sources) {
      const sessionPath = getSessionFilePath(workspace.rootPath, entry.id)
      db.prepare('INSERT INTO history_sessions VALUES(?,?,?,NULL,0)').run(entry.id, signature(sessionPath), 'pending')
      const message = entry.messages[0]!
      db.prepare('INSERT INTO history_messages VALUES(?,?,?,?)').run(entry.id, message.id,
        `STALE_PROJECTION_${entry.id}`, JSON.stringify({ sessionId: entry.id, messageId: message.id, contentHash: 'f'.repeat(64),
          projectId: null, role: message.type, timestamp: message.timestamp, directUser: true, attachmentCount: 0, attachmentContentIndexed: false }))
    }
    if (checkpoint) {
      const hash = sourceContentHash(workspace.rootPath, checkpoint.sessionId, checkpoint.content)
      db.prepare('INSERT OR REPLACE INTO history_extraction VALUES(?,?,?,?,?,?,?,?,?,?)').run(checkpoint.id, checkpoint.sessionId,
        checkpoint.messageId, hash, null, 0, checkpoint.content.length, checkpoint.content.length, 1, '{"conclusion":"no_candidate","reason":"fixture"}')
    }
  } finally { db.close() }
}

const { AssistantMemoryStore } = await import('../../../packages/server-core/src/resident-assistant/memory-store')
const seedStore = new AssistantMemoryStore(alpha)
const remembered = seedStore.mutate({ action: 'remember', requestId: 'repair-remember', key: 'repair-source', kind: 'fact',
  basis: 'user_stated', content: '被遗忘的来源仍需保留权威墓碑', sources: [{ sessionId: 's1', messageId: 'ALPHA_SECRET_DO_NOT_INDEX' }] }, 'management')
seedStore.mutate({ action: 'transition', requestId: 'repair-forget', id: remembered.record.id, expectedRevision: 1, state: 'forgotten' }, 'user_request')
seedStore.close()
const betaStore = new AssistantMemoryStore(beta); betaStore.close()

const checkpointId = 'c'.repeat(64)
seedBrokenIndex(alpha, 2, alphaSources, { id: checkpointId, sessionId: 's2', messageId: 'ALPHA_MSG_2', content: 'ALPHA_SOURCE_2 历史索引来源标记' })
seedBrokenIndex(beta, 1, [betaSource])
const alphaDbPath = join(alpha.rootPath, 'assistant/memory/memory.db'), betaDbPath = join(beta.rootPath, 'assistant/memory/memory.db')
function authorityCounts(path: string) {
  const db = openSqliteDatabase(path)
  try {
    return {
      suppression: (db.prepare('SELECT COUNT(*) AS count FROM suppression').get() as { count: number }).count,
      memories: (db.prepare('SELECT COUNT(*) AS count FROM memories').get() as { count: number }).count,
      revisions: (db.prepare('SELECT COUNT(*) AS count FROM revisions').get() as { count: number }).count,
      extraction: (db.prepare('SELECT COUNT(*) AS count FROM history_extraction').get() as { count: number }).count,
      extractionBody: db.prepare('SELECT id,session_id,message_id,content_hash,acknowledgement FROM history_extraction ORDER BY id').all(),
    }
  } finally { db.close() }
}
const authorityBefore = authorityCounts(alphaDbPath)
const betaAuthorityBefore = authorityCounts(betaDbPath)

let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
  bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
async function connect(id: string) {
  const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: id, token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false })
  await client.connect(); return client
}
let alphaClient = await connect('alpha'), betaClient = await connect('beta')
const scenes: string[] = []
const history = (client: WsRpcClient, workspace: string, query: Record<string, unknown> = {}) => client.invoke(RPC_CHANNELS.assistantMemory.HISTORY, workspace, query) as Promise<{
  items: Array<{ sessionId: string; messageId: string; role: string }>
  coverage: { pendingSessions: number; unreadableSessions: number; indexedSessions: number; refreshedSessions: number; indexedMessages: number }
  version: number
  extraction: { pendingSessions: number; unreadableSessions: number }
}>
const settle = async (client: WsRpcClient, workspace: string, query: Record<string, unknown> = {}) => {
  let page = await history(client, workspace, query)
  for (let index = 0; page.coverage.pendingSessions && index < 20; index++) page = await history(client, workspace, query)
  return page
}
try {
  // The direct-read boundary must work before any history query is attempted.
  const assistant = await alphaClient.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha') as { id: string }
  const originals = await alphaClient.invoke(RPC_CHANNELS.residentAssistant.ORIGINALS, 'alpha', 's1', { limit: 10 }) as { messages: Array<{ id: string; content: string }> }
  assert(originals.messages.some(message => message.id === 'ALPHA_L0_ORIGINAL' && message.content.includes('ALPHA_L0_ORIGINAL')))
  assert(JSON.stringify(originals).includes('ALPHA_TOOL_EVIDENCE'))
  assert(JSON.stringify(originals).includes('ALPHA_ERROR_EVIDENCE'))
  assert.equal(typeof assistant.id, 'string')
  const beforeQueryDb = openSqliteDatabase(alphaDbPath)
  const pendingRowsBefore = (beforeQueryDb.prepare('SELECT COUNT(*) AS count FROM history_messages').get() as { count: number }).count
  beforeQueryDb.close()
  assert(pendingRowsBefore > 0, 'The fixture must start with the already-broken v2 projection')
  writeFileSync(join(output, 'history-repair-progress.json'), JSON.stringify({ step: 'L0-read-before-history', scenes, pendingRowsBefore }, null, 2) + '\n')
  scenes.push('HRP01-known-L0-reads-before-history-index')
  writeFileSync(join(output, 'history-repair-progress.json'), JSON.stringify({ step: 'v2-repair-start', scenes, pendingRowsBefore }, null, 2) + '\n')

  // This is the failure contract: broken v2 pending rows plus a matching file
  // signature must be replaced, not treated as an INSERT conflict.
  const repaired = await settle(alphaClient, 'alpha')
  assert.equal(repaired.coverage.pendingSessions, 0)
  assert.equal(repaired.coverage.unreadableSessions, 0)
  assert(repaired.items.some(item => item.sessionId === 's1' && item.messageId === 'ALPHA_L0_ORIGINAL'))
  assert(repaired.items.some(item => item.sessionId === 's1' && item.messageId === 'alpha-tool'))
  assert(repaired.items.some(item => item.sessionId === 's1' && item.messageId === 'alpha-error'))
  assert(repaired.items.some(item => item.sessionId === 's2'))
  assert(!repaired.items.some(item => item.messageId === 'ALPHA_SECRET_DO_NOT_INDEX'))
  const repairedDb = openSqliteDatabase(alphaDbPath)
  const schema = repairedDb.prepare('SELECT version FROM history_schema WHERE singleton=1').get() as { version: number }
  const duplicate = repairedDb.prepare('SELECT COUNT(*) AS count FROM (SELECT session_id,message_id FROM history_messages GROUP BY session_id,message_id HAVING COUNT(*)>1)').get() as { count: number }
  const indexedRows = repairedDb.prepare('SELECT COUNT(*) AS count FROM history_messages').get() as { count: number }
  const clock = repairedDb.prepare('SELECT version FROM history_clock WHERE singleton=1').get() as { version: number }
  repairedDb.close()
  assert.equal(schema.version, 3, 'The broken v2 catalogue must be marked at the repaired schema version')
  assert.equal(duplicate.count, 0, 'A repaired projection must not keep duplicate rows')
  assert.equal(indexedRows.count, 13, 'Every non-suppressed message is indexed exactly once')
  assert(clock.version > 7)
  scenes.push('HRP02-broken-v2-pending-plus-stale-rows-repaired')

  // A second query after the rebuild must not refresh or rewrite anything.
  const stable = await history(alphaClient, 'alpha')
  assert.equal(stable.coverage.refreshedSessions, 0)
  assert.equal(stable.version, repaired.version)
  assert.equal(stable.coverage.indexedMessages, repaired.coverage.indexedMessages)
  const alphaFileBefore = readFileSync(getSessionFilePath(alpha.rootPath, 's2'))
  scenes.push('HRP03-repeat-query-is-idempotent')
  writeFileSync(join(output, 'history-repair-progress.json'), JSON.stringify({ step: 'v2-repaired', scenes, repaired }, null, 2) + '\n')

  // Authority tables are outside the disposable projection and must survive.
  const authorityAfter = authorityCounts(alphaDbPath)
  assert.deepEqual(authorityAfter, authorityBefore, 'Suppression, memories, revisions and extraction checkpoints must survive the rebuild')
  assert.equal(authorityAfter.suppression, 1)
  assert.equal(authorityAfter.memories, 1)
  assert(authorityAfter.revisions >= 2)
  assert.equal(authorityAfter.extraction, 1)
  const retired = await alphaClient.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'alpha', { includeRetired: true }) as { items: Array<{ id: string; state: string; content: string | null }> }
  assert(retired.items.some(item => item.id === remembered.record.id && item.state === 'forgotten' && item.content === null))
  await assert.rejects(alphaClient.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: 's1', messageId: 'ALPHA_SECRET_DO_NOT_INDEX' }), /suppress|forgot/i)
  scenes.push('HRP04-suppression-memories-revisions-checkpoints-preserved')
  writeFileSync(join(output, 'history-repair-progress.json'), JSON.stringify({ step: 'authority-preserved', scenes, authorityAfter }, null, 2) + '\n')

  // The schema1 workspace is a separate old catalogue; it must upgrade without
  // retaining a projection from the previous schema.
  const betaPage = await settle(betaClient, 'beta', { query: 'BETA_V1_SOURCE' })
  assert.equal(betaPage.coverage.pendingSessions, 0)
  assert(betaPage.items.some(item => item.sessionId === 'b1' && item.messageId === 'BETA_MSG_1'))
  assert(!betaPage.items.some(item => item.sessionId.startsWith('s')))
  const betaDb = openSqliteDatabase(betaDbPath)
  const betaSchema = betaDb.prepare('SELECT version FROM history_schema WHERE singleton=1').get() as { version: number }
  const betaRows = betaDb.prepare('SELECT COUNT(*) AS count FROM history_messages').get() as { count: number }
  betaDb.close()
  assert.equal(betaSchema.version, 3)
  assert.equal(betaRows.count, 1)
  assert.deepEqual(authorityCounts(betaDbPath), betaAuthorityBefore)
  scenes.push('HRP05-schema1-upgrade-clears-stale-projection')

  // One corrupt source may be unreadable forever, but it must not starve a
  // later valid source in the same bounded refresh window.
  writeFileSync(getSessionFilePath(alpha.rootPath, 's10'), '{broken header\n')
  await source(alpha, 's11', [user('ALPHA_MSG_11', 'ALPHA_AFTER_CORRUPTION 新来源仍然推进')])
  const afterCorruption = await settle(alphaClient, 'alpha', { query: 'ALPHA_AFTER_CORRUPTION' })
  assert(afterCorruption.items.some(item => item.sessionId === 's11' && item.messageId === 'ALPHA_MSG_11'))
  assert.equal(afterCorruption.coverage.unreadableSessions, 1)
  assert((await history(alphaClient, 'alpha', { query: 'ALPHA_SOURCE_2' })).items.some(item => item.sessionId === 's2'), 'Earlier healthy sources remain indexed')
  scenes.push('HRP06-corrupt-source-does-not-starve-valid-source')
  writeFileSync(join(output, 'history-repair-progress.json'), JSON.stringify({ step: 'corruption-isolated', scenes, afterCorruption }, null, 2) + '\n')

  // Host restart must not rebuild unchanged sources or lose authority.
  alphaClient.destroy(); betaClient.destroy(); await host.stop()
  host = await boot(); alphaClient = await connect('alpha'); betaClient = await connect('beta')
  const restarted = await history(alphaClient, 'alpha')
  assert.equal(restarted.coverage.pendingSessions, 0)
  assert.equal(restarted.coverage.refreshedSessions, 0)
  assert(restarted.items.some(item => item.sessionId === 's1' && item.messageId === 'ALPHA_L0_ORIGINAL'))
  assert.equal(readFileSync(getSessionFilePath(alpha.rootPath, 's2'), 'utf8'), alphaFileBefore.toString('utf8'), 'History maintenance must not rewrite Session bytes')
  assert.deepEqual(authorityCounts(alphaDbPath), authorityAfter)
  scenes.push('HRP07-restart-keeps-idempotent-projection-and-authority')

  writeFileSync(join(output, 'history-repair-evidence.json'), JSON.stringify({ scenes, repaired, stable, betaPage, afterCorruption, restarted,
    authorityBefore, authorityAfter, checkpointId }, null, 2) + '\n')
  console.log(JSON.stringify({ passed: scenes.length, output }))
} finally { alphaClient.destroy(); betaClient.destroy(); await host.stop() }
