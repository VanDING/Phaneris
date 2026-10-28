#!/usr/bin/env bun
/** Product commands, real persistence queue and filesystem watcher in an isolated workspace. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '@phaneris/core/types'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-metadata', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/storage')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { loadSession, getSessionFilePath, updateSessionMetadata } = await import('../../packages/shared/src/sessions/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const workspace = { id: 'metadata', slug: 'metadata', name: 'Metadata', createdAt: 1, rootPath: join(run.directory, 'workspace') }
  mkdirSync(workspace.rootPath, { recursive: true })
  createWorkspaceAtPath(workspace.rootPath, workspace.name, { permissionMode: 'ask' })
  saveConfig({ workspaces: [workspace], activeWorkspaceId: workspace.id, activeSessionId: null })
  const runtime = createDurableRuntime(), manager = new SessionManager(runtime)
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  const port = manager as unknown as { sessions: Map<string, { id: string; messages: Message[] }>; persistSession(managed: unknown): void }
  try {
    const session = await manager.createSession(workspace.id, { name: 'Metadata fixture', model: 'pi/fixture-model' })
    const managed = port.sessions.get(session.id)!
    await scene('metadata-command-retains-pending-messages', async () => {
      managed.messages.push({ id: 'accepted-not-yet-flushed', role: 'user', content: 'Retain pending content', timestamp: 1 })
      port.persistSession(managed)
      await manager.markSessionUnread(session.id)
      assert.equal(loadSession(workspace.rootPath, session.id)!.messages[0]?.id, 'accepted-not-yet-flushed')
    })
    await scene('explicit-model-clear-persists', async () => {
      await manager.updateSessionModel(session.id, workspace.id, 'pi/fixture-model')
      assert.equal(loadSession(workspace.rootPath, session.id)!.model, 'pi/fixture-model')
      await manager.updateSessionModel(session.id, workspace.id, null)
      assert.equal(loadSession(workspace.rootPath, session.id)!.model, undefined)
    })
    await scene('plan-state-shares-product-writer-and-single-dispatch', async () => {
      managed.messages.push({ id: 'submitted-plan', role: 'plan', content: 'Execute the fixture', timestamp: 2,
        planPath: join(workspace.rootPath, 'plan.md') })
      await manager.setPendingPlanExecution(session.id, join(workspace.rootPath, 'plan.md'), 'Retained draft')
      managed.messages.push({ id: 'plan-adjacent-message', role: 'info', content: 'Plan remains pending', timestamp: 2 })
      port.persistSession(managed)
      await manager.flushSession(session.id)
      assert.equal(loadSession(workspace.rootPath, session.id)!.pendingPlanExecution?.awaitingCompaction, true)
      await manager.markCompactionComplete(session.id)
      const claims = await Promise.all([manager.markPendingPlanExecutionDispatched(session.id), manager.markPendingPlanExecutionDispatched(session.id)])
      assert.deepEqual(claims.sort(), [false, true])
      await manager.clearPendingPlanExecution(session.id)
      assert.equal(loadSession(workspace.rootPath, session.id)!.pendingPlanExecution, undefined)
    })
    await scene('external-project-and-column-roundtrip', async () => {
      manager.setupConfigWatcher(workspace.rootPath, workspace.id)
      await manager.flushSession(session.id)
      await new Promise(resolve => setTimeout(resolve, 200))
      const path = getSessionFilePath(workspace.rootPath, session.id)
      const lines = readFileSync(path, 'utf8').split('\n')
      lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), projectId: 'external-project', kanbanColumn: 'external-column' })
      writeFileSync(path, lines.join('\n'))
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && manager.getSessions(workspace.id).find(item => item.id === session.id)?.projectId !== 'external-project') {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.equal(manager.getSessions(workspace.id).find(item => item.id === session.id)?.projectId, 'external-project')
      await manager.markSessionUnread(session.id)
      const stored = loadSession(workspace.rootPath, session.id)!
      assert.equal(stored.projectId, 'external-project')
      assert.equal(stored.kanbanColumn, 'external-column')
      assert.equal(stored.messages[0]?.id, 'accepted-not-yet-flushed')
    })
    await scene('shared-metadata-writer-preserves-owner-snapshot', async () => {
      managed.messages.push({ id: 'external-writer-adjacent', role: 'info', content: 'Keep this pending message', timestamp: 4 })
      port.persistSession(managed)
      await updateSessionMetadata(workspace.rootPath, session.id, { isFlagged: true })
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && !manager.getSessions(workspace.id).find(item => item.id === session.id)?.isFlagged) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.equal(manager.getSessions(workspace.id).find(item => item.id === session.id)?.isFlagged, true)
      await manager.flushSession(session.id)
      const stored = loadSession(workspace.rootPath, session.id)!
      assert(stored.messages.some(message => message.id === 'external-writer-adjacent'))
      assert.equal(stored.isFlagged, true)
      await Promise.all([
        updateSessionMetadata(workspace.rootPath, session.id, { isFlagged: false }),
        updateSessionMetadata(workspace.rootPath, session.id, { name: 'Parallel external metadata' }),
      ])
      const parallelDeadline = Date.now() + 5000
      while (Date.now() < parallelDeadline && manager.getSessions(workspace.id).find(item => item.id === session.id)?.name !== 'Parallel external metadata') {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      await manager.flushSession(session.id)
      assert.equal(loadSession(workspace.rootPath, session.id)!.name, 'Parallel external metadata')
      assert.equal(loadSession(workspace.rootPath, session.id)!.isFlagged, false)
    })
    await scene('failed-metadata-write-can-retry-without-dropping-product-failure', async () => {
      const retry = await manager.createSession(workspace.id, { name: 'Metadata retry fixture' })
      await manager.flushSession(retry.id)
      const temporaryPath = getSessionFilePath(workspace.rootPath, retry.id) + '.tmp'
      mkdirSync(temporaryPath)
      await assert.rejects(updateSessionMetadata(workspace.rootPath, retry.id, { name: 'Blocked metadata write' }))
      assert.equal(loadSession(workspace.rootPath, retry.id)!.name, 'Metadata retry fixture')
      rmdirSync(temporaryPath) // Only the empty blocking directory created by this fixture.
      await updateSessionMetadata(workspace.rootPath, retry.id, { name: 'Retried metadata write' })
      assert.equal(loadSession(workspace.rootPath, retry.id)!.name, 'Retried metadata write')
      const failedProduct = await manager.createSession(workspace.id, { name: 'Product failure fixture' })
      const product = port.sessions.get(failedProduct.id)!
      product.messages.push({ id: 'retained-failed-product', role: 'info', content: 'Do not overwrite a failed product snapshot', timestamp: 5 })
      const blockedProductPath = getSessionFilePath(workspace.rootPath, failedProduct.id) + '.tmp'
      mkdirSync(blockedProductPath)
      port.persistSession(product)
      await assert.rejects(manager.flushSession(failedProduct.id))
      rmdirSync(blockedProductPath)
      await assert.rejects(updateSessionMetadata(workspace.rootPath, failedProduct.id, { name: 'Must not bypass product failure' }))
      port.persistSession(product)
      await manager.flushSession(failedProduct.id)
      assert(loadSession(workspace.rootPath, failedProduct.id)!.messages.some(message => message.id === 'retained-failed-product'))
    })
    run.json('metadata.json', { checks, failures, stored: loadSession(workspace.rootPath, session.id) })
    assert.deepEqual(failures, [])
    run.complete(checks, ['native Linux filesystem watcher'])
  } finally { await manager.cleanup() }
})
