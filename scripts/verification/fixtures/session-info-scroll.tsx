/**
 * The real session-info popover and drawer, long synthetic file tree.
 *
 * Mounts `SessionInfoPopover` (`components/app-shell/SessionInfoPopover.tsx`) in
 * both of its presentations around a real trigger button, on top of a real
 * `AppShellProvider` and a real jotai `sessionAtomFamily` entry:
 *
 *   - `SessionFilesSection` calls `window.electronAPI.getSessionFiles(...)`, so
 *     the host stub answers with 12 folders x 10 long-named files and records
 *     every call instead of pretending the tree is empty;
 *   - the client platform is really initialized (`initializeClient`) with the
 *     `web` kind, so `getClientPlatform()` resolves and the section takes its
 *     non-native branch — the same code path a browser-served renderer uses.
 *
 * The test API deliberately exposes presentation, theme and language switches:
 * the point of this fixture is to prove the long-list scroll at runtime in both
 * presentations, both themes, and under a live language switch.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { Toaster } from 'sonner'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { DEFAULT_THEME_FILE } from '@config/theme'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { sessionAtomFamily } from '@/atoms/sessions'
import { SessionInfoPopover } from '@/components/app-shell/SessionInfoPopover'
import { createClientPlatform, initializeClient } from '@/platform/client'
import '@/index.css'
import type { ElectronAPI, SessionFile } from '../../../apps/electron/src/shared/types'

interface IpcRecord { method: string; args: unknown[]; at: number }

const SESSION_ID = 'session-info-fixture'
const FOLDERS = 12
const FILES_PER_FOLDER = 10
const FILE_COUNT = FOLDERS * FILES_PER_FOLDER

const now = () => Math.round(performance.now() * 100) / 100
const calls: IpcRecord[] = []
const renames: { sessionId: string; name: string }[] = []
const openedFiles: { path: string; sessionId?: string }[] = []
const unknownApi = new Set<string>()
let renders = 0

/**
 * 120 files in 12 folders, every row long enough to truncate inside a 360px
 * popover. The last row is the assertion anchor for "scrolled to the end".
 */
function filePath(folder: number, file: number): string {
  return `/session/folder-${String(folder).padStart(2, '0')}/session-artifact-${String(folder * FILES_PER_FOLDER + file).padStart(3, '0')}`
}

function fileName(folder: number, file: number): string {
  const index = folder * FILES_PER_FOLDER + file
  return `session-artifact-${String(index).padStart(3, '0')}-a-deliberately-long-file-name-that-must-truncate-in-the-popover-tree.md`
}

const tree: SessionFile[] = Array.from({ length: FOLDERS }, (_, folder) => ({
  name: `folder-${String(folder).padStart(2, '0')}-a-deliberately-long-folder-name-that-truncates`,
  path: `/session/folder-${String(folder).padStart(2, '0')}`,
  type: 'directory',
  children: Array.from({ length: FILES_PER_FOLDER }, (_, file) => ({
    name: fileName(folder, file),
    path: filePath(folder, file),
    type: 'file',
    size: 1024 + (folder * FILES_PER_FOLDER + file) * 37,
  })),
}))

const lastFileName = fileName(FOLDERS - 1, FILES_PER_FOLDER - 1)
const lastFilePath = filePath(FOLDERS - 1, FILES_PER_FOLDER - 1)

const explicit: Record<string, unknown> = {
  // Theme + preferences: answered the way the renderer host answers them.
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  // Client-platform transport handshake (initializeClient waits for `connected`).
  getTransportConnectionState: async () => ({ status: 'connected' }),
  onTransportConnectionStateChanged: () => () => {},
  // The surface under test.
  getSessionFiles: async (sessionId: string, scope: string) => {
    calls.push({ method: 'getSessionFiles', args: [sessionId, scope], at: now() })
    return tree
  },
  watchSessionFiles: async (sessionId: string, scope: string) => {
    calls.push({ method: 'watchSessionFiles', args: [sessionId, scope], at: now() })
    return undefined
  },
  unwatchSessionFiles: async (scope: string) => {
    calls.push({ method: 'unwatchSessionFiles', args: [scope], at: now() })
    return undefined
  },
  onSessionFilesChanged: () => () => {},
  onReconnected: () => () => {},
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
await initializeClient(createClientPlatform('web', electronApi), electronApi)
// Binding the client platform reads every port off the Proxy, so the baseline is
// snapshotted here: only keys touched *after* it are genuinely unexpected.
const platformBaseline = new Set(unknownApi)

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en', keySeparator: false,
  resources: { en: { translation: en }, 'zh-Hans': { translation: zh } },
})

const store = createStore()
store.set(sessionAtomFamily(SESSION_ID), {
  id: SESSION_ID,
  workspaceId: 'ws-fixture',
  name: 'Session info fixture',
  workingDirectory: '/fixture/work',
  messages: [],
  messageCount: 0,
} as never)

const shellValue = {
  workspaces: [{ id: 'ws-fixture', name: 'Fixture workspace', path: '/fixture/work' }],
  activeWorkspaceId: 'ws-fixture',
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
  onSendMessage: () => {},
  onRenameSession: (sessionId: string, name: string) => { renames.push({ sessionId, name }) },
  onFlagSession: () => {}, onUnflagSession: () => {},
  onArchiveSession: () => {}, onUnarchiveSession: () => {},
  onMarkSessionRead: () => {}, onMarkSessionUnread: () => {},
  onSetActiveViewingSession: () => {}, onSessionStatusChange: () => {},
  onDeleteSession: async () => false,
  onOpenFile: (path: string, sessionId?: string) => { openedFiles.push({ path, sessionId }) },
  onOpenUrl: () => {},
  onSelectWorkspace: () => {},
  onOpenSettings: () => {}, onOpenKeyboardShortcuts: () => {},
  onOpenStoredUserPreferences: () => {}, onReset: () => {},
  onSessionOptionsChange: () => {},
  onInputChange: () => {},
  onAttachmentsChange: () => {},
} as unknown as AppShellContextType

function Fixture() {
  const theme = useTheme()
  renders += 1
  const [presentation, setPresentation] = React.useState<'popover' | 'drawer'>('popover')
  const [revision, setRevision] = React.useState(0)

  React.useEffect(() => {
    window.sessionInfoFixture = {
      ready: theme.themeLoadStatus === 'ready',
      presentation,
      setPresentation: next => {
        // Remount so a previously open surface cannot leak into the next scene
        // (the component owns its own open state).
        setPresentation(next)
        setRevision(value => value + 1)
      },
      setThemeMode: mode => { theme.setMode(mode) },
      setLanguage: async language => { await i18n.changeLanguage(language) },
      i18nLanguage: () => i18n.resolvedLanguage ?? 'en',
      calls, renames, openedFiles, unknownApi,
      // Optional theme/overlay probes the ThemeProvider makes (`getWorkspaceColorTheme`,
      // `setTitleBarOverlay`) land here too; the list is informational, not an assertion.
      hostApiTouchedWithoutStub: () => [...unknownApi].filter(key => !platformBaseline.has(key)),
      renders: () => renders,
      counts: { folders: FOLDERS, files: FILE_COUNT, lastFileName, lastFilePath },
    }
  }, [theme.themeLoadStatus, theme.setMode, presentation])

  return (
    <div className="min-h-screen bg-background text-foreground" data-fixture-root>
      <div id="stage" className="flex h-[820px] w-full items-end justify-center pb-16">
        <SessionInfoPopover
          key={`${presentation}-${revision}`}
          sessionId={SESSION_ID}
          sessionFolderPath="/fixture/work/session"
          presentation={presentation}
          trigger={(
            <button
              type="button"
              data-testid="session-info-trigger"
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm"
            >
              Session info
            </button>
          )}
        />
      </div>
      <Toaster />
    </div>
  )
}

declare global {
  interface Window {
    sessionInfoFixture: {
      ready: boolean
      presentation: 'popover' | 'drawer'
      setPresentation: (presentation: 'popover' | 'drawer') => void
      setThemeMode: (mode: 'light' | 'dark' | 'system') => void
      setLanguage: (language: string) => Promise<void>
      i18nLanguage: () => string
      calls: IpcRecord[]
      renames: { sessionId: string; name: string }[]
      openedFiles: { path: string; sessionId?: string }[]
      unknownApi: Set<string>
      hostApiTouchedWithoutStub: () => string[]
      renders: () => number
      counts: { folders: number; files: number; lastFileName: string; lastFilePath: string }
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider defaultMode="light">
        <AppShellProvider value={shellValue}>
          <Fixture />
        </AppShellProvider>
      </ThemeProvider>
    </I18nextProvider>
  </Provider>,
)
