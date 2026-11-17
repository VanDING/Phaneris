#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { CliRpcClient } from '../../apps/cli/src/client'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { PROTOCOL_VERSION } from '../../packages/shared/src/protocol'
import { serializeEnvelope, deserializeEnvelope } from '../../packages/server-core/src/transport/codec'

await verificationWorkflow('rpc-tls', async run => {
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0')
  const fixture = process.env.PHANERIS_AUDIT_TLS_FIXTURE!
  assert(fixture && process.env.NODE_EXTRA_CA_CERTS)
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0,
    tls: { key: readFileSync(join(fixture, 'fixture-key.pem')), cert: readFileSync(join(fixture, 'fixture-cert.pem')) },
    fetch(req, server) { return server.upgrade(req) ? undefined : new Response('Not found', { status: 404 }) },
    websocket: { message(socket, raw) {
      const message = deserializeEnvelope(String(raw))
      if (message.type === 'handshake') socket.send(serializeEnvelope({ id: message.id, type: 'handshake_ack', clientId: 'tls-fixture', protocolVersion: PROTOCOL_VERSION }))
      if (message.type === 'request') socket.send(serializeEnvelope({ id: message.id, type: 'response', result: message.args }))
    } } })
  const cli = new CliRpcClient(`wss://127.0.0.1:${host.port}`), ws = new WsRpcClient(`wss://127.0.0.1:${host.port}`, { autoReconnect: false })
  try {
    assert.equal(await cli.connect(), 'tls-fixture'); ws.connect()
    assert.deepEqual(await cli.invoke('tls:echo', 'verified'), ['verified'])
    assert.deepEqual(await ws.invoke('tls:echo', 'verified'), ['verified'])
    run.json('tls.json', { cli: true, ws: true, certificateVerification: true, isolatedExtraCA: true })
    run.complete(['cli-real-wss', 'ws-real-wss'], ['External certificate chains and native operating system certificate stores'])
  } finally { cli.destroy(); ws.destroy(); host.stop(true) }
})
