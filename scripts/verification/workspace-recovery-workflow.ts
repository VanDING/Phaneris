import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verificationWorkflow } from './verification-artifacts'

if (process.argv[2] === '--interrupt') {
  const fs = await import('node:fs'), native = { ...fs }
  const { mock } = await import('bun:test')
  mock.module('node:fs', () => ({ ...native, copyFileSync: (from: string, to: string) => {
    native.copyFileSync(from, to)
    if (to.includes('.craft-restore-')) { process.stdout.write('staging-written\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0) }
  } }))
  const { restoreWorkspaceBackup } = await import('../../packages/server-core/src/services/workspace-backup')
  restoreWorkspaceBackup(process.argv[3]!, process.argv[4]!, { force: true })
} else await verificationWorkflow('workspace-recovery', async run => {
  const { createWorkspaceBackup, verifyWorkspaceBackup, restoreWorkspaceBackup } = await import('../../packages/server-core/src/services/workspace-backup')
  const { createSession, loadSession, saveSession } = await import('../../packages/shared/src/sessions/storage')
  const { createArtifactDraft, applyArtifactDraft, getArtifact, listArtifacts, submitArtifact, acceptArtifact } = await import('../../packages/shared/src/artifacts')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const workspace = join(run.directory, 'original'), backup = join(run.directory, 'backup'), restored = join(run.directory, 'restored')
  mkdirSync(join(workspace, 'materials'), { recursive: true })
  const session = await createSession(workspace, { name: 'Representative recovery session', permissionMode: 'safe', workingDirectory: join(workspace, 'materials') })
  const attachment = join(workspace, 'sessions', session.id, 'attachments', 'evidence.txt')
  mkdirSync(join(workspace, 'sessions', session.id, 'attachments'), { recursive: true }); writeFileSync(attachment, 'synthetic attachment\n')
  const saved = loadSession(workspace, session.id)!; saved.messages.push({ id: 'm1', type: 'user', content: 'Synthetic recoverable work', timestamp: 1 }); await saveSession(saved)
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({ defaults: { workingDirectory: join(workspace, 'materials') } }))
  const scope = { workspaceId: 'recovery', workspaceRootPath: workspace, contentRootPath: join(workspace, 'materials') }
  const artifact = createArtifactDraft(scope, { sessionId: session.id, kind: 'text', sourcePath: 'report.txt', initialText: 'draft one' })
  applyArtifactDraft(scope, artifact.artifact.id, { expectedRevision: artifact.artifact.draftRevision!, operation: { type: 'set_text', text: 'draft two' } })
  writeFileSync(artifact.editablePath!, 'checkout survives recovery')
  const runtime = createDurableRuntime()
  runtime.commands.acceptRun({ workspaceRootPath: workspace, sessionId: session.id, operationId: 'recover-run', turnId: 'm1', userMessageId: 'm1', userMessage: 'synthetic recovery' })
  await runtime.effects.prepareTool(workspace, { sessionId: session.id, runOperationId: 'recover-run', providerToolCallId: 'unknown-write', toolName: 'Write', args: { path: 'external-effect' } })
  await runtime.close()
  const manifest = createWorkspaceBackup(workspace, backup)
  assert(verifyWorkspaceBackup(backup).ok)
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const originalHashes = Object.fromEntries(manifest.files.map(file => [file.path, hash(join(workspace, file.path))]))
  const checks: string[] = []
  restoreWorkspaceBackup(backup, restored)
  const loaded = loadSession(restored, session.id)!
  assert.equal(loaded.workspaceRootPath, restored); assert.equal(loaded.workingDirectory, join(restored, 'materials'))
  assert.equal(loaded.messages[0]?.content, 'Synthetic recoverable work'); checks.push('session-and-owned-paths-restored')
  assert.equal(readFileSync(join(restored, 'sessions', session.id, 'attachments/evidence.txt'), 'utf8'), 'synthetic attachment\n'); checks.push('attachment-bytes-preserved')
  const restoredArtifact = getArtifact({ workspaceRootPath: restored }, artifact.artifact.id)
  assert.equal(listArtifacts({ workspaceRootPath: restored }).length, 1)
  assert.equal(readFileSync(restoredArtifact.editablePath!, 'utf8'), 'checkout survives recovery')
  assert.equal(restoredArtifact.artifact.revisions.length, 2)
  assert.equal(restoredArtifact.artifact.sourcePath, join(restored, 'materials/report.txt'))
  submitArtifact({ ...scope, workspaceRootPath: restored, contentRootPath: join(restored, 'materials') }, artifact.artifact.id)
  assert(acceptArtifact({ ...scope, workspaceRootPath: restored, contentRootPath: join(restored, 'materials') }, artifact.artifact.id).accepted)
  assert.equal(readFileSync(join(restored, 'materials/report.txt'), 'utf8'), 'checkout survives recovery'); assert(!existsSync(join(workspace, 'materials/report.txt')))
  checks.push('artifact-revisions-checkout-accept-only-restored-copy')
  const reopened = createDurableRuntime()
  reopened.admin.start([restored], (_root, error) => { throw error })
  const operations = reopened.queries.operations(restored, session.id)
  assert(operations.some(op => op.phase === 'recovery_parked'))
  const events = reopened.queries.events(restored, { sessionId: session.id })
  assert.equal(events.filter(event => event.type === 'tool_dispatch_committed').length, 1)
  assert.equal(events.filter(event => event.type === 'tool_outcome_committed').length, 0)
  run.json('restored-runtime.json', { operations, events }); await reopened.close(); checks.push('restored-runtime-start-parks-unknown-effect-without-replay')
  assert.throws(() => restoreWorkspaceBackup(backup, restored), /not empty/); checks.push('existing-target-refused')
  for (const mutation of ['checksum', 'path-escape', 'duplicate'] as const) {
    const corrupt = join(run.directory, mutation); cpSync(backup, corrupt, { recursive: true })
    const bad = structuredClone(manifest)
    if (mutation === 'checksum') writeFileSync(join(corrupt, manifest.files[0]!.path), 'corrupt')
    else { bad.files[0]!.path = mutation === 'path-escape' ? '../original/config.json' : bad.files[1]!.path; writeFileSync(join(corrupt, 'manifest.json'), JSON.stringify(bad)) }
    assert(!verifyWorkspaceBackup(corrupt).ok); assert.throws(() => restoreWorkspaceBackup(corrupt, join(run.directory, 'must-not-exist')))
    assert(!existsSync(join(run.directory, 'must-not-exist'))); checks.push(`refuse-${mutation}`)
  }
  const interrupted = join(run.directory, 'interrupted'); mkdirSync(interrupted); writeFileSync(join(interrupted, 'keep.txt'), 'keep')
  const child = Bun.spawn([process.execPath, import.meta.path, '--interrupt', backup, interrupted], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 15_000)
  try { const reader = child.stdout.getReader(), first = await reader.read(); assert(new TextDecoder().decode(first.value).includes('staging-written')); child.kill(9); assert.notEqual(await child.exited, 0) }
  finally { clearTimeout(timer); child.kill() }
  assert.equal(readFileSync(join(interrupted, 'keep.txt'), 'utf8'), 'keep'); checks.push('process-termination-before-swap-preserves-target')
  for (const file of manifest.files) assert.equal(hash(join(workspace, file.path)), originalHashes[file.path])
  checks.push('original-workspace-unchanged')
  run.json('workspace-recovery.json', { checks, fixture: 'synthetic desktop-native session + attachment + artifact revisions/checkout + config + persisted T1', manifest, originalHashes })
  run.complete(checks, ['External content roots and global credential/config stores are outside a workspace backup. Historical Runtime payload paths remain historical facts. Native UI acceptance is a separate production-build workflow.'])
})
