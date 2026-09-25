/**
 * Plan-date normalization — the single implementation of "what day and clock
 * does this planning value denote".
 *
 * A planning value (`Session.startAt` / `dueAt`, projected as
 * `WorkItem.startAt` / `dueAt`) is one of two things, and conflating them is
 * what produced three divergent parsers:
 *
 *   1. A **date-only** value (`YYYY-MM-DD`) denotes all-day work on that local
 *      calendar day. It must never be turned into an instant, because doing so
 *      shifts it a day backwards for every user west of UTC.
 *   2. A **timed** value denotes a clock reading. Without an offset it is a local
 *      wall time, so its calendar day is the written date verbatim. With an
 *      offset (`Z` or `±HH:MM`) it is an absolute instant, so its calendar day
 *      and clock must be read back in the host's own time zone.
 *
 * Previously the server used a bare `slice(0, 10)` (so `2026-09-22T02:00:00Z`
 * displayed as 02:00 rather than 10:00 at +08:00, and a space-separated value
 * silently became all-day), the client used `new Date(...)` with no validation
 * (so `2026-9-2` broke lexicographic range checks and became `NaN-NaN-NaN` when
 * dragged), and `work-items/query.ts` had its own regex-checked variant that
 * nothing else called.
 */
import { getISOWeek } from 'date-fns';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/;

export interface ParsedPlanValue {
  /** Local calendar day (`YYYY-MM-DD`). */
  dayKey: string;
  /** Local clock (`HH:mm`), absent for all-day values. */
  time?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one; this handles February
  // and leap years without a table.
  return new Date(year, month, 0).getDate();
}

function isValidDateParts(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

function isValidTimeParts(hour: string, minute: string, second?: string): boolean {
  if (Number(hour) > 23 || Number(minute) > 59) return false;
  if (second !== undefined && Number(second) > 59) return false;
  return true;
}

/** Zero-padded `YYYY-MM-DD` for a Date's **local** calendar day. */
export function planDayKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Parse a planning value, or `undefined` when it is absent or malformed.
 *
 * Malformed input is rejected rather than coerced: a value the app cannot
 * interpret must not silently become "today" (which then sorts and compares as
 * if it were real).
 */
export function parsePlanValue(value: string | undefined): ParsedPlanValue | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    if (!isValidDateParts(year!, month!, day!)) return undefined;
    // Returned verbatim: an all-day value has no instant, so there is nothing to
    // convert and no time zone that could move it.
    return { dayKey: `${year}-${month}-${day}` };
  }

  const dateTime = DATE_TIME_PATTERN.exec(trimmed);
  if (!dateTime) return undefined;
  const [, year, month, day, hour, minute, second, offset] = dateTime;
  if (!isValidDateParts(year!, month!, day!)) return undefined;
  if (!isValidTimeParts(hour!, minute!, second)) return undefined;

  if (!offset) {
    // Local wall time: the written date *is* the local day.
    return { dayKey: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
  }

  // Offset-bearing: an absolute instant. Read it back in the host's zone so an
  // instant that is 02:00 UTC displays as 10:00 at +08:00.
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) return undefined;
  return {
    dayKey: planDayKeyFromDate(instant),
    time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  };
}

/** The local calendar day a planning value denotes, or `undefined`. */
export function planDateKey(value: string | undefined): string | undefined {
  return parsePlanValue(value)?.dayKey;
}

/** The local clock a planning value denotes; `undefined` means all-day. */
export function planTimeOfDay(value: string | undefined): string | undefined {
  return parsePlanValue(value)?.time;
}

/**
 * Whether a value may be persisted.
 *
 * An absent value is valid (the field is optional); an empty or malformed string
 * is not, so a write cannot create data the read path would reject.
 */
export function isValidPlanValue(value: string | undefined): boolean {
  if (value === undefined) return true;
  return parsePlanValue(value) !== undefined;
}

/**
 * ISO-8601 week number.
 *
 * The previous hand-rolled formula anchored on 1 January with a Sunday week
 * start, which disagreed with ISO for 53 of the 156 Mondays in 2025–2027 (and
 * for all of 2027). Delegating to `date-fns` removes the whole class of error.
 */
export function isoWeekNumber(date: Date): number {
  return getISOWeek(date);
}

/**
 * Why a plan range cannot be written, or `null` when it can.
 *
 * This lives here — with the format predicate it depends on — because it is the one
 * rule every write path shares: `updateSessionPlanning` is the choke point behind
 * the board, the calendar, the timeline and the task editor, and before this guard
 * the range check existed only in `calendar:update` (plus the two editor pages that
 * were retired). Which door the user came through must not decide whether a
 * reversed range is storable.
 *
 * The comparison is lexicographic on purpose: `YYYY-MM-DD[THH:mm]` is fixed-width,
 * so string order IS chronological order, and a timed value on the same day sorts
 * after its date-only form — which is exactly the case a month/day comparison gets
 * wrong. Both formats are validated first, so a malformed value can never reach a
 * comparison that would silently call it ordered.
 */
export function planRangeError(startAt: string | undefined, dueAt: string | undefined): string | null {
  if (startAt !== undefined && !isValidPlanValue(startAt)) {
    return `Invalid start date: expected YYYY-MM-DD or YYYY-MM-DDTHH:mm, received "${startAt}"`;
  }
  if (dueAt !== undefined && !isValidPlanValue(dueAt)) {
    return `Invalid end date: expected YYYY-MM-DD or YYYY-MM-DDTHH:mm, received "${dueAt}"`;
  }
  if (startAt !== undefined && dueAt !== undefined && dueAt < startAt) {
    return 'End date must not be before the start date';
  }
  return null;
}
