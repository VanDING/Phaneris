import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { SOURCE_INDEX_WORKER } from './source-index-worker'
import type { StoredMessage, SessionHeader } from '@phaneris/shared/sessions'
import { getSessionFilePath, validateSessionId, expandSessionPath, getSessionSourceIndex, registerSessionSourceIndex, sessionSourceSignature, sessionSourceIndexMetrics, releaseSessionSourceIndex } from '@phaneris/shared/sessions'

interface Entry { id: string; offset: number; length: number; version: string }
interface Index { signature: string; header: SessionHeader; entries: Entry[]; byId: Map<string, Entry> }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** Rebuildable byte locators, never a second authoritative transcript or body cache.
 * Source reads intentionally exclude diagnostic prompt/tool-schema snapshots;
 * those have stream-local dictionaries and are not conversational evidence. */
export class SourceReader {
  private readonly failures = new Map<string, { signature: string; error: string }>()
  private counts = { bytesRead: 0, indexScanBytes: 0, decodedRecords: 0, selectedCharacters: 0, rebuilds: 0 }
  constructor(private readonly root: string) {}
  metrics() { return { ...this.counts, ...sessionSourceIndexMetrics() } }
  release(sessionId: string) { releaseSessionSourceIndex(getSessionFilePath(this.root, sessionId)) }
  async warm(sessionIds: readonly string[]): Promise<void> {
    const files: string[] = []
    for (const id of new Set(sessionIds)) {
      validateSessionId(id)
      const file = getSessionFilePath(this.root, id)
      if (!existsSync(file)) continue
      const signature = sessionSourceSignature(file)
      if (getSessionSourceIndex(file, signature) || this.failures.get(file)?.signature === signature) continue
      files.push(file)
    }
    if (!files.length) return
    interface WarmIndex { file: string; signature: string; header: SessionHeader; entries: Entry[]; bytesRead: number; decodedRecords: number; error?: string }
    const worker = new Worker(SOURCE_INDEX_WORKER, { eval: true, workerData: files })
    const results = await new Promise<WarmIndex[]>((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject)
      worker.once('exit', code => { if (code !== 0) reject(new Error(`source_index_worker_failed: ${code}`)) })
    })
    for (const result of results) {
      if (!existsSync(result.file) || sessionSourceSignature(result.file) !== result.signature) continue
      this.counts.bytesRead += result.bytesRead; this.counts.indexScanBytes += result.bytesRead
      this.counts.decodedRecords += result.decodedRecords
      if (result.error) {
        this.failures.set(result.file, { signature: result.signature, error: result.error })
        while (this.failures.size > 128) this.failures.delete(this.failures.keys().next().value!)
        continue
      }
      this.failures.delete(result.file)
      const header = JSON.parse(expandSessionPath(JSON.stringify(result.header), dirname(result.file))) as SessionHeader
      validateSessionId(header.id)
      if (getSessionFilePath(this.root, header.id) !== result.file || new Set(result.entries.map(entry => entry.id)).size !== result.entries.length) throw new Error('source_identity_conflict: Warmed locators do not match original identities')
      registerSessionSourceIndex(result.file, header, result.entries)
      this.counts.rebuilds++
    }
  }
  private index(sessionId: string): Index {
    validateSessionId(sessionId)
    const file = getSessionFilePath(this.root, sessionId)
    if (!existsSync(file)) throw new Error(`source_unavailable: Original Session ${sessionId} does not exist`)
    const signature = sessionSourceSignature(file)
    const failure = this.failures.get(file)
    if (failure?.signature === signature) throw new Error(`source_unavailable: ${failure.error}`)
    const written = getSessionSourceIndex(file, signature)
    if (written) return written
    const fd = openSync(file, 'r'), entries: Entry[] = []
    let pending = Buffer.alloc(0), position = 0, header: SessionHeader | undefined
    const consume = (line: Buffer, offset: number) => {
      if (!line.length) return
      const parsed = JSON.parse(expandSessionPath(line.toString('utf8'), dirname(file)))
      this.counts.decodedRecords++
      if (!header) { header = parsed as SessionHeader; return }
      entries.push({ id: (parsed as StoredMessage).id, offset, length: line.length, version: digest(line) })
    }
    try {
      for (;;) {
        const block = Buffer.allocUnsafe(64 * 1024), bytes = readSync(fd, block, 0, block.length, null)
        if (!bytes) break
        this.counts.bytesRead += bytes; this.counts.indexScanBytes += bytes
        pending = Buffer.concat([pending, block.subarray(0, bytes)])
        let newline: number
        while ((newline = pending.indexOf(10)) >= 0) {
          consume(pending.subarray(0, newline), position)
          position += newline + 1; pending = pending.subarray(newline + 1)
        }
      }
      if (pending.length) consume(pending, position)
    } finally { closeSync(fd) }
    if (!header) throw new Error('source_unavailable: Session header is missing')
    if (header.id !== sessionId) throw new Error('source_identity_conflict: Session header does not match its path')
    if (sessionSourceSignature(file) !== signature) throw new Error('source_revision_conflict: Source changed during index rebuild')
    const index = registerSessionSourceIndex(file, header, entries)
    if (index.byId.size !== entries.length) throw new Error('source_identity_conflict: Duplicate message identity')
    this.counts.rebuilds++
    return index
  }
  catalog(sessionId: string) {
    const index = this.index(sessionId)
    return { header: index.header, entries: index.entries.map(entry => ({ ...entry })),
      snapshot: digest(JSON.stringify(index.entries.map(entry => [entry.id, entry.version]))) }
  }
  describe(sessionId: string, messageId: string) {
    const index = this.index(sessionId), entry = index.byId.get(messageId)
    if (!entry) throw new Error(`source_unavailable: Original message ${sessionId}/${messageId} is missing`)
    return { header: index.header, version: entry.version, cursor: index.entries.indexOf(entry) + 1 }
  }
  read(sessionId: string, messageId: string) {
    const index = this.index(sessionId), entry = index.byId.get(messageId)
    if (!entry) throw new Error(`source_unavailable: Original message ${sessionId}/${messageId} is missing`)
    const file = getSessionFilePath(this.root, sessionId), fd = openSync(file, 'r'), bytes = Buffer.allocUnsafe(entry.length)
    try {
      let offset = 0
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, entry.offset + offset)
        if (!count) throw new Error('source_revision_conflict: Source changed during exact read')
        offset += count; this.counts.bytesRead += count
      }
    } finally { closeSync(fd) }
    if (digest(bytes) !== entry.version) { this.release(sessionId); throw new Error('source_revision_conflict: Source changed during exact read') }
    const { promptSnapshot: _prompt, contextSnapshot: _context, __craftSnapshotRefs: _refs, ...original } = JSON.parse(expandSessionPath(bytes.toString('utf8'), dirname(file)))
    const message = original as StoredMessage
    this.counts.decodedRecords++; this.counts.selectedCharacters += message.content.length
    return { message, header: index.header, version: entry.version, bytes: { offset: entry.offset, end: entry.offset + entry.length },
      cursor: index.entries.indexOf(entry) + 1 }
  }
}
const readers = new Map<string, SourceReader>()
export function getSourceReader(root: string): SourceReader {
  let reader = readers.get(root)
  if (!reader) { reader = new SourceReader(root); readers.set(root, reader) }
  while (readers.size > 4) readers.delete(readers.keys().next().value!)
  return reader
}
