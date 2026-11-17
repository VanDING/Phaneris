import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireAssistantWriter } from '../../../packages/server-core/src/resident-assistant/storage-lease'

const [root, control, name, stale] = process.argv.slice(2)
if (!root || !control || !name) throw new Error('Isolated writer fixture arguments are required')
mkdirSync(control, { recursive: true })
const status = (phase: string, error?: unknown) => writeFileSync(join(control, name + '-' + phase + '.json'), JSON.stringify({ pid: process.pid, phase, error: error ? String(error) : undefined }))
const stalePid = Number(stale), originalKill = process.kill.bind(process)
if (stalePid) process.kill = (pid, signal) => {
  try { return originalKill(pid, signal) }
  catch (error) {
    if (pid === stalePid && signal === 0 && (error as NodeJS.ErrnoException).code === 'ESRCH') {
      status('stale-checked')
      const until = Date.now() + 20_000
      while (!existsSync(join(control, name + '-continue'))) {
        if (Date.now() >= until) throw new Error('Stale-owner interleaving was not released')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
    throw error
  }
}
try {
  const release = acquireAssistantWriter(root)
  status('acquired')
  const timer = setInterval(() => {
    if (!existsSync(join(control, name + '-release'))) return
    clearInterval(timer)
    try { release(); release(); status('released'); process.exit(0) }
    catch (error) { status('release-rejected', error); process.exit(2) }
  }, 20)
} catch (error) { status('rejected', error); process.exit(3) }
