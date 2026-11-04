import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bootstrapServer } from '@phaneris/server-core/bootstrap'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@phaneris/server-core/sessions'
import { registerCoreRpcHandlers } from '@phaneris/server-core/handlers/rpc'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS, type MemoryMutation, type MemoryRecord, type MemoryQuery } from '@phaneris/shared/protocol'
import { saveSession } from '@phaneris/shared/sessions'

const config = process.env.PHANERIS_CONFIG_DIR!, output = process.argv[2]!
const workspace = { id: 'alpha', name: 'Alpha', rootPath: join(config, 'alpha'), createdAt: 1 }
mkdirSync(workspace.rootPath, { recursive: true })
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, llmConnections: [] }))
const sources = ['original', 'correction', 'latest', 'proof', 'other-project', 'other-condition', 'other-time', 'candidate-one', 'candidate-two']
await saveSession({ id: 'relation-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
  messages: sources.map((id, index) => ({ id, type: 'user' as const, content: `RELATION_SOURCE_${id}`, timestamp: index + 1 })),
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
let manager!: SessionManager
const boot = () => bootstrapServer({ serverToken: process.env.PHANERIS_SERVER_TOKEN!, rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException: error => console.error(error) }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
  registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
  bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
let host = await boot()
async function connect() { const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: process.env.PHANERIS_SERVER_TOKEN, autoReconnect: false }); await client.connect(); return client }
let client = await connect(), sequence = 0
const scenes: string[] = [], changes: unknown[] = []
const query = (input: MemoryQuery = {}) => client.invoke(RPC_CHANNELS.assistantMemory.QUERY, 'alpha', input)
const mutate = async (input: MemoryMutation) => { const result = await client.invoke(RPC_CHANNELS.assistantMemory.MUTATE, 'alpha', input); changes.push(result); return result }
const proof = [{ sessionId: 'relation-source', messageId: 'proof' }]
const remember = async (key: string, extra: Record<string, unknown> = {}) => (await mutate({ action: 'remember', requestId: `relation-${++sequence}`, key,
  content: `RELATION_FACT_${key}`, kind: 'decision', basis: 'user_stated', projectId: 'same-project', condition: 'same-condition',
  sources: [{ sessionId: 'relation-source', messageId: key }], ...extra } as MemoryMutation)).record
const ref = (record: MemoryRecord) => ({ id: record.id, expectedRevision: record.revision })
try {
  const original = await remember('original'), correction = await remember('correction')
  const command = { action: 'dispute', requestId: 'raise-dispute', ...ref(original), related: [ref(correction)], reason: 'Contradictory statements need review.', sources: proof } as MemoryMutation
  const raised = await mutate(command)
  assert.equal(raised.record.state, 'active'); assert(raised.record.dispute)
  assert.equal((await query()).items.length, 0)
  const group = (await query({ includeRetired: true, ids: [original.id, correction.id] })).items
  assert.equal(group.length, 2); assert(group.every(record => record.dispute))
  assert.equal((await mutate(command)).record.revision, 2)
  await assert.rejects(mutate({ ...command, reason: 'Changed payload' } as MemoryMutation), /conflict/i)
  await assert.rejects(mutate({ action: 'transition', requestId: `relation-${++sequence}`, id: original.id, expectedRevision: 2, state: 'active' }), /disput|resolv/i)
  scenes.push('RL01-attached-dispute-withholds-both-current-facts', 'RL03-idempotency-and-payload-conflict', 'RL05-direct-activation-cannot-clear-dispute')
  const foreign = await remember('other-project', { projectId: 'different-project' })
  const different = await remember('other-condition', { condition: 'different-condition' })
  const later = await remember('other-time', { validFrom: 100, validUntil: 200 })
  const earlier = await remember('latest', { validFrom: 1, validUntil: 50 })
  for (const [one, two] of [[foreign, different], [correction, different], [later, earlier]]) {
    await assert.rejects(mutate({ action: 'dispute', requestId: `relation-${++sequence}`, ...ref(one!), related: [ref(two!)], reason: 'Wrong scope', sources: proof } as MemoryMutation), /scope|project|condition|interval|revision/i)
  }
  scenes.push('RL02-project-condition-and-disjoint-time-do-not-merge')
  const winner = group.find(record => record.id === correction.id)!, loser = group.find(record => record.id === original.id)!
  await assert.rejects(mutate({ action: 'resolve', requestId: `relation-${++sequence}`, ...ref(winner), related: [ref(original)], winnerId: winner.id, reason: 'Stale member', sources: proof } as MemoryMutation), /revision|conflict/i)
  assert((await query({ includeRetired: true, ids: [winner.id] })).items[0]?.dispute)
  const resolved = await mutate({ action: 'resolve', requestId: 'resolve-prefer', ...ref(winner), related: [ref(loser)], winnerId: winner.id, reason: 'Use the corrected decision.', sources: proof } as MemoryMutation)
  assert.equal(resolved.record.state, 'active'); assert.equal(resolved.record.dispute, undefined); assert(resolved.record.lastValidatedAt)
  const superseded = (await query({ includeRetired: true, ids: [loser.id] })).items[0]!
  assert.equal(superseded.state, 'superseded'); assert.equal(superseded.supersededBy, winner.id)
  await assert.rejects(mutate({ action: 'transition', requestId: `relation-${++sequence}`, ...ref(superseded), state: 'active' }), /supersed|restor/i)
  await assert.rejects(mutate({ action: 'revise', requestId: `relation-${++sequence}`, ...ref(superseded), content: 'Revive old statement', sources: proof }), /supersed|restor/i)
  scenes.push('RL03-atomic-version-checks', 'RL04-explicit-supersession-and-validation-time', 'RL05-superseded-cannot-reactivate-or-revise')
  const candidateOne = await remember('candidate-one', { basis: 'inferred' }), candidateTwo = await remember('candidate-two', { basis: 'inferred' })
  const candidates = await mutate({ action: 'dispute', requestId: 'candidate-dispute', ...ref(candidateOne), related: [ref(candidateTwo)], reason: 'Review inferences', sources: proof } as MemoryMutation)
  const candidateGroup = (await query({ includeRetired: true, ids: candidates.affectedIds })).items
  await mutate({ action: 'resolve', requestId: 'candidate-coexist', ...ref(candidateGroup[0]!), related: [ref(candidateGroup[1]!)], reason: 'Both hypotheses may coexist.', sources: proof } as MemoryMutation)
  assert((await query({ includeRetired: true, ids: [candidateOne.id, candidateTwo.id] })).items.every(record => record.state === 'candidate' && !record.dispute))
  scenes.push('RL06-coexistence-does-not-promote-inferences')
  const last = await remember('latest-new', { sources: [{ sessionId: 'relation-source', messageId: 'latest' }] })
  const second = await mutate({ action: 'resolve', requestId: 'newest-replaces-correction', ...ref(last), related: [ref(resolved.record)], winnerId: last.id, reason: 'Final correction', sources: [{ sessionId: 'relation-source', messageId: 'latest' }] } as MemoryMutation)
  client.destroy(); await host.stop()
  copyFileSync(join(workspace.rootPath, 'memory/memory.db'), join(output, 'memory-before-forget.db'))
  host = await boot(); client = await connect()
  const forgotten = await mutate({ action: 'transition', requestId: 'forget-newest', ...ref(second.record), state: 'forgotten' })
  assert.equal(forgotten.record.content, null); assert.equal(forgotten.record.retirementReason, undefined)
  for (const messageId of ['original', 'correction', 'latest']) await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: 'relation-source', messageId }), /forgot|suppress/i)
  assert.equal((await mutate(command)).record.content, null)
  const retired = await query({ includeRetired: true, ids: [original.id, correction.id, last.id] })
  assert(retired.items.every(record => record.content === null && record.dispute === undefined && record.retirementReason === undefined))
  scenes.push('RL07-forgetting-suppresses-entire-replacement-ancestry', 'RL07-old-request-replay-redacts-related-content')
  assert(RPC_CHANNELS.assistantMemory.SUPPRESSION_EXPORT, 'Backend must expose reference-only suppression export and merge')
  const firstPage = await client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_EXPORT, 'alpha', { limit: 1 })
  assert(firstPage.nextCursor)
  const entries = [...firstPage.entries]
  let cursor: import('@phaneris/shared/protocol').MemorySuppressionPage['nextCursor'] = firstPage.nextCursor
  while (cursor) {
    const next: import('@phaneris/shared/protocol').MemorySuppressionPage = await client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_EXPORT, 'alpha', { limit: 1, cursor })
    entries.push(...next.entries); cursor = next.nextCursor
  }
  assert(entries.length >= 3)
  assert(!JSON.stringify(entries).includes('RELATION_FACT') && !JSON.stringify(entries).includes('RELATION_SOURCE'))
  await remember('after-export', { sources: [{ sessionId: 'relation-source', messageId: 'other-project' }] })
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_EXPORT, 'alpha', { limit: 1, cursor: firstPage.nextCursor! }), /cursor|version/i)
  const bundle = { formatVersion: 1 as const, workspaceId: 'alpha', entries, requestId: 'merge-newer-forgetting' }
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE, 'alpha', { ...bundle, workspaceId: 'beta' }), /workspace/i)
  scenes.push('RB01-reference-only-versioned-export', 'RB03-foreign-workspace-rejected')
  client.destroy(); await host.stop()
  // Only this fixture's isolated database is overwritten to model an old backup.
  copyFileSync(join(output, 'memory-before-forget.db'), join(workspace.rootPath, 'memory/memory.db'))
  host = await boot(); client = await connect()
  assert((await query({ ids: [last.id] })).items[0]?.content)
  const imported = await client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE, 'alpha', bundle)
  const replay = await client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE, 'alpha', bundle)
  assert.deepEqual(replay, imported)
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE, 'alpha', { ...bundle, entries: entries.slice(1) }), /request|conflict/i)
  assert.equal((await query({ ids: [last.id] })).items.length, 0)
  const duplicate = await client.invoke(RPC_CHANNELS.assistantMemory.SUPPRESSION_MERGE, 'alpha', { ...bundle, requestId: 'same-markers-new-request' })
  assert.equal(duplicate.version, imported.version)
  assert.equal(duplicate.inserted, 0)
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: 'relation-source', messageId: 'original' }), /forgot|suppress/i)
  const unrelated = await client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: 'relation-source', messageId: 'other-project' })
  assert.equal(unrelated.content, 'RELATION_SOURCE_other-project')
  scenes.push('RB02-older-database-cannot-restore-suppressed-facts-after-merge', 'RB03-merge-idempotency-and-payload-conflict', 'RB04-identical-markers-do-not-churn-version')
  client.destroy(); await host.stop(); host = await boot(); client = await connect()
  await assert.rejects(client.invoke(RPC_CHANNELS.assistantMemory.READ_SOURCE, 'alpha', { sessionId: 'relation-source', messageId: 'original' }), /forgot|suppress/i)
  assert.equal((await query()).items.some(record => [original.id, correction.id, last.id].includes(record.id)), false)
  scenes.push('RL08-restart-retains-relations-and-suppression')
  writeFileSync(join(output, 'relations-evidence.json'), JSON.stringify({ scenes, changes, final: await query({ includeRetired: true }) }, null, 2))
} finally { client.destroy(); await host.stop() }
