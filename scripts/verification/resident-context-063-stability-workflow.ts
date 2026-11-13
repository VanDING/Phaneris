import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-context-063-stability', async run => {
  const workspace = { id: 'stability', rootPath: join(run.directory, 'workspace') }
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  mkdirSync(workspace.rootPath, { recursive: true })
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, name: 'Synthetic stability', createdAt: 1,
    assistantMemory: { version: 1, learning: 'explicit', use: true } }))
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { getSourceReader } = await import('../../packages/server-core/src/context/source-reader')
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  const messages = Array.from({ length: 1200 }, (_, index) => ({ id: `unrelated-${index}`, type: 'user' as const,
    content: `UNRELATED_${index}:` + 'x'.repeat(16000), timestamp: index + 1 }))
  const width = 8, depth = 5
  for (let level = 0; level < depth; level++) for (let column = 0; column < width; column++) {
    messages.push({ id: `node-${level}-${column}`, type: 'user', content: `NODE_${level}_${column}`, timestamp: messages.length + 1 })
  }
  messages.push({ id: 'root', type: 'user', content: 'ROOT_SOURCE', timestamp: messages.length + 1 })
  const save = () => saveSession({ id: 'large', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1, messages, tokenUsage: usage })
  await save()
  const reader = getSourceReader(workspace.rootPath)
  reader.catalog('large')
  const store = new AssistantMemoryStore(workspace)
  const ref = (messageId: string) => ({ sessionId: 'large', messageId,
    contentHash: createHash('sha256').update(messages.find(message => message.id === messageId)!.content).digest('hex') })
  const evidence: Record<string, unknown> = {}, failures: string[] = []
  try {
    let before = reader.metrics(), started = performance.now()
    assert.equal(store.readSource({ sessionId: 'large', messageId: 'root' }).content, 'ROOT_SOURCE')
    let after = reader.metrics()
    evidence.exactRead = { decodedRecords: after.decodedRecords - before.decodedRecords, bytesRead: after.bytesRead - before.bytesRead,
      indexScanBytes: after.indexScanBytes - before.indexScanBytes, elapsedMs: performance.now() - started }
    if (after.decodedRecords - before.decodedRecords !== 1 || after.bytesRead - before.bytesRead > 1000) failures.push('S01: one source decoded unrelated history')
    for (let level = 1; level < depth; level++) for (let column = 0; column < width; column++) {
      store.registerDerivedSources([ref(`node-${level}-${column}`)], { sources: Array.from({ length: width }, (_, child) => ref(`node-${level - 1}-${child}`)), memories: [] })
    }
    store.registerDerivedSources([ref('root')], { sources: Array.from({ length: width }, (_, child) => ref(`node-${depth - 1}-${child}`)), memories: [] })
    const diagnostics = store.getDiagnostics(); before = reader.metrics(); started = performance.now()
    assert(store.dependenciesValid({ sources: [ref('root')], memories: [] }))
    after = reader.metrics()
    const hits = store.getDiagnostics().sourceCacheHits - diagnostics.sourceCacheHits
    evidence.sharedAncestors = { uniqueSources: width * depth + 1, uncachedPathVisits: (width ** (depth + 1) - 1) / (width - 1),
      sourceCacheHits: hits, decodedRecords: after.decodedRecords - before.decodedRecords, elapsedMs: performance.now() - started }
    if (hits > (width * depth + 1) * width) failures.push('S02: shared ancestors recursively revalidated per path')
    const previous = ref('node-0-0')
    messages.find(message => message.id === 'node-0-0')!.content = 'CHANGED_AT_NEXT_BOUNDARY'
    await save()
    assert.equal(store.dependenciesValid({ sources: [ref('root')], memories: [] }), false)
    assert.equal(store.dependenciesValid({ sources: [previous], memories: [] }), false)
    assert.equal(store.readSource({ sessionId: 'large', messageId: 'node-0-0' }).content, 'CHANGED_AT_NEXT_BOUNDARY')
    store.registerDerivedSources([ref('root')], { sources: [ref('root')], memories: [] })
    assert.equal(store.dependenciesValid({ sources: [ref('root')], memories: [] }), false)
    assert.equal(store.readSource({ sessionId: 'large', messageId: 'node-0-1' }).content, 'NODE_0_1')
    run.json('stability-evidence.json', { ...evidence, failures })
    assert.deepEqual(failures, [])
    run.complete(['S01-memory-owner-exact-read-excludes-unrelated-history', 'S02-shared-lineage-validates-unique-sources',
      'S03-next-boundary-observes-rewrite', 'S04-cycles-reject-without-poisoning-independent-read'],
    ['Real provider latency', 'Installed production client replacement', 'All causes of UI stalls'])
  } finally { store.close() }
})
