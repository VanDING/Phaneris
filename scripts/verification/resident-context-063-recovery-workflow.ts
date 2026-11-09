import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-context-063-recovery', async run => {
  const root = mkdtempSync(resolve('.cache/verification/context-063-recovery-'))
  process.env.PHANERIS_CONFIG_DIR = join(root, 'config')
  const workspace = { id: 'recovery', rootPath: join(root, 'workspace') }
  const { saveSession } = await import('@phaneris/shared/sessions')
  const { SessionContext } = await import('../../packages/server-core/src/context/session-context')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const { getSourceReader } = await import('../../packages/server-core/src/context/source-reader')
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }
  const messages = [
    { id: 'a', role: 'user' as const, content: 'CODE_KEEP budget 23; OLD_THREE; preserve ending', timestamp: 1 },
    { id: 'b', role: 'user' as const, content: 'UNRELATED_B_BODY', timestamp: 2 },
    { id: 'correction', role: 'user' as const, content: 'NEW_TWO', timestamp: 3 },
  ]
  const persist = () => saveSession({ id: 'assistant', workspaceRootPath: workspace.rootPath, sessionKind: 'resident_assistant', createdAt: 1, lastUsedAt: 1, tokenUsage: usage,
    messages: messages.map(({ role, ...m }) => ({ ...m, type: role })) })
  await persist()
  mkdirSync(join(workspace.rootPath, 'assistant'), { recursive: true })
  const legacyPath = join(workspace.rootPath, 'assistant', 'context.db'), legacy = openSqliteDatabase(legacyPath)
  legacy.exec('CREATE TABLE topics(session_id TEXT,id TEXT,body TEXT); CREATE TABLE context_state(session_id TEXT,body TEXT); CREATE TABLE segments(id TEXT,run_id TEXT,body TEXT)')
  legacy.prepare('INSERT INTO topics VALUES(?,?,?)').run('assistant', 'legacy-A', JSON.stringify({ id: 'legacy-A', label: 'A', anchors: [], originalInputIds: ['a'], createdAt: 1, updatedAt: 1 }))
  legacy.prepare('INSERT INTO context_state VALUES(?,?)').run('assistant', JSON.stringify({ revision: 1, focus: { label: 'A', topicId: 'legacy-A', anchors: [] } }))
  legacy.close()
  const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const oldHash = digest(legacyPath), scenes: string[] = []
  let memory = new AssistantMemoryStore(workspace), context = new SessionContext(workspace, 'assistant', memory)
  try {
    assert.equal(context.get().focus.topicId, 'legacy-A')
    assert.equal(context.checkpoint('legacy-A'), undefined)
    assert(context.associations('legacy-A').every(ref => ref.unclassified))
    assert.throws(() => context.taskMaterials(['legacy-A']), /legacy_scope_required/)
    context.command({ action: 'associate', branchIds: ['legacy-A'], source: { sessionId: 'assistant', messageId: 'a' }, role: 'requirement' }, messages, 'correction')
    let selection = context.prepare({ cursor: 5, items: [] }, messages, 'first', 'correction')
    assert(JSON.stringify(selection.items).includes('CODE_KEEP'))
    assert(!JSON.stringify(selection).includes('UNRELATED_B_BODY'))
    assert.equal(digest(legacyPath), oldHash)
    scenes.push('C13-isolated-one-time-migration-readonly-legacy-no-fake-checkpoint')
    const offset = messages[0]!.content.indexOf('OLD_THREE')
    context.command({ action: 'associate', branchIds: ['legacy-A'], source: { sessionId: 'assistant', messageId: 'a', quote: 'CODE_KEEP budget 23; OLD_THREE' }, role: 'requirement' }, messages, 'a')
    context.command({ action: 'associate', branchIds: ['legacy-A'], source: { sessionId: 'assistant', messageId: 'correction' }, role: 'requirement',
      supersedes: [{ sessionId: 'assistant', messageId: 'a', range: { offset, end: offset + 9 } }] }, messages, 'correction')
    selection = context.prepare({ cursor: 6, items: [] }, messages, 'corrected', 'b')
    // Force restoring the corrected A material for the fixed current input.
    context.command({ action: 'select', branchIds: ['legacy-A'] }, messages, 'b')
    selection = context.prepare({ cursor: 6, items: [] }, messages, 'corrected', 'b')
    assert(JSON.stringify(selection.items).includes('CODE_KEEP')); assert(JSON.stringify(selection.items).includes('preserve ending'))
    assert(!JSON.stringify(selection.items).includes('OLD_THREE')); assert(JSON.stringify(selection.items).includes('NEW_TWO'))
    scenes.push('C05-partial-requirement-replacement-preserves-other-original-ranges', 'C05-overlapping-reference-cannot-resurrect-superseded-clause')
    context.command({ action: 'checkpoint', requestId: 'cp', branchId: 'legacy-A', conclusions: 'Only the revised requirement applies', unresolved: ['Review'], next: ['Continue'] }, messages)
    const checkpoint = context.checkpoint('legacy-A')!
    assert(checkpoint.coverage.every(c => c.cursor === (c.messageId === 'a' ? 1 : 3)))
    const before = context.get().activeSegment!.id
    // Change a source after a valid committed view. Preparation must fail before
    // moving its recovery pointer, including when that source is checkpointed.
    messages[0]!.content += ' CHANGED_VERSION'; await persist()
    assert.throws(() => context.prepare({ cursor: 9, items: [] }, messages, 'failed-prepare', 'b'), /hash changed|revision_conflict|checkpoint_source_unavailable/i)
    assert.equal(context.get().activeSegment!.id, before)
    scenes.push('C10-preparation-failure-preserves-last-committed-pointer')
    context.close(); memory.close()
    const db = openSqliteDatabase(join(workspace.rootPath, 'context.db'))
    db.exec('BEGIN IMMEDIATE')
    db.prepare("UPDATE pointers SET body=json_set(body,'$.activeSegmentId','uncommitted') WHERE session_id='assistant'").run()
    db.close()
    memory = new AssistantMemoryStore(workspace); context = new SessionContext(workspace, 'assistant', memory)
    assert.equal(context.get().activeSegment!.id, before)
    assert.equal(digest(legacyPath), oldHash)
    scenes.push('C10-uncommitted-pointer-crash-rolls-back-without-replay')
    context.command({ action: 'create', requestId: 'fresh', label: 'Fresh work' }, messages, 'correction')
    const fresh = context.get().focus.topicId!
    context.command({ action: 'create', requestId: 'fresh', label: 'Fresh work' }, messages, 'correction')
    assert.equal(context.get().focus.topicId, fresh)
    assert.throws(() => context.command({ action: 'create', requestId: 'fresh', label: 'Changed retry' }, messages, 'correction'), /conflict/)
    scenes.push('C10-idempotent-create-and-request-content-conflict')
    context.prepare({ cursor: 10, items: [] }, messages, 'forgetting', 'correction')
    const record = memory.mutate({ action: 'remember', requestId: 'm', key: 'm', content: 'NEW_TWO', basis: 'user_stated', kind: 'decision', sources: [{ sessionId: 'assistant', messageId: 'correction' }] })
    context.command({ action: 'checkpoint', requestId: 'forget-cp', branchId: fresh, conclusions: 'Sourced note', unresolved: [], next: [] }, messages)
    memory.mutate({ action: 'transition', requestId: 'forget-m', id: record.record.id, expectedRevision: 1, state: 'forgotten' })
    context.command({ action: 'select', branchIds: [fresh] }, messages, 'b')
    assert.throws(() => context.prepare({ cursor: 11, items: [] }, messages, 'withdrawn', 'b'), /suppressed|forgot|checkpoint_source_unavailable/i)
    scenes.push('C08-forgotten-source-cannot-reenter-through-checkpoint')
    const reader = getSourceReader(workspace.rootPath), beforeRead = reader.metrics()
    reader.read('assistant', 'a'); const afterRead = reader.metrics()
    assert.equal(afterRead.indexScanBytes, beforeRead.indexScanBytes)
    assert.equal(afterRead.decodedRecords - beforeRead.decodedRecords, 1)
    scenes.push('C06-writer-index-survives-atomic-session-rewrite-without-rescan')
    const { createWorkspaceBackup, verifyWorkspaceBackup } = await import('../../packages/server-core/src/services/workspace-backup')
    const backup = join(root, 'backup'); createWorkspaceBackup(workspace.rootPath, backup)
    assert(verifyWorkspaceBackup(backup).ok)
    assert(readFileSync(join(backup, 'context.db')).length > 0)
    scenes.push('C13-backup-includes-context-metadata-and-memory-suppression')
    run.json('recovery-evidence.json', { scenes, root, legacyHash: oldHash, checkpoint, beforeRead, afterRead })
  } finally { context.close(); memory.close() }
  copyFileSync(join(workspace.rootPath, 'context.db'), join(run.directory, 'context.db'))
  run.complete(scenes, ['Model semantic quality (separate live workflow)', 'Multi-host concurrency', 'Real Work migration'])
})
