import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { listArtifacts } from '@phaneris/shared/artifacts'
import type { Message } from '@phaneris/core/types'
import { registerDelegatedDeliverables } from '../../packages/server-core/src/resident-assistant/deliverables'

await verificationWorkflow('resident-assistant-deliverables', async run => {
  const workspace = { id: 'deliverables', rootPath: join(run.directory, 'workspace') }
  const root = join(workspace.rootPath, 'sessions', 'worker', 'data')
  mkdirSync(root, { recursive: true })
  const path = join(root, 'report.html'), outside = join(run.directory, 'outside.txt')
  const start = Date.now()
  writeFileSync(path, '<!doctype html><title>Delivery evidence</title>REAL_OUTPUT')
  writeFileSync(outside, 'OUTSIDE_SCOPE')
  const messages: Message[] = [{ id: 'assignment', role: 'user', content: 'Produce report', timestamp: start,
    inputSource: { kind: 'delegation', delegationId: 'd', assistantSessionId: 'assistant', originMessageId: 'human' } },
  { id: 'write', role: 'tool', content: '', timestamp: start, toolName: 'Write', toolStatus: 'completed', toolInput: { file_path: path } },
  { id: 'error', role: 'tool', content: '', timestamp: start, toolName: 'Write', toolStatus: 'error', toolInput: { file_path: outside } }]
  await registerDelegatedDeliverables(workspace, 'worker', messages, ['assignment'])
  let artifacts = listArtifacts({ workspaceRootPath: workspace.rootPath })
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0]!.artifact.sessionId, 'worker')
  assert.equal(resolve(artifacts[0]!.artifact.sourcePath), resolve(path))
  assert.equal(artifacts[0]!.artifact.status, 'current')
  await registerDelegatedDeliverables(workspace, 'worker', messages, ['assignment'])
  assert.equal(listArtifacts({ workspaceRootPath: workspace.rootPath }).length, 1, 'Completion replay must not duplicate deliverables')
  assert.equal(listArtifacts({ workspaceRootPath: workspace.rootPath })[0]!.artifact.updatedAt, artifacts[0]!.artifact.updatedAt, 'Unchanged replay must not rewrite artifact metadata')
  messages.push({ id: 'outside', role: 'tool', content: '', timestamp: start, toolName: 'Write', toolStatus: 'completed', toolInput: { file_path: outside } })
  await registerDelegatedDeliverables(workspace, 'worker', messages, ['assignment'])
  artifacts = listArtifacts({ workspaceRootPath: workspace.rootPath })
  assert.equal(artifacts.length, 1, 'Out-of-scope paths must not become deliverables')
  const stale = join(root, 'stale.txt'); writeFileSync(stale, 'OLD')
  await registerDelegatedDeliverables(workspace, 'worker', [{ id: 'fresh', role: 'user', content: 'Read only', timestamp: Date.now() + 10000 },
    { id: 'read', role: 'tool', content: '', timestamp: start, toolName: 'Read', toolStatus: 'completed', toolInput: { file_path: stale } }], ['fresh'])
  assert.equal(listArtifacts({ workspaceRootPath: workspace.rootPath }).length, 1, 'Read-only results must not import files')
  run.json('deliverables.json', artifacts)
  run.complete(['RFU07-successful-write-registers-real-file', 'RFU07-completion-idempotence', 'RFU07-failed-read-and-external-paths-excluded'], ['Provider quality and signed installation'])
})
