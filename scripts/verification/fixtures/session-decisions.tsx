/** Real Run panel over the acceptance workflow's authenticated WebSocket server. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS } from '../../../packages/shared/src/protocol/channels'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import { AppShellProvider } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { NavigationContext } from '../../../apps/electron/src/renderer/contexts/NavigationContext'
import { TrajectoryPanel } from '../../../apps/electron/src/renderer/components/content-panels/TrajectoryPanel'
import { activateForegroundSessionAtom, setPrimarySurfaceRouteAtom } from '../../../apps/electron/src/renderer/atoms/workbench'
import { replaceLoadedSessionAtom } from '../../../apps/electron/src/renderer/atoms/sessions'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { ThemeProvider } from '../../../apps/electron/src/renderer/context/ThemeContext'
import '../../../apps/electron/src/renderer/index.css'

const params = new URLSearchParams(location.search), mode = params.get('mode') === 'dark' ? 'dark' : 'light'
await i18next.init({ lng: params.get('lang') ?? 'en', keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })
const client = new WsRpcClient(params.get('rpc')!, { mode: 'remote', workspaceId: 'fixture', token: 'fixture-token', autoReconnect: false })
client.connect()
const calls: string[] = []
let failure = false, unsupported = false, slow = false
const query = async (sessionId: string, options: unknown) => {
  calls.push(sessionId)
  if (unsupported) throw Error('Unknown channel: decisions:getSession')
  if (failure) throw Error('Fixture query failed')
  const value = await client.invoke(RPC_CHANNELS.decisions.GET_SESSION, sessionId, options)
  if (slow) await new Promise(resolve => setTimeout(resolve, 350))
  return value
}
Object.assign(window, { electronAPI: {
  getSessionDecisions: query,
  onSessionDecisionsChanged: (callback: (...args: any[]) => void) => client.on(RPC_CHANNELS.decisions.SESSION_CHANGED, callback),
  onTransportConnectionStateChanged: (callback: any) => client.onConnectionStateChanged(callback),
  listLabels: async () => [], onLabelsChanged: () => () => {},
  getThemePreferences: async () => ({ mode, colorTheme: 'default', font: 'theme' }), getWorkspaceColorTheme: async () => null,
  loadPresetTheme: async () => DEFAULT_THEME_FILE, getSystemTheme: async () => mode === 'dark', onSystemThemeChange: () => () => {},
  onThemePreferencesChange: () => () => {}, onWorkspaceThemeChange: () => () => {},
} })
const store = createStore(), ids = [params.get('a')!, params.get('b')!, params.get('empty')!]
for (const id of ids) store.set(replaceLoadedSessionAtom, { id, workspaceId: 'fixture', name: `Session ${ids.indexOf(id) + 1}`, messages: [], isProcessing: false, createdAt: Date.now() } as any)
store.set(setPrimarySurfaceRouteAtom, `allSessions/session/${ids[0]}` as any)
let refresh: () => void = () => {}, pinned: string | undefined
Object.assign(window, { decisionsFixture: {
  ids, calls, select: (index: number) => store.set(activateForegroundSessionAtom, ids[index]!), pin: (index?: number) => { pinned = index === undefined ? undefined : ids[index]; refresh() },
  fail: (value: boolean) => { failure = value }, unsupported: (value: boolean) => { unsupported = value }, slow: (value: boolean) => { slow = value },
  reconnect: () => client.reconnectNow(),
} })
function App() {
  const [, render] = React.useReducer(n => n + 1, 0); refresh = render
  return <AppShellProvider value={{ activeWorkspaceId: 'fixture', workspaces: [{ id: 'fixture', name: 'Acceptance', rootPath: '/fixture' }], onOpenFile: () => {} } as any}>
    <NavigationContext.Provider value={{ navigateToSession: (id: string) => store.set(activateForegroundSessionAtom, id) } as any}>
      <div className="h-screen bg-background"><TrajectoryPanel sessionId={pinned} /></div>
    </NavigationContext.Provider>
  </AppShellProvider>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><I18nextProvider i18n={i18next}><ThemeProvider defaultMode={mode}><App /></ThemeProvider></I18nextProvider></Provider>)
