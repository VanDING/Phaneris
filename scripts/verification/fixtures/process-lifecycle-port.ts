/** Electron exit/Sentry ports exercised in an independent real process. */
import { installProcessLifecycle } from '../../../packages/server-core/src/runtime/process-lifecycle'
const scenario = process.argv[2]!
let cleanups = 0, reports = 0
const lifecycle = installProcessLifecycle({
  owner: 'electron-ports', timeoutMs: 300,
  stopAccepting() { console.log(JSON.stringify({ event: 'quiesced' })) },
  async cleanup() {
    console.log(JSON.stringify({ event: 'cleanup', count: ++cleanups }))
    if (scenario === 'hang') await new Promise(() => {})
    if (scenario === 'throw') throw new Error('port-cleanup-failure')
  },
  report(kind, detail) { console.error(JSON.stringify({ event: 'diagnostic', kind, detail, count: ++reports })) },
  exit(code) { console.log(JSON.stringify({ event: 'exit', code, cleanups, reports })); process.exit(code) },
})
if (scenario === 'normal') lifecycle.shutdown()
else {
  lifecycle.fail('unhandledRejection', new Error('port-first-failure', { cause: new Error('port-original-cause') }))
  if (scenario === 'hang') setInterval(() => lifecycle.fail('uncaughtException', new Error('port-second-failure')), 25)
}
