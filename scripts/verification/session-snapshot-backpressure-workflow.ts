import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import { WsRpcServer } from '../../packages/server-core/src/transport/server'
import { readSessionSnapshot } from '../../packages/server-core/src/transport/session-read-client'
import { SessionReadStore } from '../../packages/server-core/src/handlers/rpc/session-read-store'
import { CliRpcClient } from '../../apps/cli/src/client'
import { RPC_CHANNELS as c, type Session } from '@phaneris/shared/protocol'

// Failure cases before client backpressure: rapid snapshots must respect the
// existing two-lease server budget; separate clients progress independently.
// Failed start, malformed payload and disconnect must release a waiting reader.
await verificationWorkflow('session-snapshot-backpressure', async run => {
  const store = new SessionReadStore({ tempDir: run.directory })
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, onClientDisconnected: id => { void store.closeForClient(id) } })
  const snapshot = (id: string): Session => ({ id, workspaceId: 'fixture', workspaceName: 'Fixture', lastMessageAt: 1, isProcessing: false,
    messages: [{ id: 'message-' + id, role: 'user', content: 'Retain complete history for ' + id, timestamp: 1 }] })
  let active = 0, maxActive = 0
  server.handle(c.sessions.READ_MESSAGES, async (context, id, cursor) => {
    if (cursor) return store.read(context, id, cursor.readId, cursor.offset)
    if (id === 'start-error') throw new Error('Fixture read start failed')
    const result = await store.start(context, snapshot(id))
    active++; maxActive = Math.max(active, maxActive)
    await Bun.sleep(35); active--
    return id === 'malformed' ? { ...result, offset: 9 } : result
  })
  server.handle(c.sessions.CLOSE_MESSAGES_READ, (context, id, readId) => store.close(context, id, readId))
  server.handle(c.sessions.GET_MESSAGES, (_context, id: string) => snapshot(id))
  await server.listen()
  const a = new CliRpcClient(`ws://127.0.0.1:${server.port}`), b = new CliRpcClient(`ws://127.0.0.1:${server.port}`)
  await a.connect(); await b.connect()
  const checks: string[] = [], failures: unknown[] = []
  const scene = async (id: string, action: () => Promise<void>) => { try { await action(); checks.push(id) } catch (error) { failures.push({ id, error: String(error) }) } }
  const reads = (client: CliRpcClient, prefix: string) => Promise.allSettled(Array.from({ length: 6 }, (_, index) => readSessionSnapshot(client, `${prefix}-${index}`)))
  try {
    await scene('six-rapid-snapshots-complete-without-raising-the-server-budget', async () => {
      const results = await reads(a, 'rapid'); run.json('rapid.json', results)
      assert(results.every(result => result.status === 'fulfilled' && result.value?.messages[0]?.content.includes(result.value.id)))
    })
    await scene('independent-clients-can-progress-at-the-same-time', async () => {
      maxActive = 0
      const results = await Promise.all([reads(a, 'alpha'), reads(b, 'beta')]); run.json('independent.json', results)
      assert(results.flat().every(result => result.status === 'fulfilled')); assert(maxActive >= 2)
    })
    for (const failure of ['start-error', 'malformed']) await scene(`${failure}-does-not-block-the-next-reader`, async () => {
      const results = await Promise.allSettled([readSessionSnapshot(a, failure), readSessionSnapshot(a, 'after-' + failure)])
      assert.equal(results[0]!.status, 'rejected'); assert.equal(results[1]!.status, 'fulfilled')
    })
    await scene('legacy-capability-fallback-retains-complete-history', async () => {
      const value = await readSessionSnapshot(a, 'legacy', () => false)
      assert.equal(value?.messages[0]?.content, 'Retain complete history for legacy')
    })
    await scene('disconnect-settles-active-and-waiting-readers', async () => {
      const pending = reads(a, 'disconnect'); a.destroy()
      const results = await Promise.race([pending, Bun.sleep(3000).then(() => null)])
      assert(results && results.every(result => result.status === 'rejected'))
    })
    run.json('scenarios.json', { checks, failures, maxActive }); assert.equal(failures.length, 0, JSON.stringify(failures))
    run.complete(checks, ['Real WS, public snapshot reader and owner-bound temporary files; application rapid navigation is covered separately.'])
  } finally { a.destroy(); b.destroy(); server.close(); await Promise.all([store.closeForClient(a.clientId ?? ''), store.closeForClient(b.clientId ?? '')]) }
})
