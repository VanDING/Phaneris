import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { verificationWorkflow } from './verification-artifacts'
import type { StoredSession } from '../../packages/shared/src/sessions/types'
import type { SqliteDatabase } from '../../packages/server-core/src/durable-runtime/sqlite-driver'

// Cases are defined before product changes in project-governance-failure-matrix-2026-10-16.md.
await verificationWorkflow('project-governance-storage', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveSession, listSessions, loadSession, sessionPersistenceQueue } = await import('../../packages/shared/src/sessions')
  const { readSessionHeader, readSessionHeaderAsync, createSessionHeader } = await import('../../packages/shared/src/sessions/jsonl')
  const { SessionManager, createManagedSession } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { DurableRuntimeStore } = await import('../../packages/server-core/src/durable-runtime/store')
  const checks: Array<{ id: string; pass: boolean; error?: string }> = []
  const check = async (id: string, action: () => unknown | Promise<unknown>) => {
    try { await action(); checks.push({ id, pass: true }) }
    catch (error) { checks.push({ id, pass: false, error: String(error) }) }
    run.json('checks.json', checks)
  }
  const workspaceRoot = join(run.directory, 'headers')
  const session = (id: string): StoredSession => ({
    id, workspaceRootPath: workspaceRoot, createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'message', type: 'user', content: 'Preserved transcript', timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  })

  await check('H01-long-description-and-transfer-remain-listed', async () => {
    for (const [id, extra] of [
      ['short', { description: 'short' }],
      ['long-description', { description: '测'.repeat(3000) }],
      ['long-transfer', { transferredSessionSummary: '测'.repeat(3000) }],
    ] as const) {
      const data = { ...session(id), ...extra }
      await saveSession(data)
      const path = join(workspaceRoot, 'sessions', id, 'session.jsonl')
      assert.equal(readSessionHeader(path)?.id, id)
      assert.equal((await readSessionHeaderAsync(path))?.id, id)
      assert.equal(loadSession(workspaceRoot, id)?.messages[0]?.content, 'Preserved transcript')
    }
    assert.deepEqual(listSessions(workspaceRoot).map(item => item.id).sort(), ['long-description', 'long-transfer', 'short'])
  })
  await check('H02-boundaries-utf8-and-no-newline', async () => {
    for (const size of [8191, 8192, 8193, 32768]) {
      const header = { ...createSessionHeader(session('boundary')), description: '' }
      header.description = 'a'.repeat(size - Buffer.byteLength(JSON.stringify(header)))
      const line = JSON.stringify(header)
      assert.equal(Buffer.byteLength(line), size)
      for (const suffix of ['', '\n' + JSON.stringify({ type: 'user', content: 'x'.repeat(1024 * 1024) })]) {
        const file = join(run.directory, 'header-boundary.jsonl')
        writeFileSync(file, line + suffix)
        assert.deepEqual(readSessionHeader(file), await readSessionHeaderAsync(file))
        assert.equal(readSessionHeader(file)?.description, header.description)
      }
    }
    const header = { ...createSessionHeader(session('utf8')), description: 'a'.repeat(8000) + '测'.repeat(3000) }
    const file = join(run.directory, 'header-utf8.jsonl')
    writeFileSync(file, JSON.stringify(header) + '\n')
    assert.equal(readSessionHeader(file)?.description, header.description)
    assert.equal((await readSessionHeaderAsync(file))?.description, header.description)
  })
  await check('H03-invalid-and-missing-header-keep-null-contract', async () => {
    const file = join(run.directory, 'invalid.jsonl')
    writeFileSync(file, '{broken\n' + JSON.stringify(createSessionHeader(session('not-a-header'))))
    for (const path of [file, run.directory, join(run.directory, 'missing.jsonl')]) {
      assert.equal(readSessionHeader(path), null)
      assert.equal(await readSessionHeaderAsync(path), null)
    }
  })

  const manager = new SessionManager()
  // Setup/observation only: all operations under test use the production manager and queue.
  const internals = manager as unknown as {
    registerManagedSession(value: ReturnType<typeof createManagedSession>): void
    enqueuePersist(value: ReturnType<typeof createManagedSession>): void
    sessions: Map<string, ReturnType<typeof createManagedSession>>
  }
  const workspace = { id: 'governance-storage', slug: 'synthetic', name: 'Synthetic', rootPath: join(run.directory, 'deletion'), createdAt: 1 }
  const deleted: string[] = []
  manager.setEventSink((_channel, _target, ...args) => {
    const event = args[0] as { type?: string; sessionId?: string } | undefined
    if (event?.type === 'session_deleted') deleted.push(event.sessionId!)
  })
  async function create(id: string) {
    const managed = createManagedSession({ id, name: id }, workspace, {
      messagesLoaded: true, messages: [{ id: 'message', role: 'assistant', content: 'Synthetic transcript', timestamp: 1 }],
    })
    internals.registerManagedSession(managed)
    internals.enqueuePersist(managed)
    await manager.flushSession(id)
    return managed
  }
  try {
    if (process.platform === 'win32') await check('D01-locked-delete-rejects-without-success-and-retries', async () => {
      const managed = await create('locked')
      const path = join(workspace.rootPath, 'sessions', managed.id, 'session.jsonl')
      const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        "$governanceHandle=[IO.File]::Open($env:PHANERIS_VERIFY_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read); try { [Console]::WriteLine('LOCK_READY'); [Console]::ReadLine() | Out-Null } finally { $governanceHandle.Dispose() }"],
      { env: { ...process.env, PHANERIS_VERIFY_LOCK: path }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      const exited = new Promise<void>((resolve, reject) => {
        locker.once('exit', () => resolve()); locker.once('error', reject)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('File lock helper timed out')), 10000)
          const reader = createInterface({ input: locker.stdout! })
          reader.on('line', line => { if (line === 'LOCK_READY') { clearTimeout(timer); reader.close(); resolve() } })
          locker.once('error', error => { clearTimeout(timer); reject(error) })
          locker.once('exit', () => { clearTimeout(timer); reject(new Error('Lock helper exited before ready')) })
        })
        await assert.rejects(() => manager.deleteSession(managed.id), /delete/i)
        assert(existsSync(path))
        assert(internals.sessions.has(managed.id))
        assert(!deleted.includes(managed.id))
      } finally { locker.stdin!.end('\n'); await exited }
      await manager.deleteSession(managed.id)
      assert(!existsSync(path))
      assert(!internals.sessions.has(managed.id))
      assert.equal(deleted.filter(id => id === managed.id).length, 1)
    })
    await check('D02-inflight-and-pending-writes-settle-before-delete', async () => {
      const managed = await create('inflight')
      managed.messages[0].content = 'large synthetic transcript '.repeat(100000)
      internals.enqueuePersist(managed)
      const writing = manager.flushSession(managed.id)
      await manager.deleteSession(managed.id)
      await writing
      await sessionPersistenceQueue.flush(managed.id)
      assert(!existsSync(join(workspace.rootPath, 'sessions', managed.id)))
      const pending = await create('pending')
      internals.enqueuePersist(pending)
      await manager.deleteSession(pending.id)
      assert(!sessionPersistenceQueue.hasPending(pending.id))
      assert(!existsSync(join(workspace.rootPath, 'sessions', pending.id)))
    })
    await check('D03-repeat-delete-notifies-once', async () => {
      const managed = await create('repeat')
      await manager.deleteSession(managed.id)
      await manager.deleteSession(managed.id)
      assert.equal(deleted.filter(id => id === managed.id).length, 1)
    })
  } finally { await manager.cleanup() }

  await check('U01-file-sqlite-replay-conflict-and-rollback', () => {
    const store = new DurableRuntimeStore(join(run.directory, 'runtime'))
    try {
      const usage = { usageId: 'usage', operationId: 'operation', sessionId: 'session', createdAt: 1,
        provider: 'fixture', model: 'fixture', inputTokens: 0, costUsd: 0, payload: { b: 2, a: 1 } }
      store.commitFactsAndUsage({ events: [], usage: [usage] })
      store.commitFactsAndUsage({ events: [], usage: [{ ...usage, payload: { a: 1, b: 2 } }] })
      assert.equal(store.listUsage().length, 1)
      assert.throws(() => store.commitFactsAndUsage({ events: [{
        eventId: 'rollback-fact', sessionId: 'session', operationId: 'operation', type: 'user_message_committed',
        schemaVersion: 1, modelVisible: true, partial: false, payload: { content: 'Must roll back' }, createdAt: 2,
      }], usage: [
        { ...usage, usageId: 'rollback' }, { ...usage, costUsd: 1 },
      ] }), /different content/)
      assert.equal(store.listUsage().length, 1)
      assert.equal(store.listEvents().length, 0)
    } finally { store.close() }
  })
  await check('U02-new-usage-never-enumerates-history', () => {
    const store = new DurableRuntimeStore(join(run.directory, 'runtime-indexed'))
    try {
      const db = (store as unknown as { db: SqliteDatabase }).db
      const insert = db.prepare('INSERT INTO usage_ledger (usage_id,operation_id,session_id,payload_json,created_at) VALUES (?,?,?,?,?)')
      db.transaction(() => {
        for (let i = 0; i < 1000; i++) insert.run('seed-' + i, 'operation', 'history', '{"fixture":true}', i)
      })()
      const list = store.listUsage.bind(store)
      let enumerations = 0
      store.listUsage = (...args) => { enumerations++; return list(...args) }
      const usage = { usageId: 'new', operationId: 'new', sessionId: 'new', createdAt: 1001 }
      store.commitFactsAndUsage({ events: [], usage: [usage] })
      store.commitFactsAndUsage({ events: [], usage: [usage] })
      assert.equal(list({ sessionId: 'new' }).length, 1)
      assert.equal(enumerations, 0, 'Inserts and idempotent replay must not call the full-history reader')
    } finally { store.close() }
  })
  run.json('checks.json', checks)
  assert(checks.every(check => check.pass), JSON.stringify(checks.filter(check => !check.pass)))
  run.complete(checks.map(check => check.id), process.platform === 'win32'
    ? ['Other operating systems', 'Live user sessions', 'Signed release']
    : ['Windows file-lock deletion', 'Live user sessions', 'Signed release'])
})
