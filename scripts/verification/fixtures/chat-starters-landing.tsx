/**
 * The real new-chat landing (`ChatDisplay` with an empty session) hosting the
 * real chat-starter chips, with a synthetic host that records every IPC call.
 *
 * This is the page that owns the click handler: it resolves the starter's
 * mentions, enables the mentioned sources and sends the prompt. The recorded
 * order between "enable resolved" and "send issued" is the assertion.
 *
 * Separate from `chat-starters.tsx` on purpose: `ChatDisplay` pulls in the whole
 * transcript/markdown/editor graph, and its Vite dependency crawl is minutes
 * long, which must not gate the light chips/settings page.
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
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { ModalProvider } from '@/context/ModalContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { FocusProvider } from '@/context/FocusContext'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { NavigationContext } from '@/contexts/NavigationContext'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import '@/index.css'
import type { ChatStarter } from '@phaneris/shared/workspaces/chat-starters'
import type { Session, LoadedSource, LoadedSkill, ElectronAPI, PermissionMode } from '../../../apps/electron/src/shared/types'

interface IpcRecord { method: string; args: unknown[]; at: number; resolvedAt?: number }
interface SendRecord { text: string; skills?: string[]; at: number }

const ipc: IpcRecord[] = []
const sends: SendRecord[] = []
const unknownApi = new Set<string>()
const now = () => Math.round(performance.now() * 100) / 100

let sourceDelayMs = 0
let failNextSourceEnable: string | null = null
let renders = 0

const explicit: Record<string, unknown> = {
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  getWorkspaceSettings: async () => ({ chatStarters: [] }),
  // The composer asks the host whether it is connected before trying to resume a
  // pending plan; a stub that answers `null` makes it read `.status` of nothing.
  getTransportConnectionState: async () => ({ status: 'disconnected' }),
  getPendingPlanExecution: async () => null,
  sessionCommand: async (sessionId: string, command: { type: string; sourceSlugs?: string[] }) => {
    const entry: IpcRecord = { method: `sessionCommand:${command.type}`, args: [sessionId, command.sourceSlugs], at: now() }
    ipc.push(entry)
    if (command.type === 'setSources' && sourceDelayMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, sourceDelayMs))
    }
    entry.resolvedAt = now()
    return undefined
  },
  getSessionFiles: async () => [],
  searchFiles: async () => [],
  getBackgroundTasks: async () => [],
  watchSessionFiles: async () => undefined,
  unwatchSessionFiles: async () => undefined,
  onSessionFilesChanged: () => () => {},
  onReconnected: () => () => {},
  onSourcesChanged: () => () => {},
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

const shell = {
  workspaces: [{ id: 'ws-fixture', name: 'Fixture', rootPath: '/fixture', slug: 'fixture' }],
  activeWorkspaceId: 'ws-fixture', activeWorkspaceSlug: 'fixture', llmConnections: [], sessionOptions: new Map(),
  pendingPermissions: new Map(), pendingCredentials: new Map(), pendingQuestions: new Map(),
  refreshLlmConnections: async () => {}, onOpenFile: () => {}, onOpenUrl: () => {},
  onCreateSession: async () => { throw new Error('createSession is not part of this fixture') },
} as unknown as AppShellContextType

const navigation = {
  navigate: () => {}, isReady: true,
  navigationState: { route: { name: 'chat' }, history: [], historyIndex: 0 },
  canGoBack: false, canGoForward: false, goBack: () => {}, goForward: () => {},
  navigateToSource: () => {}, navigateToSession: () => {},
} as unknown as React.ComponentProps<typeof NavigationContext.Provider>['value']

const starters: ChatStarter[] = [
  { label: 'Review pull requests', prompt: 'Review the open pull requests [source:github] [skill:review-prs]' },
  { label: 'Summarize inbox', prompt: 'Summarize my unread mail [source:gmail]' },
  { label: 'Plain question', prompt: 'Plain question with no mentions' },
]
const sources = [
  { config: { slug: 'github', name: 'GitHub', tagline: 'Issues and pull requests' } },
  { config: { slug: 'gmail', name: 'Gmail', tagline: 'Mail' } },
] as unknown as LoadedSource[]
const skills = [
  { slug: 'review-prs', metadata: { name: 'Review PRs', description: 'Reviews open pull requests' } },
] as unknown as LoadedSkill[]

function Fixture() {
  const theme = useTheme()
  renders += 1
  const [permissionMode, setPermissionMode] = React.useState<PermissionMode>('ask')
  const [disabled, setDisabled] = React.useState(false)
  const [enabledSources, setEnabledSources] = React.useState<string[]>([])
  // The shell can hand the display another session (or workspace) while an
  // enable-then-send is in flight; the click must not outlive that switch.
  const [identity, setIdentity] = React.useState({ id: 'session-fixture', workspaceId: 'ws-fixture' })

  const session = React.useMemo(() => ({
    id: identity.id, workspaceId: identity.workspaceId, name: 'Fixture chat',
    messages: [], enabledSourceSlugs: enabledSources, permissionMode, thinkingLevel: 'medium',
    createdAt: Date.now(), updatedAt: Date.now(),
  }) as unknown as Session, [identity, enabledSources, permissionMode])

  const onSourcesChange = React.useCallback(async (slugs: string[]) => {
    // Mirrors the real shell: the renderer forwards to a `setSources` session
    // command and only resolves once the host has applied it.
    const entry: IpcRecord = { method: 'onSourcesChange', args: [slugs], at: now() }
    ipc.push(entry)
    setEnabledSources(slugs)
    if (sourceDelayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, sourceDelayMs))
    if (failNextSourceEnable) {
      const message = failNextSourceEnable
      failNextSourceEnable = null
      entry.resolvedAt = now()
      throw new Error(message)
    }
    await (explicit.sessionCommand as (sessionId: string, command: { type: string; sourceSlugs?: string[] }) => Promise<void>)(
      'session-fixture', { type: 'setSources', sourceSlugs: slugs },
    )
    entry.resolvedAt = now()
  }, [])
  const onSendMessage = React.useCallback((text: string, _attachments?: unknown, skillSlugs?: string[]) => {
    sends.push({ text, skills: skillSlugs, at: now() })
  }, [])
  const noop = React.useCallback(() => {}, [])
  const onPermissionModeChange = React.useCallback((mode: PermissionMode) => setPermissionMode(mode), [])

  // Refreshed on every render on purpose: the test API exposes live state
  // (`enabledSources`, `identity`), and a dependency-limited effect would hand the
  // driver a stale closure — which reads exactly like a product bug.
  React.useEffect(() => {
    window.chatStartersLanding = {
      ready: theme.themeLoadStatus === 'ready', ipc, sends, unknownApi, renders: () => renders,
      setSourceDelay: ms => { sourceDelayMs = ms },
      failNextSourceEnable: message => { failNextSourceEnable = message },
      setDisabled: next => setDisabled(next),
      setPermissionMode: mode => setPermissionMode(mode as PermissionMode),
      setSession: (id, workspaceId) => setIdentity({ id, workspaceId }),
      setEnabledSources: slugs => setEnabledSources(slugs),
      enabledSources: () => [...enabledSources],
      identity: () => ({ ...identity }),
    }
  })

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <section id="chat" className="flex-1 flex min-h-0">
        <ChatDisplay
          session={session}
          chatStarters={starters}
          sources={sources}
          skills={skills}
          onSourcesChange={onSourcesChange}
          onSendMessage={onSendMessage}
          onOpenFile={noop} onOpenUrl={noop}
          currentModel="pi/fixture" onModelChange={noop}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          disabled={disabled}
          inputValue="" onInputChange={noop}
        />
      </section>
      <Toaster />
    </div>
  )
}

declare global {
  interface Window {
    chatStartersLanding: {
      ready: boolean
      ipc: IpcRecord[]
      sends: SendRecord[]
      unknownApi: Set<string>
      renders: () => number
      setSourceDelay: (ms: number) => void
      failNextSourceEnable: (message: string | null) => void
      setDisabled: (disabled: boolean) => void
      setPermissionMode: (mode: string) => void
      setSession: (id: string, workspaceId: string) => void
      setEnabledSources: (slugs: string[]) => void
      enabledSources: () => string[]
      identity: () => { id: string; workspaceId: string }
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <React.StrictMode><I18nextProvider i18n={i18n}>
      <ThemeProvider defaultMode="light">
        <ModalProvider>
          <EscapeInterruptProvider>
            <FocusProvider>
              <TooltipProvider>
                <AppShellProvider value={shell}>
                  <NavigationContext.Provider value={navigation}>
                    <Fixture />
                  </NavigationContext.Provider>
                </AppShellProvider>
              </TooltipProvider>
            </FocusProvider>
          </EscapeInterruptProvider>
        </ModalProvider>
      </ThemeProvider>
    </I18nextProvider></React.StrictMode>
  </Provider>,
)
