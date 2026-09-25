/**
 * CalendarUntimedRail — the side rail holding entries that have a date but no time.
 *
 * Why a rail instead of the library's all-day row:
 *
 *   - The all-day row is a horizontal band above the grid, and in this workspace
 *     ~93% of scheduled sessions are date-only, so that one band carried almost
 *     every entry while the 24-hour grid below it sat empty. Moving them to a rail
 *     gives the time grid back its full height.
 *   - The rail is our own DOM, so the gestures on it are ours: no layer fights, no
 *     hashed classes, no `!important`. (The alternative — rendering the entries as
 *     `display: 'background'` bands inside the grid — was measured to receive no
 *     pointer events at all, so it could not be clicked or dragged.)
 *
 * What it must not do is hide work. The rail lists EVERY untimed entry, including
 * other weeks and past dates, because "which week am I looking at" is a property
 * of the grid and not of the backlog beside it. Past dates are marked, not hidden.
 *
 * The two gestures:
 *   - rail → grid : drop on a slot to give the entry that date and time.
 *   - grid → rail : drop a timed entry here to take its time away again.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { CalendarEntry } from '@phaneris/shared/protocol'
import { planDayKeyFromDate } from '@phaneris/shared/work-items/browser'
import { ScrollArea } from '@/components/ui/scroll-area'

/** What a drop on the grid resolves to. */
export interface UntimedDropTarget {
  date: string
  time: string
  endTime: string
}


/** Date order, the only order this list has ever had. */
export function sortUntimed(entries: readonly CalendarEntry[]): CalendarEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date))
}

export interface UntimedEntryListProps {
  entries: readonly CalendarEntry[]
  todayKey: string
  locale: string
  onOpen: (entry: CalendarEntry) => void
  /** Present in the rail (drag onto the grid); absent in the compact popover. */
  onDragStart?: (event: React.PointerEvent, entry: CalendarEntry) => void
  draggingId?: string | null
}

/**
 * The untimed entries, grouped by day.
 *
 * Shared by the rail and by the narrow-panel popover so the two can never disagree
 * about what is unscheduled — the popover exists precisely because the rail is
 * hidden when the panel is too narrow for it, and a collapsed list that showed
 * something different from the open one would be worse than no list at all.
 */
export function UntimedEntryList({ entries, todayKey, locale, onOpen, onDragStart, draggingId }: UntimedEntryListProps) {
  const { t } = useTranslation()
  const groups = React.useMemo(() => {
    const byDate = new Map<string, CalendarEntry[]>()
    for (const entry of sortUntimed(entries)) {
      const bucket = byDate.get(entry.date)
      if (bucket) bucket.push(entry)
      else byDate.set(entry.date, [entry])
    }
    return [...byDate.entries()]
  }, [entries])

  return (
    <div className="pg-rail__list">
      {groups.length === 0 && <div className="pg-rail__empty">{t('schedule.untimedEmpty')}</div>}
      {groups.map(([groupDate, rows]) => {
        const overdue = groupDate < todayKey
        return (
          <div key={groupDate} className="pg-rail__group" data-rail-date={groupDate}>
            <div className={`pg-rail__group-head${overdue ? ' pg-rail__group-head--overdue' : ''}`}>
              <span>
                {weekday(locale, groupDate)} · {monthDay(locale, groupDate)}
                {overdue ? ` · ${t('schedule.untimedOverdueTag')}` : ''}
              </span>
              <span>{rows.length}</span>
            </div>
            {rows.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                data-rail-entry={entry.id}
                title={entry.title}
                className={`pg-rail__chip${draggingId === entry.id ? ' pg-rail__chip--dragging' : ''}`}
                onPointerDown={onDragStart ? (event) => onDragStart(event, entry) : undefined}
                onClick={() => onOpen(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(entry)
                  }
                }}
              >
                <span className="pg-rail__chip-title">{entry.title}</span>
                <span className="pg-rail__chip-meta">{monthDay(locale, entry.date)}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export interface CalendarUntimedRailProps {
  /** Every entry with a date but no time, in any week. */
  entries: readonly CalendarEntry[]
  /** `YYYY-MM-DD` for today, so "past" is decided in one place. */
  todayKey: string
  locale: string
  /** True while a timed entry is being dragged out of the grid. */
  dropActive: boolean
  /** Resolve a pointer position over the grid to a slot, or `null`. */
  resolveDrop: (clientX: number, clientY: number) => UntimedDropTarget | null
  /** Pointer moved while dragging out of the rail; drives the grid's drop preview. */
  onDragOver: (clientX: number, clientY: number) => void
  /** The drag ended without a drop; clear the preview. */
  onDragEnd: () => void
  onSchedule: (entry: CalendarEntry, target: UntimedDropTarget) => void
  onOpen: (entry: CalendarEntry) => void
  onCreate: (values: { title: string; date: string }) => void
}

/** `9/21` in the UI language. */
function monthDay(locale: string, dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  if (!year || !month || !day) return dayKey
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(year, month - 1, day))
}

/** `周一` / `Mon` in the UI language. */
function weekday(locale: string, dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  if (!year || !month || !day) return ''
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(year, month - 1, day))
}

export function CalendarUntimedRail({
  entries,
  todayKey,
  locale,
  dropActive,
  resolveDrop,
  onDragOver,
  onDragEnd,
  onSchedule,
  onOpen,
  onCreate,
}: CalendarUntimedRailProps) {
  const { t } = useTranslation()
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [date, setDate] = React.useState(todayKey)
  const titleRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (composing) titleRef.current?.focus()
  }, [composing])

  const ordered = React.useMemo(() => sortUntimed(entries), [entries])
  const overdueCount = React.useMemo(
    () => ordered.filter((entry) => entry.date < todayKey).length,
    [ordered, todayKey],
  )

  /**
   * Drag an entry onto the grid.
   *
   * The gesture is ours rather than the library's because the source is not a
   * calendar event, so the drop target has to be resolved from the grid's own
   * geometry. Every step is optional — if the pointer never crosses the grid, the
   * drag simply ends and nothing is written.
   */
  const startDrag = React.useCallback((event: React.PointerEvent, entry: CalendarEntry) => {
    if (event.button !== 0) return
    const ghost = document.createElement('div')
    ghost.className = 'pg-rail-ghost'
    ghost.textContent = entry.title
    document.body.appendChild(ghost)
    setDraggingId(entry.id)
    let moved = false

    const place = (clientX: number, clientY: number) => {
      ghost.style.left = `${clientX + 12}px`
      ghost.style.top = `${clientY + 12}px`
    }
    place(event.clientX, event.clientY)

    const onMove = (native: PointerEvent) => {
      moved = true
      place(native.clientX, native.clientY)
      onDragOver(native.clientX, native.clientY)
    }
    const onUp = (native: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      ghost.remove()
      setDraggingId(null)
      onDragEnd()
      const target = resolveDrop(native.clientX, native.clientY)
      if (moved && target) onSchedule(entry, target)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onDragEnd, onDragOver, onSchedule, resolveDrop])

  const commit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onCreate({ title: trimmed, date: date || todayKey })
    setTitle('')
    setComposing(false)
  }

  const countLabel = overdueCount
    ? `${t('schedule.untimedCount', { count: ordered.length })} · ${t('schedule.untimedOverdue', { count: overdueCount })}`
    : t('schedule.untimedCount', { count: ordered.length })

  return (
    <aside
      className={`pg-rail${dropActive ? ' pg-rail--drop' : ''}`}
      data-rail-drop-active={dropActive ? 'true' : undefined}
      aria-label={t('schedule.untimedTitle')}
    >
      <div className="pg-rail__head">
        <div className="pg-rail__title">
          <span>{t('schedule.untimedTitle')}</span>
          <span className="pg-rail__count" data-rail-count>{countLabel}</span>
        </div>
        <p className="pg-rail__hint">{t('schedule.untimedHint')}</p>
      </div>

      <div className="pg-rail__composer">
        {composing ? (
          <div className="pg-rail__fields">
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && title.trim()) commit()
                if (event.key === 'Escape') { setComposing(false); setTitle('') }
              }}
              placeholder={t('schedule.untimedAddTitle')}
              aria-label={t('schedule.untimedAddTitle')}
              className="pg-rail__input"
            />
            <div className="pg-rail__row">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label={t('schedule.entryDate')}
                className="pg-rail__input"
              />
              <button
                type="button"
                onClick={commit}
                disabled={!title.trim()}
                className="pg-rail__button pg-rail__button--primary"
              >
                {t('common.create')}
              </button>
              <button
                type="button"
                onClick={() => { setComposing(false); setTitle('') }}
                className="pg-rail__button"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setComposing(true); setDate(todayKey) }} className="pg-rail__add">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            {t('schedule.untimedQuickAdd')}
          </button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <UntimedEntryList
          entries={entries}
          todayKey={todayKey}
          locale={locale}
          draggingId={draggingId}
          onOpen={onOpen}
          onDragStart={startDrag}
        />
      </ScrollArea>

      <div className="pg-rail__foot">{t('schedule.untimedClearHint')}</div>
    </aside>
  )
}

/** The day key for a date, so the rail and the grid agree on "today". */
export const dayKeyOf = (date: Date): string => planDayKeyFromDate(date)
