import assert from 'node:assert/strict'
import { bootstrapServer } from '../../../packages/server-core/src/bootstrap'
import { SessionManager } from '../../../packages/server-core/src/sessions'
let cleanups = 0
const pending = Promise.withResolvers<void>()
const entered = Promise.withResolvers<void>()
const instance = await bootstrapServer({
  serverToken: 'governance-stop-only-token', rpcHost: '127.0.0.1', rpcPort: 0,
  bundledAssetsRoot: process.argv[2]!, createSessionManager: runtime => new SessionManager(runtime),
  createHandlerDeps: deps => deps, registerAllRpcHandlers() {},
  initializeSessionManager: sm => sm.initialize(), setSessionEventSink: (sm, sink) => sm.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }),
  cleanupSessionManager: async sm => { cleanups++; entered.resolve(); await pending.promise; await sm.cleanup() },
})
try {
  const first = instance.stop()
  await entered.promise
  const second = instance.stop()
  let finished = false
  void second.then(() => { finished = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert(!finished, 'Repeated stop must await the in-flight owner cleanup')
  assert.strictEqual(first, second, 'Stop has one shared promise owner')
  pending.resolve(); await Promise.all([first, second])
  assert.equal(cleanups, 1)
  console.log(JSON.stringify({ id: 'L07-bootstrap-stop-owner', passed: true, cleanups }))
} finally { pending.resolve(); await instance.stop() }
