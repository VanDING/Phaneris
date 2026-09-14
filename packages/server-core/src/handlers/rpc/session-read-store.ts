import { createHash, randomUUID } from 'node:crypto'
import { open, unlink, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnapshotEncoder } from '@craft-agent/core/utils'
import { CodedError, SESSION_READ_CHUNK_BYTES, SESSION_READ_MAX_BYTES, type Session, type SessionReadChunk } from '@craft-agent/shared/protocol'
import type { RequestContext } from '../../transport/types'

interface ReadState {
  id: string
  path: string
  owner: string
  workspaceId: string | null
  sessionId: string
  bytes: number
  handle?: FileHandle
  timer?: ReturnType<typeof setTimeout>
  closed: boolean
}

/** Immutable, owner-bound read leases. Pulling one chunk at a time provides backpressure. */
export class SessionReadStore {
  private reads = new Map<string, ReadState>()
  private totalBytes = 0
  constructor(private options: { maxBytes?: number; chunkBytes?: number; ttlMs?: number; tempDir?: string } = {}) {}

  async start(ctx: RequestContext, session: Session): Promise<SessionReadChunk> {
    if (this.reads.size >= 16 || [...this.reads.values()].filter(read => read.owner === ctx.clientId).length >= 2) {
      throw new CodedError('TRANSFER_TOO_LARGE', 'Too many concurrent session reads')
    }
    const id = randomUUID()
    const state: ReadState = { id, path: join(this.options.tempDir ?? tmpdir(), `craft-session-read-${id}.jsonl`), owner: ctx.clientId, workspaceId: ctx.workspaceId, sessionId: session.id, bytes: 0, closed: false }
    this.reads.set(id, state)
    try {
      const encoder = new SnapshotEncoder(json => createHash('sha256').update(json).digest('hex'))
      const { messages, ...metadata } = session
      const lines: string[] = []
      const append = (record: object) => {
        const line = JSON.stringify(record) + '\n'
        const bytes = Buffer.byteLength(line)
        const limit = this.options.maxBytes ?? SESSION_READ_MAX_BYTES
        if (state.bytes + bytes > limit || this.totalBytes + bytes > limit * 2) throw new CodedError('TRANSFER_TOO_LARGE', 'Session snapshot exceeds the bounded read budget')
        state.bytes += bytes
        this.totalBytes += bytes
        lines.push(line)
      }
      append({ format: 'session-jsonl-v1', session: metadata, messageCount: messages.length })
      // Capture every record synchronously before the first I/O await. A tool result or
      // appended turn cannot change the snapshot halfway through a multi-chunk read.
      for (const message of messages) append(encoder.encode(message))
      const handle = await open(state.path, 'wx+', 0o600)
      state.handle = handle
      if (state.closed) throw new CodedError('CLIENT_DISCONNECTED', 'Session read was cancelled')
      for (const line of lines) {
        if (state.closed) throw new CodedError('CLIENT_DISCONNECTED', 'Session read was cancelled')
        await handle.writeFile(line, 'utf8')
      }
      this.touch(state)
      return await this.read(ctx, session.id, id, 0)
    } catch (error) {
      await this.cleanup(state)
      throw error
    }
  }

  async read(ctx: RequestContext, sessionId: string, readId: string, offset: number): Promise<SessionReadChunk> {
    const state = this.owned(ctx, sessionId, readId)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= state.bytes) throw new CodedError('HANDLER_ERROR', 'Invalid session read offset')
    if (!state.handle) throw new CodedError('HANDLER_ERROR', 'Session read is not ready')
    this.touch(state)
    const length = Math.min(this.options.chunkBytes ?? SESSION_READ_CHUNK_BYTES, state.bytes - offset)
    const data = Buffer.alloc(length)
    let bytesRead = 0
    while (bytesRead < length) {
      const result = await state.handle.read(data, bytesRead, length - bytesRead, offset + bytesRead)
      if (!result.bytesRead) throw new CodedError('TRANSFER_VERIFICATION_FAILED', 'Session read ended before the declared length')
      bytesRead += result.bytesRead
    }
    return { format: 'session-jsonl-v1', readId, offset, nextOffset: offset + length, totalBytes: state.bytes, data: new Uint8Array(data), done: offset + length === state.bytes }
  }

  async close(ctx: RequestContext, sessionId: string, readId: string): Promise<void> {
    if (!this.reads.has(readId)) return
    await this.cleanup(this.owned(ctx, sessionId, readId))
  }

  async closeForClient(clientId: string): Promise<void> {
    await Promise.all([...this.reads.values()].filter(state => state.owner === clientId).map(state => this.cleanup(state)))
  }

  private owned(ctx: RequestContext, sessionId: string, id: string): ReadState {
    const state = this.reads.get(id)
    if (!state || state.closed) throw new CodedError('TRANSFER_TIMEOUT', 'Session read expired; reopen the conversation')
    if (state.owner !== ctx.clientId || state.workspaceId !== ctx.workspaceId || state.sessionId !== sessionId) throw new CodedError('AUTH_FAILED', 'Session read belongs to another client or workspace')
    return state
  }

  private touch(state: ReadState) {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => { void this.cleanup(state) }, this.options.ttlMs ?? 120_000)
    state.timer.unref?.()
  }

  private async cleanup(state: ReadState) {
    if (!state.closed) {
      state.closed = true
      this.reads.delete(state.id)
      this.totalBytes -= state.bytes
    }
    if (state.timer) clearTimeout(state.timer)
    const handle = state.handle
    state.handle = undefined
    if (handle) await handle.close().catch(() => {})
    await unlink(state.path).catch(() => {})
  }
}
