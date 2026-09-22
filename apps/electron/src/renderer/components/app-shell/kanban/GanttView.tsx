import * as React from 'react'
import { Gantt, Material, type ILink, type ITask, type IZoomConfig } from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/style.css'
import './gantt-overrides.css'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { projectsAtom } from '@/atoms/projects'
import { kanbanProjectFilterAtom } from '@/atoms/kanban'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useWorkItems } from '@/hooks/useWorkItems'
import { KanbanProjectFilter } from './KanbanProjectFilter'
import type { WorkItem } from '@phaneris/shared/work-items/browser'

/**
 * The bar accent for one planning row.
 *
 * Status colour is used for the border, the stripe and the progress rail — never
 * as a text background — so a bar stays readable in both themes regardless of how
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

const ZOOM_LEVELS: NonNullable<IZoomConfig['levels']> = [
  {
    // year: months across, one cell per month. Coarsest tier first.
    minCellWidth: 14,
    maxCellWidth: 22,
    scales: [
      { unit: 'year', step: 1, format: (date: Date) => `${date.getFullYear()}年` },
      { unit: 'month', step: 1, format: (date: Date) => `${date.getMonth() + 1}月` },
    ],
  },
  {
    // quarter: weeks across, one cell per week.
    minCellWidth: 26,
    maxCellWidth: 40,
    scales: [
      { unit: 'month', step: 1, format: (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月` },
      { unit: 'week', step: 1, format: (date: Date) => `W${isoWeek(date)}` },
    ],
  },
  {
    // month: days across, one cell per day.
    minCellWidth: 34,
    maxCellWidth: 56,
    scales: [
      { unit: 'month', step: 1, format: (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月` },
      { unit: 'week', step: 1, format: (date: Date) => `W${isoWeek(date)}` },
      { unit: 'day', step: 1, format: (date: Date) => `${date.getDate()}` },
    ],
  },
]

const ZOOM_LEVEL_FOR: Record<ScalePreset, number> = { year: 0, quarter: 1, month: 2 }

function isoWeek(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7)
}

/**
 * Row height; the library draws bars `cellHeight - 7` tall, so this yields a 33px
 * bar. Swept 34/40/48: at 34 the bar is 27px and the label, the 7px striped rail
 * and the state marker compete for the same few pixels, which is what read as
 * cramped. 33px is also the density mature timelines use.
 */
const CELL_HEIGHT = 40
/**
 * Title column width. The title column is `gridWidth` minus the two date columns
 * and their padding, so the dates get real room (at ~72px a `YYYY-MM-DD` wraps
 * onto three lines and the whole list reads as cramped) and the title still gets
 * ~215px.
 */
const GRID_WIDTH = 420
const DATE_COLUMN_WIDTH = 96
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
 *   - a *leaf task* is a filled progress bar in its status colour;
 *   - a *container* is a thin striped rail, because its span is computed from its
 *     children and must not read as an entered date (the convention Jira, Plane
 *     and OpenProject all converge on);
 *   - a *milestone* is a diamond, because it marks a point, not a duration.
 */
function TimelineBar({ data }: { data: ITask }) {
  const color = typeof data.barColor === 'string' ? data.barColor : 'var(--accent)'
  const title = typeof data.title === 'string' ? data.title : (data.text ?? '')
  const style = { '--pg-color': color } as React.CSSProperties

  if (data.type === 'milestone') {
    return (
      <div className="pg-bar pg-bar--milestone" style={style}>
        <span className="pg-bar-label pg-bar-label--outside" title={title}>{title}</span>
      </div>
    )
  }

  const isSummary = data.type === 'summary'
  const progress = typeof data.progress === 'number' ? data.progress : 0
  const childCount = typeof data.childCount === 'number' ? data.childCount : 0

  if (isSummary) {
    return (
      <div className="pg-bar pg-bar--summary" style={style} title={title}>
        <div className="pg-accent" />
        <div className="pg-rail" />
        <span className="pg-bar-label">{title}</span>
        {childCount > 0 && <span className="pg-bar-count">{childCount}</span>}
      </div>
    )
  }

  return (
    <div className={`pg-bar${progress >= 100 ? ' pg-bar--done' : ''}`} style={style} title={title}>
      <div className="pg-accent" />
      <div className="pg-fill" style={{ width: `${progress}%` }} />
      <span className="pg-bar-label">{title}</span>
    </div>
  )
}

/**
 * Read-only timeline projection of Session planning fields.
 *
 * The projection is bounded on three axes, because SVAR renders every task it is
 * handed and builds its scale for the whole requested range: archived items are
 * dropped by the data layer, only items overlapping the view are built, and the
 * view is always fitted to the work rather than to a fixed calendar window.
 */
export function GanttView() {
  const { t } = useTranslation()
  const { activeWorkspaceId, sessionStatuses, trailingAction, expandButton } = useAppShellContext()
  const { navigateToSession } = useNavigation()
  const { items, isLoading } = useWorkItems(activeWorkspaceId ?? null)
  const projects = useAtomValue(projectsAtom)
  const [projectIds, setProjectIds] = useAtom(kanbanProjectFilterAtom)
  const [scale, setScale] = React.useState<ScalePreset>('quarter')
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  /** Chart API + host element, used only by the "today" scroll. */
  const ganttRef = React.useRef<unknown>(null)
  const ganttHostRef = React.useRef<HTMLDivElement>(null)

  const statusColorById = React.useMemo(
    () => new Map((sessionStatuses ?? []).map((status) => [status.id, status.resolvedColor])),
    [sessionStatuses],
  )

  const projectOptions = React.useMemo(
    () => projects.map(({ config }) => ({ id: config.id, name: config.name, color: config.color })),
    [projects],
  )

  const filtered = React.useMemo(
    () => items.filter((item) => !projectIds.length || Boolean(item.projectId && projectIds.includes(item.projectId))),
    [items, projectIds],
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

  const { tasks, links, scheduledCount, unscheduledParents } = React.useMemo(() => {
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
    // NOTE: never set `open` on these tasks. The library's `DataTree.toArray`
    // recurses with `n.open === true && Bt(n.data, out)` and a leaf's `data` is
    // `null`, so `open: true` on anything without children throws
    // `Cannot read properties of null (reading 'forEach')` during the chart's own
    // init. Collapse/expand is expressed by omitting rows instead (see
    // `isHiddenByCollapse`), which also keeps the header count honest.
    for (const item of filtered) {
      if (!included.has(item.id)) continue
      const isParent = parents.has(item.id)
      if (!isParent && isHiddenByCollapse(item)) continue
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
      tasks.push({
        id: item.id,
        // Depth is expressed in the label because the grid's own tree renderer
        // does not indent: it gates on `$level`, which is only populated when the
        // grid is built in tree mode. This is what makes hierarchy legible.
        text: depth > 0 ? `${'\u2007\u2007'.repeat(depth)}· ${title}` : title,
        title,
        barColor: barAccent(item.statusId, statusColorById),
        details: item.description,
        start: range.start,
        end: range.end,
        progress: item.progress ?? 0,
        type,
        parent: item.parentId && included.has(item.parentId) ? item.parentId : 0,
        ...(childCount ? { childCount } : {}),
      })
    }

    const rendered = new Set(tasks.map((task) => task.id))
    const links: ILink[] = filtered.flatMap((item) => item.dependencyIds
      .filter((dependencyId) => rendered.has(dependencyId) && rendered.has(item.id))
      .map((dependencyId) => ({ source: dependencyId, target: item.id, type: 'e2s' as const })))

    return { tasks, links, scheduledCount: included.size, unscheduledParents }
  }, [collapsed, filtered, statusColorById, t, windowStart, windowEnd])

  const parentIds = React.useMemo(() => {
    const ids = new Set(items.map((item) => item.id))
    const parents = new Set<string>()
    for (const item of items) if (item.parentId && ids.has(item.parentId)) parents.add(item.parentId)
    return parents
  }, [items])

  const allCollapsed = parentIds.size > 0 && collapsed.size >= parentIds.size

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
      {/* Same header idiom as Calendar and Kanban: filters on the LEFT, view
          controls on the RIGHT. A projection that puts its filter elsewhere reads
          as a different application. */}
      <div className="grid h-12 flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/50 bg-background/80 px-4 backdrop-blur-sm @max-[820px]/panel:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden @max-[820px]/panel:hidden">
          {projectOptions.length > 0 && (
            <KanbanProjectFilter projects={projectOptions} value={projectIds} onChange={setProjectIds} />
          )}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 text-xs text-foreground/55">
          <span className="font-medium">{t('gantt.sessionCount', { count: scheduledCount })}</span>
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">
          {parentIds.size > 0 && (
            <div className="inline-flex h-8 items-center gap-0.5 rounded-md bg-foreground/5 p-0.5">
              <button
                type="button"
                onClick={() => setCollapsed(new Set(parentIds))}
                disabled={allCollapsed}
                className="craft-control h-7 rounded-md px-2.5 text-xs font-medium text-foreground/60 outline-none transition-colors hover:text-foreground disabled:opacity-40"
              >
                {t('gantt.collapseAll')}
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(new Set())}
                disabled={collapsed.size === 0}
                className="craft-control h-7 rounded-md px-2.5 text-xs font-medium text-foreground/60 outline-none transition-colors hover:text-foreground disabled:opacity-40"
              >
                {t('gantt.expandAll')}
              </button>
            </div>
          )}
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
                    zoom={{ level: ZOOM_LEVEL_FOR[scale], levels: ZOOM_LEVELS }}
                    taskTemplate={TimelineBar}
                    columns={[
                      { id: 'text', header: t('kanban.workItemTitle'), flexgrow: 1, tree: true },
                      { id: 'start', header: t('kanban.workItemStart'), width: DATE_COLUMN_WIDTH },
                      { id: 'end', header: t('kanban.workItemDue'), width: DATE_COLUMN_WIDTH },
                    ]}
                    onselecttask={(event) => event?.id && navigateToSession(String(event.id))}
                  />
                </div>
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
