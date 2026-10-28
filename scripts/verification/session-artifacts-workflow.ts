#!/usr/bin/env bun
/** Artifact revisions/checkouts + Session export/import/delete, including the old workspace manifest. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-artifacts', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/storage')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { getSessionPath } = await import('../../packages/shared/src/sessions/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const artifacts = await import('../../packages/shared/src/artifacts')
  const workspaces = ['source', 'target'].map(id => ({ id, slug: id, name: id, createdAt: 1, rootPath: join(run.directory, id) }))
  for (const workspace of workspaces) {
    mkdirSync(workspace.rootPath, { recursive: true })
    createWorkspaceAtPath(workspace.rootPath, workspace.name, { permissionMode: 'ask' })
  }
  saveConfig({ workspaces, activeWorkspaceId: 'source', activeSessionId: null })
  const manager = new SessionManager(), receiver = new SessionManager(), checks: string[] = []
  const workspace = workspaces[0]!, target = workspaces[1]!
  const sourcePath = join(run.directory, 'user-owned.md')
  writeFileSync(sourcePath, 'Original user file')
  const scope = { workspaceRootPath: workspace.rootPath, workspaceId: workspace.id,
    contentRootPath: run.directory, allowedRoots: [run.directory] }
  try {
    await manager.initialize()
    const session = await manager.createSession('source', { name: 'Artifact owner' })
    const sessionDir = getSessionPath(workspace.rootPath, session.id)
    const draft = artifacts.createArtifactDraft(scope, { sessionId: session.id, sourcePath, kind: 'text', initialText: 'Private draft' })
    assert(draft.editablePath!.startsWith(sessionDir), 'New checkout must belong to the Session directory')
    assert(draft.activePath!.startsWith(sessionDir))
    assert.equal(readFileSync(sourcePath, 'utf8'), 'Original user file')
    checks.push('session-owned-private-files')
    const unrelated = await manager.createSession('source', { name: 'Unrelated manifest fixture' })
    const unrelatedStore = join(getSessionPath(workspace.rootPath, unrelated.id), 'artifacts')
    mkdirSync(unrelatedStore, { recursive: true })
    writeFileSync(join(unrelatedStore, 'manifest.json'), 'invalid fixture JSON')
    assert.doesNotThrow(() => artifacts.listArtifacts(scope, { sessionId: session.id }), 'A Session read must not open unrelated manifests')
    await manager.deleteSession(unrelated.id)
    checks.push('session-read-isolated-from-unrelated-manifests')
    const leased = artifacts.acquireArtifactLease(scope, draft.artifact.id, 'agent', undefined, session.id)
    const updated = artifacts.applyArtifactDraft(scope, draft.artifact.id, { expectedRevision: draft.artifact.draftRevision!,
      leaseId: leased.artifact.lease!.id, operation: { type: 'set_text', text: 'Updated private draft' } }, session.id)
    const { storedToMessage } = await import('../../packages/core/src/types/message-mapper')
    const port = manager as unknown as { sessions: Map<string, { messages: unknown[] }>; persistSession(managed: unknown): void }
    const managed = port.sessions.get(session.id)!
    managed.messages.push(storedToMessage({ id: 'artifact-card', type: 'tool', content: artifacts.serializeArtifactEvent(updated), timestamp: 1 }))
    port.persistSession(managed)
    const bundle = await manager.exportSession(session.id, 'source')
    assert(bundle?.files.some(file => file.relativePath === 'artifacts/manifest.json'))
    const imported = await receiver.importSession('target', bundle!, 'fork')
    const targetArtifacts = artifacts.listArtifacts({ workspaceRootPath: target.rootPath }, { sessionId: imported.sessionId })
    assert.equal(targetArtifacts.length, 1)
    assert.notEqual(targetArtifacts[0]!.artifact.id, draft.artifact.id)
    assert.equal(targetArtifacts[0]!.artifact.workspaceId, 'target')
    assert.equal(readFileSync(targetArtifacts[0]!.activePath!, 'utf8'), 'Updated private draft')
    assert((await receiver.getSession(imported.sessionId))!.messages[0]!.content.includes(targetArtifacts[0]!.artifact.id))
    assert.equal(targetArtifacts[0]!.artifact.lease, undefined)
    checks.push('portable-artifact-copy-with-independent-identity')

    const legacySession = await manager.createSession('source', { name: 'Legacy artifact owner' })
    const legacyId = randomUUID(), text = 'Legacy private draft', hash = createHash('sha256').update(text).digest('hex')
    const revisionPath = `artifacts/revisions/${legacyId}/${hash}.txt`, checkoutPath = `artifacts/checkouts/${legacyId}/draft.txt`
    for (const path of [revisionPath, checkoutPath]) {
      const absolute = join(workspace.rootPath, path)
      mkdirSync(join(absolute, '..'), { recursive: true }); writeFileSync(absolute, text)
    }
    const old = { version: 1, artifacts: [{ ...draft.artifact, id: legacyId, sessionId: legacySession.id,
      lease: undefined, currentRevision: null, baseRevision: null, draftRevision: hash, previews: [],
      revisions: [{ id: hash, contentHash: hash, size: Buffer.byteLength(text), createdAt: 1, origin: 'create', relativePath: revisionPath }],
      checkoutRelativePath: checkoutPath }] }
    const oldBytes = JSON.stringify(old, null, 2) + '\n'
    mkdirSync(join(workspace.rootPath, 'artifacts'), { recursive: true })
    writeFileSync(join(workspace.rootPath, 'artifacts/manifest.json'), oldBytes)
    const conflictingTarget = join(getSessionPath(workspace.rootPath, legacySession.id), revisionPath)
    mkdirSync(join(conflictingTarget, '..'), { recursive: true })
    writeFileSync(conflictingTarget, 'Existing target must not be overwritten')
    await assert.rejects(manager.exportSession(legacySession.id, 'source'), /migration content conflict/)
    assert.equal(readFileSync(join(workspace.rootPath, 'artifacts/manifest.json'), 'utf8'), oldBytes)
    assert.equal(readFileSync(join(workspace.rootPath, revisionPath), 'utf8'), text)
    assert.equal(readFileSync(conflictingTarget, 'utf8'), 'Existing target must not be overwritten')
    unlinkSync(conflictingTarget) // Only the conflicting file created by this fixture.
    checks.push('failed-artifact-migration-preserves-both-copies')
    await manager.exportSession(legacySession.id, 'source')
    const migrated = artifacts.getArtifact(scope, legacyId)
    assert(migrated.activePath!.startsWith(getSessionPath(workspace.rootPath, legacySession.id)))
    assert.equal(readFileSync(migrated.activePath!, 'utf8'), text)
    const backups = join(workspace.rootPath, 'artifacts/legacy-manifests')
    assert(readdirSync(backups).some(file => readFileSync(join(backups, file), 'utf8') === oldBytes))
    checks.push('legacy-artifact-migrates-with-backup')
    const acceptedPath = join(run.directory, 'accepted-user-file.txt')
    const acceptedDraft = artifacts.createArtifactDraft(scope, { sessionId: legacySession.id, sourcePath: acceptedPath,
      kind: 'text', initialText: 'Accepted external file' })
    artifacts.submitArtifact(scope, acceptedDraft.artifact.id, { expectedRevision: acceptedDraft.artifact.draftRevision! })
    assert(artifacts.acceptArtifact(scope, acceptedDraft.artifact.id).accepted)
    assert.equal(readFileSync(acceptedPath, 'utf8'), 'Accepted external file')
    if (process.platform !== 'win32') assert.equal(statSync(acceptedPath).mode & 0o777, statSync(sourcePath).mode & 0o777)
    checks.push('external-materialization-keeps-user-file-policy')
    // Relative file links and artifact registration must use the same default
    // directory as the real Pi tools, even when a same-name root file exists.
    const defaultOwner = await manager.createSession('source', { name: 'Default cwd owner', workingDirectory: 'none' })
    const defaultDir = getSessionPath(workspace.rootPath, defaultOwner.id)
    writeFileSync(join(workspace.rootPath, 'relative-report.md'), 'Wrong workspace file')
    writeFileSync(join(defaultDir, 'relative-report.md'), 'Correct session file')
    const handlers = new Map<string, (...args: any[]) => any>()
    const transport = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler), push: () => {} }
    const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
    const { registerFilesHandlers } = await import('../../packages/server-core/src/handlers/rpc/files')
    const { registerArtifactHandlers } = await import('../../packages/server-core/src/handlers/rpc/artifacts')
    registerFilesHandlers(transport as any, { sessionManager: manager } as any)
    registerArtifactHandlers(transport as any, { sessionManager: manager } as any)
    const resolved = await handlers.get(RPC_CHANNELS.file.RESOLVE)!({ workspaceId: workspace.id }, 'relative-report.md', defaultOwner.id)
    assert.equal(resolved.path, join(defaultDir, 'relative-report.md'))
    checks.push('relative-file-rpc-defaults-to-session-directory')
    const registered = await handlers.get(RPC_CHANNELS.artifacts.REGISTER_CURRENT)!({}, workspace.id,
      { sessionId: defaultOwner.id, sourcePath: 'relative-report.md', kind: 'text' })
    assert.equal(registered.artifact.sourcePath, join(defaultDir, 'relative-report.md'))
    assert.equal(readFileSync(registered.activePath, 'utf8'), 'Correct session file')
    checks.push('relative-artifact-rpc-defaults-to-session-directory')
    await manager.deleteSession(defaultOwner.id)
    await manager.deleteSession(session.id)
    await manager.deleteSession(legacySession.id)
    assert(!existsSync(sessionDir))
    assert.equal(artifacts.listArtifacts(scope).length, 0)
    assert.equal(readFileSync(sourcePath, 'utf8'), 'Original user file')
    assert.equal(readFileSync(join(workspace.rootPath, revisionPath), 'utf8'), text, 'Legacy rollback bytes remain archived')
    checks.push('delete-removes-active-records-and-preserves-external-file')
    run.json('artifacts.json', { checks, imported, importedArtifacts: targetArtifacts, legacyRevisionSha256: hash })
    run.complete(checks, ['live Office rendering', 'native Linux filesystem semantics'])
  } finally { await manager.cleanup(); await receiver.cleanup() }
})
