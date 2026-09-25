/**
 * Failure cases for the planning-date ↔ FullCalendar event conversion, written
 * BEFORE the module.
 *
 * This conversion is where the inclusive/exclusive mismatch can silently eat a
 * day, and the two directions are asymmetrically defined by the library:
 *
 *   - an **all-day** event's `end` is EXCLUSIVE (a one-day event ends at the next
 *     midnight);
 *   - a **timed** event's `end` is the real end instant (10:00–10:30 ends at
 *     10:30, not midnight).
 *
 * Getting either wrong loses a day on read or on write, and a drag is the
 * shortest path to noticing. Asserting the round-trip here is deterministic,
 * unlike driving a pointer drag through a browser.
 */
import { describe, expect, it } from 'bun:test';
import { fromEventDates, toEventInput } from '../calendar-events.ts';
import type { CalendarEntry } from '@phaneris/shared/protocol';

function entry(patch: Partial<CalendarEntry> & { id: string }): CalendarEntry {
  return {
    title: patch.id,
    date: '2026-09-10',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  } as CalendarEntry;
}

/** Local midnight of a day key, so assertions never depend on the host zone. */
function at(dayKey: string, hours = 0, minutes = 0): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year!, month! - 1, day!, hours, minutes);
}

describe('toEventInput — reading a planning entry', () => {
  it('advances an all-day end by one day (the library end is exclusive)', () => {
    const event = toEventInput(entry({ id: 'a', date: '2026-09-10', endDate: '2026-09-12' }));
    expect(event.start).toBe('2026-09-10');
    expect(event.end).toBe('2026-09-13');
    expect(event.allDay).toBe(true);
  });

  it('keeps a single all-day entry one day long', () => {
    const event = toEventInput(entry({ id: 'a', date: '2026-09-10' }));
    expect(event.start).toBe('2026-09-10');
    expect(event.end).toBe('2026-09-11');
  });

  it('never shifts a date-only value across the host time zone', () => {
    // Constructing an instant from a date-only value loses a day west of UTC.
    for (const day of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31']) {
      const event = toEventInput(entry({ id: day, date: day }));
      expect(event.start).toBe(day);
    }
  });

  it('uses the real end instant for a timed entry', () => {
    const event = toEventInput(entry({ id: 'b', date: '2026-09-10', time: '10:00', endTime: '10:30', allDay: false }));
    expect(event.start).toBe('2026-09-10T10:00');
    expect(event.end).toBe('2026-09-10T10:30');
    expect(event.allDay).toBe(false);
  });

  it('derives an end for a timed entry that has none', () => {
    const event = toEventInput(entry({ id: 'c', date: '2026-09-10', time: '10:00', allDay: false }));
    expect(event.end).toBe('2026-09-10T11:00');
  });

  it('clamps a derived end at the last hour of the day', () => {
    const event = toEventInput(entry({ id: 'd', date: '2026-09-10', time: '23:30', allDay: false }));
    expect(event.end).toBe('2026-09-10T23:30');
  });

  it('keeps a timed entry that spans several days', () => {
    const event = toEventInput(entry({
      id: 'e', date: '2026-09-10', endDate: '2026-09-12', time: '22:00', endTime: '03:00', allDay: false,
    }));
    expect(event.start).toBe('2026-09-10T22:00');
    expect(event.end).toBe('2026-09-12T03:00');
  });

  it('treats an entry with no time as all-day even when allDay is unset', () => {
    const event = toEventInput(entry({ id: 'f', date: '2026-09-10', endDate: '2026-09-11' }));
    expect(event.allDay).toBe(true);
  });
});

describe('fromEventDates — writing a dragged entry', () => {
  it('turns an exclusive all-day end back into an inclusive due day', () => {
    const next = fromEventDates(at('2026-09-10'), at('2026-09-13'), true);
    expect(next).toEqual({ date: '2026-09-10', endDate: '2026-09-12' });
  });

  it('keeps a one-day all-day drag to a single day', () => {
    const next = fromEventDates(at('2026-09-10'), at('2026-09-11'), true);
    expect(next).toEqual({ date: '2026-09-10', endDate: '2026-09-10' });
  });

  it('assumes one day when an all-day drag reports no end', () => {
    const next = fromEventDates(at('2026-09-10'), null, true);
    expect(next).toEqual({ date: '2026-09-10', endDate: '2026-09-10' });
  });

  it('reads the clock from a timed drag', () => {
    const next = fromEventDates(at('2026-09-10', 14, 30), at('2026-09-10', 15, 45), false);
    expect(next).toEqual({ date: '2026-09-10', endDate: '2026-09-10', time: '14:30', endTime: '15:45' });
  });

  it('assigns a midnight end to the previous day rather than inventing one', () => {
    // A resize can land exactly on midnight; the entry ends that night.
    const next = fromEventDates(at('2026-09-10', 22, 0), at('2026-09-11', 0, 0), false);
    expect(next?.date).toBe('2026-09-10');
    expect(next?.endDate).toBe('2026-09-10');
    expect(next?.endTime).toBe('23:59');
  });

  it('preserves a genuine multi-day timed span', () => {
    const next = fromEventDates(at('2026-09-10', 22, 0), at('2026-09-12', 3, 0), false);
    expect(next).toEqual({ date: '2026-09-10', endDate: '2026-09-12', time: '22:00', endTime: '03:00' });
  });

  it('preserves the inclusive span when dragged by a whole number of days', () => {
    // The property a drag must not violate: moving an entry never changes its
    // length. An exclusive/inclusive mix-up shortens it by exactly one day.
    const original = entry({ id: 'g', date: '2026-09-10', endDate: '2026-09-12' });
    const read = toEventInput(original);
    for (const shift of [1, 3, 7]) {
      const shiftedStart = new Date(at('2026-09-10'));
      shiftedStart.setDate(shiftedStart.getDate() + shift);
      const shiftedEnd = new Date(at('2026-09-13'));
      shiftedEnd.setDate(shiftedEnd.getDate() + shift);
      const written = fromEventDates(shiftedStart, shiftedEnd, true)!;
      const reread = toEventInput(entry({ id: 'g', ...written }));
      expect(reread.start).toBe(shiftedStart.getFullYear() + '-' +
        String(shiftedStart.getMonth() + 1).padStart(2, '0') + '-' +
        String(shiftedStart.getDate()).padStart(2, '0'));
      // Same length as the original: 2 days between start and inclusive end.
      const days = (from: unknown, to: unknown) => {
        const parse = (value: unknown) => {
          const [y, m, d] = String(value).split('-').map(Number);
          return Date.UTC(y!, m! - 1, d!);
        };
        return Math.round((parse(to) - parse(from)) / 86_400_000);
      };
      expect(days(written.date, written.endDate)).toBe(days(original.date, original.endDate!));
      expect(days(original.date, original.endDate!)).toBe(2);
    }
    void read;
  });

  it('round-trips every read representation back to the same planning dates', () => {
    const cases: CalendarEntry[] = [
      entry({ id: 'h1', date: '2026-09-10', endDate: '2026-09-12' }),
      entry({ id: 'h2', date: '2026-09-10' }),
      entry({ id: 'h3', date: '2026-09-10', time: '10:00', endTime: '10:30', allDay: false }),
      entry({ id: 'h4', date: '2026-09-10', endDate: '2026-09-12', time: '22:00', endTime: '03:00', allDay: false }),
    ];
    for (const original of cases) {
      const event = toEventInput(original);
      const allDay = event.allDay === true;
      const start = allDay ? at(String(event.start)) : new Date(String(event.start));
      const end = allDay ? at(String(event.end)) : new Date(String(event.end));
      const written = fromEventDates(start, end, allDay)!;
      expect(written.date).toBe(original.date);
      expect(written.endDate).toBe(original.endDate ?? original.date);
    }
  });

  it('returns undefined when the library reports no start', () => {
    expect(fromEventDates(null, null, true)).toBeUndefined();
  });
});
