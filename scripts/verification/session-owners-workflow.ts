#!/usr/bin/env bun
/** Failure matrix S01/S02: real persistence and loopback resources, no SessionManager. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-owners', async run => {
  const workspace = join(run.directory, 'workspace')
  mkdirSync(workspace, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { buildAgentSessionSnapshot } = await import('../../packages/server-core/src/sessions/agent-product-context')
  const { createSessionAgentCallbacks } = await import('../../packages/server-core/src/sessions/agent-product-callbacks')
  const product = { id: 'fixture', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1,
    sdkSessionId: undefined as string | undefined, branchFromSdkSessionId: 'parent' as string | undefined,
    branchFromSdkCwd: '/parent' as string | undefined, branchFromSdkTurnId: 'turn' as string | undefined,
    branchFromMessageId: 'message', branchContextStrategy: 'seeded-fresh-session', branchSeedApplied: false,
    transferredSessionSummary: 'transferred context', transferredSessionSummaryApplied: false,
    thinkingLevel: 'off' as import('@phaneris/shared/agent/thinking-levels').ThinkingLevel,
    messages: [{ role: 'user' as const, content: 'retained context', isIntermediate: false }] }
  const configured = buildAgentSessionSnapshot(product)
  assert.equal(configured.branchFromSdkSessionId, undefined)
  assert.equal(configured.branchFromMessageId, 'message')
  let persistCount = 0
  const callbacks = createSessionAgentCallbacks({ read: () => ({ ...product, messages: product.messages.map(message => ({ ...message })) }),
    patch: changes => Object.assign(product, changes), persist: () => { persistCount++ }, flush: async () => {},
    thinkingChanged: () => {}, log: () => {}, error: () => {} })
  assert.deepEqual(callbacks.getBranchSeedMessages!(), [{ type: 'user', content: 'retained context' }])
  callbacks.markBranchSeedApplied!()
  assert.deepEqual(callbacks.getBranchSeedMessages!(), [])
  callbacks.onSdkSessionIdUpdate!('child')
  assert.equal(product.sdkSessionId, 'child'); assert.equal(product.branchFromSdkSessionId, undefined)
  callbacks.markTransferredSessionSummaryApplied!()
  assert.equal(callbacks.getTransferredSessionSummary!(), null)
  assert(persistCount > 0)
  const { SessionProductRepository } = await import('../../packages/server-core/src/sessions/product-repository')
  const { prepareSessionSourceResources } = await import('../../packages/server-core/src/sessions/source-resources')
  const repository = new SessionProductRepository()
  let content = 'before coalescing'
  const snapshot = () => ({ id: 'fixture', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'user', role: 'user' as const, content, timestamp: 1 }] })
  repository.enqueue('fixture', snapshot)
  content = 'latest coalesced snapshot'
  await Promise.all([repository.flush('fixture'), repository.flush('fixture')])
  assert.equal(repository.load(workspace, 'fixture')!.messages[0]!.content, content)
  const checks = ['finite product callbacks preserve branch and transfer state without Manager',
    'session snapshot filters fork-only metadata without mutable execution state',
    'lazy snapshot reads latest product state', 'concurrent flush serializes real JSONL']
  content = 'second persisted value'
  repository.enqueue('fixture', snapshot)
  await repository.flushAll()
  assert.equal(repository.load(workspace, 'fixture')!.messages[0]!.content, content)
  checks.push('flushAll barrier persists accepted product changes')
  const resources = await prepareSessionSourceResources({ workspaceRootPath: workspace,
    sessionPath: join(workspace, 'sessions', 'fixture'), servers: {}, needsHttpServer: true })
  try {
    const response = await fetch(resources.url!, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
    assert(response.ok)
    const data = await response.json() as { result: { tools: unknown[] } }
    assert.deepEqual(data.result.tools, [])
    checks.push('source pool is ready before independent SDK assembly')
    const first = resources.release(), second = resources.release()
    assert.strictEqual(first, second)
    await first
    await assert.rejects(fetch(resources.url!))
    checks.push('resource release is idempotent and closes actual HTTP listener')
    const noHttp = await prepareSessionSourceResources({ workspaceRootPath: workspace,
      sessionPath: join(workspace, 'sessions', 'fixture'), servers: {}, needsHttpServer: false })
    assert.equal(noHttp.url, undefined)
    await noHttp.release()
    checks.push('local source resource owner needs no HTTP server')
    run.json('session-owners.json', { checks, persisted: repository.load(workspace, 'fixture'),
      bytes: readFileSync(join(workspace, 'sessions', 'fixture', 'session.jsonl')).length })
    run.complete(checks, ['live external MCP services', 'native Windows filesystem semantics'])
  } finally { await resources.release() }
})
