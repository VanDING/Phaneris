import type { CalendarEntry, CalendarEntryInput } from '../protocol/dto'
import type { WorkItem } from './types'
import { isValidPlanValue, planDateKey, planTimeOfDay } from './plan-date'

/** Calendar and list views derive from the same bounded Session projection. */
export function workItemToCalendarEntry(item: WorkItem): CalendarEntry | null {
  const date = planDateKey(item.startAt) ?? planDateKey(item.dueAt)
  if (!date) return null
  const time = planTimeOfDay(item.startAt)
  return {
    id: item.id, title: item.title, date, endDate: planDateKey(item.dueAt) ?? date,
    time, endTime: planTimeOfDay(item.dueAt), allDay: !time,
    note: item.description, projectId: item.projectId,
    createdAt: item.createdAt, updatedAt: item.updatedAt,
  }
}

/** Preserve the legacy calendar RPC's date validation and inclusive last day. */
export function calendarPlanningFields(input: CalendarEntryInput): { startAt: string; dueAt: string } {
  const endDate = input.endDate ?? input.date
  for (const [field, value] of [['date', input.date], ['endDate', endDate]] as const) {
    if (!isValidPlanValue(value)) throw new Error(`Invalid ${field}: expected YYYY-MM-DD or YYYY-MM-DDTHH:mm, received "${value}"`)
  }
  if (endDate < input.date) throw new Error('End date must not be before the start date')
  return {
    startAt: !input.allDay && input.time ? `${input.date}T${input.time}` : input.date,
    dueAt: !input.allDay && input.endTime ? `${endDate}T${input.endTime}` : endDate,
  }
}
