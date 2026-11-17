import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { verificationWorkflow } from './verification-artifacts'

// Only an already consistent, isolated context backup is accepted here. The
// production audit owns the read-only source connection; this run edits its copy.
await verificationWorkflow('resident-work-continuity-production-copy', async run => {
  const source = process.env.PHANERIS_CONTINUITY_CONTEXT_SNAPSHOT
  assert(source, 'Set PHANERIS_CONTINUITY_CONTEXT_SNAPSHOT to the isolated audit directory')
  const root = join(run.directory, 'workspace'), file = join(root, 'context.db')
  assert(resolve(source) !== resolve(root))
  mkdirSync(root, { recursive: true }); copyFileSync(join(source, 'context.db'), file)
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { openSqliteDatabase } = await import('../../packages/server-core/src/runtime/sqlite')
  const { SessionContext } = await import('../../packages/server-core/src/context/session-context')
  const { AssistantMemoryStore } = await import('../../packages/server-core/src/resident-assistant/memory-store')
  const digest = () => {
    const db = openSqliteDatabase(file), result: Record<string, { count: number; hash: string }> = {}
    try {
      for (const table of ['pointers', 'branches', 'associations', 'checkpoints', 'views', 'context_commands']) {
        const hash = createHash('sha256'), rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
        for (const row of rows) hash.update(JSON.stringify(row))
        result[table] = { count: rows.length, hash: hash.digest('hex') }
      }
      return result
    } finally { db.close() }
  }
  const baseline = digest(), db = openSqliteDatabase(file)
  const id = (db.prepare('SELECT workspace_id FROM owner').get() as { workspace_id: string }).workspace_id
  const sessions = (db.prepare('SELECT session_id FROM pointers').all() as Array<{ session_id: string }>).map(row => row.session_id)
  db.close()
  const workspace = { id, rootPath: root }
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, name: 'Isolated production metadata copy', createdAt: 1,
    assistantMemory: { version: 1, learning: 'explicit', use: false } }))
  const memory = new AssistantMemoryStore(workspace)
  try {
    for (const session of sessions) {
      const context = new SessionContext(workspace, session, memory)
      try { assert(!context.get(false).preparation?.state || context.get(false).preparation?.state !== 'ready') }
      finally { context.close() }
    }
    assert.deepEqual(digest(), baseline, 'Opening the copied context must not change existing authority rows')
    run.json('copy-migration-evidence.json', { auditedSessions: sessions.length, baseline, after: digest(), originalRowsPreserved: true, readyPromoted: false })
    run.complete(['WC13-consistent-production-copy-opens-with-existing-authority-rows-preserved', 'WC13-production-copy-never-promotes-old-views-to-ready'],
      ['Production writes and installation', 'Cross-database atomicity', 'Model source material assembly against private production transcripts'])
  } finally { memory.close() }
})
