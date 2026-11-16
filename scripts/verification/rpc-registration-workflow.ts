import assert from 'node:assert/strict'
import { verificationWorkflow } from './verification-artifacts'
import { WsRpcServer } from '../../packages/server-core/src/transport/server'
import { CliRpcClient } from '../../apps/cli/src/client'
import { RPC_CHANNELS as c } from '../../packages/shared/src/protocol'

// Fixed before tightening registration: validate known fields, preserve extra
// fields/positions and legacy null, retain extensions, never retry timed-out effects.
await verificationWorkflow('rpc-registration', async run => {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0 })
  const seen: unknown[][] = [], checks: string[] = []; let effects = 0
  server.handle(c.sessions.SEND_MESSAGE, (_ctx, ...args) => { seen.push(args); return { accepted: true, messageId: 'receipt' } })
  server.handle(c.workItems.DELETE, async () => { effects++; await Bun.sleep(70) })
  server.handle(c.pages.GET_CONTENT, () => ({ content: '<h1>compatible</h1>' }))
  server.handle('fixture:extension', (_ctx, ...args) => args)
  server.handle(c.sessions.RECONCILE_TOOL, (_ctx, sessionId: string, request: { toolOperationId: string }) => ({ sessionId, operationId: request.toolOperationId }))
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { requestTimeout: 30 }); await client.connect()
  try {
    const reconciled = await client.invoke(c.sessions.RECONCILE_TOOL, 'session', { toolOperationId: 'op' })
    assert.deepEqual(reconciled, { sessionId: 'session', operationId: 'op' }); checks.push('tool-reconciliation-uses-actual-two-argument-port')
    const result = await client.invoke(c.sessions.SEND_MESSAGE, 'session', 'hello', null, null, { futureOption: { kept: true } }, 'future-position')
    assert.deepEqual(result, { accepted: true, messageId: 'receipt' })
    assert.deepEqual(seen[0], ['session', 'hello', null, null, { futureOption: { kept: true } }, 'future-position'])
    checks.push('old-frame-preserves-null-unknown-fields-and-extra-positions')
    await assert.rejects(client.invoke(c.sessions.SEND_MESSAGE, 123, 'invalid'), /Invalid RPC arguments/)
    assert.equal(seen.length, 1); checks.push('invalid-known-argument-rejected-before-handler')
    assert.deepEqual(await client.invoke(c.pages.GET_CONTENT, 'ws', 'page'), { content: '<h1>compatible</h1>' })
    checks.push('pages-authoritative-response-shape-on-wire')
    assert.deepEqual(await client.invoke('fixture:extension', { arbitrary: true }, 123), [{ arbitrary: true }, 123])
    checks.push('dynamic-extension-keeps-opaque-arguments-and-result')
    await assert.rejects(client.invoke(c.workItems.DELETE, 'workspace', 'item'), /timeout/i)
    await Bun.sleep(100); assert.equal(effects, 1)
    assert.deepEqual(await client.invoke('fixture:extension', 'after-timeout'), ['after-timeout'])
    checks.push('timeout-abandons-response-without-retrying-effect')
    await assert.rejects(client.invoke('fixture:unknown'), /No handler/); checks.push('unknown-channel-still-rejected')
    run.json('frames.json', { seen, effects, checks }); run.complete(checks, ['Real local WS registration and legacy frames on Windows; production domain behavior covered by planning, resident, Pages and input workflows.'])
  } finally { client.destroy(); await server.close() }
})
