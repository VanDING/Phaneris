import * as React from 'react'
import { Gantt, Material, type ILink, type ITask, type IZoomConfig } from '@svar-ui/react-gantt'
import {
  isoWeekNumber,
  timelineDayCount,
  toTimelineRange,
  type TimelineRange,
} from '@phaneris/shared/work-items/browser'
import type { ICellProps, IHeaderCellProps } from '@svar-ui/react-grid'
import '@svar-ui/react-gantt/style.css'
import './gantt-overrides.css'
import { CalendarOff, ChevronRight, Diamond, MoreHorizontal, Plus } from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { projectsAtom } from '@/atoms/projects'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useWorkItemViewState } from '@/hooks/useWorkItemViewState'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { Search } from 'lucide-react'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { KanbanProjectFilter } from './KanbanProjectFilter'
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl'
import type { WorkItem } from '@phaneris/shared/work-items/browser'

/**
 * The bar accent for one planning row.
 *
 * Status colour is used for a narrow leading edge and progress cue — never as a
 * large text background — so a bar stays readable in both themes regardless of how
 * light or dark a workspace's status palette is. The status set is workspace
 * configurable, so an unknown id simply falls back to the app accent rather than
 * to a hardcoded grey.
 */
function barAccent(statusId: string | undefined, statusColorById: Map<string, string>): string {
  return (statusId ? statusColorById.get(statusId) : undefined) ?? 'var(--accent)'
}

/**
 * `Material` takes a render prop and *calls* it (`children()`), but its published
 * `.d.ts` declares `children?: ReactNode` — so passing an element type-checks and
 * then throws `TypeError: e is not a function` at runtime. This alias states the
 * real contract so the compiler enforces it here.
 */
const ThemeProvider = Material as unknown as React.FC<{
  fonts?: boolean
  children: () => React.ReactNode
}>

/**
 * Scale presets. The user picks a *view period*; the library's scale tiers are
 * chosen to match it, which is the whole point of SVAR's `zoom.levels`:
 *
 *   year    -> one cell per month,   headed by months + year
 *   quarter -> one cell per week,    headed by weeks  + months
 *   month   -> one cell per day,     headed by days   + weeks + months
 *
 * TIER ORDER IS COARSEST-FIRST. The library draws `scales[0]` in the topmost
 * row (verified: declaring day/week/month renders days at the top), so the
 * array must be reversed relative to how the tiers read on screen.
 *
 * `min/maxCellWidth` bound each level so a scale can never collapse into
 * illegibility or explode into an unusable canvas.
 */
const SCALE_PRESETS = ['year', 'quarter', 'month'] as const
type ScalePreset = (typeof SCALE_PRESETS)[number]

/**
 * `formatWeek` is injected rather than built here so the `W` prefix can be
 * localized ("第 1 周" is not "W1") and so the week number comes from the shared
 * ISO-8601 helper. The previous hand-rolled formula disagreed with ISO for 53 of
 * the 156 Mondays in 2025–2027 — including every Monday of 2027, which rendered
 * one week ahead.
 */
function createZoomLevels(
  locale: string,
  formatWeek: (date: Date) => string,
): NonNullable<IZoomConfig['levels']> {
  const year = new Intl.DateTimeFormat(locale, { year: 'numeric' })
  const month = new Intl.DateTimeFormat(locale, { month: 'short' })
  const monthYear = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' })

  return [
    {
      // year: months across, one cell per month. Coarsest tier first.
      minCellWidth: 14,
      maxCellWidth: 22,
      scales: [
        { unit: 'year', step: 1, format: (date: Date) => year.format(date) },
        { unit: 'month', step: 1, format: (date: Date) => month.format(date) },
      ],
    },
    {
      // quarter: weeks across, one cell per week.
      minCellWidth: 26,
      maxCellWidth: 40,
      scales: [
        { unit: 'month', step: 1, format: (date: Date) => monthYear.format(date) },
        { unit: 'week', step: 1, format: formatWeek },
      ],
    },
    {
      // month: days across, one cell per day.
      minCellWidth: 34,
      maxCellWidth: 56,
      scales: [
        { unit: 'month', step: 1, format: (date: Date) => monthYear.format(date) },
        { unit: 'week', step: 1, format: formatWeek },
        { unit: 'day', step: 1, format: (date: Date) => String(date.getDate()) },
      ],
    },
  ]
}

const ZOOM_LEVEL_FOR: Record<ScalePreset, number> = { year: 0, quarter: 1, month: 2 }

/** Two-line task rows need room for a title and quiet date/status metadata. */
const CELL_HEIGHT = 48
/**
 * Task-list width.
 *
 * A planning chart's task list has to earn its width twice: wide enough to read
 * titles, narrow enough to leave a usable timeline. One fixed number cannot do
 * both — the previous `370` was picked against a single window size, so at a
 * 1100px host it took a third and at 2000px it took a sixth, and it never moved
 * when either the window or the user asked it to.
 *
 * So the width is a share of the host, clamped, and it keeps following the window
 * for as long as the user has not expressed a preference. The moment they drag
 * the library's splitter, their width wins and is remembered per workspace.
 */
const GRID_WIDTH_RATIO = 0.3
const MIN_GRID_WIDTH = 280
const MAX_GRID_WIDTH = 560
/** The splitter reports a width on every pointer move; only the settled one is stored. */
const GRID_WIDTH_SETTLE_MS = 250
/** Subscription tag, so the listener can be detached without touching others. */
const GRID_WIDTH_TAG = 'phaneris-gantt-grid-width'
/** Minimum fitted span, so a single-day plan does not render as one column. */
const MIN_FIT_DAYS = 21
/** Breathing room around the fitted range. */
const FIT_PADDING_DAYS = 3

const clampGridWidth = (width: number): number =>
  Math.round(Math.min(MAX_GRID_WIDTH, Math.max(MIN_GRID_WIDTH, width)))

/** The width a workspace gets before anyone has dragged the splitter. */
function adaptiveGridWidth(hostWidth: number): number {
  if (!Number.isFinite(hostWidth) || hostWidth <= 0) return MIN_GRID_WIDTH
  return clampGridWidth(hostWidth * GRID_WIDTH_RATIO)
}

/** Local midnight of the day containing `date`. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Calendar-day arithmetic: a day is a day across DST, unlike `± 86_400_000`. */
function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Row metadata date range, from the task's INCLUSIVE planning dates.
 *
 * The bar geometry needs an exclusive end, but the label must not show it: a task
 * due on the 16th is not due on the 17th. The projection therefore carries
 * `dueInclusive` alongside the exclusive `end`, and this reads the former.
 */
function formatTaskDateRange(startValue: unknown, endValue: unknown, locale: string): string {
  const start = startValue instanceof Date ? startValue : undefined
  const end = endValue instanceof Date ? endValue : undefined
  const first = start ?? end
  const last = end ?? start
  if (!first || !last) return ''

  const crossesYear = first.getFullYear() !== last.getFullYear()
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    ...(crossesYear ? { year: '2-digit' as const } : {}),
  })
  const firstLabel = formatter.format(first)
  const lastLabel = formatter.format(last)
  return firstLabel === lastLabel ? firstLabel : `${firstLabel}–${lastLabel}`
}

interface GanttTaskCellContextValue {
  collapsed: ReadonlySet<string>
  hoveredId: string | null
  parentIds: ReadonlySet<string>
  allCollapsed: boolean
  allExpanded: boolean
  toggleCollapsed: (id: string) => void
  collapseAll: () => void
  expandAll: () => void
  setHoveredId: (id: string | null) => void
}

const GanttTaskCellContext = React.createContext<GanttTaskCellContextValue>({
  collapsed: new Set(),
  hoveredId: null,
  parentIds: new Set(),
  allCollapsed: false,
  allExpanded: true,
  toggleCollapsed: () => undefined,
  collapseAll: () => undefined,
  expandAll: () => undefined,
  setHoveredId: () => undefined,
})

function GanttTaskTitleCell({ row }: ICellProps) {
  const { t, i18n } = useTranslation()
  const { collapsed, hoveredId, toggleCollapsed, setHoveredId } = React.useContext(GanttTaskCellContext)
  const id = String(row.id ?? '')
  const title = typeof row.title === 'string' ? row.title : String(row.text ?? '')
  const color = typeof row.barColor === 'string' ? row.barColor : 'var(--accent)'
  const childCount = Number(row.childCount) || 0
  const isParent = row.type === 'summary' && childCount > 0
  const isCollapsed = collapsed.has(id)
  const depth = Math.min(8, Math.max(0, Number(row.depth) || 0))
  const dateRange = formatTaskDateRange(
    row.displayStart,
    row.displayDue,
    i18n.resolvedLanguage ?? i18n.language,
  )
  const statusLabel = typeof row.statusLabel === 'string' ? row.statusLabel : ''
  const isHovered = hoveredId === id

  return (
    <div
      className={`pg-task-cell${isHovered ? ' pg-task-cell--hovered' : ''}`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onMouseEnter={() => setHoveredId(id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      {isParent ? (
        <button
          type="button"
          aria-label={t(isCollapsed ? 'gantt.expandTask' : 'gantt.collapseTask', { title })}
          aria-expanded={!isCollapsed}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            toggleCollapsed(id)
          }}
          className="pg-task-toggle craft-focus"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-150${isCollapsed ? '' : ' rotate-90'}`} />
        </button>
      ) : (
        <span className="pg-task-toggle-spacer" aria-hidden="true" />
      )}
      {row.type === 'milestone' ? (
        <Diamond className="pg-task-status pg-task-status--milestone" style={{ color }} aria-hidden="true" />
      ) : (
        <span
          className="pg-task-status"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      <span className="pg-task-copy" title={title}>
        <span className={`pg-task-title${row.type === 'summary' ? ' pg-task-title--summary' : ''}`}>
          <span className="pg-task-title-text">{title}</span>
          {childCount > 0 && <span className="pg-task-count">{childCount}</span>}
        </span>
        <span className="pg-task-meta" style={{ '--pg-color': color } as React.CSSProperties}>
          {dateRange && <span className="pg-task-meta__date">{dateRange}</span>}
          {statusLabel && <span className="pg-task-meta__status">{statusLabel}</span>}
        </span>
      </span>
    </div>
  )
}

function GanttTaskHeaderCell({ cell }: IHeaderCellProps) {
  const { t } = useTranslation()
  const { parentIds, allCollapsed, allExpanded, collapseAll, expandAll } = React.useContext(GanttTaskCellContext)

  return (
    <div className="pg-task-header">
      <span>{cell.text ?? t('kanban.workItemTitle')}</span>
      {parentIds.size > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('gantt.taskListOptions')}
              className="pg-task-header-menu craft-focus"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem disabled={allExpanded} onSelect={expandAll}>
              {t('gantt.expandAll')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={allCollapsed} onSelect={collapseAll}>
              {t('gantt.collapseAll')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** Parent id -> its direct children, for hierarchy and summary roll-up. */
function directChildren(items: readonly WorkItem[]): Map<string, WorkItem[]> {
  const map = new Map<string, WorkItem[]>()
  for (const item of items) {
    if (!item.parentId) continue
    const children = map.get(item.parentId)
    if (children) children.push(item)
    else map.set(item.parentId, [item])
  }
  return map
}

/**
 * The bar for one planning row.
 *
 * A three-part vocabulary, so the three different meanings never look alike:
 *   - a *leaf task* is a compact status-tinted bar with a progress cue;
 *   - a *container* is a full task bar whose fill shows its own saved progress;
 *   - a *milestone* is a diamond, because it marks a point, not a duration.
 */
function TimelineBar({ data }: { data: ITask }) {
  const { hoveredId, setHoveredId } = React.useContext(GanttTaskCellContext)
  const id = String(data.id ?? '')
  const isHovered = hoveredId === id
  const color = typeof data.barColor === 'string' ? data.barColor : 'var(--accent)'
  const title = typeof data.title === 'string' ? data.title : (data.text ?? '')
  const style = { '--pg-color': color } as React.CSSProperties
  const hoverClass = isHovered ? ' pg-bar--hovered' : ''
  const hoverHandlers = {
    onMouseEnter: () => setHoveredId(id),
    onMouseLeave: () => setHoveredId(null),
  }

  if (data.type === 'milestone') {
    return (
      <div className={`pg-bar pg-bar--milestone${hoverClass}`} style={style} {...hoverHandlers}>
        <span className="pg-bar-label pg-bar-label--outside" title={title}>{title}</span>
      </div>
    )
  }

  const isSummary = data.type === 'summary'
  const progress = Math.max(0, Math.min(100, typeof data.progress === 'number' ? data.progress : 0))

  if (isSummary) {
    return (
      <div className={`pg-bar pg-bar--summary${hoverClass}`} style={style} title={`${title} · ${progress}%`} {...hoverHandlers}>
        <div className="pg-summary-fill" style={{ width: `${progress}%` }} aria-hidden="true" />
        <span className="pg-bar-label">{title}</span>
        <span className="pg-summary-progress">{progress}%</span>
      </div>
    )
  }

  return (
    <div className={`pg-bar${progress >= 100 ? ' pg-bar--done' : ''}${hoverClass}`} style={style} title={title} {...hoverHandlers}>
      <div className="pg-accent" />
      <div className="pg-fill" style={{ width: `${progress}%` }} />
      <span className="pg-bar-label">{title}</span>
    </div>
  )
}

/**
 * Read-only timeline projection of work item planning fields.
 *
 * The projection is bounded on three axes, because SVAR renders every task it is
 * handed and builds its scale for the whole requested range: archived items are
 * dropped by the data layer, only items overlapping the view are built, and the
 * view is always fitted to the work rather than to a fixed calendar window.
 */
export function GanttView() {
  const { t, i18n } = useTranslation()
  const { activeWorkspaceId, sessionStatuses, trailingAction, expandButton } = useAppShellContext()
  const { navigate, navigateToSession } = useNavigation()
  const { items, isLoading } = useWorkItems(activeWorkspaceId ?? null)
  const projects = useAtomValue(projectsAtom)
  const setEditorTarget = useSetAtom(kanbanEditorTargetAtom)
  const compensateForStoplight = useCompensateForStoplight()
  const projectOptionsForState = React.useMemo(
    () => projects.map(({ config }) => ({ id: config.id, name: config.name, color: config.color })),
    [projects],
  )
  const liveProjectIds = React.useMemo(() => projectOptionsForState.map(({ id }) => id), [projectOptionsForState])
  /*
   * The project filter and the search box are the two controls this projection
   * shares with the board, the list and the calendar, so they come from the same
   * hook rather than a bare atom — otherwise the box would render but filter
   * nothing.
   */
  const { projectIds, setProjectIds, search, setSearch } = useWorkItemViewState(
    activeWorkspaceId ?? null,
    items,
    liveProjectIds,
  )
  /*
   * The zoom preset survives leaving the projection: opening a work item unmounts
   * this view, and a remount used to drop the user back to `quarter`.
   */
  const scaleScope = activeWorkspaceId ?? 'global'
  const [scale, setScale] = React.useState<ScalePreset>(
    () => storage.get<ScalePreset>(KEYS.ganttScale, 'quarter', scaleScope),
  )
  React.useEffect(() => {
    storage.set(KEYS.ganttScale, scale, scaleScope)
  }, [scale, scaleScope])
  /*
   * Task-list width. Read once per workspace; `null` means "no preference yet",
   * which is what keeps the adaptive default following the window.
   */
  const widthScope = activeWorkspaceId ?? 'global'
  const readUserGridWidth = React.useCallback((scope: string): number | null => {
    const stored = storage.get<unknown>(KEYS.ganttTaskColumnWidth, null, scope)
    // localStorage is user-writable, so a hand-edited value must not be trusted
    // into the chart's geometry.
    return typeof stored === 'number' && Number.isFinite(stored) ? clampGridWidth(stored) : null
  }, [])
  const [userGridWidth, setUserGridWidth] = React.useState<number | null>(
    () => readUserGridWidth(widthScope),
  )
  React.useEffect(() => {
    setUserGridWidth(readUserGridWidth(widthScope))
  }, [readUserGridWidth, widthScope])
  /** Host width, so the adaptive default is a share of what is actually available. */
  const [gridHostWidth, setGridHostWidth] = React.useState(0)
  const effectiveGridWidth = userGridWidth ?? adaptiveGridWidth(gridHostWidth)
  /** Settled-but-unwritten width, so an unmount mid-drag cannot lose the gesture. */
  const pendingGridWidthRef = React.useRef<number | null>(null)
  const gridWidthTimerRef = React.useRef<number | null>(null)
  const collapseScopeSuffix = React.useMemo(() => {
    const projectsScope = projectIds.length
      ? [...projectIds].sort().map((id) => encodeURIComponent(id)).join(',')
      : 'all'
    return `ws=${encodeURIComponent(activeWorkspaceId ?? 'global')}|projects=${projectsScope}`
  }, [activeWorkspaceId, projectIds])
  const readCollapsedForScope = React.useCallback((scope: string) => {
    const stored = storage.get<unknown>(KEYS.collapsedGanttItems, [], scope)
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [])
  }, [])
  const [collapseState, setCollapseState] = React.useState(() => ({
    scope: collapseScopeSuffix,
    collapsed: readCollapsedForScope(collapseScopeSuffix),
  }))
  const collapsed = collapseState.scope === collapseScopeSuffix
    ? collapseState.collapsed
    : readCollapsedForScope(collapseScopeSuffix)
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const zoomLevels = React.useMemo(
    () => createZoomLevels(locale, (date) => t('gantt.weekNumber', { week: isoWeekNumber(date) })),
    [locale, t],
  )
  /** Chart API + host element, used by the "today" scroll and the width sync. */
  const ganttRef = React.useRef<unknown>(null)
  const ganttHostRef = React.useRef<HTMLDivElement>(null)

  /*
   * Track how much room the chart actually has. `isLoading` is a dependency
   * because the host element does not exist until the projection arrives, so the
   * observer has nothing to observe on the first pass.
   */
  React.useEffect(() => {
    const node = ganttHostRef.current
    if (!node) return
    setGridHostWidth(node.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.clientWidth
      setGridHostWidth(width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [isLoading])

  /*
   * The library's splitter drives its own store; this listener is how the
   * gesture becomes a preference. It is deliberately debounced: the splitter
   * fires on every pointer move, and writing localStorage on each one would put
   * hundreds of synchronous writes inside a single drag.
   */
  const commitGridWidth = React.useCallback((width: number) => {
    pendingGridWidthRef.current = null
    setUserGridWidth(width)
    storage.set(KEYS.ganttTaskColumnWidth, width, widthScope)
  }, [widthScope])

  React.useEffect(() => {
    const api = ganttRef.current as {
      on?: (action: string, callback: (event: { width?: number }) => void, config?: { tag?: string }) => void
      detach?: (tag: string) => void
    } | null
    if (!api?.on || !api.detach) return
    api.on('resize-grid', (event) => {
      const width = Number(event?.width)
      if (!Number.isFinite(width) || width <= 0) return
      const clamped = clampGridWidth(width)
      pendingGridWidthRef.current = clamped
      if (gridWidthTimerRef.current !== null) window.clearTimeout(gridWidthTimerRef.current)
      gridWidthTimerRef.current = window.setTimeout(() => {
        gridWidthTimerRef.current = null
        commitGridWidth(clamped)
      }, GRID_WIDTH_SETTLE_MS)
    }, { tag: GRID_WIDTH_TAG })
    return () => {
      api.detach?.(GRID_WIDTH_TAG)
    }
  }, [commitGridWidth, isLoading])

  /*
   * A drag that is still settling when the view unmounts must not be lost —
   * opening a work item from the chart unmounts it while the pointer is up.
   */
  React.useEffect(() => () => {
    if (gridWidthTimerRef.current !== null) window.clearTimeout(gridWidthTimerRef.current)
    const pending = pendingGridWidthRef.current
    if (pending !== null) {
      pendingGridWidthRef.current = null
      storage.set(KEYS.ganttTaskColumnWidth, pending, widthScope)
    }
  }, [widthScope])

  React.useEffect(() => {
    if (collapseState.scope === collapseScopeSuffix) return
    setCollapseState({ scope: collapseScopeSuffix, collapsed: readCollapsedForScope(collapseScopeSuffix) })
  }, [collapseScopeSuffix, collapseState.scope, readCollapsedForScope])

  React.useEffect(() => {
    if (collapseState.scope !== collapseScopeSuffix) return
    storage.set(KEYS.collapsedGanttItems, Array.from(collapseState.collapsed), collapseScopeSuffix)
  }, [collapseScopeSuffix, collapseState])

  const statusColorById = React.useMemo(
    () => new Map((sessionStatuses ?? []).map((status) => [status.id, status.resolvedColor])),
    [sessionStatuses],
  )
  const statusLabelById = React.useMemo(
    () => new Map((sessionStatuses ?? []).map((status) => [status.id, status.label])),
    [sessionStatuses],
  )

  const filtered = React.useMemo(
    () => items
      .filter((item) => !projectIds.length || Boolean(item.projectId && projectIds.includes(item.projectId)))
      // Same search semantics as the board and list: title + description.
      .filter((item) => {
        const needle = search.trim().toLocaleLowerCase()
        if (!needle) return true
        return `${item.title}\n${item.description ?? ''}`.toLocaleLowerCase().includes(needle)
      })
      // The session API returns most-recently-used items first. A planning tree
      // should retain creation order so opening a phase never reverses its rows
      // when child sessions are updated independently.
      .sort((left, right) => {
        const createdOrder = left.createdAt - right.createdAt
        if (createdOrder !== 0) return createdOrder
        return left.title.localeCompare(right.title, locale, { numeric: true, sensitivity: 'base' })
          || left.id.localeCompare(right.id)
      }),
    [items, locale, projectIds, search],
  )

  // The span actually covered by scheduled work; the scale is always fitted to it.
  // Ranges come from `toTimelineRange`, whose `endExclusive` already sits at the
  // midnight AFTER the last due day, so the fitted window covers that day whole.
  const dataRange = React.useMemo(() => {
    let start: Date | undefined
    let endExclusive: Date | undefined
    for (const item of filtered) {
      const range = toTimelineRange(item)
      if (!range) continue
      if (!start || range.start.getTime() < start.getTime()) start = range.start
      if (!endExclusive || range.endExclusive.getTime() > endExclusive.getTime()) endExclusive = range.endExclusive
    }
    return start && endExclusive ? { start, endExclusive } : undefined
  }, [filtered])

  const { windowStart, windowEnd } = React.useMemo(() => {
    if (!dataRange) {
      const today = startOfDay(new Date())
      return { windowStart: addDays(today, -7), windowEnd: addDays(today, MIN_FIT_DAYS) }
    }
    const spanDays = timelineDayCount(dataRange)
    const deficit = Math.max(0, MIN_FIT_DAYS - spanDays)
    return {
      windowStart: addDays(dataRange.start, -(FIT_PADDING_DAYS + Math.floor(deficit / 2))),
      windowEnd: addDays(dataRange.endExclusive, FIT_PADDING_DAYS + Math.ceil(deficit / 2)),
    }
  }, [dataRange])

  const { tasks, links, scheduledCount, unscheduledItems, parentIds } = React.useMemo(() => {
    const byId = new Map(filtered.map((item) => [item.id, item]))
    const children = directChildren(filtered)
    const scheduled = new Set(filtered.filter((item) => item.startAt || item.dueAt).map((item) => item.id))
    /** Own-dated items, used to keep ancestors of in-window work in the tree. */

    /** The child ranges a container rolls up from, or `[]` for a leaf. */
    const childRangesOf = (item: WorkItem, seen: Set<string>): TimelineRange[] => {
      if (seen.has(item.id)) return []
      seen.add(item.id)
      return (children.get(item.id) ?? [])
        .map((child) => rollUpRange(child, seen))
        .filter((range): range is TimelineRange => range !== undefined)
    }

    /**
     * Roll a container's range up from its scheduled descendants.
     *
     * Every range is an inclusive-days range with an exclusive end, built by
     * `toTimelineRange`, so a 5-day child contributes 5 days rather than 4 and
     * the roll-up cannot drift by a day per level.
     */
    const rollUpRange = (item: WorkItem, seen: Set<string>): TimelineRange | undefined => {
      const own = toTimelineRange(item)
      if (own) return own
      const collected = childRangesOf(item, seen)
      if (!collected.length) return undefined
      return {
        start: new Date(Math.min(...collected.map((range) => range.start.getTime()))),
        endExclusive: new Date(Math.max(...collected.map((range) => range.endExclusive.getTime()))),
      }
    }

    const rangeCache = new Map<string, TimelineRange | undefined>()
    const rangeOf = (item: WorkItem): TimelineRange | undefined => {
      if (rangeCache.has(item.id)) return rangeCache.get(item.id)
      const computed = rollUpRange(item, new Set())
      rangeCache.set(item.id, computed)
      return computed
    }

    /**
     * The range a bar actually draws.
     *
     * A container that carries its own dates keeps them (so a phase bar shows the
     * phase, not the envelope of its children); only a container without its own
     * dates inherits the rolled-up envelope.
     */
    const displayRangeCache = new Map<string, TimelineRange | undefined>()
    const displayRangeOf = (item: WorkItem): TimelineRange | undefined => {
      if (displayRangeCache.has(item.id)) return displayRangeCache.get(item.id)
      const own = toTimelineRange(item)
      const computed = own ?? rollUpRange(item, new Set())
      displayRangeCache.set(item.id, computed)
      return computed
    }

    const overlapsWindow = (item: WorkItem): boolean => {
      const range = rangeOf(item)
      if (!range) return false
      return range.endExclusive.getTime() > windowStart.getTime() && range.start.getTime() <= windowEnd.getTime()
    }

    // Include an item when it overlaps the view, and keep ancestors so the tree
    // stays navigable.
    const included = new Set<string>()
    for (const item of filtered) {
      if (scheduled.has(item.id) && overlapsWindow(item)) included.add(item.id)
    }
    for (const item of filtered) {
      if (!scheduled.has(item.id) || !included.has(item.id)) continue
      let parentId = byId.get(item.id)?.parentId
      const guard = new Set<string>()
      while (parentId && byId.has(parentId) && !guard.has(parentId)) {
        guard.add(parentId)
        included.add(parentId)
        parentId = byId.get(parentId)?.parentId
      }
    }

    const parents = new Set<string>()
    for (const item of filtered) {
      if (!included.has(item.id)) continue
      if ((children.get(item.id) ?? []).some((child) => included.has(child.id))) parents.add(item.id)
    }

    /**
     * A collapsed parent hides its whole subtree. Resolved here, in the
     * projection, rather than delegated to the library's own tree state, so the
     * visible row set is a pure function of `collapsed` and the counts stay honest.
     */
    const isHiddenByCollapse = (item: WorkItem): boolean => {
      let parentId = item.parentId
      const guard = new Set<string>()
      while (parentId && byId.has(parentId) && !guard.has(parentId)) {
        if (collapsed.has(parentId)) return true
        guard.add(parentId)
        parentId = byId.get(parentId)?.parentId
      }
      return false
    }

    const depthOf = (item: WorkItem): number => {
      let depth = 0
      let parentId = item.parentId
      const guard = new Set<string>()
      while (parentId && byId.has(parentId) && !guard.has(parentId)) {
        guard.add(parentId)
        depth += 1
        parentId = byId.get(parentId)?.parentId
      }
      return depth
    }

    const tasks: ITask[] = []
    // `open` belongs only on parents: the library recursively reads `data` when
    // it is true, while leaf rows have `data: null`. The projection also removes
    // collapsed descendants so the grid and timeline always share the same rows.
    for (const item of filtered) {
        if (!included.has(item.id)) continue
        const isParent = parents.has(item.id)
        if (isHiddenByCollapse(item)) continue
      const range = rangeOf(item)
      // A container is always a summary: rendering it as a milestone collapses the
      // whole branch into one diamond and hides the real span — measured on real
      // data, phase bars went from 480–1360px spans to 31px diamonds purely because
      // they also carried `isMilestone`.
      const type = isParent ? 'summary' : item.isMilestone ? 'milestone' : 'task'
      // The library throws on a summary without dates, and a dateless row cannot be
      // placed on a timeline at all — such items are reported through the header
      // count and the unscheduled drawer instead of vanishing silently.
      if (!range) continue
      const childCount = isParent
        ? (children.get(item.id) ?? []).filter((child) => included.has(child.id)).length
        : 0
      const title = item.title?.trim() || t('chat.titlePlaceholder')
      const depth = depthOf(item)
      const displayRange = displayRangeOf(item) ?? range
      tasks.push({
        id: item.id,
        text: title,
        title,
        barColor: barAccent(item.statusId, statusColorById),
        statusLabel: statusLabelById.get(item.statusId) ?? item.statusId,
        details: item.description,
        start: range.start,
        // `end` is an EXCLUSIVE boundary: a task due on the 14th ends on the 15th.
        end: range.endExclusive,
        displayStart: displayRange.start,
        // Bar geometry is exclusive; the label needs the inclusive last day.
        displayEnd: displayRange.endExclusive,
        displayDue: addDays(displayRange.endExclusive, -1),
        depth,
        progress: item.progress ?? 0,
        type,
        parent: item.parentId && included.has(item.parentId) ? item.parentId : 0,
        ...(isParent ? { open: !collapsed.has(item.id) } : {}),
        ...(childCount ? { childCount } : {}),
      })
    }

    const rendered = new Set(tasks.map((task) => task.id))
    const parentIds = new Set(
      [...parents].filter((id) => {
        const item = byId.get(id)
        if (!item) return false
        return rangeOf(item) !== undefined
      }),
    )
    const links: ILink[] = filtered.flatMap((item) => item.dependencyIds
      .filter((dependencyId) => rendered.has(dependencyId) && rendered.has(item.id))
      .map((dependencyId) => ({ source: dependencyId, target: item.id, type: 'e2s' as const })))

    const scheduledCount = filtered.filter((item) => rangeOf(item) !== undefined).length
    /**
     * Items with neither their own dates nor any scheduled descendant. These were
     * previously dropped without a trace: the old render loop counted only
     * "dateless summaries" that could never reach the branch it counted them in,
     * so the notice was unreachable and the header claimed "2 scheduled items"
     * while the chart drew 3 bars.
     */
    const unscheduledItems = filtered.filter((item) => rangeOf(item) === undefined)
    return { tasks, links, scheduledCount, unscheduledItems, parentIds }
  }, [collapsed, filtered, statusColorById, statusLabelById, t, windowStart, windowEnd])

  const toggleCollapsed = React.useCallback((id: string) => {
    setCollapseState((previous) => {
      const current = previous.scope === collapseScopeSuffix
        ? previous.collapsed
        : readCollapsedForScope(collapseScopeSuffix)
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { scope: collapseScopeSuffix, collapsed: next }
    })
  }, [collapseScopeSuffix, readCollapsedForScope])
  const collapseAll = React.useCallback(() => {
    setCollapseState({ scope: collapseScopeSuffix, collapsed: new Set(parentIds) })
  }, [collapseScopeSuffix, parentIds])
  const expandAll = React.useCallback(() => {
    setCollapseState({ scope: collapseScopeSuffix, collapsed: new Set() })
  }, [collapseScopeSuffix])
  const allCollapsed = parentIds.size > 0 && [...parentIds].every((id) => collapsed.has(id))
  const allExpanded = [...parentIds].every((id) => !collapsed.has(id))
  const taskCellContext = React.useMemo<GanttTaskCellContextValue>(() => ({
    collapsed,
    hoveredId,
    parentIds,
    allCollapsed,
    allExpanded,
    toggleCollapsed,
    collapseAll,
    expandAll,
    setHoveredId,
  }), [
    allCollapsed,
    allExpanded,
    collapseAll,
    collapsed,
    expandAll,
    hoveredId,
    parentIds,
    toggleCollapsed,
  ])

  /**
   * Bring today into view. The scale is always fitted to the work, so this is a
   * scroll — not a range change — and it matters most on long plans where today
   * sits far from the range the eye lands on.
   *
   * The public API exposes no scroll method, so the offset is derived from the
   * chart's own state and applied to the scroll container. Every step is optional:
   * if the library changes shape this degrades to a no-op rather than throwing.
   */
  const goToToday = React.useCallback(() => {
    const api = ganttRef.current as {
      getState?: () => {
        _start?: Date
        _scales?: { diff?: (a: Date, b: Date, unit?: string, unitSize?: boolean) => number; lengthUnitWidth?: number }
      }
    } | null
    const root = ganttHostRef.current
    if (!api?.getState || !root) return
    const state = api.getState()
    const start = state._start
    const scales = state._scales
    if (!start || !scales?.diff || !scales.lengthUnitWidth) return
    const offsetPx = scales.diff(start, new Date()) * scales.lengthUnitWidth
    const scroller = root.querySelector('.wx-area') ?? root.querySelector('.wx-gantt')
    const el = (scroller?.parentElement ?? scroller) as HTMLElement | null
    if (!el) return
    el.scrollLeft = Math.max(0, offsetPx - el.clientWidth / 2)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/*
        Same header skeleton as the calendar: a 42px bar (matching the board and the
        list) with traffic-light compensation, and a three-column grid so the centre
        group is genuinely centred rather than wherever `justify-between` lands it.
        Left = the controls shared with the other projections (project filter,
        search) plus this view's own counts; centre = Today; right = the zoom
        segments, New Task and the surface controls — the calendar keeps its view
        segments on the right too.
      */}
      <div
        className="grid h-[42px] flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/50 bg-background/80 backdrop-blur-sm @max-[760px]/panel:grid-cols-[auto_minmax(0,1fr)]"
        style={{
          paddingLeft: compensateForStoplight ? 84 : 16,
          paddingRight: compensateForStoplight ? 48 : 16,
        }}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden @max-[760px]/panel:hidden">
          {projectOptionsForState.length > 0 && (
            <div className="@max-[820px]/panel:hidden">
              <KanbanProjectFilter projects={projectOptionsForState} value={projectIds} onChange={setProjectIds} />
            </div>
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
          <span className="truncate text-xs font-medium text-foreground/55">
            {t('gantt.itemCount', { count: scheduledCount })}
          </span>
          {/*
            Dateless items cannot be placed on a timeline, but they must not
            disappear either: the count is always honest and the drawer is the
            path back to them.
          */}
          {unscheduledItems.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="craft-control inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-foreground/15 px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
                >
                  <CalendarOff className="h-3.5 w-3.5" />
                  {t('gantt.unscheduledCount', { count: unscheduledItems.length })}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <div className="border-b border-border/60 px-3 py-2">
                  <div className="text-xs font-semibold">{t('gantt.unscheduledTitle')}</div>
                  <p className="pt-1 text-[11px] leading-snug text-foreground/55">
                    {t('gantt.unscheduledHint')}
                  </p>
                </div>
                <ScrollArea className="max-h-72">
                  <div className="flex flex-col gap-0.5 p-1.5">
                    {unscheduledItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateToSession(item.id)}
                        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]"
                      >
                        <span
                          className="h-2 w-2 flex-none rounded-full"
                          style={{ backgroundColor: barAccent(item.statusId, statusColorById) }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {item.title?.trim() || t('chat.titlePlaceholder')}
                        </span>
                        <span className="flex-none text-[10px] text-foreground/55">
                          {statusLabelById.get(item.statusId) ?? item.statusId}
                        </span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <button
            type="button"
            onClick={goToToday}
            className="craft-control h-8 rounded-md border border-foreground/15 px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            {t('common.today')}
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 @max-[760px]/panel:col-start-2">
          {/*
            View period: picks the scale tiers (year→months, quarter→weeks,
            month→days). Uses the shared radiogroup primitive rather than a
            second hand-rolled segmented control, so this and the calendar's
            control behave identically for keyboard and assistive tech.
          */}
          <div className="inline-flex h-8 items-center rounded-md bg-foreground/5 p-0.5">
            <SettingsSegmentedControl
              size="sm"
              className="gap-0.5"
              aria-label={t('gantt.scaleMode')}
              value={scale}
              onValueChange={setScale}
              options={SCALE_PRESETS.map((option) => ({
                value: option,
                label: t(`gantt.scale.${option}`, option),
              }))}
            />
          </div>
          <button
            type="button"
            onClick={() => setEditorTarget({
              mode: 'create',
              initialProjectId: projectIds.length === 1 ? projectIds[0] : undefined,
            })}
            disabled={!activeWorkspaceId}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="@max-[1100px]/panel:hidden">{t('kanban.newTask')}</span>
          </button>
          {/* Surface-injected close + fullscreen controls. */}
          {trailingAction}
          {expandButton}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {isLoading ? (
          /* The projection arrives asynchronously; without this the view claims
             "nothing scheduled" for however long the fetch takes. */
          <div className="grid h-full place-items-center text-sm text-foreground/45">
            {t('common.loading')}
          </div>
        ) : (
          /*
            The chart is rendered even with nothing scheduled, so an empty plan
            still shows the planning surface — the task-list header and the time
            scale — instead of collapsing into a single line of text. The empty
            state then sits inside the timeline pane; see the overlay below.

            `phaneris-gantt` scopes the CSS override that gives Material's wrapper
            the definite height `.wx-gantt` needs to virtualise its rows, and that
            re-skins the chart in the app's own tokens; see gantt-overrides.css.
          */
          <div ref={ganttHostRef} className="phaneris-gantt relative h-full rounded-xl border border-border bg-background">
            <ThemeProvider fonts={false}>
              {() => (
                <GanttTaskCellContext.Provider value={taskCellContext}>
                  <div className="h-full min-h-0 overflow-hidden">
                    <Gantt
                      ref={ganttRef as never}
                      tasks={tasks}
                      links={links}
                      readonly
                      cellBorders="column"
                      cellHeight={CELL_HEIGHT}
                      lengthUnit="day"
                      durationUnit="day"
                      gridWidth={effectiveGridWidth}
                      start={windowStart}
                      end={windowEnd}
                      zoom={{ level: ZOOM_LEVEL_FOR[scale], levels: zoomLevels }}
                      taskTemplate={TimelineBar}
                      columns={[
                        {
                          id: 'text',
                          header: { text: t('kanban.workItemTitle'), cell: GanttTaskHeaderCell },
                          flexgrow: 1,
                          cell: GanttTaskTitleCell,
                        },
                      ]}
                      onselecttask={(event) => event?.id && navigateToSession(String(event.id))}
                    />
                  </div>
                </GanttTaskCellContext.Provider>
              )}
            </ThemeProvider>
          </div>
        )}
      </div>
    </div>
  )
}
