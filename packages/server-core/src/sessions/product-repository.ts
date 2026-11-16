/** Product persistence adapter. Execution recovery and admission remain on the Runtime Host. */
import { loadSession, sessionPersistenceQueue, type StoredSession, type SessionHeader } from '@phaneris/shared/sessions'
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
  commitMetadata<T extends Partial<SessionHeader>>(workspaceRootPath: string, sessionId: string, owner: T, patch: Partial<Omit<SessionHeader, 'id' | 'workspaceRootPath' | 'messageCount' | 'tokenUsage'>>): Promise<void> {
    return sessionPersistenceQueue.patchHeader(workspaceRootPath, sessionId, patch, () => Object.assign(owner, patch))
  }
  releaseProject(workspaceRootPath: string, sessionId: string, owner: { projectId?: string }, projectId: string): Promise<void> {
    // Resolve against the queued read, not an earlier Host or disk snapshot.
    // A different external assignment survives and becomes the Host's value.
    return sessionPersistenceQueue.patchHeader(workspaceRootPath, sessionId,
      current => ({ projectId: current.projectId === projectId ? undefined : current.projectId }),
      committed => { owner.projectId = committed.projectId })
  }
  flushAll(): Promise<void> { return sessionPersistenceQueue.flushAll() }
  cancel(sessionId: string): void { sessionPersistenceQueue.cancel(sessionId) }
  async cancelAndWait(sessionId: string): Promise<void> {
    sessionPersistenceQueue.cancel(sessionId)
    try { await sessionPersistenceQueue.flush(sessionId) }
    finally { sessionPersistenceQueue.cancel(sessionId) }
  }
  hasPending(sessionId: string): boolean { return sessionPersistenceQueue.hasPending(sessionId) }
  getLastWrittenSignature(sessionId: string): string | undefined { return sessionPersistenceQueue.getLastWrittenSignature(sessionId) }
}
