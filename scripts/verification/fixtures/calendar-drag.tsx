/**
 * The real calendar surface, synthetic work-item host.
 *
 * Mounts the production `CalendarView` (`components/app-shell/kanban/CalendarView.tsx`)
 * — the component `ProjectManagementSurface` renders for its calendar projection —
 * with the real `useCalendarEntries`/`useWorkItemsCollection` data layer. Only the
 * host is synthetic: `listWorkItems`/`updateWorkItem` answer with three seeded
 * entries and record every write, so a drag or a resize has to travel the whole
 * real path (`eventDrop`/`eventResize` -> `commitDates` -> `update` ->
 * `calendarPlanningFields` -> `updateWorkItem`) before it can be observed.
 *
 * `data-calendar-entry` on every event and `data-calendar-view` on the grid come
 * from the component itself (CalendarView sets both), so the workflow asserts the
 * product's own hooks rather than the library's hashed class names.
 *
 * The week view is pre-selected through the renderer's own persisted view state
 * and the language switch is driven live (`changeLanguage`), because the review's
 * gap is exactly that the calendar was only ever seeded with a language before
 * load.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@phaneris/ui'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { DEFAULT_THEME_FILE } from '@config/theme'
import { ThemeProvider } from '@/context/ThemeContext'
import { AppShellProvider } from '@/context/AppShellContext'
import { NavigationContext } from '@/contexts/NavigationContext'
import { CalendarView } from '@/components/app-shell/kanban/CalendarView'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import { planDayKeyFromDate, workItemToCalendarEntry } from '@phaneris/shared/work-items/browser'
import '@/index.css'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'
import type { WorkItem } from '@phaneris/shared/work-items/browser'

interface IpcRecord { method: string; args: unknown[]; at: number }
interface WriteRecord { id: string; patch: Record<string, unknown>; at: number }

const WORKSPACE_ID = 'ws-fixture'
const ANCHOR = planDayKeyFromDate(new Date())

// The component remembers its projection per workspace. Pre-selecting the week
// view through that same persisted state is what a returning user has.
storage.set(KEYS.calendarViewState, { mode: 'week', cursor: ANCHOR }, WORKSPACE_ID)

const now = () => Math.round(performance.now() * 100) / 100
const calls: IpcRecord[] = []
const writes: WriteRecord[] = []
const unknownApi = new Set<string>()
const listeners = new Set<(workspaceId: string) => void>()

let revision = 1
const items: WorkItem[] = [
  {
    id: 'ev-1', title: 'Design review', statusId: 'todo', columnId: 'backlog',
    dependencyIds: [], sessionIds: [],
    startAt: `${ANCHOR}T10:00`, dueAt: `${ANCHOR}T11:00`,
    createdAt: revision, updatedAt: revision,
  },
  {
    id: 'ev-2', title: 'Untimed chore', statusId: 'todo', columnId: 'backlog',
    dependencyIds: [], sessionIds: [],
    startAt: ANCHOR, dueAt: ANCHOR,
    createdAt: revision, updatedAt: revision,
  },
  {
    id: 'ev-3', title: 'Release check', statusId: 'todo', columnId: 'backlog',
    dependencyIds: [], sessionIds: [],
    startAt: `${ANCHOR}T14:00`, dueAt: `${ANCHOR}T15:00`,
    createdAt: revision, updatedAt: revision,
  },
]

const explicit: Record<string, unknown> = {
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  getTransportConnectionState: async () => ({ status: 'connected' }),
  onTransportConnectionStateChanged: () => () => {},
  listWorkItems: async (workspaceId: string) => {
    calls.push({ method: 'listWorkItems', args: [workspaceId], at: now() })
    return items.map(item => ({ ...item }))
  },
  createWorkItem: async (workspaceId: string, input: Record<string, unknown>) => {
    calls.push({ method: 'createWorkItem', args: [workspaceId, input], at: now() })
    revision += 1
    const item: WorkItem = {
      id: `ev-created-${revision}`, title: String(input.title ?? ''), statusId: String(input.statusId ?? 'backlog'),
      dependencyIds: [], sessionIds: [], createdAt: revision, updatedAt: revision,
      startAt: input.startAt as string | undefined, dueAt: input.dueAt as string | undefined,
    }
    items.push(item)
    return { ...item }
  },
  updateWorkItem: async (workspaceId: string, id: string, patch: Record<string, unknown>) => {
    calls.push({ method: 'updateWorkItem', args: [workspaceId, id, patch], at: now() })
    writes.push({ id, patch: { ...patch }, at: now() })
    revision += 1
    const index = items.findIndex(item => item.id === id)
    if (index < 0) throw new Error(`unknown work item ${id}`)
    const next = { ...items[index]!, ...patch, updatedAt: revision } as WorkItem
    items[index] = next
    for (const listener of listeners) listener(WORKSPACE_ID)
    return { ...next }
  },
  deleteWorkItem: async (workspaceId: string, id: string) => {
    calls.push({ method: 'deleteWorkItem', args: [workspaceId, id], at: now() })
    const index = items.findIndex(item => item.id === id)
    if (index >= 0) items.splice(index, 1)
    return undefined
  },
  onWorkItemsChanged: (callback: (workspaceId: string) => void) => {
    listeners.add(callback)
    return () => { listeners.delete(callback) }
  },
}

const electronApi = new Proxy(explicit, {
  get(target, key) {
    if (typeof key !== 'string') return undefined
    if (key in target) return target[key]
    if (key === 'then') return undefined
    if (key.startsWith('on')) return () => () => {}
    unknownApi.add(key)
    return async () => null
  },
}) as unknown as ElectronAPI

Object.assign(window, { electronAPI: electronApi })

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en', keySeparator: false,
  resources: { en: { translation: en }, 'zh-Hans': { translation: zh } },
})

/**
 * The props `CalendarView` handed to FullCalendar, found through React's own
 * fiber tree. This exists only for the documented fallback: if a synthetic
 * pointer drag cannot start the library's interaction handler in headless
 * Chromium, the workflow still drives the *component's* `eventDrop` /
 * `eventResize` callbacks — real product code — instead of skipping the scene.
 * The `info.event.extendedProps.entry` it needs is projected from the same host
 * data the component itself projects (`workItemToCalendarEntry`).
 */
function findCalendarProps(): Record<string, unknown> | null {
  const root = document.querySelector('.phaneris-calendar')
  if (!root) return null
  const key = Object.keys(root).find(candidate => candidate.startsWith('__reactFiber$'))
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let top: any = key ? (root as any)[key] : null
  if (!top) return null
  while (top.return) top = top.return
  const stack: any[] = [top]
  while (stack.length > 0) {
    const node = stack.pop()
    const props = node?.memoizedProps as Record<string, unknown> | undefined
    if (props && typeof props.eventDrop === 'function' && typeof props.eventResize === 'function') return props
    if (node?.child) stack.push(node.child)
    if (node?.sibling) stack.push(node.sibling)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return null
}

function entryFor(id: string) {
  const item = items.find(candidate => candidate.id === id)
  return item ? workItemToCalendarEntry(item) : null
}

/** Builds the `info` shape FullCalendar hands to eventDrop/eventResize. */
function interactionInfo(id: string, target: { date: string; endDate: string; time?: string; endTime?: string }) {
  const entry = entryFor(id)
  if (!entry) return null
  const timed = target.time !== undefined
  const start = new Date(timed ? `${target.date}T${target.time}` : `${target.date}T00:00`)
  const end = timed ? new Date(`${target.endDate}T${target.endTime ?? target.time}`) : new Date(`${target.endDate}T00:00`)
  if (!timed) end.setDate(end.getDate() + 1) // all-day end is exclusive
  return {
    entry,
    info: { event: { extendedProps: { entry }, start, end, allDay: !timed }, revert: () => { reverted += 1 } },
  }
}

let reverted = 0

const shellValue = {
  workspaces: [{ id: WORKSPACE_ID, name: 'Fixture workspace', path: '/fixture/work' }],
  activeWorkspaceId: WORKSPACE_ID,
  activeWorkspaceSlug: 'fixture',
  llmConnections: [],
  refreshLlmConnections: async () => {},
  pendingPermissions: new Map(),
  pendingCredentials: new Map(),
  pendingQuestions: new Map(),
  getDraft: () => '',
  getDraftAttachmentRefs: () => [],
  hydrateDraftAttachments: async () => [],
  sessionOptions: new Map(),
  onCreateSession: async () => { throw new Error('not used by this fixture') },
  onSendMessage: () => {}, onRenameSession: () => {},
  onFlagSession: () => {}, onUnflagSession: () => {},
  onArchiveSession: () => {}, onUnarchiveSession: () => {},
  onMarkSessionRead: () => {}, onMarkSessionUnread: () => {},
  onSetActiveViewingSession: () => {}, onSessionStatusChange: () => {},
  onDeleteSession: async () => false,
  onOpenFile: () => {}, onOpenUrl: () => {},
  onSelectWorkspace: () => {},
  onOpenSettings: () => {}, onOpenKeyboardShortcuts: () => {},
  onOpenStoredUserPreferences: () => {}, onReset: () => {},
  onSessionOptionsChange: () => {},
  onInputChange: () => {}, onAttachmentsChange: () => {},
} as never

const navigationValue = {
  navigate: () => {}, navigateToSession: () => {},
  currentWorkspaceId: WORKSPACE_ID, currentWorkspaceSlug: 'fixture',
} as never

function Fixture() {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    const deadline = Date.now() + 60_000
    const timer = setInterval(() => {
      const entries = document.querySelectorAll('[data-calendar-entry]').length
      const cells = document.querySelectorAll(".phaneris-calendar [role='gridcell'][data-date]").length
      if ((entries > 0 && cells > 0) || Date.now() > deadline) {
        clearInterval(timer)
        setReady(true)
      }
    }, 100)
    return () => clearInterval(timer)
  }, [])
  React.useEffect(() => {
    window.calendarFixture = {
      ready,
      anchorDate: ANCHOR,
      workspaceId: WORKSPACE_ID,
      eventIds: ['ev-1', 'ev-2', 'ev-3'],
      calls, writes, unknownApi,
      items: () => items.map(item => ({ ...item })),
      resetWrites: () => { writes.length = 0 },
      setLanguage: async language => { await i18n.changeLanguage(language) },
      i18nLanguage: () => i18n.resolvedLanguage ?? 'en',
      mode: () => document.querySelector('.phaneris-calendar')?.getAttribute('data-calendar-view') ?? null,
      title: () => document.querySelector('[data-calendar-title]')?.textContent ?? '',
      // Documented fallback only: drives the callback CalendarView itself passed
      // to FullCalendar, for the case where a synthetic pointer drag cannot start
      // the library's interaction handler in headless Chromium.
      componentDrop: (id, target) => {
        const props = findCalendarProps()
        const built = interactionInfo(id, target)
        if (!props || typeof props.eventDrop !== 'function' || !built) return false
        ;(props.eventDrop as (info: unknown) => void)(built.info)
        return true
      },
      componentResize: (id, target) => {
        const props = findCalendarProps()
        const built = interactionInfo(id, target)
        if (!props || typeof props.eventResize !== 'function' || !built) return false
        ;(props.eventResize as (info: unknown) => void)(built.info)
        return true
      },
      handlerFound: () => findCalendarProps() !== null,
      reverted: () => reverted,
      /** The title FullCalendar itself currently holds (live viewApi), not our copy. */
      fullCalendarTitle: () => {
        try {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const controller = (findCalendarProps() as any)?.controller
          return (controller?.view?.title as string | undefined) ?? null
        } catch { return null }
      },
    }
  }, [ready])
  return (
    <div className="@container/panel h-screen bg-background text-foreground" data-fixture-root>
      <CalendarView />
    </div>
  )
}

declare global {
  interface Window {
    calendarFixture: {
      ready: boolean
      anchorDate: string
      workspaceId: string
      eventIds: string[]
      calls: IpcRecord[]
      writes: WriteRecord[]
      unknownApi: Set<string>
      items: () => WorkItem[]
      resetWrites: () => void
      setLanguage: (language: string) => Promise<void>
      i18nLanguage: () => string
      mode: () => string | null
      title: () => string
      componentDrop: (id: string, target: { date: string; endDate: string; time?: string; endTime?: string }) => boolean
      componentResize: (id: string, target: { date: string; endDate: string; time?: string; endTime?: string }) => boolean
      handlerFound: () => boolean
      reverted: () => number
      fullCalendarTitle: () => string | null
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider defaultMode="light">
        <AppShellProvider value={shellValue}>
          <NavigationContext.Provider value={navigationValue}>
            <TooltipProvider>
              <Fixture />
              <Toaster />
            </TooltipProvider>
          </NavigationContext.Provider>
        </AppShellProvider>
      </ThemeProvider>
    </I18nextProvider>
  </Provider>,
)
