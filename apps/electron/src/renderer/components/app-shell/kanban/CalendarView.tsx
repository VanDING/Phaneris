/**
 * CalendarView — the time projection of Session planning metadata.
 *
 * Rendered by **FullCalendar (MIT)** on top of `dayGrid` / `timeGrid` /
 * `interaction`. This view used to be a hand-rolled grid: it owned the hour
 * window, the month-cell capacity, the overlap packing, the resize gesture and
 * the keyboard story, and every one of those was a defect source —
 *
 *   - `HOUR_START=8 / HOUR_END=20` painted a 07:00 entry above the grid and a
 *     22:00 entry 168px below it;
 *   - `MAX_TASKS_PER_CELL = 3` ignored the available height, squeezed three chips
 *     into 6px unreadable lines, and left "+N more" as an unfocusable `<span>`;
 *   - overlap layout was `index/count` grouping, so chained overlaps (A∩B, B∩C,
 *     A∩C=∅) were crushed into one column;
 *   - resize had no live feedback and leaked its listeners.
 *
 * Those are engine concerns, so they now belong to the library. What stays here
 * is everything that is genuinely ours and must not change:
 *
 *   - the app header (project filter, search, segmented control, New Schedule,
 *     traffic-light compensation and the surface close/fullscreen controls) —
 *     driven through `useCalendarController`, with the library's own toolbar
 *     disabled, so the design system's chrome survives the swap;
 *   - the full-page `SchedulePage` editor (unchanged, shared with every other
 *     entry point);
 *   - the `useCalendarEntries` data layer, which is still the projection of
 *     Session planning fields;
 *   - the design tokens, mapped onto FullCalendar's palette in
 *     `calendar-overrides.css`.
 */

import * as React from 'react'
import { CalendarOff, Plus, Search } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import FullCalendar, { useCalendarController } from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import classicThemePlugin from '@fullcalendar/react/themes/classic'
// Individual locales rather than `locales-all`: each is well under 2 KB and the
// app only ever ships the seven it supports.
import deLocale from '@fullcalendar/react/locales/de'
import esLocale from '@fullcalendar/react/locales/es'
import huLocale from '@fullcalendar/react/locales/hu'
import jaLocale from '@fullcalendar/react/locales/ja'
import plLocale from '@fullcalendar/react/locales/pl'
import zhCnLocale from '@fullcalendar/react/locales/zh-cn'
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/classic/theme.css'
import './calendar-overrides.css'
import { planDayKeyFromDate } from '@phaneris/shared/work-items/browser'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import { fromEventDates, oneHourAfter, toEventInput } from '@/lib/calendar-events'
import { useAppShellContext } from '@/context/AppShellContext'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useCalendarEntries } from '@/hooks/useCalendarEntries'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useWorkItemViewState } from '@/hooks/useWorkItemViewState'
import { projectsAtom } from '@/atoms/projects'
import { Button } from '@/components/ui/button'
import type { CalendarEntry } from '@phaneris/shared/protocol'
import { KanbanProjectFilter, type KanbanProjectFilterOption } from './KanbanProjectFilter'
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CalendarUntimedRail, UntimedEntryList, type UntimedDropTarget } from './CalendarUntimedRail'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import type { TaskPlanValue } from './TaskPlanPanel'

type ViewMode = 'day' | 'week' | 'month'

/**
 * What a click or a drag on the grid resolves to. It is the same shape the drag
 * commit path uses, so "create here" and "move to here" cannot disagree about what
 * a selection meant.
 */
type CalendarDraft = Partial<NonNullable<ReturnType<typeof fromEventDates>>>

/** Our three projections mapped onto FullCalendar view names. */
const VIEW_FOR: Record<ViewMode, string> = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
}

const MODE_FOR_VIEW = Object.fromEntries(
  Object.entries(VIEW_FOR).map(([mode, view]) => [view, mode as ViewMode]),
) as Record<string, ViewMode | undefined>

/**
 * FullCalendar locale objects, keyed by the app's UI language codes.
 *
 * English is the library default, so it needs no import. `zh-Hans` maps to the
 * library's `zh-cn`; the code shapes differ between the two systems and this is
 * the only place that knows it.
 */
const FC_LOCALE: Record<string, typeof deLocale | undefined> = {
  en: undefined,
  de: deLocale,
  es: esLocale,
  hu: huLocale,
  ja: jaLocale,
  pl: plLocale,
  'zh-Hans': zhCnLocale,
}

export function CalendarView() {
  const { activeWorkspaceId, trailingAction, expandButton } = useAppShellContext()
  const compensateForStoplight = useCompensateForStoplight()
  const { t, i18n } = useTranslation()
  // Date labels follow the UI language, not the host locale.
  const locale = i18n.resolvedLanguage ?? i18n.language
  const { navigate, navigateToSession } = useNavigation()
  const { entries, create, update, remove } = useCalendarEntries(activeWorkspaceId ?? null)
  const { items: workItems } = useWorkItems(activeWorkspaceId ?? null)
  const projects = useAtomValue(projectsAtom)
  const setEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const projectOptions = React.useMemo<KanbanProjectFilterOption[]>(
    () => projects.map((project) => ({ id: project.config.id, name: project.config.name, color: project.config.color })),
    [projects],
  )
  const liveProjectIds = React.useMemo(() => projectOptions.map(({ id }) => id), [projectOptions])
  /**
   * Only the project scope and the search box are shared with the other
   * projections. The status / scheduled filters are deliberately NOT touched
   * here: this view does not read them, and writing them cleared the list view's
   * filters purely by opening the calendar.
   */
  const { projectIds, setProjectIds, search, setSearch } = useWorkItemViewState(
    activeWorkspaceId ?? null,
    workItems,
    liveProjectIds,
  )

  const controller = useCalendarController()
  /*
   * The view choice survives leaving the projection.
   *
   * Opening a schedule entry swaps this component for the editor, which unmounts
   * it; coming back used to remount with `useState('month')` and today's date, so
   * a week view silently reverted to the month and the user lost their place.
   * Scoped per workspace, so each workspace remembers its own.
   */
  const viewScope = activeWorkspaceId ?? 'global'
  /** Read once: the remembered date is only needed for the initial jump. */
  const storedCursorRef = React.useRef<string | undefined>(undefined)
  /**
   * The remembered mode has to drive `initialView`, not just the segmented
   * control: the calendar renders its own initial view, and a state-only restore
   * was overwritten by the mount-time sync below, so the header read "Week" while
   * the grid still showed the month.
   */
  const initialModeRef = React.useRef<ViewMode>('month')
  const [mode, setMode] = React.useState<ViewMode>(() => {
    const stored = storage.get<{ mode?: ViewMode; cursor?: string }>(KEYS.calendarViewState, {}, viewScope)
    storedCursorRef.current = stored.cursor
    initialModeRef.current = stored.mode ?? 'month'
    return initialModeRef.current
  })
  const [title, setTitle] = React.useState('')

  // Jump to the remembered date once, after the controller is attached.
  const restoredRef = React.useRef(false)
  React.useEffect(() => {
    const cursor = storedCursorRef.current
    if (restoredRef.current || !cursor || !controller.view) return
    restoredRef.current = true
    // `mode` already drove `initialView` through the stored value; only the date
    // needs applying, and the controller is attached by now.
    const [year, month, day] = cursor.split('-').map(Number)
    if (year && month && day) controller.gotoDate(new Date(year, month - 1, day))
  }, [controller])

  const visibleEntries = React.useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return entries
      .filter((entry) => !projectIds.length || Boolean(entry.projectId && projectIds.includes(entry.projectId)))
      .filter((entry) => !needle || `${entry.title}\n${entry.note ?? ''}`.toLocaleLowerCase().includes(needle))
  }, [entries, projectIds, search])

  const events = React.useMemo(() => visibleEntries.map(toEventInput), [visibleEntries])

  /**
   * Entries with a date but no time. `allDay` is explicit on new entries and
   * inferred from a missing `time` on legacy ones, so both shapes resolve here
   * and the rail cannot disagree with the grid about what is scheduled.
   */
  const isUntimed = React.useCallback(
    (entry: CalendarEntry) => entry.allDay ?? !entry.time,
    [],
  )
  const untimedEntries = React.useMemo(
    () => visibleEntries.filter(isUntimed),
    [isUntimed, visibleEntries],
  )

  // The library re-renders us on date/view changes (its hook wires
  // `handleDateChange` to a state update), so the title and the active segment
  // follow navigation performed by the calendar itself — including a drag that
  // scrolls into a new month.
  React.useEffect(() => {
    const view = controller.view
    if (!view) return
    setTitle(view.title)
    const nextMode = MODE_FOR_VIEW[view.type]
    if (nextMode) setMode(nextMode)
    // Persist what the user is looking at, so remounting restores it.
    const active = controller.getDate()
    storage.set(
      KEYS.calendarViewState,
      { mode: nextMode ?? mode, cursor: active ? planDayKeyFromDate(active) : undefined },
      viewScope,
    )
  }, [controller, events, title, mode, viewScope])

  // -------------------------------------------------------------------------
  // The untimed rail: drop targets, preview, and the two gestures' write paths
  // -------------------------------------------------------------------------

  const calendarHostRef = React.useRef<HTMLDivElement>(null)
  const railHostRef = React.useRef<HTMLDivElement>(null)
  const [dropPreview, setDropPreview] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [gridDragActive, setGridDragActive] = React.useState(false)
  /** The entry as it was before a grid drag, so "clear its time" keeps its date. */
  const dragEntryRef = React.useRef<CalendarEntry | null>(null)
  /** Set when a grid drag ended on the rail, so `eventDrop` does not also move it. */
  const railDropRef = React.useRef<string | null>(null)

  /**
   * The slot under a pointer, plus where to draw the preview.
   *
   * The library exposes no drop API for an outside draggable, so the target is
   * read from the grid's own DOM: day columns carry `data-date` and the slot lanes
   * carry `data-time`. Both are structural (roles and data attributes), not the
   * hashed class names the migration set out to stop depending on.
   */
  const locateDrop = React.useCallback((clientX: number, clientY: number) => {
    const root = calendarHostRef.current
    if (!root) return null
    const column = [...root.querySelectorAll<HTMLElement>("[role='gridcell'][data-date]")]
      .find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.height > 100 && clientX >= rect.left && clientX <= rect.right
      })
    if (!column) return null
    const lane = [...root.querySelectorAll<HTMLElement>('[data-time]')]
      .find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 200 && clientY >= rect.top && clientY <= rect.bottom
      })
    const date = column.dataset.date
    const time = (lane?.dataset.time ?? '').slice(0, 5)
    if (!date || !lane || !/^\d{2}:\d{2}$/.test(time)) return null
    const rootRect = root.getBoundingClientRect()
    const columnRect = column.getBoundingClientRect()
    const laneRect = lane.getBoundingClientRect()
    return {
      target: { date, time, endTime: oneHourAfter(time) } satisfies UntimedDropTarget,
      preview: {
        left: columnRect.left - rootRect.left,
        top: laneRect.top - rootRect.top,
        width: columnRect.width,
        height: laneRect.height,
      },
    }
  }, [])

  const resolveDrop = React.useCallback(
    (clientX: number, clientY: number): UntimedDropTarget | null => locateDrop(clientX, clientY)?.target ?? null,
    [locateDrop],
  )

  /**
   * The time body's scroller.
   *
   * Found from the grid's own DOM rather than a hashed class: the element that
   * actually scrolls is the nearest ancestor of a slot lane that can. Cached,
   * because this runs on every pointer move of a drag.
   */
  const findScroller = (root: HTMLElement): HTMLElement | null => {
    let node = root.querySelector<HTMLElement>('[data-time]')?.parentElement ?? null
    while (node && node !== root) {
      const overflowY = getComputedStyle(node).overflowY
      if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node
      node = node.parentElement
    }
    return null
  }

  const scrollerRef = React.useRef<HTMLElement | null>(null)
  const dragPointRef = React.useRef<{ x: number; y: number } | null>(null)
  const autoScrollTimerRef = React.useRef<number | null>(null)
  const autoScrollDirectionRef = React.useRef(0)

  const stopAutoScroll = React.useCallback(() => {
    autoScrollDirectionRef.current = 0
    if (autoScrollTimerRef.current !== null) {
      window.clearInterval(autoScrollTimerRef.current)
      autoScrollTimerRef.current = null
    }
  }, [])

  /**
   * Auto-scroll at the edges while a rail entry is dragged over the grid.
   *
   * Without it the drop targets are only the slots already on screen: the grid
   * opens at 08:00 and shows about ten hours, so putting an untimed entry at 19:00
   * meant scrolling the grid BEFORE starting the drag. The scroll is driven by a
   * timer rather than by pointer movement, because a pointer held still against the
   * edge must keep scrolling — and the preview is recomputed each frame, since the
   * content moves underneath a stationary pointer.
   */
  const EDGE_SCROLL_ZONE_PX = 48
  const EDGE_SCROLL_STEP_PX = 10

  const applyDragPoint = React.useCallback((clientX: number, clientY: number) => {
    setDropPreview(locateDrop(clientX, clientY)?.preview ?? null)
    const root = calendarHostRef.current
    if (!root) return
    if (!scrollerRef.current) scrollerRef.current = findScroller(root)
    const scroller = scrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const direction = clientY < rect.top + EDGE_SCROLL_ZONE_PX
      ? -1
      : clientY > rect.bottom - EDGE_SCROLL_ZONE_PX ? 1 : 0
    autoScrollDirectionRef.current = direction
    if (direction === 0) {
      stopAutoScroll()
      return
    }
    if (autoScrollTimerRef.current !== null) return
    autoScrollTimerRef.current = window.setInterval(() => {
      const element = scrollerRef.current
      const point = dragPointRef.current
      if (!element || !point || autoScrollDirectionRef.current === 0) return
      const before = element.scrollTop
      element.scrollTop = before + autoScrollDirectionRef.current * EDGE_SCROLL_STEP_PX
      if (element.scrollTop === before) {
        // Hit the end of the range: nothing left to reveal.
        stopAutoScroll()
        return
      }
      setDropPreview(locateDrop(point.x, point.y)?.preview ?? null)
    }, 16)
  }, [locateDrop, stopAutoScroll])

  const handleDragOver = React.useCallback((clientX: number, clientY: number) => {
    dragPointRef.current = { x: clientX, y: clientY }
    applyDragPoint(clientX, clientY)
  }, [applyDragPoint])

  const clearDropPreview = React.useCallback(() => {
    dragPointRef.current = null
    stopAutoScroll()
    setDropPreview(null)
  }, [stopAutoScroll])

  /** Give an untimed entry the date and time it was dropped on. */
  const scheduleFromRail = React.useCallback(async (entry: CalendarEntry, target: UntimedDropTarget) => {
    try {
      await update(entry.id, {
        title: entry.title,
        date: target.date,
        endDate: target.date,
        allDay: false,
        time: target.time,
        endTime: target.endTime,
        note: entry.note,
        projectId: entry.projectId,
      })
    } catch (err) {
      toast.error(t('schedule.moveFailed'), {
        description: err instanceof Error ? err.message : t('common.unknownError'),
      })
    }
  }, [t, update])

  /** Dropping a timed entry on the rail takes its time away, keeping its date. */
  const clearEntryTime = React.useCallback(async (entry: CalendarEntry) => {
    try {
      await update(entry.id, {
        title: entry.title,
        date: entry.date,
        endDate: entry.endDate ?? entry.date,
        allDay: true,
        note: entry.note,
        projectId: entry.projectId,
      })
    } catch (err) {
      toast.error(t('schedule.moveFailed'), {
        description: err instanceof Error ? err.message : t('common.unknownError'),
      })
    }
  }, [t, update])

  /** The rail's `+`: a title and a date is all the fast path asks for. */
  const createUntimed = React.useCallback(async (values: { title: string; date: string }) => {
    try {
      await create({
        title: values.title,
        date: values.date,
        endDate: values.date,
        allDay: true,
      })
    } catch (err) {
      toast.error(t('schedule.createFailed'), {
        description: err instanceof Error ? err.message : t('common.unknownError'),
      })
    }
  }, [create, t])

  const isOverRail = React.useCallback((clientX: number, clientY: number) => {
    const rect = railHostRef.current?.getBoundingClientRect()
    if (!rect) return false
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }, [])

  /** `周一` / `Mon`, and `9/21`, in the UI language — the header's two lines. */
  const headerFormats = React.useMemo(() => ({
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    monthDay: new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }),
  }), [locale])
  const todayKey = planDayKeyFromDate(new Date())


  // -------------------------------------------------------------------------
  // Navigation and the write paths
  // -------------------------------------------------------------------------

  /**
   * The plan a calendar gesture already expressed, as the editor's own shape.
   *
   * A click on one slot arrives as `13:00-13:30` and a drag as the drawn range, so
   * the editor opens on exactly what was drawn rather than on a default hour. An
   * all-day selection has no times at all, which is what keeps it all-day.
   */
  const planFromDraft = React.useCallback((draft: CalendarDraft): Partial<TaskPlanValue> => {
    const startDate = draft.date ?? ''
    const dueDate = draft.endDate ?? draft.date ?? ''
    const startTime = draft.time ?? ''
    return {
      startDate,
      startTime,
      dueDate,
      dueTime: draft.endTime ?? (startTime ? oneHourAfter(startTime) : ''),
    }
  }, [])

  /**
   * Create at a slot or over a range — in the shared Task Definition editor, which
   * is now the only surface that creates project work. The calendar's job is to say
   * WHERE, and that is what `initialPlan` carries.
   */
  const openCreate = React.useCallback((draft: CalendarDraft) => {
    setEditorTarget({
      mode: 'create',
      initialProjectId: projectIds.length === 1 ? projectIds[0] : undefined,
      initialPlan: planFromDraft(draft),
    })
  }, [planFromDraft, projectIds, setEditorTarget])

  const openEdit = React.useCallback((entry: CalendarEntry) => {
    setEditorTarget({ mode: 'edit', sessionId: entry.id, initialTitle: entry.title })
  }, [setEditorTarget])

  /** A drag or resize: persist the new inclusive dates, or put the bar back. */
  const commitDates = React.useCallback(async (
    entry: CalendarEntry,
    next: { date: string; endDate: string; time?: string; endTime?: string },
  ): Promise<boolean> => {
    try {
      await update(entry.id, {
        title: entry.title,
        date: next.date,
        endDate: next.endDate,
        allDay: next.time === undefined,
        time: next.time,
        endTime: next.endTime,
        note: entry.note,
        projectId: entry.projectId,
      })
      return true
    } catch (err) {
      // The library has already moved the bar optimistically; the caller reverts
      // it so the view never claims a write that did not happen.
      toast.error(t('schedule.moveFailed'), {
        description: err instanceof Error ? err.message : t('common.unknownError'),
      })
      return false
    }
  }, [t, update])

  const handleDelete = React.useCallback((entry: CalendarEntry) => {
    void remove(entry.id).catch((err: unknown) => {
      toast.error(t('schedule.deleteFailed'), {
        description: err instanceof Error ? err.message : t('common.unknownError'),
      })
    })
  }, [remove, t])

  const changeMode = React.useCallback((next: ViewMode) => {
    setMode(next)
    controller.changeView(VIEW_FOR[next])
  }, [controller])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header paddings adapt at the window edge (focused mode / fullscreen
          overlay): left reserves macOS traffic lights, right reserves the
          floating restore button of the expanded overlay. */}
      <div
        className="grid h-[42px] flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/50 bg-background/80 px-4 backdrop-blur-sm @max-[760px]/panel:grid-cols-[auto_minmax(0,1fr)]"
        style={{
          paddingLeft: compensateForStoplight ? 84 : 16,
          paddingRight: compensateForStoplight ? 48 : 16,
        }}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden @max-[760px]/panel:hidden">
          {projectOptions.length > 0 && (
            <KanbanProjectFilter projects={projectOptions} value={projectIds} onChange={setProjectIds} />
          )}
          {/*
            The rail's stand-in when there is no room for the rail. Same list, same
            order, same data — a collapsed surface that showed something else would
            be worse than none.
          */}
          {untimedEntries.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-calendar-untimed-trigger
                  className="craft-control hidden h-8 shrink-0 items-center gap-1.5 rounded-md border border-foreground/15 px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground @max-[900px]/panel:inline-flex"
                >
                  <CalendarOff className="h-3.5 w-3.5" />
                  {t('schedule.untimedCount', { count: untimedEntries.length })}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <div className="border-b border-border/60 px-3 py-2">
                  <div className="text-xs font-semibold">{t('schedule.untimedTitle')}</div>
                  <p className="pt-1 text-[11px] leading-snug text-foreground/55">{t('schedule.untimedHint')}</p>
                </div>
                <ScrollArea className="max-h-80">
                  <UntimedEntryList
                    entries={untimedEntries}
                    todayKey={todayKey}
                    locale={locale}
                    onOpen={openEdit}
                  />
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
          <label className="relative hidden min-w-32 @min-[980px]/panel:block @min-[980px]/panel:w-44">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('kanban.workItemSearch')}
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring/60"
            />
          </label>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => controller.prev()}
            aria-label={t('schedule.prevMonth')}
            className="craft-control inline-flex h-8 w-8 items-center justify-center rounded-md border border-foreground/15 text-foreground/55 transition-colors hover:text-foreground"
          >
            ‹
          </button>
          <span className="text-sm font-semibold" data-calendar-title>{title}</span>
          <button
            type="button"
            onClick={() => controller.next()}
            aria-label={t('schedule.nextMonth')}
            className="craft-control inline-flex h-8 w-8 items-center justify-center rounded-md border border-foreground/15 text-foreground/55 transition-colors hover:text-foreground"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => controller.today()}
            className="craft-control h-8 rounded-md border border-foreground/15 px-3 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground @max-[560px]/panel:hidden"
          >
            {t('common.today')}
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 @max-[760px]/panel:col-start-2">
          {/*
            The shared radiogroup primitive, not a second hand-rolled segmented
            control: it brings role=radiogroup, roving tabindex and arrow/Home/End
            navigation, and keeps this control identical to the Gantt's.
          */}
          <div className="inline-flex h-8 items-center rounded-md bg-foreground/5 p-0.5">
            <SettingsSegmentedControl
              size="sm"
              className="gap-0.5"
              aria-label={t('schedule.viewMode')}
              value={mode}
              onValueChange={changeMode}
              options={(['day', 'week', 'month'] as const).map((option) => ({
                value: option,
                label: t(`schedule.view.${option}`),
              }))}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => openCreate({ date: planDayKeyFromDate(new Date()) })}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="@max-[940px]/panel:hidden">{t('schedule.newEntry')}</span>
          </Button>
          {/* Surface-injected close + fullscreen controls. */}
          {trailingAction}
          {expandButton}
        </div>
      </div>

      {/*
        The grid and the untimed rail share this row. The rail is a sibling rather
        than an overlay so the grid keeps its own scrolling and hit-testing, and so
        a pointer over the rail can never be mistaken for a slot.
      */}
      <div className="flex min-h-0 flex-1 gap-3 p-2 @min-[800px]/panel:p-4">
      {/*
        `data-calendar-view` lets the stylesheet tell the time grids apart from the
        month grid: every day cell carries `data-date`, so a rule targeting that
        attribute alone also painted the hour rules inside the 126px month cells.
      */}
      <div
        ref={calendarHostRef}
        className="phaneris-calendar relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-foreground/[0.012]"
        data-calendar-view={mode}
      >
        {/*
          Drop preview for a drag out of the rail. The library has no API for an
          outside draggable, so the slot is highlighted with our own absolutely
          positioned element placed from the column and lane rectangles.
        */}
        {dropPreview && (
          <div
            className="pg-calendar-droptarget"
            data-calendar-droptarget
            style={{
              left: dropPreview.left,
              top: dropPreview.top,
              width: dropPreview.width,
              height: dropPreview.height,
            }}
          />
        )}
        <FullCalendar
          controller={controller}
          plugins={[classicThemePlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={VIEW_FOR[initialModeRef.current]}
          // Our own header replaces the library's toolbar entirely.
          headerToolbar={false}
          /*
           * Two-line day headers in the time grids (`周一` over `9/21`), and the
           * weekday alone in the month grid — at the same band height, so switching
           * views never moves the grid. The previous single-line `MON 21` left today
           * unmarked and made the three views different heights.
           */
          dayHeaderContent={(info) => {
            const isMonth = info.view.type === 'dayGridMonth'
            // The month header is one row of seven weekday labels, so no single
            // column is "today" and marking one of them would be arbitrary.
            const isToday = !isMonth && planDayKeyFromDate(info.date) === todayKey
            return (
              <div className={`pg-cal-head${isMonth ? ' pg-cal-head--month' : ''}${isToday ? ' pg-cal-head--today' : ''}`}>
                <span className="pg-cal-head__weekday">{headerFormats.weekday.format(info.date)}</span>
                {!isMonth && <span className="pg-cal-head__date">{headerFormats.monthDay.format(info.date)}</span>}
              </div>
            )
          }}
          /*
           * Empty space creates; an existing entry opens.
           *
           * The gesture is `select` and NOT `dateClick`: measured on this build, a
           * single click fires BOTH, so listening to each of them opened the editor
           * twice for one click. `select` already reports a one-slot selection for a
           * click (10:00 -> 10:00-10:30) and the dragged range for a drag, so it is
           * the single source for "create here".
           *
           * `selectMirror` gives the drag live feedback, and `snapDuration` keeps the
           * result on the same 30-minute grid the slots are drawn on. The selection
           * needs no manual clearing: the editor is a full-page route, so the
           * calendar unmounts and `unselectAuto` covers the case where it does not.
           */
          selectable
          selectMirror
          unselectAuto
          snapDuration="00:30"
          select={(info) => {
            const draft = fromEventDates(info.start, info.end, info.allDay)
            if (draft) openCreate(draft)
          }}
          eventClick={(info) => openEdit(info.event.extendedProps.entry as CalendarEntry)}
          editable
          eventStartEditable
          eventDurationEditable
          /*
           * Dropping a timed entry on the rail strips its time. The library only
           * reports where the pointer was at the end of the drag, so the decision is
           * made in `eventDragStop` and simply recorded for `eventDrop` to skip —
           * otherwise the same gesture would also write the moved date.
           */
          eventDragStart={(info) => {
            dragEntryRef.current = info.event.extendedProps.entry as CalendarEntry
            setGridDragActive(true)
          }}
          eventDragStop={(info) => {
            setGridDragActive(false)
            const entry = dragEntryRef.current ?? (info.event.extendedProps.entry as CalendarEntry)
            if (isOverRail(info.jsEvent.clientX, info.jsEvent.clientY)) {
              railDropRef.current = entry.id
              void clearEntryTime(entry)
            } else {
              railDropRef.current = null
            }
          }}
          eventDrop={(info) => {
            const entry = info.event.extendedProps.entry as CalendarEntry
            if (railDropRef.current === entry.id) {
              // Already handled as "clear the time"; the bar goes back to where it was.
              railDropRef.current = null
              info.revert()
              return
            }
            const next = fromEventDates(info.event.start, info.event.end, info.event.allDay)
            if (!next) return
            void commitDates(entry, next).then((ok) => { if (!ok) info.revert() })
          }}
          eventResize={(info) => {
            const entry = info.event.extendedProps.entry as CalendarEntry
            const next = fromEventDates(info.event.start, info.event.end, info.event.allDay)
            if (!next) return
            void commitDates(entry, next).then((ok) => { if (!ok) info.revert() })
          }}
          // A month cell grows its own "+N more" popover; the old view's was an
          // unfocusable <span> with no way to reach the hidden entries.
          /*
           * Time axis: 30-minute slots at twice the library's default row height,
           * which puts ~10 hours (08:00–18:00) in the viewport at a typical panel
           * height. The full 24 hours stay rendered, so the rest of the day is a
           * scroll away — the previous hand-rolled grid showed a fixed 08:00–20:00
           * window at 56px/hour and nothing else.
           */
          slotDuration="00:30"
          /* 36px per 30-minute slot = ~72px per hour. */
          slotMinHeight={36}
          scrollTime="08:00:00"
          /*
           * 24-hour clock. `slotHeaderContent` is the v7 hook for the hour axis
           * (`slotLabelFormat` no longer exists); `isTime` separates it from the
           * other headers that share this renderer.
           */
          slotHeaderContent={(info) => (
            info.isTime
              ? <span className="pg-calendar-hour">{`${String(info.date.getHours()).padStart(2, '0')}:00`}</span>
              : <>{info.text}</>
          )}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayMaxEvents
          nowIndicator
          /*
            v7 removed `dayCellContent` / `dayCellClassNames`, so out-of-month
            cells cannot be styled from a class hook. `dayCellDidMount` is the
            documented way to mark the node; the attribute it sets is what
            `calendar-overrides.css` styles.
          */
          dayCellDidMount={(info) => {
            if (info.isOther) info.el.setAttribute('data-other-month', 'true')
            if (info.isPast) info.el.setAttribute('data-past', 'true')
          }}
          /*
            Our own "+N more". The library's default is an unstyled text node; this
            one carries a class we own, so the overflow affordance matches the rest
            of the app (and stays clickable — the old hand-rolled view rendered it
            as an unfocusable <span>).
          */
          moreLinkContent={(info) => <span className="pg-calendar-more">{info.text}</span>}
          /*
           * The all-day row is gone; the rail owns untimed entries now. Measured:
           * this option only affects the time grids — the month grid keeps its
           * chips — and without it every date-only entry would simply vanish from
           * the day and week views instead of moving to the rail.
           */
          allDaySlot={false}
          // ISO week numbers, matching the Gantt's scale labels.
          weekNumbers
          weekNumberCalculation="ISO"
          locale={FC_LOCALE[locale]}
          height="100%"
          events={events}
          eventDidMount={(info) => {
            // Stable hook for the verification suite; the library's own classes
            // are hashed and must not be relied on.
            info.el.setAttribute('data-calendar-entry', info.event.id)
          }}
          eventContent={(info) => {
            return (
              // Real React JSX: the connector renders it, so the chips keep the
              // app's own markup, colours and focus behaviour.
              <span className="pg-calendar-event">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: 'var(--accent)' }}
                  aria-hidden="true"
                />
                {info.timeText && (
                  <span className="flex-none text-[10px] font-semibold tabular-nums opacity-75">{info.timeText}</span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{info.event.title}</span>
              </span>
            )
          }}
        />
      </div>
        {/*
          The rail is only meaningful where a time grid is: the month view already
          shows an untimed entry as a chip in its day cell, so a rail there would
          duplicate every entry and eat a third of the width for nothing.
        */}
        {mode !== 'month' && (
          /*
           * Hidden below 900px of panel: a 300px rail beside a seven-column week
           * leaves the grid unreadable. The entries do NOT disappear with it — the
           * header chip that takes over is rendered whenever this is hidden, and it
           * opens the same list (see `UntimedEntryList`).
           */
          <div ref={railHostRef} className="flex min-h-0 flex-none @max-[900px]/panel:hidden">
            <CalendarUntimedRail
              entries={untimedEntries}
              todayKey={todayKey}
              locale={locale}
              dropActive={gridDragActive}
              resolveDrop={resolveDrop}
              onDragOver={handleDragOver}
              onDragEnd={clearDropPreview}
              onSchedule={(entry, target) => { void scheduleFromRail(entry, target) }}
              onOpen={openEdit}
              onCreate={(values) => { void createUntimed(values) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
