import { createHash } from 'node:crypto'
import { getSourceReader } from '../context/source-reader'
import type { SessionHistoryQuery, SessionHistoryPage } from '@phaneris/session-tools-core/session-history-contracts'
import type { AssistantMemoryStore } from '../resident-assistant/memory-store'
import { historySourceContent, isDirectUserMessage, sourceContentHash } from '../resident-assistant/source-provenance'

/** Session owns original bytes; memory contributes only source-access decisions. */
export function readSessionOriginals(workspace: { rootPath: string }, sessionId: string, query: SessionHistoryQuery, memory: AssistantMemoryStore): SessionHistoryPage {
  const reader = getSourceReader(workspace.rootPath), catalog = reader.catalog(sessionId)
  const count = query.cursor?.count ?? catalog.entries.length
  if (count > catalog.entries.length) throw new Error('Session history snapshot changed; read a new snapshot')
  const entries = catalog.entries.slice(0, count)
  const snapshot = createHash('sha256').update(JSON.stringify([sessionId, entries.map(entry => [entry.id, entry.version])])).digest('hex')
  if (query.cursor && query.cursor.snapshot !== snapshot) throw new Error('Session history snapshot changed; read a new snapshot')
  const messageId = query.cursor?.messageId ?? query.messageId
  if (query.cursor && query.messageId && query.messageId !== query.cursor.messageId) throw new Error('Session history cursor target conflict')
  const matching = messageId ? entries.filter(message => message.id === messageId) : entries
  if (messageId && !matching.length) throw new Error('Original message not found')
  const limit = query.limit ?? 8
  const offset = query.cursor?.offset ?? query.offset ?? (query.fromEnd ? Math.max(0, matching.length - limit) : 0)
  const start = query.cursor?.character ?? query.startCharacter ?? 0
  const page = matching.slice(offset, offset + limit).map(entry => reader.read(sessionId, entry.id).message)
  const sources = memory.readHistoricalSources(sessionId, page.map(message => ({ messageId: message.id,
    contentHash: sourceContentHash(workspace.rootPath, sessionId, historySourceContent(message)) })))
  let remaining = query.maxCharacters ?? 12000
  let nextIndex = offset, nextCharacter = start
  const output: SessionHistoryPage['messages'] = []
  for (const [index, message] of page.entries()) {
    if (remaining <= 0) break
    const access = sources[index]!
    const beginning = Math.min(index === 0 ? start : 0, access.source?.content.length ?? 0)
    const content = access.source?.content.slice(beginning, beginning + remaining) ?? ''
    const end = beginning + content.length, length = access.source?.content.length ?? 0
    remaining -= content.length
    const partial = end < length
    nextIndex = offset + index + (partial ? 0 : 1); nextCharacter = partial ? end : 0
    output.push({ id: message.id, historyOffset: entries.findIndex(entry => entry.id === message.id), role: message.type, timestamp: message.timestamp,
      inputSource: message.inputSource, hidden: message.hidden, isIntermediate: message.isIntermediate, directUser: isDirectUserMessage(message),
      content, contentHash: access.source?.contentHash ?? '', historical: true, toolName: message.toolName,
      coverage: access.unavailable ? 'unavailable' : beginning === 0 && !partial ? 'full' : 'partial', unavailable: access.unavailable,
      startCharacter: beginning, endCharacter: end, characters: length, nextCharacter: partial ? end : null,
      attachmentCount: message.attachments?.length ?? 0,
      ...(!access.unavailable && message.attachments?.length ? { attachments: message.attachments.slice(0, 16).map(({ id, name, mimeType, storedPath, size }) => ({ id, name, mimeType, storedPath, size })) } : {}) })
    if (partial) break
  }
  const hasMore = nextIndex < matching.length
  return { sessionId, snapshot, total: matching.length, offset, messages: output, hasMore,
    nextOffset: hasMore ? nextIndex : null, nextCursor: hasMore ? { snapshot, count, offset: nextIndex, character: nextCharacter, ...(messageId ? { messageId } : {}) } : null }
}
