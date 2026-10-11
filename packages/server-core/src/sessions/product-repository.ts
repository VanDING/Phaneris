/** Product persistence adapter. Execution recovery and admission remain on the Runtime Host. */
import { loadSession, sessionPersistenceQueue, type StoredSession } from '@phaneris/shared/sessions'
import { messageToStored, type Message } from '@phaneris/core/types'

export type SessionProductSnapshot = Omit<StoredSession, 'messages' | 'tokenUsage' | 'createdAt' | 'lastUsedAt'> & {
  createdAt?: number
  messages: readonly Message[]
  tokenUsage?: StoredSession['tokenUsage']
}
export class SessionProductRepository {
  load(workspaceRootPath: string, sessionId: string): StoredSession | null { return loadSession(workspaceRootPath, sessionId) }
  enqueue(sessionId: string, readSnapshot: () => SessionProductSnapshot): void {
    sessionPersistenceQueue.enqueueLazy(sessionId, () => {
      const snapshot = readSnapshot()
      if (snapshot.id !== sessionId) throw new Error('Product persistence session identity mismatch')
      return { ...snapshot, createdAt: snapshot.createdAt ?? Date.now(), lastUsedAt: Date.now(),
        messages: snapshot.messages.filter(message => message.role !== 'status').map(messageToStored),
        tokenUsage: snapshot.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } }
    })
  }
  flush(sessionId: string): Promise<void> { return sessionPersistenceQueue.flush(sessionId) }
  flushAll(): Promise<void> { return sessionPersistenceQueue.flushAll() }
  cancel(sessionId: string): void { sessionPersistenceQueue.cancel(sessionId) }
  hasPending(sessionId: string): boolean { return sessionPersistenceQueue.hasPending(sessionId) }
  getLastWrittenSignature(sessionId: string): string | undefined { return sessionPersistenceQueue.getLastWrittenSignature(sessionId) }
}
