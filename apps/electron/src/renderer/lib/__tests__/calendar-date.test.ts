/**
 * Calendar date labels must follow the UI language: the reported defect was a
 * hardcoded CJK pattern (`yyyy年M月d日`) showing in an English UI, plus a weekday
 * header that ignored the language entirely.
 */
import { describe, expect, it } from 'bun:test'

import { formatCalendarTitle, formatWeekdayLong } from '../calendar-date'

const CJK = /[\u3040-\u30ff\u4e00-\u9fff]/
// 2026-09-21 is a Monday.
const MONDAY = new Date(2026, 8, 21)

describe('formatCalendarTitle', () => {
  it('renders an English UI in English, with no CJK date units', () => {
    const title = formatCalendarTitle(MONDAY, 'day', 'en')

    expect(title).toContain('September')
    expect(title).toContain('21')
    expect(title).toContain('2026')
    expect(title).not.toMatch(CJK)
    expect(title).not.toMatch(/[年月日]/)
  })

  it('keeps the CJK order for the languages that use it', () => {
    expect(formatCalendarTitle(MONDAY, 'day', 'zh-Hans')).toMatch(/^2026年9月21日/)
    expect(formatCalendarTitle(MONDAY, 'day', 'ja')).toMatch(/^2026年9月21日/)
  })

  it('uses each locale own month/year order for the week and month views', () => {
    expect(formatCalendarTitle(MONDAY, 'month', 'en')).toBe('September 2026')
    expect(formatCalendarTitle(MONDAY, 'week', 'zh-Hans')).toMatch(/^2026年9月/)
    expect(formatCalendarTitle(MONDAY, 'month', 'hu')).toMatch(/^2026\. szeptember/)
    // Week and month views share one label: neither may show the day number.
    expect(formatCalendarTitle(MONDAY, 'week', 'en')).toBe(formatCalendarTitle(MONDAY, 'month', 'en'))
    expect(formatCalendarTitle(MONDAY, 'month', 'en')).not.toContain('21')
  })
})

describe('formatWeekdayLong', () => {
  it('names the weekday in the UI language', () => {
    expect(formatWeekdayLong(MONDAY, 'en')).toBe('Monday')
    expect(formatWeekdayLong(MONDAY, 'zh-Hans')).toBe('星期一')
    expect(formatWeekdayLong(MONDAY, 'ja')).toBe('月曜日')
    expect(formatWeekdayLong(MONDAY, 'de')).toBe('Montag')
  })

  it('never falls back to English for a non-English UI', () => {
    for (const locale of ['zh-Hans', 'ja', 'de', 'es', 'hu', 'pl']) {
      expect(formatWeekdayLong(MONDAY, locale)).not.toBe('Monday')
    }
  })
})
