import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { canonicalJson } from '@phaneris/shared/durable-runtime/identity'
import { atomicWriteFileSync } from '@phaneris/shared/utils/files'
import { getSessionPath, loadSession, sessionDirectoryEntries, restoreSessionBundle, makeSessionPathPortable, type StoredSession, type SessionBundle, type BundleFile } from '@phaneris/shared/sessions'
import { storedToMessage } from '@phaneris/core/types'
import type { DurableRuntime } from '../durable-runtime'
import { importLegacyContext } from '../runtime-adapters/legacy-context'
import type { Logger } from '../runtime/platform'

const RECORD_FILE = '.phaneris-import.json'
const ImportRecordSchema = z.object({
  version: z.literal(1), importId: z.string().uuid(), sessionId: z.string().min(1),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/), productDigest: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.number().finite(), state: z.enum(['pending', 'complete']), warnings: z.array(z.string()),
})
type ImportRecord = z.infer<typeof ImportRecordSchema>
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export function sessionBundleDigest(bundle: SessionBundle): string { return digest(canonicalJson(bundle)) }

export function readSessionImport(root: string, sessionId: string): ImportRecord | null {
  const path = join(getSessionPath(root, sessionId), RECORD_FILE)
  if (!existsSync(path)) return null
  const record = ImportRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (record.sessionId !== sessionId) throw new Error(`Import record identity mismatch for ${sessionId}`)
  return record
}

function productDigest(session: StoredSession): string {
  return digest(makeSessionPathPortable(canonicalJson(session.messages), getSessionPath(session.workspaceRootPath, session.id)))
}

/** Directory publication precedes idempotent facts; the pending record travels with it. */
export function publishSessionImport(
  runtime: DurableRuntime, session: StoredSession, files: BundleFile[], sourceDigest: string, warnings: string[],
  prepareAssets: (directory: string) => void,
): void {
  const importId = randomUUID(), importedAt = Date.now()
  session.messages = session.messages.map(message => ({ ...message, inputSource: { kind: 'imported_history', importId, importedAt } }))
  restoreSessionBundle(session, files, directory => {
    prepareAssets(directory)
    const record: ImportRecord = { version: 1, importId, sessionId: session.id, sourceDigest,
      productDigest: productDigest(session), importedAt, state: 'pending', warnings: [...warnings] }
    atomicWriteFileSync(join(directory, RECORD_FILE), JSON.stringify(record) + '\n', { mode: 0o600 })
  })
  completeSessionImport(runtime, session.workspaceRootPath, session.id)
}

/** Safe after publication, SQLite commit, or a lost acknowledgement. */
export function completeSessionImport(runtime: DurableRuntime, root: string, sessionId: string): void {
  const record = readSessionImport(root, sessionId)
  if (!record) throw new Error(`Import record missing for ${sessionId}`)
  if (record.state === 'complete') return
  const session = loadSession(root, sessionId)
  if (!session || productDigest(session) !== record.productDigest) {
    throw new Error(`Published import ${sessionId} conflicts with its staged content; evidence retained for review`)
  }
  importLegacyContext(runtime, root, sessionId, session.messages.map(message => ({
    ...storedToMessage(message), timestamp: message.timestamp ?? record.importedAt,
  })), record.importedAt)
  atomicWriteFileSync(join(getSessionPath(root, sessionId), RECORD_FILE), JSON.stringify({ ...record, state: 'complete' }) + '\n', { mode: 0o600 })
}

/** Run before exposing metadata. A conflicting/invalid import remains diagnosable on disk. */
export function recoverSessionImports(runtime: DurableRuntime, root: string, logger: Logger): Set<string> {
  const unresolved = new Set<string>()
  for (const entry of sessionDirectoryEntries(root)) {
    if (!existsSync(join(entry.path, RECORD_FILE))) continue
    try { completeSessionImport(runtime, root, entry.id) }
    catch (error) { unresolved.add(entry.id); logger.error('Session import requires recovery; directory retained', entry.id, error) }
  }
  return unresolved
}
