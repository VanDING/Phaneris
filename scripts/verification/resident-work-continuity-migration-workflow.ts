import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// WC13: migrate the real v1 table shape with an old active view, preserving HEAD
// while denying implicit readiness; reject a newer schema without changing it.
await verificationWorkflow('resident-work-continuity-migration', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const workspace = { id: 'legacy', rootPath: join(run.directory, 'workspace') }
  mkdirSync(workspace.rootPath, { recursive: true })
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, name: 'Legacy context fixture', createdAt: 1,
    assistantMemory: { version: 1, learning: 'explicit', use: false } }))
  const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const { SessionContext } = await import('../../packages/server-core/src/context/session-context')
  const file = join(workspace.rootPath, 'context.db'), legacy = openSqliteDatabase(file)
  const pointer = { workspaceId: workspace.id, sessionId: 'assistant', revision: 4, focus: { label: 'Original work', topicId: 'A', anchors: [] },
    selectedBranchIds: ['A'], selectedForInput: 'old-input', activeSegmentId: 'legacy-view' }
  const branch = { id: 'A', sessionId: 'assistant', label: 'Original work', revision: 1, state: 'active', createdAt: 1, updatedAt: 1 }
  legacy.exec(`PRAGMA user_version=1;
    CREATE TABLE pointers(session_id TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE branches(session_id TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session_id,id));
    CREATE TABLE views(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
    CREATE TABLE context_commands(session_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_id TEXT NOT NULL,PRIMARY KEY(session_id,id));`)
  legacy.prepare('INSERT INTO pointers VALUES(?,?)').run('assistant', JSON.stringify(pointer))
  legacy.prepare('INSERT INTO branches VALUES(?,?,?)').run('assistant', 'A', JSON.stringify(branch))
  legacy.prepare('INSERT INTO views VALUES(?,?,?)').run('legacy-view', 'old-run', JSON.stringify({ id: 'legacy-view', runOperationId: 'old-run',
    inputMessageId: 'old-input', dependencies: { sources: [], memories: [] }, branchRevisions: { A: 1 }, requests: [] }))
  legacy.close()
  const memory = new AssistantMemoryStore(workspace), context = new SessionContext(workspace, 'assistant', memory)
  try {
    assert.equal(context.get().focus.topicId, 'A')
    assert.equal(context.get().revision, 4)
    assert(!context.get().preparation)
    assert(!context.get().activeSegment?.preparation)
    assert.throws(() => context.assertBusinessTool({ sessionId: 'assistant', runOperationId: 'old-run', providerToolCallId: 'old-call',
      toolName: 'mcp__session__assistant_delegate', args: {} }), /work_not_prepared/)
    run.json('migration-evidence.json', { pointer: context.get(), branch: context.branch('A') })
  } finally { context.close(); memory.close() }
  const newer = openSqliteDatabase(file)
  assert.equal((newer.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2)
  newer.exec('PRAGMA user_version=3'); newer.close()
  const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex'), before = hash()
  const placeholderMemory = new AssistantMemoryStore(workspace)
  try { assert.throws(() => new SessionContext(workspace, 'assistant', placeholderMemory), /schema_unsupported/) }
  finally { placeholderMemory.close() }
  assert.equal(hash(), before)
  run.complete(['WC13-v1-HEAD-and-view-preserved-without-implicit-readiness', 'WC13-newer-schema-refused-without-context-write'])
})
