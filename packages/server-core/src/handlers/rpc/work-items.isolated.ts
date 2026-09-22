import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerWorkItemHandlers } from './work-items'

let workspaceRoot = ''
const workspaceFixture = { id: 'ws-test', name: 'ws-test', rootPath: '' }

mock.module('@phaneris/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === workspaceFixture.id ? workspaceFixture : null),

  migrateRemoteServerTokens: async () => 0,
}))

const context: RequestContext = {
  clientId: 'test-client',
  workspaceId: workspaceFixture.id,
  webContentsId: 1,
}

interface SessionFixture {
  id: string
  name?: string
  preview?: string
  messageCount?: number
  projectId?: string
  sessionStatus?: string
  kanbanColumn?: string
  parentSessionId?: string
  createdAt?: number
  lastMessageAt?: number
  isArchived?: boolean
  hidden?: boolean
  taskDraft?: unknown
}

function createHarness(options?: {
  sessions?: SessionFixture[]
  failRename?: boolean
  createdSession?: SessionFixture
}) {
  const sessions = options?.sessions ?? []
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const calls: string[] = []
  const warnings: unknown[][] = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, _target, ...args) {
      pushes.push({ channel, args })
    },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const sessionManager = {
    async waitForInit() {},
    getSessions: () => sessions,
    async createSession(_workspaceId: string, input: { name?: string }) {
      const created = options?.createdSession ?? { id: 'created-session', name: input.name }
      sessions.push(created)
      calls.push(`create:${input.name ?? ''}`)
      return created
    },
    async renameSession(sessionId: string, title: string) {
      calls.push(`title:${sessionId}:${title}`)
      if (options?.failRename) throw new Error('session mirror failed')
    },
    async setSessionProjectId(sessionId: string, projectId: string | null) {
      calls.push(`project:${sessionId}:${projectId ?? ''}`)
    },
    async setSessionStatus(sessionId: string, statusId: string) {
      calls.push(`status:${sessionId}:${statusId}`)
    },
    async setKanbanColumn(sessionId: string, columnId: string | null) {
      calls.push(`column:${sessionId}:${columnId ?? ''}`)
    },
    async updateSessionPlanning(sessionId: string, patch: Record<string, unknown>) {
      calls.push(`planning:${sessionId}:${Object.keys(patch).sort().join(',')}`)
    },
    async deleteSession(sessionId: string) {
      calls.push(`delete:${sessionId}`)
      const index = sessions.findIndex(({ id }) => id === sessionId)
      if (index >= 0) sessions.splice(index, 1)
    },
  } as unknown as HandlerDeps['sessionManager']
  const deps: HandlerDeps = {
    sessionManager,
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info() {},
        warn: (...args: unknown[]) => warnings.push(args),
        error() {},
        debug() {},
      },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerWorkItemHandlers(server, deps)

  const handler = (channel: string): HandlerFn => {
    const registered = handlers.get(channel)
    if (!registered) throw new Error(`Handler not registered: ${channel}`)
    return registered
  }

  return { sessions, pushes, calls, warnings, handler }
}

describe('work item RPC handlers', () => {
  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'phaneris-work-items-rpc-'))
    workspaceFixture.rootPath = workspaceRoot
  })

  it('projects every visible Session and nothing else', async () => {
    const harness = createHarness({
      sessions: [
        { id: 'legacy', name: 'Legacy task', projectId: 'project-a', sessionStatus: 'todo', createdAt: 10, lastMessageAt: 20 },
        { id: 'child', name: 'Child', parentSessionId: 'legacy' },
        { id: 'archived', name: 'Archived', isArchived: true },
        { id: 'hidden', name: 'Hidden', hidden: true },
        { id: 'draft', name: 'Draft', taskDraft: { title: 'Draft' } },
      ],
    })
    const list = harness.handler(RPC_CHANNELS.workItems.LIST)

    const items = await list(context, workspaceFixture.id)
    expect(items.map((item: { id: string }) => item.id).sort()).toEqual(['child', 'legacy'])
    expect(items.find((item: { id: string }) => item.id === 'legacy')).toMatchObject({
      title: 'Legacy task',
      projectId: 'project-a',
      statusId: 'todo',
      primarySessionId: 'legacy',
      sessionIds: ['legacy'],
    })
  })

  it('projects continuously without writing anything to disk', async () => {
    const harness = createHarness({ sessions: [{ id: 'first', name: 'First' }] })
    const list = harness.handler(RPC_CHANNELS.workItems.LIST)

    expect(await list(context, workspaceFixture.id)).toHaveLength(1)
    harness.sessions.push({ id: 'second', name: 'Second' })
    expect(await list(context, workspaceFixture.id)).toHaveLength(2)

    // The projection is derived from Sessions only: no store, no event log.
    expect(readdirSync(workspaceRoot)).toEqual([])
  })

  it('keeps a Session with no messages of its own (planning without chat)', async () => {
    const harness = createHarness({ sessions: [{ id: 'planned', name: 'Planned task', messageCount: 0 }] })
    const list = harness.handler(RPC_CHANNELS.workItems.LIST)
    const items = await list(context, workspaceFixture.id)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'planned', title: 'Planned task' })
  })

  it('falls back to a trimmed preview for an unnamed Session', async () => {
    const longPreview = 'x'.repeat(400)
    const harness = createHarness({ sessions: [{ id: 'unnamed', preview: longPreview, messageCount: 3 }] })
    const list = harness.handler(RPC_CHANNELS.workItems.LIST)
    const items = await list(context, workspaceFixture.id)
    expect(items[0].title).toHaveLength(240)
  })

  it('creates a Session instead of a standalone record', async () => {
    const harness = createHarness()
    const create = harness.handler(RPC_CHANNELS.workItems.CREATE)

    const item = await create(context, workspaceFixture.id, { title: 'New task' })

    expect(harness.calls).toContain('create:New task')
    expect(item).toMatchObject({ title: 'New task', primarySessionId: 'created-session' })
  })

  it('mirrors only explicitly updated fields in deterministic order', async () => {
    const harness = createHarness({ sessions: [{ id: 'session-1', name: 'Old' }] })
    const update = harness.handler(RPC_CHANNELS.workItems.UPDATE)

    await update(context, workspaceFixture.id, 'session-1', {
      title: 'Linked task',
      projectId: 'project-b',
      statusId: 'done',
      columnId: 'complete',
      startAt: '2026-08-18',
      dueAt: '2026-08-20',
    })

    expect(harness.calls).toEqual([
      'title:session-1:Linked task',
      'project:session-1:project-b',
      'status:session-1:done',
      'column:session-1:complete',
      'planning:session-1:dueAt,startAt',
    ])
  })

  it('rejects an update for a Session that does not exist', async () => {
    const harness = createHarness()
    const update = harness.handler(RPC_CHANNELS.workItems.UPDATE)
    await expect(update(context, workspaceFixture.id, 'missing', { title: 'Nope' })).rejects.toThrow(
      'Session not found: missing',
    )
  })

  it('deletes the backing Session and broadcasts a change', async () => {
    const harness = createHarness({ sessions: [{ id: 'session-1', name: 'Doomed' }] })
    const remove = harness.handler(RPC_CHANNELS.workItems.DELETE)

    await remove(context, workspaceFixture.id, 'session-1')

    expect(harness.calls).toContain('delete:session-1')
    expect(harness.pushes.some(({ channel }) => channel === RPC_CHANNELS.workItems.CHANGED)).toBe(true)
  })
})
