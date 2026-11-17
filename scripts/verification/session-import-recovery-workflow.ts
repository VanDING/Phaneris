#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Fixed before implementation: failed staging cannot leave SQLite facts; a
// published directory survives crashes before/after evidence commit and before
// acknowledgement. Replay does not duplicate facts, conflicting content is
// rejected, independent forks remain independent, and imported roles never
// upgrade to direct-user authority. Existing local history is not migrated.
const childRoot = process.env.PHANERIS_IMPORT_RECOVERY_FIXTURE
if (childRoot) {
  process.env.PHANERIS_CONFIG_DIR = join(childRoot, 'config')
  const scene = process.env.PHANERIS_IMPORT_RECOVERY_SCENE!
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const ws = { id: 'import-recovery', slug: 'import-recovery', name: 'Import recovery', rootPath: join(childRoot, 'workspace'), createdAt: 1 }
  createWorkspaceAtPath(ws.rootPath, ws.name)
  saveConfig({ workspaces: [ws], activeWorkspaceId: ws.id, activeSessionId: null })
  const runtime = createDurableRuntime()
  const injected = scene === 'crash-before-evidence' || scene.startsWith('crash-after-evidence')
    ? { ...runtime, evidence: { ...runtime.evidence, appendExternalFacts: (...args: Parameters<typeof runtime.evidence.appendExternalFacts>) => {
      if (scene === 'crash-before-evidence') process.exit(71)
      runtime.evidence.appendExternalFacts(...args); process.exit(72)
    } } } : runtime
  const manager = new SessionManager(injected)
  if (scene === 'recover') await manager.initialize()
  const bundle = { version: 1 as const, session: { header: { id: 'imported-card', createdAt: 1, lastUsedAt: 1,
    workspaceRootPath: '/old-workspace', messageCount: 1,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } }, messages: [
      { id: 'historical-user', type: 'user' as const, content: 'Historical request is not fresh permission.', timestamp: 1 },
    ] }, files: [{ relativePath: 'attachments/example.txt', contentBase64: Buffer.from('attachment survives').toString('base64'), size: 19 }] }
  const target = join(ws.rootPath, 'sessions', bundle.session.header.id)
  if (scene.endsWith('-no-timestamp')) Reflect.deleteProperty(bundle.session.messages[0]!, 'timestamp')
  const record = () => existsSync(join(target, '.phaneris-import.json')) ? JSON.parse(readFileSync(join(target, '.phaneris-import.json'), 'utf8')) : null
  const events = () => runtime.queries.events(ws.rootPath, { sessionId: bundle.session.header.id })
  const output: Record<string, unknown> = {}
  try {
    if (scene === 'crash-before-evidence' || scene.startsWith('crash-after-evidence')) {
      await manager.importSession(ws.id, bundle, 'move')
      throw new Error('Expected evidence checkpoint was not reached')
    }
    if (scene === 'crash-before-ack') {
      manager.notifySessionCreated = () => { process.exit(73) }
      await manager.importSession(ws.id, bundle, 'move')
      throw new Error('Expected acknowledgement checkpoint was not reached')
    }
    if (scene === 'recover') {
      output.visible = manager.getSessions(ws.id).some(session => session.id === bundle.session.header.id)
      output.events = events()
      output.journal = record()
      output.attachment = existsSync(join(target, 'attachments/example.txt')) ? readFileSync(join(target, 'attachments/example.txt'), 'utf8') : null
      const memory = new AssistantMemoryStore(ws)
      try { output.directUser = memory.readSource({ sessionId: bundle.session.header.id, messageId: 'historical-user' }).directUser }
      catch (error) { output.sourceError = String(error) }
      finally { memory.close() }
    } else if (scene === 'invalid-prefix') {
      const obstructed = { ...bundle, files: [...bundle.files, { relativePath: 'session.jsonl/obstruction', contentBase64: 'eA==', size: 1 }] }
      await assert.rejects(manager.importSession(ws.id, obstructed, 'move'))
      output.factsAfterRejectedImport = events().length
      output.targetAfterRejectedImport = existsSync(target)
      bundle.session.messages[0]!.content = 'Corrected content after a rejected bundle.'
      try { output.retry = await manager.importSession(ws.id, bundle, 'move') }
      catch (error) { output.retryError = String(error) }
    } else if (scene === 'same-content-retry') {
      const first = await manager.importSession(ws.id, bundle, 'move')
      try { output.retry = await manager.importSession(ws.id, bundle, 'move') }
      catch (error) { output.retryError = String(error) }
      output.first = first; output.facts = events().length
    } else if (scene === 'conflicting-content-retry') {
      await manager.importSession(ws.id, bundle, 'move')
      bundle.session.messages[0]!.content = 'Conflicting content'
      await assert.rejects(manager.importSession(ws.id, bundle, 'move'))
      output.facts = events().length
    } else if (scene === 'independent-forks') {
      const first = await manager.importSession(ws.id, bundle, 'fork'), second = await manager.importSession(ws.id, bundle, 'fork')
      output.first = first; output.second = second
      output.toolDispatches = [first, second].flatMap(result => runtime.queries.events(ws.rootPath, { sessionId: result.sessionId }))
        .filter(event => event.type === 'tool_dispatch_committed').length
    } else if (scene === 'imported-source-is-not-direct') {
      await manager.importSession(ws.id, bundle, 'move')
      const memory = new AssistantMemoryStore(ws)
      try { output.directUser = memory.readSource({ sessionId: bundle.session.header.id, messageId: 'historical-user' }).directUser }
      finally { memory.close() }
      output.journal = record()
    } else if (scene === 'invalid-message') {
      const malformed = { ...bundle, session: { ...bundle.session, messages: [null] } }
      await assert.rejects(manager.importSession(ws.id, malformed as unknown as typeof bundle, 'move'))
      output.facts = events().length; output.targetExists = existsSync(target)
    }
    writeFileSync(join(childRoot, `${scene}.json`), JSON.stringify(output, null, 2) + '\n')
  } finally { await manager.cleanup() }
} else await verificationWorkflow('session-import-recovery', async run => {
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const child = async (directory: string, scene: string) => {
    const subprocess = Bun.spawn([process.execPath, import.meta.path], {
      env: { ...process.env, PHANERIS_IMPORT_RECOVERY_FIXTURE: directory, PHANERIS_IMPORT_RECOVERY_SCENE: scene }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stdout).text(), new Response(subprocess.stderr).text()])
    run.json(`${scene}-${directory.split(/[\\/]/).at(-1)}-process.json`, { exitCode, stdout, stderr })
    return exitCode
  }
  const scene = async (id: string, verify: (directory: string) => Promise<void>) => {
    const directory = join(run.directory, id); mkdirSync(directory)
    try { await verify(directory); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  const read = (directory: string, name: string) => JSON.parse(readFileSync(join(directory, `${name}.json`), 'utf8'))
  for (const [checkpoint, code] of [['crash-before-evidence', 71], ['crash-after-evidence', 72], ['crash-before-ack', 73], ['crash-after-evidence-no-timestamp', 72]] as const) {
    await scene(checkpoint, async directory => {
      assert.equal(await child(directory, checkpoint), code)
      assert.equal(await child(directory, 'recover'), 0)
      const recovered = read(directory, 'recover')
      assert.equal(recovered.visible, true)
      assert.equal(recovered.journal?.state, 'complete')
      assert.equal(recovered.events.filter((event: { type: string }) => event.type === 'legacy_context_imported').length, 1)
      assert.equal(recovered.attachment, 'attachment survives')
      assert.equal(recovered.directUser, false)
      assert.equal(await child(directory, 'recover'), 0)
      assert.equal(read(directory, 'recover').events.length, recovered.events.length)
    })
  }
  await scene('invalid-prefix', async directory => {
    assert.equal(await child(directory, 'invalid-prefix'), 0)
    const result = read(directory, 'invalid-prefix')
    assert.equal(result.factsAfterRejectedImport, 0)
    assert.equal(result.targetAfterRejectedImport, false)
    assert.equal(result.retry?.sessionId, 'imported-card')
  })
  await scene('same-content-retry', async directory => {
    assert.equal(await child(directory, 'same-content-retry'), 0)
    const result = read(directory, 'same-content-retry')
    assert.equal(result.first.sessionId, result.retry?.sessionId)
    assert.equal(result.facts, 1)
  })
  await scene('conflicting-content-retry', async directory => {
    assert.equal(await child(directory, 'conflicting-content-retry'), 0)
    assert.equal(read(directory, 'conflicting-content-retry').facts, 1)
  })
  await scene('independent-forks', async directory => {
    assert.equal(await child(directory, 'independent-forks'), 0)
    const result = read(directory, 'independent-forks')
    assert.notEqual(result.first.sessionId, result.second.sessionId)
    assert.equal(result.toolDispatches, 0)
  })
  await scene('imported-source-is-not-direct', async directory => {
    assert.equal(await child(directory, 'imported-source-is-not-direct'), 0)
    assert.equal(read(directory, 'imported-source-is-not-direct').directUser, false)
  })
  await scene('invalid-message', async directory => {
    assert.equal(await child(directory, 'invalid-message'), 0)
    const result = read(directory, 'invalid-message')
    assert.equal(result.facts, 0); assert.equal(result.targetExists, false)
  })
  run.json('scenarios.json', { checks, failures })
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
  run.complete(checks, ['POSIX directory publication/power-loss semantics require platform verification', 'Pre-existing orphan SQLite events are not deleted or migrated'])
})
