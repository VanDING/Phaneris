/** Test-only preload: no production routes or environment-triggered fatal branches. */
import { createInterface } from 'node:readline'
const input = createInterface({ input: process.stdin })
input.on('line', async line => {
  let command: { governanceFault?: string; governanceStop?: boolean }
  try { command = JSON.parse(line) } catch { return }
  if (command.governanceStop) { process.emit('SIGTERM'); return }
  if (!command.governanceFault) return
  const error = new Error(`governance-${command.governanceFault}`, { cause: new Error('governance-original-cause') })
  if (command.governanceFault === 'hang-cleanup' || command.governanceFault === 'throw-cleanup') {
    const { SessionManager } = await import('../../../packages/server-core/src/sessions/SessionManager')
    SessionManager.prototype.cleanup = command.governanceFault === 'hang-cleanup'
      ? () => new Promise(() => {}) : async () => { throw new Error('governance-cleanup-failed') }
  }
  if (command.governanceFault === 'uncaught') setImmediate(() => { throw error })
  else void Promise.reject(error)
})
