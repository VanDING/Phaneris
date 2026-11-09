import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-structure', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const root = mkdtempSync(resolve('.cache/verification/resident-structure-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  const workspace = { id: 'structure', rootPath: join(root, 'workspace') }
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { ResidentAssistantService } = await import('../../packages/server-core/src/resident-assistant/service')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const messages = [{ id: 'requirement', role: 'user' as const, content: 'KEEP_ORIGINAL_REQUIREMENT', timestamp: 1 }]
  await saveSession({ id: 'assistant', workspaceRootPath: workspace.rootPath, sessionKind: 'resident_assistant', createdAt: 1, lastUsedAt: 1,
    messages: messages.map(({ role, ...message }) => ({ ...message, type: role })), tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  let service = new ResidentAssistantService(workspace)
  const scenes: string[] = []
  try {
    let context = service.context('assistant')
    for (let round = 0; round < 20; round++) {
      context.prepare({ cursor: round, items: [] }, messages, `run-${round}`, 'requirement')
      const segment = context.get().activeSegment!
      assert.equal(segment.dependencies.sources.length, 1)
    }
    scenes.push('RZ01-repeated-turns-retain-one-source-reference')
    const dbPath = join(workspace.rootPath, 'context.db')
    await service.close()
    const db = openSqliteDatabase(dbPath)
    try {
      const state = JSON.parse((db.prepare('SELECT body FROM pointers').get() as { body: string }).body)
      assert.equal(state.activeSegment, undefined)
      assert(db.prepare('SELECT 1 FROM views WHERE id=?').get(state.activeSegmentId))
      db.prepare("UPDATE pointers SET body=json_set(body,'$.activeSegmentId','missing-view')").run()
    } finally { db.close() }
    service = new ResidentAssistantService(workspace)
    context = service.context('assistant')
    assert.throws(() => context.get(), /view|unavailable/i)
    context.command({ action: 'focus', label: 'Explicit recovery', anchors: [] }, messages)
    context.prepare({ cursor: 22, items: [] }, messages, 'recovered-run', 'requirement')
    assert.equal(context.get().activeSegment!.runOperationId, 'recovered-run')
    scenes.push('RZ02-reference-only-pointer-and-explicit-recovery-without-history-fallback')
    const external = new AssistantMemoryStore(workspace)
    try {
      const entry = external.mutate({ action: 'remember', requestId: 'remember', key: 'original', content: 'LIVE_EXTERNAL_MEMORY', kind: 'fact', basis: 'user_stated', sources: [{ sessionId: 'assistant', messageId: 'requirement' }] })
      assert.equal(service.memory.query({ text: 'LIVE_EXTERNAL_MEMORY' }).items.length, 1)
      external.mutate({ action: 'transition', requestId: 'forget', id: entry.record.id, expectedRevision: 1, state: 'forgotten' })
      assert.equal(service.memory.query({ text: 'LIVE_EXTERNAL_MEMORY' }).items.length, 0)
    } finally { external.close() }
    scenes.push('RZ04-shared-service-observes-external-connection-forgetting')
    await service.close()
    assert.throws(() => service.memory, /closed/i)
    assert.throws(() => service.context('assistant'), /closed/i)
    scenes.push('RZ04-closed-service-cannot-reopen-resources')
    run.json('structure-evidence.json', { scenes, rounds: 20 })
  } finally { await service.close() }
  copyFileSync(join(workspace.rootPath, 'context.db'), join(run.directory, 'context.db'))
  copyFileSync(join(workspace.rootPath, 'assistant/memory/memory.db'), join(run.directory, 'memory.db'))
  run.complete(scenes, ['Paid models and provider quality', 'Performance beyond the recorded repeated-turn fixture', 'Multi-Host authority'])
})
