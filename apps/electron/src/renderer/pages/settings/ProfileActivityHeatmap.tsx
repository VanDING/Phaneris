import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@phaneris/ui'
import type { ProfileActivityDay } from './profile-activity'

const LEVELS = ['bg-foreground/5', 'bg-accent/20', 'bg-accent/40', 'bg-accent/70', 'bg-accent'] as const

/** The existing local-day activity calendar, with theme-aware Violet Pulse styling. */
export function ProfileActivityHeatmap({ calendar, locale }: { calendar: ProfileActivityDay[]; locale: string }) {
  const { t } = useTranslation()
  const today = new Date().toLocaleDateString('en-CA')
  const [focusedKey, setFocusedKey] = useState(today)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const weeks = useMemo(() => Array.from({ length: Math.ceil(calendar.length / 7) }, (_, i) => calendar.slice(i * 7, i * 7 + 7)), [calendar])
  const dayLabel = (day: ProfileActivityDay) => t('settings.preferences.activityDay', {
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(day.date), count: day.count,
  })
  const selected = calendar.find(day => day.key === selectedKey)
  const focusKey = calendar.some(day => day.key === focusedKey && !day.isFuture)
    ? focusedKey : calendar.findLast(day => !day.isFuture)?.key

  return (
    <div className="py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('settings.preferences.lastYear')}</span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-hidden="true">
          <span>{t('settings.preferences.less')}</span>
          {LEVELS.map((level, index) => <span key={level} data-level={index} className={`size-2.5 rounded-[3px] ${level}`} />)}
          <span>{t('settings.preferences.more')}</span>
        </div>
      </div>
      <div className="overflow-x-auto py-1" role="group" aria-label={t('settings.preferences.activityAriaLabel')}>
        <div className="grid min-w-[560px] grid-cols-[22px_minmax(0,1fr)] gap-x-2 gap-y-2">
          <span aria-hidden="true" />
          <div className="grid gap-[3px] text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${weeks.length},minmax(0,1fr))` }} aria-hidden="true">
            {weeks.map((week, i) => {
              const month = week.find(day => day.date.getDate() === 1)?.date
              // A label in the last two columns would overflow the year grid.
              return <span key={week[0]?.key ?? i} className="whitespace-nowrap">{month && i < weeks.length - 2 ? new Intl.DateTimeFormat(locale, { month: 'short' }).format(month) : ''}</span>
            })}
          </div>
          <div className="relative text-[11px] text-muted-foreground" aria-hidden="true">
            {[1, 3, 5].map(day => <span key={day} className="absolute right-0 -translate-y-1/2" style={{ top: `${((day + 0.5) / 7) * 100}%` }}>{new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2026, 7, 23 + day))}</span>)}
          </div>
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks.length},minmax(0,1fr))` }}>
            {calendar.map((day, index) => day.isFuture ? <span key={day.key} aria-hidden="true" /> : (
              <Tooltip key={day.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-activity-day={day.key}
                    aria-label={dayLabel(day)}
                    aria-pressed={selectedKey === day.key}
                    tabIndex={day.key === focusKey ? 0 : -1}
                    onFocus={() => setFocusedKey(day.key)}
                    onClick={() => setSelectedKey(day.key)}
                    onKeyDown={event => {
                      const offset = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key]
                      if (offset === undefined) return
                      event.preventDefault()
                      const next = calendar[index + offset]
                      if (next && !next.isFuture) {
                        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-activity-day="${next.key}"]`)?.focus()
                      }
                    }}
                    className={`aspect-square w-full rounded-[3px] ${LEVELS[day.level]} transition-[transform,box-shadow] duration-150 hover:z-10 hover:scale-125 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:scale-100 ${day.key === today || day.key === selectedKey ? 'ring-1 ring-accent ring-offset-1 ring-offset-background' : ''}`}
                  />
                </TooltipTrigger>
                <TooltipContent>{dayLabel(day)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      {selected && <div className="mt-3 text-xs text-muted-foreground" aria-live="polite">{dayLabel(selected)}</div>}
    </div>
  )
}
