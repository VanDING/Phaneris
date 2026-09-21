/**
 * Calendar date labels in the active UI language.
 *
 * The calendar previously formatted its header with a literal CJK pattern
 * (`yyyy年M月d日`), so an English UI still read "2026年9月21日", and its day header
 * used date-fns' default locale, which is English in every language. `Intl`
 * orders year/month/day (and inserts the separators) per locale, which a fixed
 * pattern cannot express: `2026年9月` in zh-Hans/ja, `September 2026` in en,
 * `2026. szeptember` in hu.
 */

export type CalendarDateView = 'day' | 'week' | 'month'

/** Full date for the day view; month and year for the week and month views. */
export function formatCalendarTitle(date: Date, view: CalendarDateView, locale: string): string {
  return new Intl.DateTimeFormat(
    locale,
    view === 'day' ? { dateStyle: 'long' } : { year: 'numeric', month: 'long' },
  ).format(date)
}

/** Long weekday name, for the day view header. */
export function formatWeekdayLong(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
}
