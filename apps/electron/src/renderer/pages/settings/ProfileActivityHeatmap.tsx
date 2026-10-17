import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@phaneris/ui'
import type { ProfileActivityDay } from './profile-activity'

const LEVELS = ['bg-foreground/5', 'bg-accent/20', 'bg-accent/40', 'bg-accent/70', 'bg-accent'] as const

/** Full-width local-day calendar. Details are available on hover and keyboard focus. */
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
    <div className="min-w-0">
      <div className="overflow-x-auto py-1" role="group" aria-label={t('settings.preferences.activityAriaLabel')}>
        <div className="min-w-[560px]">
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
                    className={`craft-control aspect-square w-full rounded-shape-sm ${LEVELS[day.level]} transition-[transform,box-shadow] duration-150 hover:z-component-chrome hover:scale-125 focus-visible:z-component-chrome focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:scale-100 ${day.key === today || day.key === selectedKey ? 'ring-1 ring-accent ring-offset-1 ring-offset-background' : ''}`}
                  />
                </TooltipTrigger>
                <TooltipContent>{dayLabel(day)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="craft-text-caption mt-2 grid gap-[3px] text-text-secondary" style={{ gridTemplateColumns: `repeat(${weeks.length},minmax(0,1fr))` }} aria-hidden="true">
            {weeks.map((week, i) => {
              const month = week.find(day => day.date.getDate() === 1)?.date
              // Keep the final label inside the calendar instead of clipping it.
              return <span key={week[0]?.key ?? i} className="whitespace-nowrap">{month && i < weeks.length - 2 ? new Intl.DateTimeFormat(locale, { month: 'short' }).format(month) : ''}</span>
            })}
          </div>
        </div>
      </div>
      {selected && <div className="mt-3 text-xs text-text-secondary" aria-live="polite">{dayLabel(selected)}</div>}
    </div>
  )
}
