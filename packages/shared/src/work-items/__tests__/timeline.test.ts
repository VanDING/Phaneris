/**
 * Failure cases for exclusive-end timeline ranges, written BEFORE the
 * implementation.
 *
 * Background: the timeline library (SVAR) treats a task's `end` as an EXCLUSIVE
 * boundary — its scale generator iterates `for (; cell < end; )`. The previous
 * adapter fed it `dueAt` verbatim and only added a day when `start === end`, so
 * every multi-day bar was one day short. Measured on the old code: a 5-day task
 * rendered 4 cells, a 161-day task rendered 160.
 *
 * These cases pin the corrected inclusive-day contract. The DST cases are
 * structural (they hold in any timezone) but only *bite* where the local zone
 * observes DST — run `TZ=America/New_York bun test` to exercise them for real.
 */
import { describe, expect, it } from 'bun:test';
import { addDays, differenceInCalendarDays, getDaysInMonth, startOfDay } from 'date-fns';
import { planDayKeyFromDate } from '../plan-date.ts';
import { fromTimelineRange, timelineDayCount, toTimelineRange } from '../timeline.ts';

function day(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

describe('toTimelineRange — inclusive due date becomes an exclusive boundary', () => {
  it('returns undefined when the item carries no planning date', () => {
    expect(toTimelineRange({})).toBeUndefined();
    expect(toTimelineRange({ startAt: undefined, dueAt: undefined })).toBeUndefined();
  });

  it('spans exactly one day when only a due date is known', () => {
    const range = toTimelineRange({ dueAt: '2026-09-22' })!;
    expect(timelineDayCount(range)).toBe(1);
    expect(range.start).toEqual(day('2026-09-22'));
    expect(range.endExclusive).toEqual(day('2026-09-23'));
  });

  it('spans exactly one day when only a start date is known', () => {
    const range = toTimelineRange({ startAt: '2026-09-22' })!;
    expect(timelineDayCount(range)).toBe(1);
    expect(range.endExclusive).toEqual(day('2026-09-23'));
  });

  it('spans exactly one day for a zero-length task (start === due)', () => {
    const range = toTimelineRange({ startAt: '2026-09-22', dueAt: '2026-09-22' })!;
    expect(timelineDayCount(range)).toBe(1);
    expect(range.endExclusive).toEqual(day('2026-09-23'));
  });

  it('includes the due day: a 5-day task is 5 days, not 4', () => {
    // The regression the plan measured: start −12 / due −8 rendered 4 cells.
    const range = toTimelineRange({ startAt: '2026-09-10', dueAt: '2026-09-14' })!;
    expect(timelineDayCount(range)).toBe(5);
    expect(range.endExclusive).toEqual(day('2026-09-15'));
  });

  it('includes the due day at every length', () => {
    const cases: Array<[string, string, number]> = [
      ['2026-09-10', '2026-09-11', 2],
      ['2026-09-10', '2026-09-16', 7],
      ['2026-01-01', '2026-12-31', 365],
      ['2025-01-01', '2025-12-31', 365],
      ['2024-01-01', '2024-12-31', 366], // leap year
    ];
    for (const [startAt, dueAt, expected] of cases) {
      expect(timelineDayCount(toTimelineRange({ startAt, dueAt })!)).toBe(expected);
    }
  });

  it('spans the plan-mentioned 161-day case as 161 days', () => {
    const range = toTimelineRange({ startAt: '2026-05-01', dueAt: '2026-10-08' })!;
    expect(timelineDayCount(range)).toBe(161);
  });

  it('crosses month and year boundaries as calendar days', () => {
    const range = toTimelineRange({ startAt: '2026-12-30', dueAt: '2027-01-02' })!;
    expect(timelineDayCount(range)).toBe(4);
    expect(range.endExclusive).toEqual(day('2027-01-03'));
  });

  it('includes 29 February of a leap year', () => {
    const range = toTimelineRange({ startAt: '2024-02-28', dueAt: '2024-03-01' })!;
    expect(timelineDayCount(range)).toBe(3);
  });

  it('never produces a negative or zero span when start is after due', () => {
    // Tolerant, not throwing: corrupt planning data must not break the view.
    const range = toTimelineRange({ startAt: '2026-09-22', dueAt: '2026-09-10' })!;
    expect(timelineDayCount(range)).toBeGreaterThanOrEqual(1);
    expect(range.endExclusive.getTime()).toBeGreaterThan(range.start.getTime());
  });

  it('ignores malformed values instead of producing NaN', () => {
    expect(toTimelineRange({ startAt: '2026-9-2', dueAt: '2026-9-5' })).toBeUndefined();
    expect(toTimelineRange({ startAt: 'garbage' })).toBeUndefined();
    expect(toTimelineRange({ startAt: '2026-02-30' })).toBeUndefined();
  });

  it('falls back to the parseable side when only one value is malformed', () => {
    const range = toTimelineRange({ startAt: '2026-9-2', dueAt: '2026-09-05' })!;
    expect(timelineDayCount(range)).toBe(1);
    expect(range.start).toEqual(day('2026-09-05'));
  });

  it('normalizes a timed value to whole days', () => {
    const range = toTimelineRange({ startAt: '2026-09-10T14:30', dueAt: '2026-09-12T09:00' })!;
    expect(range.start).toEqual(day('2026-09-10'));
    expect(range.endExclusive).toEqual(day('2026-09-13'));
    expect(timelineDayCount(range)).toBe(3);
  });
});

describe('timelineDayCount — calendar arithmetic, not milliseconds', () => {
  it('lands endExclusive exactly on local midnight across both DST directions', () => {
    // This is the assertion that actually bites. Building the boundary by adding
    // 86_400_000 ms instead of one calendar day drifts to 01:00 on a 23-hour day
    // (2026-03-08 in America/New_York) and to 23:00 — the WRONG day — on a
    // 25-hour day (2026-11-01). Verified to fail against a millisecond-based
    // implementation under TZ=America/New_York.
    for (const iso of ['2026-03-08', '2026-11-01', '2026-03-07', '2026-10-31']) {
      const range = toTimelineRange({ startAt: iso, dueAt: iso })!;
      expect(range.endExclusive.getHours()).toBe(0);
      expect(range.endExclusive.getMinutes()).toBe(0);
      expect(range.endExclusive.getSeconds()).toBe(0);
      expect(range.start.getHours()).toBe(0);
    }
  });

  it('counts a multi-day span across the spring-forward day without losing one', () => {
    // start −7 → due −5 in the plan's fixture terms. The truncated range is
    // 71 hours, so a floored millisecond division reports 2; the `>= 1` guard in
    // timelineDayCount cannot mask this one, unlike a single-day span.
    for (const [startAt, dueAt, expected] of [
      ['2026-03-07', '2026-03-09', 3],
      ['2026-03-06', '2026-03-12', 7],
      ['2026-03-01', '2026-03-31', 31],
    ] as Array<[string, string, number]>) {
      expect(timelineDayCount(toTimelineRange({ startAt, dueAt })!)).toBe(expected);
    }
  });

  it('covers every consecutive day exactly once across a DST boundary', () => {
    // Structural invariant: walking [d, d+1) over a whole month must visit each
    // day key once, with no repeat and no gap, in any timezone.
    for (const month of ['2026-03', '2026-11']) {
      const daysInMonth = getDaysInMonth(day(`${month}-01`));
      let cursor = startOfDay(day(`${month}-01`));
      const seen: string[] = [];
      for (let index = 0; index < daysInMonth; index += 1) {
        const range = { start: cursor, endExclusive: addDays(cursor, 1) };
        expect(timelineDayCount(range)).toBe(1);
        seen.push(fromTimelineRange(range.start, range.endExclusive).startAt);
        cursor = range.endExclusive;
      }
      expect(seen).toHaveLength(daysInMonth);
      expect(new Set(seen).size).toBe(daysInMonth);
      expect(seen[0]).toBe(`${month}-01`);
      expect(seen[1]).toBe(`${month}-02`);
      // Last entry is the month's own last day, and the cursor has rolled into
      // the next month — proving no day was skipped or repeated.
      expect(seen[daysInMonth - 1]).toBe(planDayKeyFromDate(addDays(day(`${month}-01`), daysInMonth - 1)));
      expect(fromTimelineRange(cursor, addDays(cursor, 1)).startAt).toBe(
        planDayKeyFromDate(addDays(day(`${month}-01`), daysInMonth)),
      );
    }
  });

  it('agrees with the calendar difference for every length 1..40 through the real path', () => {
    // Drives toTimelineRange rather than hand-built ranges, so the assertion
    // tests the implementation instead of restating the input.
    for (let length = 1; length <= 40; length += 1) {
      const start = day('2026-03-01');
      const dueAt = fromTimelineRange(start, addDays(start, length)).dueAt;
      const range = toTimelineRange({ startAt: '2026-03-01', dueAt })!;
      expect(timelineDayCount(range)).toBe(length);
      expect(range.endExclusive).toEqual(addDays(start, length));
      expect(timelineDayCount(range)).toBe(differenceInCalendarDays(range.endExclusive, range.start));
    }
  });
});

describe('fromTimelineRange — write path', () => {
  it('converts an exclusive boundary back to an inclusive due date', () => {
    expect(fromTimelineRange(day('2026-09-10'), day('2026-09-15'))).toEqual({
      startAt: '2026-09-10',
      dueAt: '2026-09-14',
    });
  });

  it('round-trips every range produced by toTimelineRange', () => {
    const cases = [
      { startAt: '2026-09-10', dueAt: '2026-09-14' },
      { startAt: '2026-09-22', dueAt: '2026-09-22' },
      { startAt: '2026-12-30', dueAt: '2027-01-02' },
      { startAt: '2024-02-28', dueAt: '2024-03-01' },
      { dueAt: '2026-09-22' },
      { startAt: '2026-09-22T14:30', dueAt: '2026-09-24T09:00' },
    ];
    for (const item of cases) {
      const range = toTimelineRange(item)!;
      const written = fromTimelineRange(range.start, range.endExclusive);
      const reread = toTimelineRange(written)!;
      expect(timelineDayCount(reread)).toBe(timelineDayCount(range));
      expect(reread.start).toEqual(range.start);
      expect(reread.endExclusive).toEqual(range.endExclusive);
    }
  });

  it('round-trips across the DST boundary without drifting', () => {
    for (const iso of ['2026-03-07', '2026-03-08', '2026-11-01']) {
      const start = startOfDay(day(iso));
      const endExclusive = addDays(start, 3);
      const written = fromTimelineRange(start, endExclusive);
      const reread = toTimelineRange(written)!;
      expect(reread.start).toEqual(start);
      expect(reread.endExclusive).toEqual(endExclusive);
      expect(timelineDayCount(reread)).toBe(3);
    }
  });

  it('clamps a zero or inverted span to a single day', () => {
    expect(fromTimelineRange(day('2026-09-22'), day('2026-09-22'))).toEqual({
      startAt: '2026-09-22',
      dueAt: '2026-09-22',
    });
    expect(fromTimelineRange(day('2026-09-22'), day('2026-09-10'))).toEqual({
      startAt: '2026-09-22',
      dueAt: '2026-09-22',
    });
  });

  it('zero-pads every component', () => {
    expect(fromTimelineRange(day('2026-01-05'), day('2026-01-06'))).toEqual({
      startAt: '2026-01-05',
      dueAt: '2026-01-05',
    });
  });
});
