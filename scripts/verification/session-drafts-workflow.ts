#!/usr/bin/env bun
/** Real RPC handlers + SessionManager + old/new draft files, with isolated config/workspaces. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('session-drafts', async run => {
  const config = join(run.directory, 'config')
  process.env.PHANERIS_CONFIG_DIR = config
  const { saveConfig } = await import('../../packages/shared/src/config/storage')
  const legacy = await import('../../packages/shared/src/config/drafts')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { getSessionPath } = await import('../../packages/shared/src/sessions/storage')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { registerSettingsHandlers } = await import('../../packages/server-core/src/handlers/rpc/settings')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const workspaces = ['one', 'two'].map(id => ({ id, slug: id, name: id, createdAt: 1, rootPath: join(run.directory, id) }))
  for (const workspace of workspaces) {
    mkdirSync(workspace.rootPath, { recursive: true })
    createWorkspaceAtPath(workspace.rootPath, workspace.name, { permissionMode: 'ask' })
  }
  saveConfig({ workspaces, activeWorkspaceId: 'one', activeSessionId: null })
  const manager = new SessionManager()
  // Fixture bootstrap is complete; no live account/provider initialization is needed.
  ;(manager as unknown as { initGate: { markReady(): void } }).initGate.markReady()
  const handlers = new Map<string, (ctx: { workspaceId?: string }, ...args: unknown[]) => Promise<unknown>>()
  registerSettingsHandlers({ handle: (channel: string, handler: never) => handlers.set(channel, handler) } as never,
    { sessionManager: manager } as never)
  const call = (channel: string, workspaceId: string | undefined, ...args: unknown[]) => handlers.get(channel)!({ workspaceId }, ...args)
  const checks: string[] = []
  try {
    const session = await manager.createSession('one', { name: 'Legacy draft owner' })
    const root = workspaces[0]!.rootPath, dir = getSessionPath(root, session.id)
    const draft = { text: 'Legacy draft', attachments: [{ name: 'pasted.txt', path: 'pasted.txt',
      content: { type: 'text' as const, mimeType: 'text/plain', size: 5, text: 'hello' } }] }
    legacy.setSessionDraft(session.id, draft)
    const oldBytes = readFileSync(join(config, 'drafts.json'), 'utf8')
    assert.deepEqual(await call(RPC_CHANNELS.drafts.GET, 'one', session.id), draft)
    assert(existsSync(join(dir, 'draft.json')), 'Read must migrate the old draft into its Session')
    assert.equal(legacy.getSessionDraft(session.id), null, 'Migrated entry must not resurrect after deletion')
    assert(readdirSync(join(config, 'drafts-backups')).some(file => readFileSync(join(config, 'drafts-backups', file), 'utf8') === oldBytes))
    checks.push('legacy-draft-migration-with-exact-backup')
    const blocked = await manager.createSession('one', { name: 'Failed migration fixture' })
    legacy.setSessionDraft(blocked.id, { text: 'Do not lose this legacy draft' })
    const blockedPath = join(getSessionPath(root, blocked.id), 'draft.json')
    mkdirSync(blockedPath)
    const beforeFailure = readFileSync(join(config, 'drafts.json'), 'utf8')
    await assert.rejects(call(RPC_CHANNELS.drafts.GET, 'one', blocked.id))
    assert.equal(readFileSync(join(config, 'drafts.json'), 'utf8'), beforeFailure)
    rmdirSync(blockedPath) // Only the empty blocking directory created by this fixture.
    assert.equal((await call(RPC_CHANNELS.drafts.GET, 'one', blocked.id) as { text: string }).text, 'Do not lose this legacy draft')
    await manager.deleteSession(blocked.id)
    checks.push('failed-draft-migration-preserves-legacy-and-retries')
    assert.deepEqual(await call(RPC_CHANNELS.drafts.GET_ALL, 'two'), {})
    await assert.rejects(call(RPC_CHANNELS.drafts.GET, 'two', session.id))
    checks.push('workspace-scoped-rpc')
    await call(RPC_CHANNELS.drafts.SET, 'one', session.id, { text: 'Session-owned draft' })
    assert.equal((await call(RPC_CHANNELS.drafts.GET, 'one', session.id) as { text: string }).text, 'Session-owned draft')
    const bundle = await manager.exportSession(session.id, 'one')
    assert(bundle?.files.some(file => file.relativePath === 'draft.json'))
    checks.push('session-draft-follows-export')
    await call(RPC_CHANNELS.drafts.DELETE, 'one', session.id)
    assert.equal(await call(RPC_CHANNELS.drafts.GET, 'one', session.id), null)
    checks.push('cleared-draft-does-not-resurrect')
    await call(RPC_CHANNELS.drafts.SET, 'one', session.id, draft)
    await manager.deleteSession(session.id)
    assert(!existsSync(dir))
    assert.deepEqual(await call(RPC_CHANNELS.drafts.GET_ALL, 'one'), {})
    await assert.rejects(call(RPC_CHANNELS.drafts.SET, 'one', session.id, draft))
    checks.push('deleted-session-cannot-be-recreated-by-draft-write')
    run.json('drafts.json', { checks, sessionId: session.id, backups: readdirSync(join(config, 'drafts-backups')) })
    run.complete(checks, ['live renderer composer hydration'])
  } finally { await manager.cleanup() }
})
