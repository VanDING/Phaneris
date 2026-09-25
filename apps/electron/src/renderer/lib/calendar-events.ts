/**
 * Planning dates ↔ FullCalendar event conversion.
 *
 * Kept out of the view because this is where a silent off-by-one lives, and it is
 * the one part of the calendar that is not the library's job. The two directions
 * are asymmetrically defined by FullCalendar:
 *
 *   - **all-day** `end` is EXCLUSIVE — a one-day event ends at the next midnight,
 *     so a due date of the 12th must be handed over as the 13th;
 *   - **timed** `end` is the real end instant, so 10:00–10:30 ends at 10:30 and
 *     must NOT be advanced.
 *
 * The inclusive→exclusive half is delegated to the shared `toTimelineRange`, so
 * the calendar and the Gantt cannot disagree about how long a task is.
 */
import type { CalendarEntry } from '@phaneris/shared/protocol'
import { planDayKeyFromDate, toTimelineRange } from '@phaneris/shared/work-items/browser'

/** The slice of a FullCalendar event this module reads and writes. */
export interface CalendarEventShape {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  extendedProps: { entry: CalendarEntry }
}

/** One hour after an `HH:mm`, clamped so a derived end never crosses midnight. */
export function oneHourAfter(time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return `${String(Math.min(23, hour + 1)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** A planning entry as a FullCalendar event. */
export function toEventInput(entry: CalendarEntry): CalendarEventShape {
  const range = toTimelineRange({ startAt: entry.date, dueAt: entry.endDate ?? entry.date })
  const startDay = range ? planDayKeyFromDate(range.start) : entry.date
  // `endExclusive` is already the day after the inclusive due day, which is
  // exactly what an all-day event's `end` means.
  const endExclusiveDay = range ? planDayKeyFromDate(range.endExclusive) : entry.date
  const allDay = entry.allDay ?? !entry.time

  if (allDay || !entry.time) {
    return {
      id: entry.id,
      title: entry.title,
      start: startDay,
      end: endExclusiveDay,
      allDay: true,
      extendedProps: { entry },
    }
  }

  const endDayInclusive = entry.endDate ?? entry.date
  const endTime = entry.endTime ?? oneHourAfter(entry.time)
  return {
    id: entry.id,
    title: entry.title,
    start: `${entry.date}T${entry.time}`,
    // Timed end is a real instant, so it is used as-is.
    end: `${endDayInclusive}T${endTime}`,
    allDay: false,
    extendedProps: { entry },
  }
}

/** The inclusive planning dates a drag or resize produced, or `undefined`. */
export function fromEventDates(
  start: Date | null,
  end: Date | null,
  allDay: boolean,
): { date: string; endDate: string; time?: string; endTime?: string } | undefined {
  if (!start) return undefined
  const date = planDayKeyFromDate(start)

  if (allDay) {
    // All-day `end` is exclusive: step back one day to get the inclusive due day.
    const inclusiveEnd = end ? new Date(end.getTime() - 1) : start
    return { date, endDate: planDayKeyFromDate(inclusiveEnd) }
  }

  const time = clockOf(start)
  if (!end) return { date, endDate: date, time, endTime: oneHourAfter(time) }

  const endDay = planDayKeyFromDate(end)
  const endsAtMidnight = end.getHours() === 0 && end.getMinutes() === 0 && endDay !== date
  if (endsAtMidnight) {
    // An end at exactly midnight belongs to the night before; writing the next
    // day would silently extend the entry by a day.
    return { date, endDate: planDayKeyFromDate(new Date(end.getTime() - 1)), time, endTime: '23:59' }
  }
  return { date, endDate: endDay, time, endTime: clockOf(end) }
}
