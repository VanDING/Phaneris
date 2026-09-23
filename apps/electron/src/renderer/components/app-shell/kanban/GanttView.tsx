import * as React from 'react'
import { Gantt, Material, type ILink, type ITask, type IZoomConfig } from '@svar-ui/react-gantt'
import type { ICellProps, IHeaderCellProps } from '@svar-ui/react-grid'
import '@svar-ui/react-gantt/style.css'
import './gantt-overrides.css'
import { ChevronRight, Diamond, MoreHorizontal } from 'lucide-react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { projectsAtom } from '@/atoms/projects'
import { kanbanProjectFilterAtom } from '@/atoms/kanban'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useWorkItems } from '@/hooks/useWorkItems'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { KanbanProjectFilter } from './KanbanProjectFilter'
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

function createZoomLevels(locale: string): NonNullable<IZoomConfig['levels']> {
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
        { unit: 'week', step: 1, format: (date: Date) => `W${isoWeek(date)}` },
      ],
    },
    {
      // month: days across, one cell per day.
      minCellWidth: 34,
      maxCellWidth: 56,
      scales: [
        { unit: 'month', step: 1, format: (date: Date) => monthYear.format(date) },
        { unit: 'week', step: 1, format: (date: Date) => `W${isoWeek(date)}` },
        { unit: 'day', step: 1, format: (date: Date) => String(date.getDate()) },
      ],
    },
  ]
}

const ZOOM_LEVEL_FOR: Record<ScalePreset, number> = { year: 0, quarter: 1, month: 2 }

function isoWeek(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7)
}

/** Two-line task rows need room for a title and quiet date/status metadata. */
const CELL_HEIGHT = 48
/**
 * The full grid width belongs to one task-list column; dates are secondary row
 * metadata, so long task titles have substantially more room than in the old grid.
 */
const GRID_WIDTH = 370
/** Minimum fitted span, so a single-day plan does not render as one column. */
const MIN_FIT_DAYS = 21
/** Breathing room around the fitted range. */
const FIT_PADDING_DAYS = 3

function parsePlanDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function addOneDay(date: Date): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  return next
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

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
    row.displayEnd,
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
  const { navigateToSession } = useNavigation()
  const { items, isLoading } = useWorkItems(activeWorkspaceId ?? null)
  const projects = useAtomValue(projectsAtom)
  const [projectIds, setProjectIds] = useAtom(kanbanProjectFilterAtom)
  const [scale, setScale] = React.useState<ScalePreset>('quarter')
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
  const zoomLevels = React.useMemo(() => createZoomLevels(locale), [locale])
  /** Chart API + host element, used only by the "today" scroll. */
  const ganttRef = React.useRef<unknown>(null)
  const ganttHostRef = React.useRef<HTMLDivElement>(null)

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

  const projectOptions = React.useMemo(
    () => projects.map(({ config }) => ({ id: config.id, name: config.name, color: config.color })),
    [projects],
  )

  const filtered = React.useMemo(
    () => items
      .filter((item) => !projectIds.length || Boolean(item.projectId && projectIds.includes(item.projectId)))
      // The session API returns most-recently-used items first. A planning tree
      // should retain creation order so opening a phase never reverses its rows
      // when child sessions are updated independently.
      .sort((left, right) => {
        const createdOrder = left.createdAt - right.createdAt
        if (createdOrder !== 0) return createdOrder
        return left.title.localeCompare(right.title, locale, { numeric: true, sensitivity: 'base' })
          || left.id.localeCompare(right.id)
      }),
    [items, locale, projectIds],
  )

  // The span actually covered by scheduled work; the scale is always fitted to it.
  const dataRange = React.useMemo(() => {
    let earliest: Date | undefined
    let latest: Date | undefined
    for (const item of filtered) {
      const start = parsePlanDate(item.startAt) ?? parsePlanDate(item.dueAt)
      const end = parsePlanDate(item.dueAt) ?? start
      if (!start || !end) continue
      if (!earliest || start.getTime() < earliest.getTime()) earliest = start
      if (!latest || end.getTime() > latest.getTime()) latest = end
    }
    return earliest && latest ? { start: startOfDay(earliest), end: startOfDay(latest) } : undefined
  }, [filtered])

  const { windowStart, windowEnd } = React.useMemo(() => {
    if (!dataRange) {
      const today = startOfDay(new Date())
      return { windowStart: addDays(today, -7), windowEnd: addDays(today, MIN_FIT_DAYS) }
    }
    const spanDays = Math.round((dataRange.end.getTime() - dataRange.start.getTime()) / 86_400_000) + 1
    const deficit = Math.max(0, MIN_FIT_DAYS - spanDays)
    return {
      windowStart: addDays(dataRange.start, -(FIT_PADDING_DAYS + Math.floor(deficit / 2))),
      windowEnd: addDays(dataRange.end, FIT_PADDING_DAYS + Math.ceil(deficit / 2)),
    }
  }, [dataRange])

  const { tasks, links, scheduledCount, unscheduledParents, parentIds } = React.useMemo(() => {
    const byId = new Map(filtered.map((item) => [item.id, item]))
    const children = directChildren(filtered)
    const scheduled = new Set(filtered.filter((item) => item.startAt || item.dueAt).map((item) => item.id))

    /** Roll a container's range up from its scheduled descendants. */
    const bounds = (item: WorkItem, seen: Set<string>): { start?: Date; end?: Date } => {
      const start = parsePlanDate(item.startAt) ?? parsePlanDate(item.dueAt)
      const end = parsePlanDate(item.dueAt) ?? start
      if (start && end) return { start, end: end.getTime() === start.getTime() ? addOneDay(end) : end }
      if (seen.has(item.id)) return {}
      seen.add(item.id)
      const childBounds = (children.get(item.id) ?? []).map((child) => bounds(child, seen))
      const starts = childBounds.flatMap((value) => (value.start ? [value.start] : []))
      const ends = childBounds.flatMap((value) => (value.end ? [value.end] : []))
      return {
        start: starts.length ? new Date(Math.min(...starts.map(Number))) : undefined,
        end: ends.length ? new Date(Math.max(...ends.map(Number))) : undefined,
      }
    }

    const rangeCache = new Map<string, { start?: Date; end?: Date }>()
    const rangeOf = (item: WorkItem): { start?: Date; end?: Date } => {
      const cached = rangeCache.get(item.id)
      if (cached) return cached
      const computed = bounds(item, new Set())
      rangeCache.set(item.id, computed)
      return computed
    }

    const displayRangeCache = new Map<string, { start?: Date; end?: Date }>()
    const displayRangeOf = (item: WorkItem, seen = new Set<string>()): { start?: Date; end?: Date } => {
      const cached = displayRangeCache.get(item.id)
      if (cached) return cached
      const start = parsePlanDate(item.startAt) ?? parsePlanDate(item.dueAt)
      const end = parsePlanDate(item.dueAt) ?? start
      if (start && end) {
        const ownRange = { start, end }
        displayRangeCache.set(item.id, ownRange)
        return ownRange
      }
      if (seen.has(item.id)) return {}
      seen.add(item.id)
      const childRanges = (children.get(item.id) ?? []).map((child) => displayRangeOf(child, seen))
      const starts = childRanges.flatMap((value) => (value.start ? [value.start] : []))
      const ends = childRanges.flatMap((value) => (value.end ? [value.end] : []))
      const computed = {
        start: starts.length ? new Date(Math.min(...starts.map(Number))) : undefined,
        end: ends.length ? new Date(Math.max(...ends.map(Number))) : undefined,
      }
      displayRangeCache.set(item.id, computed)
      return computed
    }

    const overlapsWindow = (item: WorkItem): boolean => {
      const range = rangeOf(item)
      if (!range.start || !range.end) return false
      return range.end.getTime() >= windowStart.getTime() && range.start.getTime() <= windowEnd.getTime()
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

    let unscheduledParents = 0
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
      // SVAR throws on a summary without dates, so skip rather than crash the view.
      if (!range.start || !range.end) {
        if (type === 'summary') unscheduledParents++
        continue
      }
      const childCount = isParent
        ? (children.get(item.id) ?? []).filter((child) => included.has(child.id)).length
        : 0
      const title = item.title?.trim() || t('chat.titlePlaceholder')
      const depth = depthOf(item)
      const displayRange = displayRangeOf(item)
      tasks.push({
        id: item.id,
        text: title,
        title,
        barColor: barAccent(item.statusId, statusColorById),
        statusLabel: statusLabelById.get(item.statusId) ?? item.statusId,
        details: item.description,
        start: range.start,
        end: range.end,
        displayStart: displayRange.start,
        displayEnd: displayRange.end,
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
        const range = rangeOf(item)
        return Boolean(range.start && range.end)
      }),
    )
    const links: ILink[] = filtered.flatMap((item) => item.dependencyIds
      .filter((dependencyId) => rendered.has(dependencyId) && rendered.has(item.id))
      .map((dependencyId) => ({ source: dependencyId, target: item.id, type: 'e2s' as const })))

    const scheduledCount = filtered.filter((item) => scheduled.has(item.id) && included.has(item.id)).length
    return { tasks, links, scheduledCount, unscheduledParents, parentIds }
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
      <div className="flex h-12 flex-none items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          {projectOptions.length > 0 && (
            <div className="@max-[820px]/panel:hidden">
              <KanbanProjectFilter projects={projectOptions} value={projectIds} onChange={setProjectIds} />
            </div>
          )}
          <span className="truncate text-xs font-medium text-foreground/55">
            {t('gantt.itemCount', { count: scheduledCount })}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          {/* View period: picks the scale tiers (year→months, quarter→weeks, month→days). */}
          <div className="inline-flex h-8 items-center gap-0.5 rounded-md bg-foreground/5 p-0.5">
            {SCALE_PRESETS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScale(option)}
                aria-pressed={scale === option}
                className={
                  scale === option
                    ? 'craft-control h-7 rounded-md bg-background px-3 text-xs font-semibold text-foreground shadow-minimal'
                    : 'craft-control h-7 rounded-md px-3 text-xs font-medium text-foreground/50 transition-colors hover:text-foreground/80'
                }
              >
                {t(`gantt.scale.${option}`, option)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={goToToday}
            className="craft-control h-8 rounded-md border border-foreground/15 px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            {t('common.today')}
          </button>
          {trailingAction}
          {expandButton}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {tasks.length ? (
          /*
            `phaneris-gantt` scopes the CSS override that gives Material's wrapper
            the definite height `.wx-gantt` needs to virtualise its rows, and that
            re-skins the chart in the app's own tokens; see gantt-overrides.css.
          */
          <div ref={ganttHostRef} className="phaneris-gantt h-full rounded-xl border border-border bg-background">
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
                      gridWidth={GRID_WIDTH}
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
        ) : isLoading ? (
          /* The projection arrives asynchronously; without this the view claims
             "nothing scheduled" for however long the fetch takes. */
          <div className="grid h-full place-items-center text-sm text-foreground/45">
            {t('common.loading')}
          </div>
        ) : (
          <div className="grid h-full place-items-center text-sm text-foreground/45">
            {t('gantt.empty')}
          </div>
        )}
        {unscheduledParents > 0 && (
          <p className="pt-2 text-xs text-foreground/45">
            {t('gantt.unscheduledParents', { count: unscheduledParents })}
          </p>
        )}
      </div>
    </div>
  )
}
