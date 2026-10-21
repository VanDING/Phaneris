/**
 * Panel chrome fixture — the Files panel's vertical chrome budget.
 *
 * `panel-chrome-workflow.ts` mounts the real `FilesPanel` and measures what sits
 * between the panel top and its content. The audit found three competing bars
 * (workbench strip + view tabs + a filter band) totalling 112.5px over an empty
 * panel; the contract is one row per panel. This fixture exists so that budget is
 * a measured number instead of a class-name review.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { createClientPlatform, initializeClient } from '@/platform/client'
import { FilesPanel } from '@/components/content-panels/FilesPanel'
import { DndContext } from '@dnd-kit/core'
import { KanbanColumn } from '@/components/app-shell/kanban/KanbanColumn'
import { KANBAN_COLUMNS } from '@/components/app-shell/kanban/status-column'
import { makeColumnColor, type KanbanColumnColor } from '@/hooks/useKanbanColumnColors'
import { PROJECT_COLOR_PALETTE } from '@/utils/project-colors'
import type { KanbanTask } from '@/components/app-shell/kanban/types'
import type { SessionStatus } from '@/config/session-status-config'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { filesPanelViewAtom } from '@/atoms/content-panel-ui'

declare global {
  interface Window {
    __panelChrome?: { ready: boolean }
    __boardMoves?: Array<{ taskId: string; to: string }>
  }
}
window.__boardMoves = []

const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('panel-chrome fixture requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

// Business components refuse to render before the client platform handshake
// finishes (`initializeClient`), exactly like the shipped renderer. Only the
// ports this panel can touch are explicit; everything else resolves to a no-op.
const explicit: Record<string, unknown> = {
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  getTransportConnectionState: async () => ({ status: 'connected' }),
  onTransportConnectionStateChanged: () => () => {},
}
const electronApi = new Proxy(explicit, {
  get(target, key) {
    if (typeof key !== 'string') return undefined
    if (key in target) return target[key]
    if (key === 'then') return undefined
    if (key.startsWith('on')) return () => () => {}
    // Unknown ports resolve to an empty collection: the panels behind the chrome
    // row iterate their data (`listArtifacts`, `getSessionFiles`), and a `null`
    // there is a crash rather than an empty state.
    return async () => []
  },
}) as unknown as Parameters<typeof createClientPlatform>[1]
Object.assign(window, { electronAPI: electronApi })
await initializeClient(createClientPlatform('web', electronApi), electronApi)

const SESSION_ID = 'fixture'
const store = createStore()
// `activeSessionIdAtom` is derived (read-only); the panel takes the id by prop.
store.set(loadedSessionsAtom, new Set([SESSION_ID]))
// Browse is the view with both chrome affordances (view tabs + filter) in one
// row, so it is the one the chrome budget is measured on.
store.set(filesPanelViewAtom, 'browse')
store.set(sessionMetaMapAtom, new Map([[SESSION_ID, {
  id: SESSION_ID, name: 'Chrome fixture', workspaceId: 'fixture-workspace', workingDirectory: '/tmp/fixture',
}]]))
// One message keeps `needsMessages` false, so the panel does not try to hydrate
// through `window.electronAPI` in this host. The fixture session only needs the
// fields `FilesPanel` reads, so it is cast rather than constructed in full.
store.set(sessionAtomFamily(SESSION_ID), {
  id: SESSION_ID, workspaceId: 'fixture-workspace', name: 'Chrome fixture',
  messages: [{ id: 'm1', role: 'user', timestamp: 1, content: 'fixture' }],
} as never)

const contextValue = {
  activeWorkspaceId: 'fixture-workspace',
  onOpenFile() {},
  onOpenUrl() {},
  isCompactMode: false,
  workspaces: [],
} as unknown as AppShellContextType

// ── Board columns ──────────────────────────────────────────────────────────
// Two real columns exercise the anatomy rules: a finished column above the
// collapse threshold, and an empty column that must offer an exit.
const doneColumn = KANBAN_COLUMNS.find(column => column.id === 'done')!
const todoColumn = KANBAN_COLUMNS.find(column => column.id === 'todo')!
const doneTasks = Array.from({ length: 30 }, (_, index) => ({
  id: `done-${index}`,
  title: `Finished task ${index}`,
  column: 'done',
  statusId: 'done',
  subtasks: [],
})) as unknown as KanbanTask[]
// A status renders the tile's meta row, so the chrome measurement sees a card in
// its real shape rather than a title-only skeleton.
const doneStatus = {
  id: 'done',
  label: 'Done',
  category: 'closed',
  resolvedColor: 'var(--accent)',
  icon: null,
  iconColorable: true,
} as unknown as SessionStatus
const statusesById = new Map([['done', doneStatus]])
const statuses = [doneStatus]
const successColor: KanbanColumnColor = { solid: 'var(--success)', tint: 'transparent', onAccent: 'var(--foreground)' }
const neutralColor: KanbanColumnColor = { solid: 'var(--foreground-dimmed)', tint: 'transparent', onAccent: 'var(--foreground)' }

function BoardFixture() {
const recordMove = (taskId: string, columnId: string) => {
  window.__boardMoves?.push({ taskId, to: columnId })
  document.body.dataset.lastMove = `${taskId}->${columnId}`
}
  return (
    <DndContext>
      <div data-board-fixture className="flex gap-3 p-3" style={{ width: 720, height: 520 }}>
        <KanbanColumn
          column={doneColumn}
          color={successColor}
          tasks={doneTasks}
          projectsById={new Map()}
          statusesById={statusesById}
          statuses={statuses}
          treatment="stripe"
          expandedTaskIds={new Set()}
          onCreateTask={() => {}}
          columns={KANBAN_COLUMNS}
          onMoveTask={recordMove}
        />
        <KanbanColumn
          column={todoColumn}
          color={neutralColor}
          tasks={[]}
          projectsById={new Map()}
          statusesById={statusesById}
          statuses={statuses}
          treatment="stripe"
          expandedTaskIds={new Set()}
          onCreateTask={() => {}}
        />
      </div>
      {/* Every project colour a user can pick, rendered exactly as a custom
          column paints it (solid fill + computed onAccent). The workflow reads
          the painted pair back and checks WCAG contrast: a user-chosen colour
          must not be able to produce an unreadable column header. */}
      <div data-color-swatches className="flex flex-wrap gap-2 px-3 pb-3">
        {PROJECT_COLOR_PALETTE.map(color => {
          const resolved = makeColumnColor(color)
          return (
            <span
              key={color}
              data-swatch={color}
              className="rounded-shape-sm px-2 py-1 text-meta font-medium"
              style={{ backgroundColor: resolved.solid, color: resolved.onAccent }}
            >
              {color}
            </span>
          )
        })}
      </div>
    </DndContext>
  )
}

/**
 * Exercises the transcript highlighter against a fixed subtree: a match that
 * crosses element boundaries (`foo<strong>bar</strong>` for "oob"), a match that
 * must be ignored because it sits in an excluded cell, and the active/passive
 * split. Results land on `window.__highlightProbe` for the workflow to read —
 * the same code runs in ChatDisplay, where only a full session could reach it.
 */
function HighlightProbe() {
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const { collectHighlightRanges, applyHighlightRanges, clearHighlightRanges, countHighlightRanges } =
        await import('@/components/app-shell/transcript-highlights')
      const { nextMatchIndex, previousMatchIndex } = await import('@/components/app-shell/search-navigation')
      const { formatFollowUpChipText, shuffleArray, cmdKey } = await import('@/components/app-shell/input/composer-badges')
      if (cancelled) return
      const host = document.createElement('div')
      host.innerHTML = `
        <p>foo<strong>bar</strong>baz foo<i>bar</i>baz</p>
        <p data-search-exclude="true">foobarbaz</p>
      `
      document.body.appendChild(host)
      try {
        const ranges = collectHighlightRanges(host, 'oob')
        applyHighlightRanges(ranges, 0)
        const withActive = countHighlightRanges()
        applyHighlightRanges(ranges, -1)
        const withoutActive = countHighlightRanges()
        clearHighlightRanges()
        const cleared = countHighlightRanges()
        ;(window as unknown as { __highlightProbe?: unknown }).__highlightProbe = {
          matches: ranges.length,
          // A cross-node match produces one Range whose start and end live in
          // different text nodes.
          crossNode: ranges.filter(range => range.startContainer !== range.endContainer).length,
          withActive,
          withoutActive,
          cleared,
          next: [nextMatchIndex(0, 3), nextMatchIndex(2, 3), nextMatchIndex(0, 0)],
          prev: [previousMatchIndex(2, 3), previousMatchIndex(0, 3), previousMatchIndex(2, 0)],
          // The composer helpers moved out of the component; these are their contracts.
          chip: [formatFollowUpChipText('  a   b  ', 'fallback'), formatFollowUpChipText('   ', 'fallback'), formatFollowUpChipText('x'.repeat(60), 'fallback').length],
          shuffle: (() => { const input = [1, 2, 3, 4, 5]; const out = shuffleArray(input); return [input.join(','), out.slice().sort().join(','), out.length] })(),
          cmdKey: cmdKey.length > 0,
        }
      } finally {
        host.remove()
      }
    })()
    return () => { cancelled = true }
  }, [])
  return null
}

function Fixture() {
  return (
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <AppShellProvider value={contextValue}>
          <HighlightProbe />
          <div data-chrome-host className="h-screen bg-background text-foreground">
            <div style={{ width: 420, height: 620 }} className="flex flex-col">
              <FilesPanel sessionId={SESSION_ID} />
            </div>
            <BoardFixture />
          </div>
        </AppShellProvider>
      </Provider>
    </I18nextProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
requestAnimationFrame(() => requestAnimationFrame(() => {
  window.__panelChrome = { ready: true }
}))
