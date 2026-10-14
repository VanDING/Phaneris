/** Calendar entries share the workspace WorkItem projection; writes still persist Sessions. */
import { useCallback, useMemo } from 'react'
import type { CalendarEntry, CalendarEntryInput } from '@phaneris/shared/protocol'
import { calendarPlanningFields, workItemToCalendarEntry } from '@phaneris/shared/work-items/browser'
import { useWorkItemsCollection } from './work-items-collection'

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

export function calendarErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const message = err.message.trim()
    if (message && message !== 'Error') return message
  }
  if (typeof err === 'string' && err.trim()) return err.trim()
  return fallback
}

export function useCalendarEntries(workspaceId: string | null): UseCalendarEntriesResult {
  const { items, isLoading, error, collection } = useWorkItemsCollection(workspaceId)
  const entries = useMemo(() => items.flatMap(item => {
    const entry = workItemToCalendarEntry(item)
    return entry ? [entry] : []
  }), [items])
  const refresh = useCallback(async () => { await collection?.refresh() }, [collection])
  const create = useCallback(async (input: CalendarEntryInput) => {
    if (!collection) throw new Error('No workspace is active')
    try {
      const item = await collection.create({
        ...calendarPlanningFields(input), title: input.title.trim(), projectId: input.projectId,
        description: input.note, statusId: 'backlog',
      })
      const entry = workItemToCalendarEntry(item)
      if (!entry) throw new Error('The schedule entry has no valid date')
      return entry
    } catch (cause) { throw new Error(calendarErrorMessage(cause, 'Failed to create the schedule entry')) }
  }, [collection])
  const update = useCallback(async (id: string, input: CalendarEntryInput) => {
    if (!collection) throw new Error('No workspace is active')
    try {
      const item = await collection.update(id, {
        ...calendarPlanningFields(input), title: input.title.trim(),
        projectId: input.projectId ?? null, description: input.note ?? null,
      })
      const entry = workItemToCalendarEntry(item)
      if (!entry) throw new Error('The schedule entry has no valid date')
      return entry
    } catch (cause) { throw new Error(calendarErrorMessage(cause, 'Failed to update the schedule entry')) }
  }, [collection])
  const remove = useCallback(async (id: string) => {
    if (!collection) throw new Error('No workspace is active')
    try { await collection.update(id, { startAt: null, dueAt: null }) }
    catch (cause) { throw new Error(calendarErrorMessage(cause, 'Failed to remove the schedule entry')) }
  }, [collection])
  return { entries, isLoading, error, refresh, create, update, remove }
}
