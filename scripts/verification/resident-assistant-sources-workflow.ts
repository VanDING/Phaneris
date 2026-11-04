import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AssistantMemoryStore } from '../../packages/server-core/src/resident-assistant/memory-store'
import { getSessionFilePath, saveSession } from '@phaneris/shared/sessions'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-sources', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = mkdtempSync(resolve('.cache/verification/resident-sources-'))
  const workspace = { id: 'alpha', rootPath: join(config, 'alpha') }, otherWorkspace = { id: 'beta', rootPath: join(config, 'beta') }
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  const messages = Array.from({ length: 128 }, (_, index) => ({ id: `input-${index}`, type: 'user' as const, content: `SOURCE_SNAPSHOT_ALPHA_${index}`, timestamp: index + 1 }))
  const write = (items = messages) => saveSession({ id: 'many-sources', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1, messages: items, tokenUsage: usage })
  await write()
  await saveSession({ id: 'many-sources', workspaceRootPath: otherWorkspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'input-0', type: 'user', content: 'OTHER_WORKSPACE_SOURCE', timestamp: 1 }], tokenUsage: usage })
  await saveSession({ id: 'derived-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'output', type: 'assistant', content: 'DERIVED_SOURCE_SNAPSHOT', timestamp: 1 }], tokenUsage: usage })
  const store = new AssistantMemoryStore(workspace), other = new AssistantMemoryStore(otherWorkspace)
  const scenes: string[] = [], diagnostics: unknown[] = []
  const dependencies = { sources: messages.map(message => ({ sessionId: 'many-sources', messageId: message.id, contentHash: createHash('sha256').update(message.content).digest('hex') })), memories: [] }
  try {
    let before = store.getDiagnostics()
    assert(store.dependenciesValid(dependencies))
    let after = store.getDiagnostics(); diagnostics.push(before, after)
    assert.equal(after.sourceFileLoads - before.sourceFileLoads, 1)
    assert(after.sourceCacheHits > before.sourceCacheHits)
    scenes.push('RS01-many-references-decode-one-real-session-once')
    store.registerDerivedSources([{ sessionId: 'derived-source', messageId: 'output' }], dependencies)
    before = store.getDiagnostics()
    assert.equal(store.readSource({ sessionId: 'derived-source', messageId: 'output' }).content, 'DERIVED_SOURCE_SNAPSHOT')
    after = store.getDiagnostics(); diagnostics.push(after)
    assert.equal(after.sourceFileLoads - before.sourceFileLoads, 2)
    scenes.push('RS01-derived-graph-shares-only-current-boundary-snapshot')
    for (let index = 0; index < 16; index++) store.mutate({ action: 'remember', requestId: `source-${index}`, key: `source-${index}`, content: `Source ${index}`, kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'many-sources', messageId: messages[index]!.id }] })
    before = store.getDiagnostics()
    assert.equal(store.query({ limit: 20 }).items.length, 16)
    after = store.getDiagnostics(); diagnostics.push(after)
    assert.equal(after.sourceFileLoads - before.sourceFileLoads, 1)
    scenes.push('RS01-memory-query-validates-all-records-with-one-source-decode')
    const longContent = 'LOOKUP_BUDGET_material '.repeat(300)
    for (let index = 0; index < 20; index++) store.mutate({ action: 'remember', requestId: `lookup-${index}`, key: `lookup-${index}`, content: longContent, kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'many-sources', messageId: messages[index + 20]!.id }] })
    const lookup = store.lookup({ query: 'LOOKUP_BUDGET', limit: 20 })
    assert(JSON.stringify(lookup).length <= 12000)
    assert(lookup.items.length > 0 && lookup.items.length < 20)
    assert(lookup.nextCursor)
    assert(lookup.items.every(item => item.contentTruncated && item.contentChars === longContent.length))
    const visited = new Set(lookup.items.map(item => item.id))
    let lookupCursor: import('@phaneris/session-tools-core/memory-lookup-contracts').MemoryLookupResult['nextCursor'] = lookup.nextCursor
    while (lookupCursor) {
      const next: import('@phaneris/session-tools-core/memory-lookup-contracts').MemoryLookupResult = store.lookup({ query: 'LOOKUP_BUDGET', limit: 20, cursor: lookupCursor })
      assert(JSON.stringify(next).length <= 12000)
      assert(next.items.every(item => !visited.has(item.id)))
      next.items.forEach(item => visited.add(item.id)); lookupCursor = next.nextCursor
    }
    assert.equal(visited.size, 20)
    assert.throws(() => store.lookup({ query: 'different query', cursor: lookup.nextCursor! }), /query|cursor/i)
    const selected = lookup.items[0]!
    const inspected = store.inspect({ id: selected.id, expectedRevision: selected.revision, offset: 1000, maxChars: 2000 })
    assert.equal(inspected.record.content, longContent.slice(1000, 3000))
    assert.equal(inspected.contentRange.fullChars, longContent.length)
    assert.equal(inspected.nextOffset, 3000)
    assert.throws(() => store.inspect({ id: selected.id, expectedRevision: selected.revision + 1 }), /revision|changed/i)
    scenes.push('RK01-search-packets-bounded-and-paginated-without-gaps', 'RK02-exact-memory-inspection-is-revision-and-range-bound', 'RK04-search-cursor-is-query-bound')
    for (const [suffix, projectId] of [['GLOBAL', undefined], ['A', 'project-a'], ['B', 'project-b']] as const) store.mutate({ action: 'remember', requestId: `scope-${suffix}`, key: `scope-${suffix}`, content: `SCOPED_LOOKUP_${suffix}`, kind: 'fact', basis: 'user_stated', projectId,
      sources: [{ sessionId: 'many-sources', messageId: 'input-100' }] })
    const scoped = store.lookup({ query: 'SCOPED_LOOKUP', projectId: 'project-a', includeWorkspace: true })
    assert.equal(scoped.items.length, 2)
    assert(!JSON.stringify(scoped.items).includes('SCOPED_LOOKUP_B'))
    assert.equal(scoped.scope.projectId, 'project-a'); assert(scoped.scope.includesWorkspace)
    const wide = store.lookup({ query: 'SCOPED_LOOKUP', scope: 'workspace' })
    assert.equal(wide.items.length, 3); assert(wide.scope.workspaceWide)
    const scopePage = store.query({ text: 'SCOPED_LOOKUP', projectId: 'project-a', includeWorkspace: true, limit: 1 })
    assert(scopePage.nextCursor)
    assert.throws(() => store.query({ text: 'SCOPED_LOOKUP', projectId: 'project-a', includeWorkspace: false, limit: 1, cursor: scopePage.nextCursor! }), /query|cursor/i)
    scenes.push('RK05-current-project-plus-generic-workspace-and-explicit-wide-scope')
    const first = store.query({ text: 'Source 0' }).items[0]!
    const forgotten = store.mutate({ action: 'transition', requestId: 'forget-source', id: first.id, expectedRevision: first.revision, state: 'forgotten' })
    assert.equal(forgotten.record.content, null)
    const hiddenLookup = store.lookup({ ids: [first.id], includeRetired: true })
    assert.equal(hiddenLookup.items[0]?.content, null)
    assert.equal(hiddenLookup.items[0]?.sourceCount, 0)
    const hiddenInspection = store.inspect({ id: first.id, expectedRevision: forgotten.record.revision })
    assert.equal(hiddenInspection.record.content, null)
    assert.deepEqual(hiddenInspection.record.sources, [])
    scenes.push('RK03-forgotten-navigation-and-inspection-remain-redacted')
    assert.throws(() => store.readSource({ sessionId: 'derived-source', messageId: 'output' }), /changed|forgot|unavailable/i)
    assert.equal(store.readSource({ sessionId: 'many-sources', messageId: 'input-1' }).content, 'SOURCE_SNAPSHOT_ALPHA_1')
    scenes.push('RS03-suppression-wins-over-current-file-snapshot')
    await write(messages.map(message => message.id === 'input-1' ? { ...message, content: 'SOURCE_CHANGED_BETWEEN_BOUNDARIES' } : message))
    assert.throws(() => store.readSource({ sessionId: 'many-sources', messageId: 'input-1', expectedContentHash: dependencies.sources[1]!.contentHash }), /hash|changed/i)
    assert.equal(store.readSource({ sessionId: 'many-sources', messageId: 'input-1' }).content, 'SOURCE_CHANGED_BETWEEN_BOUNDARIES')
    assert.equal(other.readSource({ sessionId: 'many-sources', messageId: 'input-0' }).content, 'OTHER_WORKSPACE_SOURCE')
    scenes.push('RS02-rewrite-visible-at-next-boundary', 'RS04-error-cleans-up-and-workspaces-stay-independent')
    store.registerDerivedSources([{ sessionId: 'derived-source', messageId: 'output' }], { sources: [{ sessionId: 'derived-source', messageId: 'output', contentHash: createHash('sha256').update('DERIVED_SOURCE_SNAPSHOT').digest('hex') }], memories: [] })
    assert.throws(() => store.readSource({ sessionId: 'derived-source', messageId: 'output' }), /cycle|unavailable/i)
    assert.equal(store.readSource({ sessionId: 'many-sources', messageId: 'input-2' }).content, 'SOURCE_SNAPSHOT_ALPHA_2')
    scenes.push('RS04-derived-cycle-does-not-leak-snapshot')
    unlinkSync(getSessionFilePath(workspace.rootPath, 'many-sources'))
    assert.equal(store.dependenciesValid({ sources: [dependencies.sources[2]!], memories: [] }), false)
    scenes.push('RS02-delete-visible-without-cached-fallback')
    run.json('sources-evidence.json', { scenes, diagnostics, final: store.getDiagnostics() })
  } finally { store.close(); other.close() }
  copyFileSync(join(workspace.rootPath, 'memory/memory.db'), join(run.directory, 'memory.db'))
  writeFileSync(join(run.directory, 'source-fixture.json'), JSON.stringify({ messages: messages.length, workspaces: [workspace.id, otherWorkspace.id] }))
  run.complete(scenes, ['Paid-model quality', 'Multi-Host authority', 'Filesystem changes inside one synchronous validation boundary'])
})
