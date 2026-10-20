/**
 * Workspace-isolation fixture for the real `useWorkspaceChatStarters` hook.
 *
 * The hook is production code (`apps/electron/src/renderer/hooks/useWorkspaceChatStarters.ts`)
 * and `AppShell` uses this exact instance. Host reads are manually controlled here
 * so the driver can decide which workspace answers first — including answering an
 * abandoned workspace last — which is the ordering that produced the original bug.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { DEFAULT_THEME_FILE } from '@config/theme'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { useWorkspaceChatStarters } from '@/hooks/useWorkspaceChatStarters'
import { announceWorkspaceSettingsChanged } from '@/lib/workspace-settings-events'
import '@/index.css'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'

interface PendingCall { index: number; workspaceId: string; resolve: (value: unknown) => void; reject: (error: Error) => void }

const pending: PendingCall[] = []
const calls: { index: number; workspaceId: string }[] = []
let renders = 0

const explicit: Record<string, unknown> = {
  // The theme provider reads these before anything renders; a stub that answers
  // `null` makes it destructure nothing and take the whole fixture down.
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
  getWorkspaceSettings: (workspaceId: string) => new Promise((resolve, reject) => {
    const index = calls.length
    calls.push({ index, workspaceId })
    pending.push({ index, workspaceId, resolve, reject })
  }),
}

const electronApi = new Proxy(explicit, {
  get(target, key) {
    if (typeof key !== 'string') return undefined
    if (key in target) return target[key]
    if (key === 'then') return undefined
    return async () => null
  },
}) as unknown as ElectronAPI
Object.assign(window, { electronAPI: electronApi })

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: en } } })

function Fixture() {
  const theme = useTheme()
  renders += 1
  const [workspaceId, setWorkspaceId] = React.useState<string | null>('ws-a')
  const starters = useWorkspaceChatStarters(workspaceId)

  React.useEffect(() => {
    window.workspaceIsolationFixture = {
      ready: theme.themeLoadStatus === 'ready',
      renders: () => renders,
      setWorkspace: id => setWorkspaceId(id),
      workspace: () => workspaceId,
      calls: () => calls.map(call => ({ ...call })),
      pending: () => pending.map(call => ({ index: call.index, workspaceId: call.workspaceId })),
      resolveCall: (index, settings) => {
        const call = pending.find(entry => entry.index === index)
        if (!call) throw new Error(`no pending call ${index}`)
        pending.splice(pending.indexOf(call), 1)
        call.resolve(settings)
      },
      rejectCall: (index, message) => {
        const call = pending.find(entry => entry.index === index)
        if (!call) throw new Error(`no pending call ${index}`)
        pending.splice(pending.indexOf(call), 1)
        call.reject(new Error(message))
      },
      announce: workspaceId => announceWorkspaceSettingsChanged(workspaceId),
      shown: () => Array.from(document.querySelectorAll('[data-testid="starter"]')).map(node => (node as HTMLElement).dataset.label ?? ''),
      shownWorkspace: () => document.querySelector('[data-testid="active-workspace"]')?.textContent ?? null,
    }
  })

  return (
    <main className="p-6 space-y-3">
      <p data-testid="active-workspace">{workspaceId ?? 'none'}</p>
      <ul data-testid="starters">
        {starters.map((starter, index) => (
          <li key={`${starter.label}:${index}`} data-testid="starter" data-label={starter.label}>{starter.label}</li>
        ))}
      </ul>
    </main>
  )
}

declare global {
  interface Window {
    workspaceIsolationFixture: {
      ready: boolean
      renders: () => number
      setWorkspace: (id: string | null) => void
      workspace: () => string | null
      calls: () => { index: number; workspaceId: string }[]
      pending: () => { index: number; workspaceId: string }[]
      resolveCall: (index: number, settings: unknown) => void
      rejectCall: (index: number, message: string) => void
      announce: (workspaceId?: string) => void
      shown: () => string[]
      shownWorkspace: () => string | null
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
