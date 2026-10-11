import { useCallback, useEffect, useRef } from 'react'
import type { SessionDraft } from '@phaneris/shared/config/persisted-types'
import { getClientPlatform } from '@/platform/client'

/** Own only absolute draft snapshots. Tool effects and session commands never enter this queue. */
export function useDraftPersistence(readDraft: (sessionId: string) => SessionDraft) {
  const pending = useRef(new Map<string, SessionDraft>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const flushing = useRef<Promise<void> | null>(null)

  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current) {
      await flushing.current
      // A newer edit may have arrived while the preceding write was acknowledged.
      if (pending.current.size) await flush()
      return
    }
    const write = (async () => {
      while (pending.current.size) {
        for (const [id, snapshot] of [...pending.current]) {
          const timer = timers.current.get(id)
          if (timer) clearTimeout(timer)
          timers.current.delete(id)
          await getClientPlatform().drafts.setDraft(id, snapshot)
          if (pending.current.get(id) === snapshot) pending.current.delete(id)
        }
      }
    })()
    flushing.current = write
    try { await write } finally {
      if (flushing.current === write) flushing.current = null
    }
  }, [])

  const persistWhenConnected = useCallback(async () => {
    try { await flush() } catch (error) {
      // A failed draft remains queued. Reconnection retries this idempotent snapshot;
      // other server failures remain visible and also prevent a workspace switch.
      const message = error instanceof Error ? error.message : String(error)
      if (!/^(Not connected \(channel: drafts:set\)|Connection lost(?: before handshake)?)$/.test(message)) {
        console.error('Failed to persist session draft:', error)
      }
    }
  }, [flush])

  const schedule = useCallback((sessionId: string) => {
    pending.current.set(sessionId, readDraft(sessionId))
    const previous = timers.current.get(sessionId)
    if (previous) clearTimeout(previous)
    timers.current.set(sessionId, setTimeout(() => { void persistWhenConnected() }, 500))
  }, [readDraft, persistWhenConnected])

  useEffect(() => {
    const ownedTimers = timers.current
    const unsubscribe = getClientPlatform().connection.onTransportConnectionStateChanged(state => {
      if (state.status === 'connected' && pending.current.size) void persistWhenConnected()
    })
    return () => {
      unsubscribe()
      ownedTimers.forEach(clearTimeout)
      ownedTimers.clear()
    }
  }, [persistWhenConnected])

  return { schedule, flush }
}
