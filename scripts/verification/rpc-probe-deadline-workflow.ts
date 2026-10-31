/** CI repair matrix: actual WS calls retain the complete connection-probe budget. */
import assert from 'node:assert/strict'
import { WsRpcServer } from '../../packages/server-core/src/transport/server'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('rpc-probe-deadline', async run => {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false, serverId: 'probe-deadline' })
  const requests: Array<{ mode: string; elapsed: number }> = []
  server.handle(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, async (_context, input: { mode: string }) => {
    if (input.mode === 'error') throw new Error('controlled probe failure')
    const start = performance.now()
    await Bun.sleep(input.mode === 'slow' ? 31_000 : 200)
    requests.push({ mode: input.mode, elapsed: performance.now() - start })
    return { success: true }
  })
  server.handle('test:ordinary', async () => { await Bun.sleep(300); return 'ordinary response' })
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false })
  const short = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false, requestTimeout: 100 })
  const checks: string[] = []
  try {
    for (const connection of [client, short]) {
      connection.connect()
      const deadline = Date.now() + 5000
      while (!connection.isConnected) { assert(Date.now() < deadline, 'Local WS handshake failed'); await Bun.sleep(10) }
    }
    const started = performance.now()
    assert.deepEqual(await client.invoke(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { mode: 'slow' }), { success: true })
    assert(performance.now() - started > 30_000)
    checks.push('connection probe receives its real response after the ordinary 30 second deadline')
    await assert.rejects(short.invoke('test:ordinary'), /Request timeout: test:ordinary \(100ms\)/)
    checks.push('ordinary RPC retains the configured short deadline')
    await assert.rejects(client.invoke(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { mode: 'error' }), /controlled probe failure/)
    checks.push('probe handler failures remain failures')
    const disconnected = assert.rejects(client.invoke(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { mode: 'disconnect' }), /destroy|disconnect|closed/i)
    await Bun.sleep(20)
    client.destroy()
    await disconnected
    checks.push('disconnect rejects the pending probe')
    run.complete(checks, ['Live model-provider latency; the actual Pi/native flow is verified separately'])
  } finally {
    client.destroy(); short.destroy(); server.close()
    run.json('rpc-probe-deadline.json', { checks, requests })
  }
})
