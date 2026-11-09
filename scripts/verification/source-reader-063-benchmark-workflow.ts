import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('source-reader-063-benchmark', async run => {
  const oldRoot = join(run.directory, 'old-code'); fs.mkdirSync(oldRoot)
  const baselineRef = 'aab3af835868bc90b4b50b4ff85ddb14e53ff1a2'
  const archive = execFileSync('git', ['archive', '--format=tar', baselineRef, 'packages/server-core/src'], { maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', oldRoot], { input: archive })
  const config = join(run.directory, 'config'), workspace = { id: 'io', rootPath: join(config, 'io') }
  process.env.PHANERIS_CONFIG_DIR = config; fs.mkdirSync(workspace.rootPath, { recursive: true })
  const { saveSession, getSessionFilePath } = await import('@phaneris/shared/sessions')
  await saveSession({ id: 'long', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: Array.from({ length: 1200 }, (_, index) => ({ id: `m${index}`, type: 'user' as const, timestamp: index, content: `original-${index}:` + '原文'.repeat(500) })),
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const file = getSessionFilePath(workspace.rootPath, 'long')
    const oldMemoryModule = await import(pathToFileURL(join(oldRoot, 'packages/server-core/src/resident-assistant/memory-store.ts')).href)
    const oldHistory = await import(pathToFileURL(join(oldRoot, 'packages/server-core/src/sessions/session-history.ts')).href)
    const oldMemory = new oldMemoryModule.AssistantMemoryStore(workspace)
    const oldCounts = oldMemory.getDiagnostics()
    const oldStarted = performance.now(); let oldResult: any
    for (let count = 0; count < 3; count++) oldResult = oldHistory.readSessionOriginals(workspace, 'long', { messageId: 'm600', maxCharacters: 300 }, oldMemory)
    const ownerLoads = oldMemory.getDiagnostics().sourceFileLoads - oldCounts.sourceFileLoads
    const baseline = { entryLoads: 3, observedSourceOwnerLoads: ownerLoads, byteEstimate: (3 + ownerLoads) * fs.statSync(file).size, elapsedMs: performance.now() - oldStarted, measurement: 'Whole-file bytes inferred from fixed old reader paths and measured source-owner load count; not syscall tracing' }; oldMemory.close()
    assert(ownerLoads >= 3)
    const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
    const { readSessionOriginals } = await import('../../packages/server-core/src/sessions/session-history')
    const memory = new AssistantMemoryStore(workspace)
    const { getSourceReader } = await import('../../packages/server-core/src/context/source-reader')
    const coldBefore = getSourceReader(workspace.rootPath).metrics(), coldStarted = performance.now()
    readSessionOriginals(workspace, 'long', { messageId: 'm600', maxCharacters: 300 }, memory)
    const coldAfter = getSourceReader(workspace.rootPath).metrics()
    const cold = { bytesRead: coldAfter.bytesRead - coldBefore.bytesRead, indexScanBytes: coldAfter.indexScanBytes - coldBefore.indexScanBytes, decodedRecords: coldAfter.decodedRecords - coldBefore.decodedRecords, elapsedMs: performance.now() - coldStarted }
    const before = getSourceReader(workspace.rootPath).metrics()
    const started = performance.now(); let result
    for (let count = 0; count < 3; count++) result = readSessionOriginals(workspace, 'long', { messageId: 'm600', maxCharacters: 300 }, memory)
    const after = getSourceReader(workspace.rootPath).metrics()
    const current = { bytesRead: after.bytesRead - before.bytesRead, indexScanBytes: after.indexScanBytes - before.indexScanBytes, decodedRecords: after.decodedRecords - before.decodedRecords, elapsedMs: performance.now() - started }; memory.close()
    assert.equal(result!.messages[0]!.content, oldResult.messages[0].content)
    assert.equal(current.indexScanBytes, 0); assert(current.bytesRead < baseline.byteEstimate)
    run.json('io-comparison.json', { baselineRef, scope: 'Retrospective isolated fixed baseline reader+memory owner versus current reader; source storage format unchanged. Not a C0 wall-clock measurement.',
      fileBytes: fs.statSync(file).size, records: 1200, repetitions: 3, selectedCharactersPerRead: 300, baseline, cold, current, contentHash: result!.messages[0]!.contentHash })
    run.complete(['C06-old-and-new-exact-content-match', 'C06-measured-whole-file-versus-indexed-range-IO'], ['Total application background indexing I/O', 'Cold startup timings and cross-machine performance'])
})
