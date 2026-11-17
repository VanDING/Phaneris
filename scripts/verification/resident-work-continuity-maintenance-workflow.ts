import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryMaintenanceCommandSchema } from '@phaneris/session-tools-core/memory-maintenance-contracts'
import { verificationWorkflow } from './verification-artifacts'

// WC16: unavailable destinations must not become no_candidate or advance coverage;
// bounded background work must preserve its pending source across a new run.
await verificationWorkflow('resident-work-continuity-maintenance', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const workspace = { id: 'maintenance', rootPath: join(run.directory, 'workspace') }
  mkdirSync(workspace.rootPath, { recursive: true })
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, name: 'Maintenance fixture', createdAt: 1,
    assistantMemory: { version: 1, learning: 'automatic', use: true } }))
  assert(MemoryMaintenanceCommandSchema.safeParse({ action: 'acknowledge', checkpointId: 'a'.repeat(64),
    conclusion: 'deferred', reason: 'Project destination temporarily unavailable' }).success)
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  await saveSession({ id: 'maintenance-source', workspaceRootPath: workspace.rootPath, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'source', type: 'user', content: 'Project decision: preserve original evidence and verify the target before writing.', timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const memory = new AssistantMemoryStore(workspace)
  try {
    const source = memory.maintain({ action: 'next', sessionId: 'maintenance-source' }, 'maintenance-1')
    assert.equal(source.status, 'source'); if (source.status !== 'source') throw new Error('No maintenance source')
    const deferred = memory.maintain({ action: 'acknowledge', checkpointId: source.checkpointId,
      conclusion: 'deferred', reason: 'Cannot currently write the source project destination' }, 'maintenance-1')
    assert.equal(deferred.status, 'deferred')
    assert.equal(deferred.coverage.processedMessages, source.coverage.processedMessages)
    const retried = memory.maintain({ action: 'next', sessionId: 'maintenance-source' }, 'maintenance-2')
    assert.equal(retried.status, 'source'); if (retried.status !== 'source') throw new Error('Deferred source disappeared')
    assert.equal(retried.checkpointId, source.checkpointId)
    const acknowledged = memory.maintain({ action: 'acknowledge', checkpointId: retried.checkpointId,
      conclusion: 'no_candidate', reason: 'Reviewed; no durable additional observation is justified' }, 'maintenance-2')
    assert.equal(acknowledged.status, 'acknowledged')
    assert.equal(acknowledged.coverage.processedMessages, source.coverage.processedMessages + 1)
    run.json('maintenance-evidence.json', { source, deferred, retried, acknowledged })
    run.complete(['WC16-deferred-destination-preserves-pending-source', 'WC16-genuine-no-candidate-advances-coverage'])
  } finally { memory.close() }
})
