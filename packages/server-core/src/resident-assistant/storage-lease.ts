import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Held for the complete assistant service lifetime, including offline migration. */
export function acquireAssistantWriter(root: string): () => void {
  mkdirSync(join(root, 'assistant'), { recursive: true, mode: 0o700 })
  const part = relative(realpathSync(root), realpathSync(join(root, 'assistant')))
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error('Assistant writer location escapes the workspace')
  const file = join(root, 'assistant', '.writer.lock'), nonce = randomUUID()
  if (existsSync(file)) {
    const owner = JSON.parse(readFileSync(file, 'utf8')) as { pid?: number; nonce?: string }
    if (!Number.isSafeInteger(owner.pid) || !owner.nonce) throw new Error('Assistant writer lease is invalid; retain it for recovery')
    let alive = true
    try { process.kill(owner.pid!, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
    if (alive) throw new Error('Another active assistant writer owns this workspace')
    // Keep stale ownership evidence; renaming a fixed workspace-owned file cannot move user content.
    renameSync(file, join(root, 'assistant', `.writer-stale-${nonce}.json`))
  }
  let descriptor: number
  try { descriptor = openSync(file, 'wx', 0o600) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another assistant writer acquired this workspace'); throw error }
  try { writeFileSync(descriptor, JSON.stringify({ version: 1, pid: process.pid, nonce, acquiredAt: Date.now() }) + '\n') }
  finally { closeSync(descriptor) }
  let released = false
  return () => {
    if (released) return
    const owner = JSON.parse(readFileSync(file, 'utf8')) as { nonce: string }
    if (owner.nonce !== nonce) throw new Error('Assistant writer lease ownership changed')
    unlinkSync(file); released = true
  }
}
