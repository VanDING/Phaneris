import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts.ts'
import { WsRpcServer } from '../../packages/server-core/src/transport/server.ts'
import { WsRpcClient } from '../../packages/server-core/src/transport/client.ts'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { registerSessionsHandlers } from '../../packages/server-core/src/handlers/rpc/sessions.ts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps.ts'

await verificationWorkflow('rpc-contracts', async run => {
  run.checkArguments()
  const scenes: string[] = []
  let effects = 0
  const server = new WsRpcServer()
  const manager = {
    getSessions: () => [{ id: 'session-one', workspaceId: 'workspace-one' }],
    async sendMessage(_id: string, _message: string, _a: unknown, _s: unknown, _o: unknown, _q: unknown, _b: unknown, ack: (id: string) => void) { effects++; ack('message-one') },
  }
  const logger = { info() {}, warn() {}, error() {}, debug() {} }
  registerSessionsHandlers(server, { sessionManager: manager, platform: { logger } } as unknown as HandlerDeps)
  server.handle('verification:binary', (_ctx, data: Uint8Array) => data)
  server.handle('verification:timeout', async () => { await Bun.sleep(90); effects++; return true })
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: 'workspace-one', autoReconnect: false, requestTimeout: 40 })
  const other = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: 'workspace-other', autoReconnect: false })
  try {
    await client.connect(); await other.connect()
    await assert.rejects(client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-one', { illegal: true }))
    assert.equal(effects, 0)
    scenes.push('invalid-message-before-effect')
    await assert.rejects(client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-one', 'hello', 'bad-attachments'))
    assert.equal(effects, 0)
    scenes.push('invalid-attachments-before-effect')
    await assert.rejects(other.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-one', 'hello'), /does not belong/)
    assert.equal(effects, 0)
    scenes.push('workspace-ownership')
    assert.deepEqual(await client.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE, 'session-one', 'hello', undefined, undefined, { futureOption: 'preserved' }), { accepted: true, messageId: 'message-one' })
    assert.equal(effects, 1)
    scenes.push('old-optional-args-and-unknown-fields')
    const bytes = new Uint8Array([0, 1, 128, 255])
    assert.deepEqual(await client.invoke('verification:binary', bytes), bytes)
    scenes.push('binary-codec-compatibility')
    await assert.rejects(client.invoke('verification:timeout'), /timeout/i)
    await Bun.sleep(130)
    assert.equal(effects, 2, 'timeout abandons response; effect happens once without automatic retry')
    scenes.push('timeout-does-not-retry-or-cancel-effect')
    assert.deepEqual(await client.invoke('verification:binary', bytes), bytes)
    scenes.push('late-response-does-not-poison-next-request')
    run.json('rpc-contracts.json', { scenes, effects })
    run.complete(scenes, ['native preload IPC', 'live remote TLS'])
  } finally { client.destroy(); other.destroy(); server.close() }
})
