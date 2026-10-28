#!/usr/bin/env bun
/** Real export/import through SessionManager; no live provider or user workspace. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-transfer', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/storage')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { createSession, loadSession, saveSession, getSessionPath, sessionPersistenceQueue } = await import('../../packages/shared/src/sessions/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const workspaces = ['source', 'target'].map(id => ({ id, slug: id, name: id, createdAt: 1, rootPath: join(run.directory, id) }))
  for (const workspace of workspaces) {
    mkdirSync(workspace.rootPath, { recursive: true })
    createWorkspaceAtPath(workspace.rootPath, workspace.name, { permissionMode: 'ask' })
  }
  const [source, target] = workspaces as [typeof workspaces[number], typeof workspaces[number]]
  saveConfig({ workspaces, activeWorkspaceId: source.id, activeSessionId: null })
  const stored = await createSession(source.rootPath, { name: 'Portable fixture', permissionMode: 'ask' })
  const sourceDir = getSessionPath(source.rootPath, stored.id)
  const filePath = join(sourceDir, 'attachments/input.txt')
  writeFileSync(filePath, 'portable fixture bytes')
  mkdirSync(join(sourceDir, '.pi-sessions'), { recursive: true })
  writeFileSync(join(sourceDir, '.pi-sessions/fixture.jsonl'), '{"type":"session","id":"fixture-sdk"}\n')
  await saveSession({ ...loadSession(source.rootPath, stored.id)!, description: 'Planning description', acceptanceCriteria: 'Preserved across transfer',
    progress: 25, dueAt: '2026-11-01', activePlugin: 'fixture-plugin', isArchived: true,
    messages: [{ id: 'file-input', type: 'user', content: `Read ${filePath.replaceAll('\\', '/')}`, timestamp: 1,
      durableSeq: 9000, durableOperationId: 'source-workspace-run' }] })
  const sourceRuntime = createDurableRuntime(), runtime = createDurableRuntime(), sourceManager = new SessionManager(sourceRuntime)
  ;(sourceManager as unknown as { loadSessionsFromDisk(): void }).loadSessionsFromDisk()
  // A separate receiving server has no in-memory source Session, but resolves the same fixture workspace config.
  const manager = new SessionManager(runtime)
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  try {
    const bundle = await sourceManager.exportSession(stored.id, source.id)
    assert(bundle)
    await scene('portable-bundle-and-native-journal', async () => {
      assert(bundle.session.messages[0]!.content.includes('{{SESSION_PATH}}'))
      assert(bundle.files.some(file => file.relativePath === '.pi-sessions/fixture.jsonl'))
    })
    const sourceHash = createHash('sha256').update(readFileSync(filePath)).digest('hex')
    const transferred = await manager.importSession(target.id, bundle, 'move')
    renameSync(sourceDir, `${sourceDir}-unavailable`)
    await scene('move-with-source-unavailable', async () => {
      const session = (await manager.getSession(transferred.sessionId))!
      const expected = join(getSessionPath(target.rootPath, session.id), 'attachments/input.txt')
      assert(session.messages[0]!.content.includes(expected.replaceAll('\\', '/')))
      assert.equal(createHash('sha256').update(readFileSync(expected)).digest('hex'), sourceHash)
      assert.equal(session.description, 'Planning description')
      assert.equal(session.acceptanceCriteria, 'Preserved across transfer')
      assert.equal(session.progress, 25)
      assert.equal(session.dueAt, '2026-11-01')
      assert.equal(session.activePlugin, 'fixture-plugin')
      assert.equal(session.isArchived, true)
    })
    await scene('imported-history-is-context-not-execution-evidence', async () => {
      const session = (await manager.getSession(transferred.sessionId))!
      assert.notEqual(session.messages[0]!.durableSeq, 9000)
      const events = runtime.queries.events(target.rootPath, { sessionId: session.id })
      assert(events.some(event => event.type === 'legacy_context_imported'))
      assert(!events.some(event => event.type === 'tool_dispatch_committed' || event.type === 'model_dispatch_committed'))
      assert(runtime.queries.getCanonicalModelContext(target.rootPath, session.id).items.some(item => item.kind === 'user'))
    })
    await scene('failed-import-leaves-no-partial-session', async () => {
      const before = readdirSync(join(target.rootPath, 'sessions')).sort()
      const invalid = { ...bundle, files: [...bundle.files, { relativePath: '../escape.txt', contentBase64: '', size: 0 }] }
      await assert.rejects(manager.importSession(target.id, invalid, 'fork'))
      assert.deepEqual(readdirSync(join(target.rootPath, 'sessions')).sort(), before)
      assert(!existsSync(join(target.rootPath, 'escape.txt')))
    })
    await scene('legacy-absolute-path-bundle', async () => {
      const legacy = { ...bundle, session: { ...bundle.session, messages: bundle.session.messages.map(message => ({
        ...message, content: `Read ${filePath.replaceAll('\\', '/')}` })) } }
      const imported = await manager.importSession(target.id, legacy, 'fork')
      const session = (await manager.getSession(imported.sessionId))!
      assert(session.messages[0]!.content.includes(getSessionPath(target.rootPath, session.id).replaceAll('\\', '/')))
    })
    run.json('transfer.json', { checks, failures, sourceHash, transferred, bundleFiles: bundle.files.map(({ relativePath, size }) => ({ relativePath, size })) })
    assert.deepEqual(failures, [])
    run.complete(checks, ['live Pi SDK resume on a different host', 'native Linux filesystem semantics'])
  } finally { await sessionPersistenceQueue.flushAll(); await runtime.close(); await sourceRuntime.close() }
})
