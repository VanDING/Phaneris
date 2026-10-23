/** Production browser batch runtime: bounded capture, cancellation and partial results. */
import assert from 'node:assert/strict'
import { executeBrowserToolCommand } from '../../packages/shared/src/agent/browser-tool-runtime'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('conversation-browser-settlement', async evidence => {
  const checks: string[] = [], calls: string[] = []
  const never = new Promise<never>(() => {})
  const fns = { screenshotRegion: async () => { calls.push('capture'); return never },
    resizeWindow: async () => { calls.push('resize'); return {} } } as any
  const execute = (command: string, options: object = {}) => executeBrowserToolCommand({ command, fns, sessionId: 'fixture', readTimeoutMs: 40, ...options } as any)
  const deadline = async <T>(task: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout>
    try { return await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Browser read remained hung')), 1000) })]) }
    finally { clearTimeout(timer!) }
  }
  await assert.rejects(deadline(execute('screenshot-region --selector #result; window-resize 1280 720')), /timed out/i)
  assert.deepEqual(calls, ['capture']); checks.push('hung capture is bounded and stops batch')
  calls.length = 0
  const abort = new AbortController()
  const running = execute('screenshot-region --selector #result; window-resize 1280 720', { signal: abort.signal, readTimeoutMs: 5000 })
  setTimeout(() => abort.abort(new Error('Fixture user cancellation')), 20)
  await assert.rejects(deadline(running), /cancell|abort/i)
  assert.deepEqual(calls, ['capture']); checks.push('cancelled capture cannot start subsequent mutation')
  fns.evaluate = async () => 'https://example.invalid/fixture'
  await assert.rejects(deadline(execute('evaluate document.title; screenshot-region --selector #result')), /https:\/\/example.invalid\/fixture[\s\S]*Command 2/)
  checks.push('earlier batch result preserved on later capture failure')
  evidence.json('browser-settlement.json', { checks, calls })
  evidence.complete(checks, ['Native Electron screenshot hang trigger', 'Live browser remote mutation reconciliation'])
})
