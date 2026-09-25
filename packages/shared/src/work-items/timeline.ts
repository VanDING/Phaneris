/**
 * Timeline range semantics — the one place that converts between the app's
 * **inclusive** planning dates and a renderer's **exclusive** end boundary.
 *
 * `WorkItem.startAt` / `dueAt` are inclusive: a task from the 10th to the 14th
 * occupies five days, the 14th included. Timeline renderers take an exclusive
 * `end` instead (SVAR's scale generator iterates `for (; cell < end; )`), so a
 * due date of the 14th must be handed over as the 15th.
 *
 * The previous adapter only added that day when `start === end`, so every
 * multi-day bar rendered one day short — a 5-day task drew 4 cells and a
 * 161-day task drew 160 (measured). Feeding `endExclusive` through one shared
 * helper makes the off-by-one structurally impossible rather than a rule each
 * caller has to remember, and `fromTimelineRange` guarantees the write path
 * round-trips.
 *
 * All arithmetic is calendar-based (`addDays` / `differenceInCalendarDays`), so
 * a day is a day across DST transitions and month or year boundaries. Millisecond
 * arithmetic (`± 86_400_000`) silently yields 0 or 2 days on the 23- and 25-hour
 * days.
 */
import { addDays, differenceInCalendarDays } from 'date-fns';
import { planDateKey, planDayKeyFromDate } from './plan-date.ts';

export interface TimelineRange {
  /** First day the bar covers, at local midnight. */
  start: Date;
  /** First day **after** the bar, at local midnight. */
  endExclusive: Date;
}

/** The planning fields a timeline range is derived from. */
export interface TimelineSource {
  startAt?: string;
  dueAt?: string;
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateFromDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

/**
 * Inclusive planning dates to an exclusive-end render range.
 *
 * Tolerant by design: malformed values are ignored, and inverted data
 * (`startAt` after `dueAt`) collapses to the span it actually covers rather than
 * producing a negative-width bar. Returns `undefined` only when neither field
 * holds a usable date, which is the honest representation of an unscheduled row.
 */
export function toTimelineRange(item: TimelineSource): TimelineRange | undefined {
  const startKey = planDateKey(item.startAt);
  const dueKey = planDateKey(item.dueAt);
  const firstKey = startKey ?? dueKey;
  const lastKey = dueKey ?? startKey;
  if (!firstKey || !lastKey) return undefined;

  const first = dateFromDayKey(firstKey);
  const last = dateFromDayKey(lastKey);
  const inverted = first.getTime() > last.getTime();
  const start = inverted ? last : first;
  const endInclusive = inverted ? first : last;

  return { start, endExclusive: addDays(endInclusive, 1) };
}

/** Number of days the range covers, inclusive of both ends. Always at least 1. */
export function timelineDayCount(range: TimelineRange): number {
  const span = differenceInCalendarDays(range.endExclusive, range.start);
  return span >= 1 ? span : 1;
}

/**
 * Exclusive-end render range back to inclusive planning dates (the write path).
 *
 * A zero or inverted span collapses to a single day at `start`, because a
 * renderer should not be able to write a task that ends before it begins.
 */
export function fromTimelineRange(start: Date, endExclusive: Date): { startAt: string; dueAt: string } {
  const startDay = localMidnight(start);
  const endDay = localMidnight(endExclusive);
  const span = differenceInCalendarDays(endDay, startDay);
  const dueDay = span >= 1 ? addDays(endDay, -1) : startDay;
  return { startAt: planDayKeyFromDate(startDay), dueAt: planDayKeyFromDate(dueDay) };
}
