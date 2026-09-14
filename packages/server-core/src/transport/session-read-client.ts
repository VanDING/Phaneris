import type { Message } from '@phaneris/core/types'
import { SnapshotDecoder } from '@phaneris/core/utils'
import { CodedError, RPC_CHANNELS, SESSION_READ_CHUNK_BYTES, SESSION_READ_MAX_BYTES, type Session, type SessionReadChunk } from '@phaneris/shared/protocol'
import type { RpcClient } from './types'

/** Pull bounded chunks, then publish one complete session to existing Chat/Run consumers. */
export async function readSessionSnapshot(client: Pick<RpcClient, 'invoke'>, sessionId: string, available?: (channel: string) => boolean): Promise<Session | null> {
  if (available && !available(RPC_CHANNELS.sessions.READ_MESSAGES)) return client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, sessionId)
  let readId: string | undefined
  let offset = 0
  let total: number | undefined
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const snapshots = new SnapshotDecoder()
  const fragments: string[] = []
  const messages: Message[] = []
  let session: Omit<Session, 'messages'> | undefined
  let expectedCount = 0
  const invalid = () => new CodedError('TRANSFER_VERIFICATION_FAILED', 'Incomplete or invalid session snapshot')
  const line = (text: string) => {
    const record = JSON.parse(text)
    if (!session) {
      if (record?.format !== 'session-jsonl-v1' || record.session?.id !== sessionId || !Number.isSafeInteger(record.messageCount) || record.messageCount < 0) throw invalid()
      session = record.session
      expectedCount = record.messageCount
    } else {
      const message = snapshots.decode<Message>(record)
      if (typeof message.id !== 'string' || typeof message.role !== 'string' || typeof message.content !== 'string') throw invalid()
      messages.push(message)
      if (messages.length > expectedCount) throw invalid()
    }
  }
  const consume = (text: string) => {
    let start = 0
    for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n', start)) {
      fragments.push(text.slice(start, end))
      line(fragments.join(''))
      fragments.length = 0
      start = end + 1
    }
    if (start < text.length) fragments.push(text.slice(start))
  }
  try {
    while (true) {
      let chunk: SessionReadChunk | null
      try {
        chunk = await client.invoke(RPC_CHANNELS.sessions.READ_MESSAGES, sessionId, readId ? { readId, offset } : undefined)
      } catch (error) {
        // Older servers remain usable; never retry an interrupted new-format read as legacy.
        if (!readId && (error as { code?: string })?.code === 'CHANNEL_NOT_FOUND') return client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, sessionId)
        throw error
      }
      if (!chunk && !readId) return null
      if (!chunk || chunk.format !== 'session-jsonl-v1' || typeof chunk.readId !== 'string') throw invalid()
      if (readId && chunk.readId !== readId) throw invalid()
      readId = chunk.readId
      if (!(chunk.data instanceof Uint8Array) || chunk.data.byteLength < 1 || chunk.data.byteLength > SESSION_READ_CHUNK_BYTES
        || !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes < 1 || chunk.totalBytes > SESSION_READ_MAX_BYTES
        || total !== undefined && chunk.totalBytes !== total
        || chunk.offset !== offset || chunk.nextOffset !== offset + chunk.data.byteLength || chunk.nextOffset > chunk.totalBytes
        || chunk.done !== (chunk.nextOffset === chunk.totalBytes)) throw invalid()
      total = chunk.totalBytes
      offset = chunk.nextOffset
      consume(decoder.decode(chunk.data, { stream: true }))
      if (chunk.done) break
    }
    consume(decoder.decode())
    if (fragments.length || !session || messages.length !== expectedCount) throw invalid()
    return { ...session, messages } as Session
  } finally {
    if (readId) await client.invoke(RPC_CHANNELS.sessions.CLOSE_MESSAGES_READ, sessionId, readId).catch(() => {})
  }
}
