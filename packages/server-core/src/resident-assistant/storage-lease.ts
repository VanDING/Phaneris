import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireWriterLease } from '../runtime/writer-lease'
import { z } from 'zod'

const writerOwner = z.object({
  version: z.literal(1).optional(), // Unversioned legacy owners remain readable.
  pid: z.number().int().positive().safe(),
  nonce: z.string().min(1),
  acquiredAt: z.number().optional(),
}).passthrough()

function readWriterOwner(file: string) {
  const parsed = writerOwner.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) throw new Error('Assistant writer lease is invalid; retain it for recovery')
  return parsed.data
}

/** Held for the complete assistant service lifetime, including offline migration. */
export function acquireAssistantWriter(root: string): () => void {
  mkdirSync(join(root, 'assistant'), { recursive: true, mode: 0o700 })
  const part = relative(realpathSync(root), realpathSync(join(root, 'assistant')))
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error('Assistant writer location escapes the workspace')
  const releaseLease = acquireWriterLease(join(root, 'assistant', '.writer.sqlite'), 'Another active assistant writer owns this workspace')
  const file = join(root, 'assistant', '.writer.lock'), nonce = randomUUID()
  try {
    if (existsSync(file)) {
      const owner = readWriterOwner(file)
      let alive = true
      try { process.kill(owner.pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
      if (alive) throw new Error('Another active assistant writer owns this workspace')
      // The OS lease serializes stale reclamation and the writer's full lifetime.
      // Keep the old ownership evidence, including compatibility with old Hosts.
      renameSync(file, join(root, 'assistant', `.writer-stale-${nonce}.json`))
    }
    let descriptor: number
    try { descriptor = openSync(file, 'wx', 0o600) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another assistant writer acquired this workspace'); throw error }
    try { writeFileSync(descriptor, JSON.stringify({ version: 1, pid: process.pid, nonce, acquiredAt: Date.now() }) + '\n') }
    finally { closeSync(descriptor) }
  } catch (error) { releaseLease(); throw error }
  let released = false
  return () => {
    if (released) return
    try {
      const owner = readWriterOwner(file)
      if (owner.nonce !== nonce) throw new Error('Assistant writer lease ownership changed')
      unlinkSync(file)
    } finally { released = true; releaseLease() }
  }
}
