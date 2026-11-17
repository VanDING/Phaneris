#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Failure-first wire contract: replay identity, reservation before asynchronous
// writes, write-failure rollback, exclusive commit, abort/TTL mutual exclusion,
// retained completion, distinct user transfers, and client-owned transport choice.
await verificationWorkflow('transfer-retry', async run => {
  const { registerTransferHandlers, setTransferableHandler, __resetTransferStateForTests } = await import('../../packages/server-core/src/handlers/rpc/transfer')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  registerTransferHandlers(server)
  let dispatches = 0
  let entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const handler = async (_ctx: unknown, _workspace: unknown, payload: unknown) => {
    const sequence = ++dispatches
    if ((payload as { gate?: boolean }).gate) { entered.resolve(); await release.promise }
    return { sequence }
  }
  setTransferableHandler('audit:counter', handler)
  setTransferableHandler(c.sessions.IMPORT, handler)
  server.handle(c.sessions.IMPORT, handler)
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token })
  const ids: string[] = [], checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
    finally { release.resolve(); delete process.env.PHANERIS_TRANSFER_TTL_MS }
  }
  const start = async (value: unknown, pieces = 1, options: { totalBytes?: number; checksum?: string } = {}) => {
    const bytes = Buffer.from(JSON.stringify(value))
    const checksum = options.checksum ?? createHash('sha256').update(bytes).digest('hex')
    const { transferId } = await client.invoke(c.transfer.START, { channel: 'audit:counter', args: ['workspace', null], largeArgIndex: 1,
      totalBytes: options.totalBytes ?? bytes.length, chunkCount: pieces, checksum }) as { transferId: string }
    ids.push(transferId)
    const chunks = Array.from({ length: pieces }, (_, i) => bytes.subarray(Math.floor(i * bytes.length / pieces), Math.floor((i + 1) * bytes.length / pieces)).toString('base64'))
    return { transferId, bytes, chunks }
  }
  const chunk = (transferId: string, index: number, data: string) => client.invoke(c.transfer.CHUNK, { transferId, index, data })
  const commit = (transferId: string) => client.invoke(c.transfer.COMMIT, { transferId })
  const upload = async (value: unknown) => {
    const transfer = await start(value)
    await chunk(transfer.transferId, 0, transfer.chunks[0]!)
    return transfer
  }
  try {
    await client.connect()
    await scene('lost-last-chunk-ack-replay-is-idempotent', async () => {
      const t = await upload({ marker: 'replay' }), before = dispatches
      await chunk(t.transferId, 0, t.chunks[0]!)
      await commit(t.transferId)
      assert.equal(dispatches - before, 1)
    })
    await scene('conflicting-index-replay-is-rejected', async () => {
      const t = await start({ marker: 'same-size-a' })
      const other = Buffer.from(JSON.stringify({ marker: 'same-size-b' })).toString('base64')
      const results = await Promise.allSettled([chunk(t.transferId, 0, t.chunks[0]!), chunk(t.transferId, 0, other)])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      await commit(t.transferId)
    })
    await scene('concurrent-identical-chunks-share-ack', async () => {
      const t = await start({ marker: 'concurrent' })
      await Promise.all([chunk(t.transferId, 0, t.chunks[0]!), chunk(t.transferId, 0, t.chunks[0]!)])
      await commit(t.transferId)
    })
    await scene('concurrent-byte-reservations-enforce-total', async () => {
      const t = await start({ marker: 'reservation' }, 2, { totalBytes: 10 })
      const data = Buffer.from('12345678').toString('base64')
      const results = await Promise.allSettled([chunk(t.transferId, 0, data), chunk(t.transferId, 1, data)])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    })
    await scene('failed-write-releases-index-and-byte-reservation', async () => {
      const t = await start({ marker: 'retry-write' })
      const obstruction = join(tmpdir(), `craft-transfer-${t.transferId}`, 'chunk-000000')
      mkdirSync(obstruction)
      try { await assert.rejects(chunk(t.transferId, 0, t.chunks[0]!)) } finally { rmdirSync(obstruction) }
      await chunk(t.transferId, 0, t.chunks[0]!)
      await commit(t.transferId)
    })
    await scene('missing-chunk-can-be-supplied-after-rejected-commit', async () => {
      const t = await start({ marker: 'missing' }, 2)
      await chunk(t.transferId, 0, t.chunks[0]!)
      await assert.rejects(commit(t.transferId), /Missing/)
      await chunk(t.transferId, 1, t.chunks[1]!)
      await commit(t.transferId)
    })
    await scene('checksum-failure-never-dispatches', async () => {
      const before = dispatches, t = await start({ marker: 'checksum' }, 1, { checksum: 'wrong' })
      await chunk(t.transferId, 0, t.chunks[0]!)
      await assert.rejects(commit(t.transferId), /Checksum/)
      await assert.rejects(commit(t.transferId))
      assert.equal(dispatches, before)
    })
    await scene('concurrent-and-repeated-commits-share-one-result', async () => {
      entered = Promise.withResolvers<void>(); release = Promise.withResolvers<void>()
      const before = dispatches, t = await upload({ gate: true })
      const first = commit(t.transferId), second = commit(t.transferId)
      await entered.promise; release.resolve()
      const results = await Promise.all([first, second])
      assert.deepEqual(results[0], results[1])
      assert.deepEqual(await commit(t.transferId), results[0])
      assert.equal(dispatches - before, 1)
    })
    await scene('abort-cannot-interrupt-commit', async () => {
      const before = dispatches, t = await upload({ marker: 'abort-race' })
      const result = commit(t.transferId).then(value => ({ value }), error => ({ error }))
      assert.deepEqual(await client.invoke(c.transfer.ABORT, { transferId: t.transferId }), { aborted: false })
      assert(!('error' in await result))
      assert.equal(dispatches - before, 1)
    })
    await scene('ttl-cannot-interrupt-running-commit', async () => {
      process.env.PHANERIS_TRANSFER_TTL_MS = '80'
      entered = Promise.withResolvers<void>(); release = Promise.withResolvers<void>()
      const t = await upload({ gate: true }), result = commit(t.transferId)
      await entered.promise; await new Promise(resolve => setTimeout(resolve, 120))
      assert.deepEqual(await client.invoke(c.transfer.ABORT, { transferId: t.transferId }), { aborted: false })
      release.resolve(); await result
    })
    await scene('distinct-user-transfers-dispatch-independently', async () => {
      const before = dispatches, first = await upload({ marker: 'fork' }), second = await upload({ marker: 'fork' })
      await Promise.all([commit(first.transferId), commit(second.transferId)])
      assert.equal(dispatches - before, 2)
    })
    await scene('client-owns-direct-chunked-choice-and-ack-retry', async () => {
      const { importSessionRemotely } = await import('../../apps/electron/src/main/chunked-rpc')
      const progress: number[] = [], calls: string[] = []
      let lostChunkAck = false
      const proxy = { invoke: async (channel: string, ...args: unknown[]) => {
        calls.push(channel)
        const result = await client.invoke(channel, ...args)
        if (channel === c.transfer.CHUNK && !lostChunkAck) { lostChunkAck = true; throw new Error('simulated lost chunk ack') }
        return result
      } }
      const before = dispatches
      await importSessionRemotely(proxy, { workspaceId: 'workspace', bundle: { marker: 'small' }, mode: 'fork' })
      assert.equal(calls[0], c.sessions.IMPORT)
      await importSessionRemotely(proxy, { workspaceId: 'workspace', bundle: { marker: 'x'.repeat(6 * 1024 * 1024) }, mode: 'fork', onProgress: sent => progress.push(sent) })
      assert.equal(calls.filter(ch => ch === c.transfer.START).length, 1)
      assert.equal(calls.filter(ch => ch === c.transfer.COMMIT).length, 1)
      assert.equal(dispatches - before, 2)
      assert.equal(progress.at(-1), 4)
    })
    await scene('lost-commit-ack-is-explicitly-unconfirmed-without-retry', async () => {
      const { importSessionRemotely } = await import('../../apps/electron/src/main/chunked-rpc')
      const before = dispatches
      const proxy = { invoke: async (channel: string, ...args: unknown[]) => {
        const value = await client.invoke(channel, ...args)
        if (channel === c.transfer.COMMIT) throw new Error('simulated lost commit ack')
        return value
      } }
      await assert.rejects(importSessionRemotely(proxy, { workspaceId: 'workspace', bundle: { marker: 'x'.repeat(6 * 1024 * 1024) }, mode: 'fork' }), /result.*unconfirmed/i)
      assert.equal(dispatches - before, 1)
    })
    run.json('scenarios.json', { checks, failures, dispatches })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['In-process dispatch guarantee only; cross-restart fork requires a future durable request ID', 'Target handler is a counter; real bundle publication is verified separately'])
  } finally {
    release.resolve()
    for (const transferId of ids) await client.invoke(c.transfer.ABORT, { transferId }).catch(() => {})
    client.destroy(); await disconnected.promise; server.close(); __resetTransferStateForTests()
  }
})
