import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS, type Session } from '@craft-agent/shared/protocol'
import { SessionReadStore } from '../../handlers/rpc/session-read-store'
import { readSessionSnapshot } from '../session-read-client'
import type { RpcClient } from '../types'

const ctx = { clientId: 'client', workspaceId: 'workspace', webContentsId: null }
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'session-read-test-'))
  dirs.push(dir)
  const store = new SessionReadStore({ tempDir: dir, ...options })
  const session = { id: 's', workspaceId: 'workspace', messages: Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, role: 'assistant', content: '中文长消息'.repeat(100), timestamp: i, promptSnapshot: 'system'.repeat(100), contextSnapshot: { tools: [{ name: 'tool' }] } })) } as unknown as Session
  const invoke = async (channel: string, ...args: any[]) => {
    if (channel === RPC_CHANNELS.sessions.CLOSE_MESSAGES_READ) return store.close(ctx, args[0], args[1])
    return args[1] ? store.read(ctx, args[0], args[1].readId, args[1].offset) : store.start(ctx, session)
  }
  return { dir, store, session, client: { invoke } as Pick<RpcClient, 'invoke'> }
}
it('round trips long records and split UTF-8, cleaning the immutable lease', async () => {
  const { dir, session, client } = fixture({ chunkBytes: 67 })
  expect(await readSessionSnapshot(client, 's')).toEqual(session)
  expect(readdirSync(dir)).toEqual([])
})
it('freezes records across reads and enforces owner, workspace and offsets', async () => {
  const { store, session } = fixture({ chunkBytes: 67 })
  const first = await store.start(ctx, session)
  session.messages[0]!.content = 'changed'
  await expect(store.read({ ...ctx, clientId: 'other' }, 's', first.readId, first.nextOffset)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  await expect(store.read({ ...ctx, workspaceId: 'other' }, 's', first.readId, first.nextOffset)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  await expect(store.read(ctx, 's', first.readId, -1)).rejects.toThrow('offset')
  const chunks = [first.data]
  let current = first
  while (!current.done) { current = await store.read(ctx, 's', first.readId, current.nextOffset); chunks.push(current.data) }
  expect(Buffer.concat(chunks).toString()).not.toContain('changed')
  await store.closeForClient(ctx.clientId)
  await expect(store.read(ctx, 's', first.readId, 0)).rejects.toMatchObject({ code: 'TRANSFER_TIMEOUT' })
})
it('releases capacity after budget failures', async () => {
  const { store, session, dir } = fixture({ maxBytes: 100 })
  for (let i = 0; i < 3; i++) await expect(store.start(ctx, session)).rejects.toThrow('budget')
  expect(readdirSync(dir)).toEqual([])
})
it('rejects corrupt chunk progress and closes the lease', async () => {
  const { client, dir } = fixture({ chunkBytes: 67 })
  const invoke = client.invoke.bind(client)
  client.invoke = (async (channel: string, ...args: any[]) => {
    const result: any = await invoke(channel, ...args)
    return channel === RPC_CHANNELS.sessions.READ_MESSAGES ? { ...result, nextOffset: 0 } : result
  }) as RpcClient['invoke']
  await expect(readSessionSnapshot(client, 's')).rejects.toMatchObject({ code: 'TRANSFER_VERIFICATION_FAILED' })
  expect(readdirSync(dir)).toEqual([])
})
it('does not publish partial sessions after an interrupted read', async () => {
  const { client, dir } = fixture({ chunkBytes: 67 })
  const invoke = client.invoke.bind(client)
  client.invoke = (async (channel: string, ...args: any[]) => {
    if (channel === RPC_CHANNELS.sessions.READ_MESSAGES && args[1]) throw new Error('interrupted')
    return invoke(channel, ...args)
  }) as RpcClient['invoke']
  await expect(readSessionSnapshot(client, 's')).rejects.toThrow('interrupted')
  expect(readdirSync(dir)).toEqual([])
})
it('expires abandoned leases and releases their files', async () => {
  const { store, session, dir } = fixture({ ttlMs: 10 })
  const first = await store.start(ctx, session)
  await new Promise(resolve => setTimeout(resolve, 80))
  await expect(store.read(ctx, 's', first.readId, 0)).rejects.toMatchObject({ code: 'TRANSFER_TIMEOUT' })
  expect(readdirSync(dir)).toEqual([])
})
it('falls back only when the new channel is unavailable', async () => {
  const calls: string[] = []
  const legacy = { id: 's', workspaceId: 'workspace', workspaceName: 'Workspace', lastMessageAt: 1, isProcessing: false, messages: [] } as Session
  const client = { invoke: async (channel: string) => { calls.push(channel); if (channel === RPC_CHANNELS.sessions.READ_MESSAGES) throw Object.assign(new Error('old server'), { code: 'CHANNEL_NOT_FOUND' }); return legacy } } as Pick<RpcClient, 'invoke'>
  expect(await readSessionSnapshot(client, 's')).toEqual(legacy)
  expect(calls).toEqual([RPC_CHANNELS.sessions.READ_MESSAGES, RPC_CHANNELS.sessions.GET_MESSAGES])
})
