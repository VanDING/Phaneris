/** Real Run panel fed by the observability workflow's authenticated RPC. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS } from '../../../packages/shared/src/protocol/channels'
import { AppShellProvider } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { NavigationContext } from '../../../apps/electron/src/renderer/context/NavigationContext'
import { TrajectoryPanel } from '../../../apps/electron/src/renderer/components/content-panels/TrajectoryPanel'
import { activateForegroundSessionAtom, setPrimarySurfaceRouteAtom } from '../../../apps/electron/src/renderer/atoms/workbench'
import { replaceLoadedSessionAtom } from '../../../apps/electron/src/renderer/atoms/sessions'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { ThemeProvider } from '../../../apps/electron/src/renderer/context/ThemeContext'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import '../../../apps/electron/src/renderer/index.css'

const params = new URLSearchParams(location.search), mode = params.get('mode') === 'dark' ? 'dark' : 'light'
await i18next.init({ lng: params.get('lang') ?? 'en', keySeparator: false, interpolation: { escapeValue: false }, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })
const client = new WsRpcClient(params.get('rpc')!, { mode: 'remote', workspaceId: 'fixture', token: 'fixture-token', autoReconnect: false })
client.connect()
const ids = [params.get('main')!, params.get('legacy')!, params.get('empty')!, params.get('large')!]
Object.assign(window, { electronAPI: {
  getSessionMessages: (id: string) => client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, id),
  getSessionDecisions: (id: string, query: unknown) => client.invoke(RPC_CHANNELS.decisions.GET_SESSION, id, query),
  onSessionDecisionsChanged: (callback: (...args: unknown[]) => void) => client.on(RPC_CHANNELS.decisions.SESSION_CHANGED, callback),
  onTransportConnectionStateChanged: (callback: Parameters<typeof client.onConnectionStateChanged>[0]) => client.onConnectionStateChanged(callback),
  listLabels: async () => [], onLabelsChanged: () => () => {},
  getThemePreferences: async () => ({ mode, colorTheme: 'default', font: 'theme' }), getWorkspaceColorTheme: async () => null,
  loadPresetTheme: async () => DEFAULT_THEME_FILE, getSystemTheme: async () => mode === 'dark', onSystemThemeChange: () => () => {},
  onThemePreferencesChange: () => () => {}, onWorkspaceThemeChange: () => () => {},
} })
const store = createStore()
const sessions = await Promise.all(ids.map(id => client.invoke(RPC_CHANNELS.sessions.GET_MESSAGES, id)))
for (const session of sessions) if (session) store.set(replaceLoadedSessionAtom, session)
store.set(setPrimarySurfaceRouteAtom, `allSessions/session/${ids[0]}`)
Object.assign(window, { runObservabilityFixture: {
  language: (lng: string) => i18next.changeLanguage(lng),
  select: (index: number) => store.set(activateForegroundSessionAtom, ids[index]!),
  processing: (value: boolean) => store.set(replaceLoadedSessionAtom, { ...sessions[0]!, isProcessing: value }),
} })
function App() {
  return <AppShellProvider value={{ activeWorkspaceId: 'fixture', workspaces: [{ id: 'fixture', name: 'Acceptance', rootPath: '/fixture' }], onOpenFile: () => {} } as never}>
    <NavigationContext.Provider value={{ navigateToSession: (id: string) => store.set(activateForegroundSessionAtom, id) } as never}>
      <div className="h-screen bg-background"><TrajectoryPanel /></div>
    </NavigationContext.Provider>
  </AppShellProvider>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><I18nextProvider i18n={i18next}><ThemeProvider defaultMode={mode}><App /></ThemeProvider></I18nextProvider></Provider>)
