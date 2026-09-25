/**
 * useCalendarEntries — load and manage workspace calendar entries.
 *
 * Entries are a **projection of Session planning fields** (`calendar:list` maps
 * every visible Session carrying a date), not a standalone store — creating one
 * creates a Session, and deleting one clears its dates. The previous header here
 * claimed the opposite, which is what led feature work to assume an independent
 * store existed.
 *
 * Mutations THROW on failure. They previously logged and returned `null`, which
 * made a rejected write indistinguishable from a no-op: the editor closed as if
 * it had saved, and a failed drag left the old data on screen with no
 * explanation. Callers now own the failure path, so every one of them has to
 * decide what the user sees.
 */

import { useState, useEffect, useCallback } from 'react'
import type { CalendarEntry, CalendarEntryInput } from '@phaneris/shared/protocol'

export interface UseCalendarEntriesResult {
  entries: CalendarEntry[]
  isLoading: boolean
  /** Load failure only; mutation failures are thrown from the mutator. */
  error: string | null
  refresh: () => Promise<void>
  create: (input: CalendarEntryInput) => Promise<CalendarEntry>
  update: (entryId: string, input: CalendarEntryInput) => Promise<CalendarEntry>
  remove: (entryId: string) => Promise<void>
}

/** A readable message for an unknown thrown value, with a caller-supplied fallback. */
export function calendarErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const message = err.message.trim()
    // Electron IPC wraps handler failures; the wrapper text is noise, the
    // server's own sentence is the useful part.
    if (message && message !== 'Error') return message
  }
  if (typeof err === 'string' && err.trim()) return err.trim()
  return fallback
}

export function useCalendarEntries(workspaceId: string | null): UseCalendarEntriesResult {
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setEntries([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const list = await window.electronAPI.listCalendarEntries(workspaceId)
      setEntries(list)
      setError(null)
    } catch (err) {
      console.error('[useCalendarEntries] Failed to load calendar entries:', err)
      setError(calendarErrorMessage(err, 'Failed to load calendar entries'))
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Live updates: any window creating/editing/deleting entries refreshes all views.
  useEffect(() => {
    if (!workspaceId) return
    const cleanup = window.electronAPI.onCalendarEntriesChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) refresh()
    })
    return cleanup
  }, [workspaceId, refresh])

  const create = useCallback(
    async (input: CalendarEntryInput) => {
      if (!workspaceId) throw new Error('No workspace is active')
      try {
        const entry = await window.electronAPI.createCalendarEntry(workspaceId, input)
        setEntries((prev) => [...prev, entry])
        return entry
      } catch (err) {
        console.error('[useCalendarEntries] Failed to create entry:', err)
        throw new Error(calendarErrorMessage(err, 'Failed to create the schedule entry'))
      }
    },
    [workspaceId],
  )

  const update = useCallback(
    async (entryId: string, input: CalendarEntryInput) => {
      if (!workspaceId) throw new Error('No workspace is active')
      try {
        const entry = await window.electronAPI.updateCalendarEntry(workspaceId, entryId, input)
        setEntries((prev) => prev.map((e) => (e.id === entryId ? entry : e)))
        return entry
      } catch (err) {
        console.error('[useCalendarEntries] Failed to update entry:', err)
        throw new Error(calendarErrorMessage(err, 'Failed to update the schedule entry'))
      }
    },
    [workspaceId],
  )

  const remove = useCallback(
    async (entryId: string) => {
      if (!workspaceId) throw new Error('No workspace is active')
      try {
        await window.electronAPI.deleteCalendarEntry(workspaceId, entryId)
        setEntries((prev) => prev.filter((e) => e.id !== entryId))
      } catch (err) {
        console.error('[useCalendarEntries] Failed to delete entry:', err)
        throw new Error(calendarErrorMessage(err, 'Failed to remove the schedule entry'))
      }
    },
    [workspaceId],
  )

  return { entries, isLoading, error, refresh, create, update, remove }
}
