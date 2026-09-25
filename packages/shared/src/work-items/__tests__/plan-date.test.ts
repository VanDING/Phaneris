/**
 * Failure cases for plan-date normalization, written BEFORE the implementation.
 *
 * Every case below is a way the previous three ad-hoc implementations
 * (server `calendar.ts:12-18` bare `slice`, client `parsePlanDate`,
 * `work-items/query.ts:workItemDateKey`) demonstrably got it wrong.
 *
 * Timezone note: the host timezone is deliberately NOT assumed. Cases that
 * depend on the local offset assert the *definition* (the local calendar day of
 * the instant) rather than a hardcoded day, so the suite is correct on any
 * machine while still catching the UTC-slice regression wherever the host
 * offset is non-zero. `TZ=America/New_York bun test` additionally exercises the
 * DST cases.
 */
import { describe, expect, it } from 'bun:test';
import {
  isValidPlanValue,
  isoWeekNumber,
  planDateKey,
  planDayKeyFromDate,
  planRangeError,
  planTimeOfDay,
} from '../plan-date.ts';

/** The local calendar day of an instant — the contract `planDateKey` implements. */
function localDayOf(instant: Date): string {
  return [
    instant.getFullYear(),
    String(instant.getMonth() + 1).padStart(2, '0'),
    String(instant.getDate()).padStart(2, '0'),
  ].join('-');
}

describe('planDateKey — accepted forms', () => {
  it('treats a date-only value as date-only (never shifts across time zones)', () => {
    // A date-only value denotes all-day work: parsing it as an instant would
    // move it a day backwards for every negative-offset user.
    expect(planDateKey('2026-09-22')).toBe('2026-09-22');
    expect(planDateKey('2026-01-01')).toBe('2026-01-01');
    expect(planDateKey('2026-12-31')).toBe('2026-12-31');
    expect(planDateKey('2024-02-29')).toBe('2024-02-29');
  });

  it('reads a local date-time without an offset as that local day', () => {
    expect(planDateKey('2026-09-22T14:30')).toBe('2026-09-22');
    expect(planDateKey('2026-09-22T00:00')).toBe('2026-09-22');
    expect(planDateKey('2026-09-22T23:59:59')).toBe('2026-09-22');
  });

  it('accepts a space separator between date and time', () => {
    // The server accepted this form but `time()` returned undefined for it,
    // silently turning a timed entry into an all-day entry.
    expect(planDateKey('2026-09-22 14:30')).toBe('2026-09-22');
    expect(planDateKey('2026-09-22 00:00')).toBe('2026-09-22');
  });

  it('resolves an offset-bearing value to the LOCAL day of that instant', () => {
    const instant = new Date('2026-09-22T20:00:00Z');
    expect(planDateKey('2026-09-22T20:00:00Z')).toBe(localDayOf(instant));

    const withOffset = new Date('2026-09-22T02:00:00+05:30');
    expect(planDateKey('2026-09-22T02:00:00+05:30')).toBe(localDayOf(withOffset));
  });

  it('does not return the naive UTC slice for an offset-bearing value', () => {
    // Regression pin for `value.slice(0, 10)`. On a host whose offset is a whole
    // number of hours this constructs an instant that provably falls on a
    // different local day; on a zero-offset host the correct answer coincides
    // with the slice, so the case is vacuous there by construction.
    const offsetMinutes = -new Date('2026-06-15T12:00:00Z').getTimezoneOffset();
    if (offsetMinutes === 0) {
      expect(planDateKey('2026-09-22T23:30:00Z')).toBe('2026-09-22');
      return;
    }
    const utcHour = offsetMinutes > 0 ? 23 : 0;
    const value = `2026-09-22T${String(utcHour).padStart(2, '0')}:30:00Z`;
    const expected = localDayOf(new Date(value));
    expect(expected).not.toBe('2026-09-22');
    expect(planDateKey(value)).toBe(expected);
  });
});

describe('planDateKey — rejected forms', () => {
  it('rejects a non-zero-padded date instead of passing it through', () => {
    // `2026-9-2` broke lexicographic range comparison and sorting, and produced
    // `NaN-NaN-NaN` when dragged.
    expect(planDateKey('2026-9-2')).toBeUndefined();
    expect(planDateKey('2026-09-2')).toBeUndefined();
    expect(planDateKey('2026-9-22')).toBeUndefined();
    expect(isValidPlanValue('2026-9-2')).toBe(false);
  });

  it('rejects calendar-impossible dates', () => {
    expect(planDateKey('2026-13-01')).toBeUndefined();
    expect(planDateKey('2026-00-10')).toBeUndefined();
    expect(planDateKey('2026-02-30')).toBeUndefined();
    expect(planDateKey('2026-02-29')).toBeUndefined(); // 2026 is not a leap year
    expect(planDateKey('2026-04-31')).toBeUndefined();
    expect(planDateKey('2026-09-00')).toBeUndefined();
    expect(planDateKey('2026-09-32')).toBeUndefined();
  });

  it('rejects out-of-range clock components', () => {
    expect(planDateKey('2026-09-22T24:00')).toBeUndefined();
    expect(planDateKey('2026-09-22T25:00')).toBeUndefined();
    expect(planDateKey('2026-09-22T14:60')).toBeUndefined();
    expect(planDateKey('2026-09-22 24:00')).toBeUndefined();
  });

  it('rejects free-form and compact values', () => {
    expect(planDateKey('not-a-date')).toBeUndefined();
    expect(planDateKey('20260922')).toBeUndefined();
    expect(planDateKey('22/09/2026')).toBeUndefined();
    expect(planDateKey('2026-09')).toBeUndefined();
    expect(planDateKey('2026')).toBeUndefined();
    expect(planDateKey('')).toBeUndefined();
    expect(planDateKey(undefined)).toBeUndefined();
    expect(planDateKey('   ')).toBeUndefined();
  });
});

describe('planTimeOfDay', () => {
  it('returns undefined for date-only values (all-day)', () => {
    expect(planTimeOfDay('2026-09-22')).toBeUndefined();
    expect(planTimeOfDay(undefined)).toBeUndefined();
  });

  it('reads the clock from every accepted timed form', () => {
    expect(planTimeOfDay('2026-09-22T14:30')).toBe('14:30');
    expect(planTimeOfDay('2026-09-22 14:30')).toBe('14:30');
    expect(planTimeOfDay('2026-09-22T14:30:45')).toBe('14:30');
    expect(planTimeOfDay('2026-09-22T09:05')).toBe('09:05');
  });

  it('keeps midnight as a real time rather than collapsing it to all-day', () => {
    expect(planTimeOfDay('2026-09-22T00:00')).toBe('00:00');
    expect(planTimeOfDay('2026-09-22 00:00')).toBe('00:00');
  });

  it('converts an offset-bearing value to the LOCAL clock', () => {
    // Regression pin: the server previously returned the UTC clock verbatim,
    // displaying 02:00 for an instant that is 10:00 locally at +08:00.
    const instant = new Date('2026-09-22T02:00:00Z');
    const expected = `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
    expect(planTimeOfDay('2026-09-22T02:00:00Z')).toBe(expected);
  });

  it('returns undefined for malformed values', () => {
    expect(planTimeOfDay('2026-9-2')).toBeUndefined();
    expect(planTimeOfDay('2026-09-22T25:00')).toBeUndefined();
    expect(planTimeOfDay('garbage')).toBeUndefined();
  });
});

describe('isValidPlanValue', () => {
  it('accepts absent and every valid form', () => {
    expect(isValidPlanValue(undefined)).toBe(true);
    expect(isValidPlanValue('2026-09-22')).toBe(true);
    expect(isValidPlanValue('2026-09-22T14:30')).toBe(true);
    expect(isValidPlanValue('2026-09-22 14:30')).toBe(true);
    expect(isValidPlanValue('2026-09-22T14:30:00Z')).toBe(true);
  });

  it('rejects every malformed form the server used to accept', () => {
    expect(isValidPlanValue('')).toBe(false);
    expect(isValidPlanValue('2026-9-2')).toBe(false);
    expect(isValidPlanValue('2026-02-30')).toBe(false);
    expect(isValidPlanValue('tomorrow')).toBe(false);
  });
});

describe('planDayKeyFromDate', () => {
  it('zero-pads every component', () => {
    expect(planDayKeyFromDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(planDayKeyFromDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('isoWeekNumber', () => {
  /**
   * Anchors cross-checked against an independent ISO-8601 implementation using
   * the Thursday rule (a date's ISO week-year is the calendar year of the
   * Thursday in its Mon–Sun week; the number is then derived from that
   * Thursday's day-of-year) — not by calling `date-fns` twice. Several of these
   * are exactly the cases the previous hand-rolled formula got wrong.
   */
  const anchors: Array<[string, number]> = [
    ['2025-12-29', 1], // old formula said W53 — the week belongs to 2026
    ['2027-01-04', 1], // old formula said W2 — the whole of 2027 was offset by 1
    ['2024-12-30', 1], // old formula said W53
    ['2028-01-03', 1], // old formula said W2
    ['2022-01-03', 1],
    ['2026-01-01', 1], // a Thursday: the first week of its own year
    ['2025-01-01', 1],
    ['2029-01-01', 1],
    ['2026-06-15', 25],
    ['2026-12-28', 53], // a 53-week ISO year
    ['2027-12-27', 52], // old formula said W53 — 2027 has no week 53
  ];

  it('matches independently derived ISO-8601 week numbers', () => {
    for (const [iso, expected] of anchors) {
      const [year, month, day] = iso.split('-').map(Number);
      expect(isoWeekNumber(new Date(year!, month! - 1, day!))).toBe(expected);
    }
  });

  it('never returns a week outside 1..53', () => {
    let cursor = new Date(2025, 0, 1);
    for (let index = 0; index < 365 * 4; index += 1) {
      const week = isoWeekNumber(cursor);
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(53);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
  });

  it('is stable across every day of a single ISO week and steps at the boundary', () => {
    // Mon 2027-01-04 .. Sun 2027-01-10 are all W1; the next Monday is W2.
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(2027, 0, 4 + offset);
      expect(isoWeekNumber(date)).toBe(1);
    }
    expect(isoWeekNumber(new Date(2027, 0, 11))).toBe(2);
  });
});

/**
 * Failure cases for the plan-range guard, written BEFORE the implementation.
 *
 * The guard moved here because the two pages that used to validate a range are
 * gone: creating and editing project work now happens in one editor, and the only
 * thing every write path shares is `updateSessionPlanning`. Without a guard at that
 * choke point a reversed range is storable — `calendar:update` checked it, but
 * `workItems:update` and the plan fields on a task create did not, so the check
 * depended on which door the user came through.
 *
 * What each case protects:
 *   - equality is allowed (a one-day span is start == due);
 *   - a timed start with a date-only due on the same day IS reversed
 *     (`2026-09-25T14:00` starts after `2026-09-25` ends);
 *   - a malformed half is refused rather than stored: `2026-9-5` passed every older
 *     check and then produced `NaN-NaN-NaN` on drag and corrupted the lexicographic
 *     range comparison the projections rely on;
 *   - one-sided ranges are fine — the caller synthesizes the missing end.
 */
describe('planRangeError', () => {
  it('accepts an absent or one-sided range', () => {
    expect(planRangeError(undefined, undefined)).toBeNull();
    expect(planRangeError('2026-09-25', undefined)).toBeNull();
    expect(planRangeError(undefined, '2026-09-25')).toBeNull();
  });

  it('accepts a well-ordered range, including a single day', () => {
    expect(planRangeError('2026-09-25', '2026-09-27')).toBeNull();
    expect(planRangeError('2026-09-25', '2026-09-25')).toBeNull();
    expect(planRangeError('2026-09-25T09:00', '2026-09-25T17:00')).toBeNull();
    expect(planRangeError('2026-09-25T09:00', '2026-09-26')).toBeNull();
    expect(planRangeError('2026-09-25', '2026-09-26T09:00')).toBeNull();
  });

  it('refuses an end before the start', () => {
    expect(planRangeError('2026-09-27', '2026-09-25')).toMatch(/before/i);
    expect(planRangeError('2026-09-25T14:00', '2026-09-25T09:00')).toMatch(/before/i);
    // A timed start on a day that a date-only end closes at its midnight.
    expect(planRangeError('2026-09-25T14:00', '2026-09-25')).toMatch(/before/i);
    // Cross-year, where a hand-rolled month/day comparison goes wrong.
    expect(planRangeError('2027-01-04', '2026-12-31')).toMatch(/before/i);
  });

  it('refuses a value the projections could not interpret', () => {
    expect(planRangeError('2026-9-5', undefined)).toMatch(/invalid/i);
    expect(planRangeError('2026-09-25', '2026-9-27')).toMatch(/invalid/i);
    expect(planRangeError('garbage', '2026-09-27')).toMatch(/invalid/i);
    expect(planRangeError('2026-09-25T9:00', undefined)).toMatch(/invalid/i);
  });
});
