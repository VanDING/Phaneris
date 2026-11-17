#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import { CliRpcClient } from '../../apps/cli/src/client'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { serializeEnvelope, deserializeEnvelope } from '../../packages/server-core/src/transport/codec'
import { PROTOCOL_VERSION } from '../../packages/shared/src/protocol'

// Before extraction: one exchange never retries an effect; late replies are
// ignored, code/data survive, timeout/disconnect/destroy reject pending calls.
// Serialization and synchronous socket-write failures release timers/entries.
// CLI keeps immediate no-connection rejection and its handshake clientId.
await verificationWorkflow('rpc-exchange', async run => {
  const frames: Array<{ type: string; channel?: string }> = []
  let effects = 0
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req, host) {
    return host.upgrade(req) ? undefined : new Response('Not found', { status: 404 })
  }, websocket: { message(ws, raw) {
    const frame = deserializeEnvelope(String(raw)); frames.push({ type: frame.type, channel: frame.channel })
    if (frame.type === 'handshake') {
      ws.send(serializeEnvelope({ id: frame.id, type: 'handshake_ack', protocolVersion: PROTOCOL_VERSION, clientId: 'exchange-fixture' })); return
    }
    if (frame.type !== 'request') return
    const reply = () => ws.send(serializeEnvelope({ id: frame.id, channel: frame.channel, type: 'response', result: frame.args }))
    if (frame.channel === 'late') { effects++; setTimeout(reply, 90); return }
    if (frame.channel === 'pending') return
    if (frame.channel === 'close') { ws.close(); return }
    if (frame.channel === 'reject') {
      ws.send(serializeEnvelope({ id: frame.id, channel: frame.channel, type: 'response', error: { code: 'HANDLER_ERROR', message: 'Fixture refusal', data: { retry: false } } })); return
    }
    reply()
  } } })
  const url = `ws://127.0.0.1:${server.port}`, checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, action: () => Promise<void>) => {
    try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) }
  }
  try {
    await scene('cli-unconnected-call-rejects-without-connecting', async () => {
      const client = new CliRpcClient(url); const before = frames.length
      await assert.rejects(client.invoke('echo'), /Not connected/); assert.equal(frames.length, before); client.destroy()
    })
    for (const kind of ['cli', 'ws'] as const) {
      const client = kind === 'cli' ? new CliRpcClient(url, { requestTimeout: 35 }) : new WsRpcClient(url, { requestTimeout: 35, autoReconnect: false })
      try {
        const id = await client.connect()
        if (kind === 'cli') assert.equal(id, 'exchange-fixture')
        await scene(`${kind}-request-response-and-error-fields`, async () => {
          assert.deepEqual(await client.invoke('echo', 'fixture', 1), ['fixture', 1])
          await assert.rejects(client.invoke('reject'), (error: Error & { code?: string; data?: unknown }) => {
            assert.equal(error.code, 'HANDLER_ERROR'); assert.deepEqual(error.data, { retry: false }); return true
          })
        })
        await scene(`${kind}-late-response-no-effect-retry`, async () => {
          const before = effects
          await assert.rejects(client.invoke('late'), /timeout/i); await Bun.sleep(100)
          assert.equal(effects, before + 1); assert.deepEqual(await client.invoke('echo', 'after-late'), ['after-late'])
        })
        await scene(`${kind}-serialization-failure-can-continue`, async () => {
          const value: { self?: unknown } = {}; value.self = value
          await assert.rejects(client.invoke('echo', value)); assert.deepEqual(await client.invoke('echo', 'after-json'), ['after-json'])
        })
        await scene(`${kind}-disconnect-rejects-all-and-does-not-replay`, async () => {
          const pending = client.invoke('pending'), closing = client.invoke('close')
          const results = await Promise.allSettled([pending, closing])
          assert(results.every(result => result.status === 'rejected' && /Disconnected|Connection lost/.test(String(result.reason))))
        })
      } finally { client.destroy() }
    }
    await scene('exchange-write-and-encode-failure-releases-state', async () => {
      const { RpcRequestExchange } = await import('../../packages/server-core/src/transport/request-exchange')
      const exchange = new RpcRequestExchange()
      await assert.rejects(exchange.request('failed-write', [], { timeoutMs: 1000, write() { throw new Error('Socket write failure') } }), /Socket write failure/)
      assert.equal(exchange.pendingCount, 0)
      const value: { self?: unknown } = {}; value.self = value
      await assert.rejects(exchange.request('failed-encode', [value], { timeoutMs: 1000, write() { throw new Error('Must not write') } }))
      assert.equal(exchange.pendingCount, 0)
      const request = exchange.request('synchronous-response', [], { timeoutMs: 1000, write(_wire, envelope) {
        exchange.accept({ id: envelope.id, type: 'response', result: 'once' })
        assert.equal(exchange.accept({ id: envelope.id, type: 'response', result: 'twice' }), false)
      } })
      assert.equal(await request, 'once'); assert.equal(exchange.pendingCount, 0)
      const pending = exchange.request('interrupted', [], { timeoutMs: 1000, write() {} })
      exchange.disconnect(new Error('Client destroyed'))
      await assert.rejects(pending, /Client destroyed/); assert.equal(exchange.pendingCount, 0)
    })
    run.json('frames.json', frames); run.json('scenarios.json', { checks, failures, effects })
    assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['WSS, authentication, reconnect and CLI command exit covered separately by existing client tests and TLS probe'])
  } finally { server.stop(true) }
})
