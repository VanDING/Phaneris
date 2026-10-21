/**
 * Real chat-starter chips and the real workspace-settings editor, synthetic host.
 *
 * Two panels of production code with the real interaction path:
 *   1. `ChatStarters` — the chips themselves.
 *   2. `ChatStartersSection` — the workspace settings editor, driven through the
 *      real workspace-settings IPC surface (stubbed, but recording every call).
 *
 * The new-chat landing that consumes these chips is mounted by its own fixture
 * (`chat-starters-landing.tsx`): importing `ChatDisplay` pulls in the whole
 * transcript/markdown/editor graph, and Vite's dependency crawl of that graph
 * makes the light page here take minutes for no benefit.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { Toaster } from 'sonner'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { DEFAULT_THEME_FILE } from '@config/theme'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { ChatStarters } from '@/components/chat/ChatStarters'
import { ChatStartersSection } from '@/pages/settings/ChatStartersSection'
import '@/index.css'
import type { ChatStarter } from '@phaneris/shared/workspaces/chat-starters'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'

interface IpcRecord { method: string; args: unknown[]; at: number; resolvedAt?: number }

const ipc: IpcRecord[] = []
const selections: ChatStarter[] = []
const settingsWrites: { key: string; value: unknown }[] = []
const unknownApi = new Set<string>()
const now = () => Math.round(performance.now() * 100) / 100

let failNextWrite: string | null = null
let storedStarters: ChatStarter[] = []
let renders = 0
let holdNextRead = false
let pendingRead: { resolve: () => void; reject: () => void } | null = null
let holdNextWrite = false
let pendingWrite: (() => void) | null = null

const explicit: Record<string, unknown> = {
  // Theme + preferences: the renderer host normally answers these before the
  // theme provider mounts, so the fixture answers them the same way.
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  getWorkspaceSettings: async (workspaceId: string) => {
    if (holdNextRead) {
      holdNextRead = false
      await new Promise<void>((resolve, reject) => {
        pendingRead = { resolve, reject: () => reject(new Error('Settings read rejected')) }
      })
      pendingRead = null
    }
    return { chatStarters: workspaceId === 'ws-other' ? [{ label: 'Other workspace', prompt: 'Other prompt' }] : storedStarters }
  },
  getSources: async () => [{ config: { slug: 'github', name: 'GitHub', type: 'mcp', enabled: true } }],
  getSkills: async () => [{ slug: 'review-prs', metadata: { name: 'Review PRs', description: 'Review pull requests' } }],
  updateWorkspaceSetting: async (_workspaceId: string, key: string, value: unknown) => {
    ipc.push({ method: 'updateWorkspaceSetting', args: [key, value], at: now() })
    if (holdNextWrite) { holdNextWrite = false; await new Promise<void>(resolve => { pendingWrite = resolve }); pendingWrite = null }
    if (failNextWrite) {
      const message = failNextWrite
      failNextWrite = null
      throw new Error(message)
    }
    settingsWrites.push({ key, value })
    storedStarters = (value ?? []) as ChatStarter[]
    return undefined
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

const allStarters: ChatStarter[] = [
  { label: 'Review pull requests', prompt: 'Review the open pull requests [source:github] [skill:review-prs]' },
  { label: 'Summarize inbox', prompt: 'Summarize my unread mail [source:gmail]' },
  { label: 'A very long starter label that must truncate inside the chip', prompt: 'Plain question with no mentions' },
]

function Fixture() {
  const theme = useTheme()
  renders += 1
  const [starters, setStarters] = React.useState<ChatStarter[]>(allStarters.slice(0, 3))
  const [disabled, setDisabled] = React.useState(false)
  const [settingsEpoch, setSettingsEpoch] = React.useState(0)
  const [workspaceId, setWorkspaceId] = React.useState('ws-fixture')

  const onSelectChip = React.useCallback((starter: ChatStarter) => { selections.push(starter) }, [])

  React.useEffect(() => {
    window.chatStartersFixture = {
      ready: theme.themeLoadStatus === 'ready', ipc, selections, settingsWrites, unknownApi,
      renders: () => renders,
      failNextSettingsWrite: message => { failNextWrite = message },
      setStarters: next => setStarters(next),
      setDisabled: next => setDisabled(next),
      setLanguage: async language => { await i18n.changeLanguage(language) },
      i18nLanguage: () => i18n.resolvedLanguage ?? 'en',
      holdSettingsRead: () => { holdNextRead = true; setSettingsEpoch(value => value + 1) },
      readIsPending: () => pendingRead !== null,
      resolveSettingsRead: () => pendingRead?.resolve(),
      rejectSettingsRead: () => pendingRead?.reject(),
      setWorkspaceId,
      holdSettingsWrite: () => { holdNextWrite = true },
      writeIsPending: () => pendingWrite !== null,
      resolveSettingsWrite: () => pendingWrite?.(),
    }
  }, [theme.themeLoadStatus])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section id="chips" className="border-b border-border p-4">
        <ChatStarters starters={starters} disabled={disabled} onSelect={onSelectChip} />
      </section>
      <section id="settings" className="border-b border-border p-4">
        <ChatStartersSection key={settingsEpoch} workspaceId={workspaceId} />
      </section>
      <Toaster />
    </div>
  )
}

declare global {
  interface Window {
    chatStartersFixture: {
      ready: boolean
      ipc: IpcRecord[]
      selections: ChatStarter[]
      settingsWrites: { key: string; value: unknown }[]
      unknownApi: Set<string>
      renders: () => number
      failNextSettingsWrite: (message: string | null) => void
      setStarters: (starters: ChatStarter[]) => void
      setDisabled: (disabled: boolean) => void
      setLanguage: (language: string) => Promise<void>
      i18nLanguage: () => string
      holdSettingsRead: () => void
      readIsPending: () => boolean
      resolveSettingsRead: () => void
      rejectSettingsRead: () => void
      setWorkspaceId: (workspaceId: string) => void
      holdSettingsWrite: () => void
      writeIsPending: () => boolean
      resolveSettingsWrite: () => void
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider defaultMode="light">
        <Fixture />
      </ThemeProvider>
    </I18nextProvider>
  </Provider>,
)
