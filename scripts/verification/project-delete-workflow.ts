import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'
import { holdFileAgainstReplacement } from './fixtures/file-read-lease'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Fixed before moving project deletion: the successful RPC must clear both
// cached/durable references; later Session saves must not resurrect a removed
// project. Real replacement/delete failures retain a retryable project, and
// only the final committed deletion may emit the absent project list.
await verificationWorkflow('project-delete', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('@phaneris/shared/config/repository')
  const { createWorkspaceAtPath } = await import('@phaneris/shared/workspaces/storage')
  const { createProject, loadProject, getProjectPath } = await import('@phaneris/shared/projects')
  const { loadSession, getSessionFilePath, createSession: createStoredSession } = await import('@phaneris/shared/sessions')
  const { loadPageConfig } = await import('@phaneris/shared/pages')
  const { SessionManager } = await import('@phaneris/server-core/sessions')
  const { createDurableRuntime } = await import('@phaneris/server-core/durable-runtime')
  const { WsRpcServer } = await import('@phaneris/server-core/transport')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { registerProjectsHandlers } = await import('../../packages/server-core/src/handlers/rpc/projects')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { OAuthFlowStore } = await import('@phaneris/shared/auth')
  const { RPC_CHANNELS: c } = await import('@phaneris/shared/protocol')
  const workspaces = ['alpha', 'beta'].map(id => ({ id, name: id, slug: id, rootPath: join(run.directory, id), createdAt: 1 }))
  for (const ws of workspaces) createWorkspaceAtPath(ws.rootPath, ws.name)
  const ws = workspaces[0]!, beta = workspaces[1]!
  saveConfig({ workspaces, activeWorkspaceId: ws.id, activeSessionId: null })
  const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0 }), pushed: Array<{ channel: string; args: unknown[] }> = []
  const push = server.push.bind(server)
  let failNextProjectNotification = false
  server.push = (channel, target, ...args) => {
    if (channel === c.projects.CHANGED && failNextProjectNotification) { failNextProjectNotification = false; throw new Error('Fixture notification unavailable after commit') }
    pushed.push({ channel, args }); push(channel, target, ...args)
  }
  manager.setRpcServer(server); manager.setEventSink((channel, target, ...args) => server.push(channel, target, ...args))
  registerProjectsHandlers(server, { sessionManager: manager, oauthFlowStore, platform: createHeadlessPlatform() } satisfies HandlerDeps)
  await manager.initialize(); await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: ws.id }); await client.connect()
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    const project = createProject(ws.rootPath, { name: 'Delete cache fixture' }), other = createProject(ws.rootPath, { name: 'Retain other project' })
    const session = await manager.createSession(ws.id, { name: 'Retain this conversation', projectId: project.id })
    const unrelated = await manager.createSession(ws.id, { name: 'Other project', projectId: other.id })
    const page = await manager.getWorkspacePages(ws.id).create({ name: 'Keep page', projectId: project.id, content: '<p>Retain page bytes</p>' })
    const foreignProject = createProject(beta.rootPath, { name: 'Other workspace' })
    const foreign = await manager.createSession(beta.id, { name: 'Foreign conversation', projectId: foreignProject.id })
    await scene('delete-ack-clears-live-and-durable-session-and-page-references', async () => {
      await client.invoke(c.projects.DELETE, ws.id, project.slug)
      assert.equal(loadProject(ws.rootPath, project.slug), null)
      assert.equal(loadSession(ws.rootPath, session.id)?.projectId, undefined)
      assert.equal(manager.getSessions(ws.id).find(row => row.id === session.id)?.projectId, undefined)
      assert.equal(loadPageConfig(ws.rootPath, page.slug)?.projectId, undefined)
    })
    await scene('later-session-save-cannot-resurrect-the-deleted-project', async () => {
      await manager.renameSession(session.id, 'Renamed after deletion')
      assert.equal(loadSession(ws.rootPath, session.id)?.projectId, undefined)
      assert.equal((await manager.getSession(session.id))?.projectId, undefined)
    })
    await scene('unrelated-projects-and-workspaces-keep-their-bindings', async () => {
      assert.equal((await manager.getSession(unrelated.id))?.projectId, other.id)
      assert.equal((await manager.getSession(foreign.id))?.projectId, foreignProject.id)
      assert(loadProject(beta.rootPath, foreignProject.slug))
    })
    await scene('missing-project-keeps-the-legacy-void-result', async () => {
      assert.equal(await client.invoke(c.projects.DELETE, ws.id, 'absent-project'), undefined)
    })
    await scene('postcommit-notification-failure-does-not-report-deletion-as-failed', async () => {
      const p = createProject(ws.rootPath, { name: 'Notification failure' })
      failNextProjectNotification = true
      try { assert.equal(await client.invoke(c.projects.DELETE, ws.id, p.slug), undefined); assert.equal(loadProject(ws.rootPath, p.slug), null) }
      finally { failNextProjectNotification = false }
    })
    await scene('sessions-created-outside-this-host-after-startup-are-also-unbound', async () => {
      const p = createProject(ws.rootPath, { name: 'External session' })
      const external = await createStoredSession(ws.rootPath, { name: 'External cold conversation', projectId: p.id })
      assert(!manager.getSessions(ws.id).some(row => row.id === external.id))
      await client.invoke(c.projects.DELETE, ws.id, p.slug)
      assert.equal(loadSession(ws.rootPath, external.id)?.projectId, undefined)
    })
    await scene('external-project-reassignment-is-preserved-and-cache-converges', async () => {
      const p = createProject(ws.rootPath, { name: 'Old external binding' })
      const s = await manager.createSession(ws.id, { projectId: p.id })
      await manager.flushAllSessions()
      const file = getSessionFilePath(ws.rootPath, s.id), bytes = readFileSync(file, 'utf8'), newline = bytes.indexOf('\n')
      writeFileSync(file, JSON.stringify({ ...JSON.parse(bytes.slice(0, newline)), projectId: other.id }) + bytes.slice(newline))
      await client.invoke(c.projects.DELETE, ws.id, p.slug)
      assert.equal(loadSession(ws.rootPath, s.id)?.projectId, other.id)
      assert.equal(manager.getSessions(ws.id).find(row => row.id === s.id)?.projectId, other.id)
    })
    if (process.platform === 'win32') {
      await scene('project-assignment-failure-retains-both-live-and-durable-binding', async () => {
        await manager.flushAllSessions()
        const file = getSessionFilePath(ws.rootPath, unrelated.id)
        const release = await holdFileAgainstReplacement(file, run.directory)
        const before = readFileSync(file)
        try {
          await assert.rejects(manager.setSessionProjectId(unrelated.id, null), /EPERM|EBUSY|access|permitted|locked/i)
          assert.equal(manager.getSessions(ws.id).find(row => row.id === unrelated.id)?.projectId, other.id)
          assert.deepEqual(readFileSync(file), before)
        } finally { await release() }
        await manager.setSessionProjectId(unrelated.id, null)
        assert.equal(loadSession(ws.rootPath, unrelated.id)?.projectId, undefined)
      })
      await scene('page-unbind-failure-retains-project-and-retries-without-stale-cache', async () => {
        const p = createProject(ws.rootPath, { name: 'Page failure' }), s = await manager.createSession(ws.id, { projectId: p.id })
        const page = await manager.getWorkspacePages(ws.id).create({ name: 'Blocked page', projectId: p.id, content: '<p>Retain content</p>' })
        const release = await holdFileAgainstReplacement(join(ws.rootPath, 'pages', page.slug, 'page.json'), run.directory)
        try {
          await assert.rejects(client.invoke(c.projects.DELETE, ws.id, p.slug), /EPERM|EBUSY|access|permitted|locked/i)
          assert(loadProject(ws.rootPath, p.slug)); assert.equal((await manager.getSession(s.id))?.projectId, undefined)
        } finally { await release() }
        await client.invoke(c.projects.DELETE, ws.id, p.slug)
        assert.equal(loadProject(ws.rootPath, p.slug), null); assert.equal(loadPageConfig(ws.rootPath, page.slug)?.projectId, undefined)
      })
      await scene('project-directory-delete-failure-can-be-retried-after-unbinding', async () => {
        const p = createProject(ws.rootPath, { name: 'Project file failure' }), s = await manager.createSession(ws.id, { projectId: p.id })
        const release = await holdFileAgainstReplacement(join(getProjectPath(ws.rootPath, p.slug), 'config.json'), run.directory)
        try {
          await assert.rejects(client.invoke(c.projects.DELETE, ws.id, p.slug), /EPERM|EBUSY|access|permitted|locked/i)
          assert(loadProject(ws.rootPath, p.slug)); assert.equal((await manager.getSession(s.id))?.projectId, undefined)
        } finally { await release() }
        await client.invoke(c.projects.DELETE, ws.id, p.slug); assert.equal(loadProject(ws.rootPath, p.slug), null)
      })
    }
    run.json('scenarios.json', { checks, failures, pushed })
    assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Windows real share-mode I/O failures; POSIX replacement semantics require a platform-specific fault.', 'All product resources and deletions are confined to this isolated run directory.'])
  } finally { client.destroy(); await server.close(); await manager.cleanup() }
})
