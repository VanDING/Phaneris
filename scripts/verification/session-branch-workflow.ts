#!/usr/bin/env bun
/** V12: real SessionManager/Host/storage; provider and pool endpoints are controlled ports. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-branch', async evidence => {
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-branch-workflow-'))
  process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/storage')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { createSession, loadSession, saveSession, getSessionPath } = await import('../../packages/shared/src/sessions/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { PiRuntimeDriver } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { createArtifactDraft, listArtifacts, serializeArtifactEvent } = await import('../../packages/shared/src/artifacts')
  const ws = join(fixture, 'workspace')
  mkdirSync(ws, { recursive: true })
  const workspace = { id: 'branch-fixture', slug: 'branch-fixture', createdAt: 1, name: 'Branch fixture', rootPath: ws }
  createWorkspaceAtPath(ws, workspace.name, { permissionMode: 'ask' })
  saveConfig({ workspaces: [workspace], activeWorkspaceId: workspace.id, activeSessionId: null })
  const parent = await createSession(ws, { name: 'Parent', model: 'pi/gpt-5', permissionMode: 'ask' })
  const storedParent = loadSession(ws, parent.id)
  assert(storedParent, 'Parent must exist in real storage before branching')
  const parentDir = getSessionPath(ws, parent.id)
  const ownedFiles = ['attachments/input.txt', 'plans/plan.md', 'data/table.json', 'downloads/output.bin', 'long_responses/tool.txt', 'notes.md']
  for (const path of ownedFiles) writeFileSync(join(parentDir, path), `session-owned fixture: ${path}`)
  const artifactScope = { workspaceRootPath: ws, workspaceId: workspace.id, allowedRoots: [ws] }
  const parentArtifact = createArtifactDraft(artifactScope, { sessionId: parent.id, kind: 'text',
    sourcePath: join(parentDir, 'notes.md'), initialText: 'Branch-owned artifact draft' })
  await saveSession({ ...storedParent, sdkSessionId: 'fixture-parent-sdk', messages: [
    { id: 'm1', type: 'user', content: `Original parent input ${parentDir.replaceAll('\\', '/')}/attachments/input.txt\n${serializeArtifactEvent(parentArtifact)}`, timestamp: 1 },
    { id: 'm2', type: 'assistant', content: 'Original parent answer', timestamp: 2 },
  ] })
  const sdkless = await createSession(ws, { name: 'Parent without SDK context', model: 'pi/gpt-5', permissionMode: 'ask' })
  const storedSdkless = loadSession(ws, sdkless.id)
  assert(storedSdkless)
  await saveSession({ ...storedSdkless, messages: [{ id: 'm1', type: 'user', content: 'No SDK context', timestamp: 1 }] })
  const parentFile = join(getSessionPath(ws, parent.id), 'session.jsonl')
  const parentHash = () => createHash('sha256').update(readFileSync(parentFile)).digest('hex')
  const before = parentHash(), checks: { id: string; passed: boolean; childId: string; disposed: boolean;
    poolStopped: boolean; mcpDisconnected: boolean; hostGeneration: number | null }[] = []
  const runtime = createDurableRuntime(), manager = new SessionManager(runtime)
  const port = manager as unknown as { getOrCreateAgent: (managed: { id: string; poolServer?: { stop: () => Promise<void> }; mcpPool?: { disconnectAll: () => Promise<void> } }) => Promise<unknown> }
  let failing = true, disposed = false, poolStopped = false, mcpDisconnected = false, childId = ''
  let childView: ReturnType<typeof runtime.execution.view> | undefined
  const record = (id: string) => checks.push({ id, passed: true, childId, disposed, poolStopped, mcpDisconnected,
    hostGeneration: childView?.generation ?? null })
  port.getOrCreateAgent = async managed => {
    childId = managed.id
    managed.poolServer = { stop: async () => { poolStopped = true } }
    managed.mcpPool = { disconnectAll: async () => { mcpDisconnected = true } }
    const backend = { supportsBranching: true, ensureBranchReady: async () => { if (failing) throw new Error('fixture preflight failed') },
      destroy: () => { disposed = true } }
    runtime.execution.installDriver(managed.id, new PiRuntimeDriver(backend as never))
    childView = runtime.execution.view(managed.id)
    return backend
  }
  try {
    const beforeMissing = readdirSync(join(ws, 'sessions')).sort()
    const sdklessFile = join(getSessionPath(ws, sdkless.id), 'session.jsonl')
    const sdklessBefore = createHash('sha256').update(readFileSync(sdklessFile)).digest('hex')
    await assert.rejects(manager.createSession(workspace.id, { branchFromSessionId: sdkless.id, branchFromMessageId: 'm1' }), /parent session SDK context is not initialized/)
    assert.equal(childId, '', 'Invalid parent must be rejected before creating a driver')
    assert.deepEqual(readdirSync(join(ws, 'sessions')).sort(), beforeMissing)
    assert.equal(createHash('sha256').update(readFileSync(sdklessFile)).digest('hex'), sdklessBefore)
    assert.equal(parentHash(), before)
    record('missing-parent-sdk')
    await assert.rejects(manager.createSession(workspace.id, { name: 'Failed branch', branchFromSessionId: parent.id, branchFromMessageId: 'm1' }), /fixture preflight failed/)
    assert(disposed && poolStopped && mcpDisconnected, 'Branch failure must release Host driver and both pool endpoints')
    assert.equal(childView?.driver, null)
    assert(childView && childView.generation > 0, 'Failure rollback must release the Host session, not just drop its driver')
    assert(!existsSync(getSessionPath(ws, childId)), 'Failed child must be deleted from real storage')
    assert.equal(parentHash(), before)
    record('preflight-rollback')
    failing = false; disposed = false; poolStopped = false; mcpDisconnected = false
    const branch = await manager.createSession(workspace.id, { name: 'Successful branch', branchFromSessionId: parent.id, branchFromMessageId: 'm1' })
    assert(existsSync(getSessionPath(ws, branch.id)))
    assert(runtime.execution.view(branch.id).driver, 'Successful branch remains owned by Host')
    assert.equal(parentHash(), before)
    record('successful-preflight')
    const branched = loadSession(ws, branch.id)!
    const branchDir = getSessionPath(ws, branch.id)
    for (const path of ownedFiles) assert.equal(readFileSync(join(branchDir, path), 'utf8'), readFileSync(join(parentDir, path), 'utf8'))
    assert(branched.messages[0]!.content.includes(branchDir.replaceAll('\\', '/')))
    writeFileSync(join(branchDir, ownedFiles[0]!), 'branch-private edit')
    assert.notEqual(readFileSync(join(branchDir, ownedFiles[0]!), 'utf8'), readFileSync(join(parentDir, ownedFiles[0]!), 'utf8'))
    record('owned-files-copied-and-independent')
    const branchArtifacts = listArtifacts(artifactScope, { sessionId: branch.id })
    assert.equal(branchArtifacts.length, 1)
    assert.notEqual(branchArtifacts[0]!.artifact.id, parentArtifact.artifact.id)
    assert(branched.messages[0]!.content.includes(branchArtifacts[0]!.artifact.id))
    assert(branchArtifacts[0]!.editablePath!.startsWith(branchDir))
    record('artifact-owner-and-card-rebound')
    await manager.deleteSession(branch.id)
    assert(disposed && poolStopped && mcpDisconnected)
    assert.equal(childView?.driver, null)
    assert(childView && childView.generation > 0)
    assert(!existsSync(getSessionPath(ws, branch.id)))
    assert.equal(parentHash(), before)
    record('successful-branch-delete')
    evidence.complete(checks.map(check => check.id), ['live Pi SDK branch initialization', 'native Windows/Linux filesystem'])
  } finally {
    await runtime.close()
    evidence.json('session-branch.json', { fixture, checks, parentUnchanged: parentHash() === before, parentSha256: before,
      files: ownedFiles.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(join(parentDir, path))).digest('hex') })) })
  }
  console.log(JSON.stringify({ passed: checks.length, output: join(evidence.directory, 'session-branch.json') }))
})
