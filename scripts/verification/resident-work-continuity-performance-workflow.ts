import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure modes WC15 were fixed before these implementation changes: a wider
// working set than eight sessions must not rescan unchanged files each round.
await verificationWorkflow('resident-work-continuity-performance', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const workspace = { id: 'performance', rootPath: join(run.directory, 'workspace') }
  mkdirSync(workspace.rootPath, { recursive: true })
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, name: 'Isolated source performance', createdAt: 1,
    assistantMemory: { version: 1, learning: 'automatic', use: true } }))
  const { saveSession, getSessionFilePath } = await import('@phaneris/shared/sessions')
  const { getSourceReader } = await import('../../packages/server-core/src/context/source-reader')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const reader = getSourceReader(workspace.rootPath), scenes: string[] = []
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  const ids = Array.from({ length: 13 }, (_, i) => `source-${i}`)
  for (const id of ids) await saveSession({ id, workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    messages: Array.from({ length: 64 }, (_, i) => ({ id: `message-${i}`, type: 'user' as const,
      content: `Supported durable collaboration preference ${i}: ` + 'evidence '.repeat(512), timestamp: i + 1 })) })
  for (const id of ids) reader.describe(id, 'message-0')
  const before = reader.metrics()
  for (const id of ids) reader.describe(id, 'message-0')
  const after = reader.metrics()
  run.json('warm-cache.json', { before, after })
  assert.equal(after.indexScanBytes - before.indexScanBytes, 0, 'WC15: unchanged 13-session working set repeatedly scans entire transcripts')
  scenes.push('WC15-wide-working-set-no-rebuild-on-warm-round')
  for (const id of ids) { const file = getSessionFilePath(workspace.rootPath, id); writeFileSync(file, readFileSync(file)); reader.release(id) }
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 1), start = performance.now()
  await reader.warm(ids)
  clearInterval(timer)
  const warmed = reader.metrics()
  for (const id of ids) reader.describe(id, 'message-0')
  assert.equal(reader.metrics().indexScanBytes, warmed.indexScanBytes, 'Cold indexes must publish exact locators before main-thread reads')
  assert(ticks > 0, 'Index warming must yield the main event loop')
  run.json('cold-worker.json', { ticks, elapsedMs: performance.now() - start, metrics: warmed })
  scenes.push('WC15-cold-indexing-off-main-thread-with-versioned-publication')
  const memory = new AssistantMemoryStore(workspace)
  try {
    for (let i = 0; i < 24; i++) memory.mutate({ action: 'remember', requestId: `preference-${i}`, key: `collaboration.preference-${i}`,
      kind: 'fact', basis: 'inferred', intent: 'automatic', content: `Supported durable collaboration preference ${i}`,
      assessment: { confidence: 'supported', durability: 'durable', domain: 'collaboration', reason: 'The exact synthetic user source states a stable collaboration preference' },
      sources: [{ sessionId: ids[0]!, messageId: `message-${i}` }] })
    const profile = memory.profile({ query: 'collaboration preference' })
    assert.equal(profile.items.length, 8)
    assert(profile.coverage.validatedRecords! <= 8, 'Profile must rank before expensive source validation')
    run.json('profile.json', profile)
    scenes.push('WC15-profile-validates-selected-candidates-before-filling')
  } finally { memory.close() }
  run.complete(scenes, ['Production data performance', 'Installed Electron UI frame profiling'])
})
