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
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { filesPanelViewAtom } from '@/atoms/content-panel-ui'

declare global {
  interface Window { __panelChrome?: { ready: boolean } }
}

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

function Fixture() {
  return (
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <AppShellProvider value={contextValue}>
          <div data-chrome-host className="h-screen bg-background text-foreground">
            <div style={{ width: 420, height: 620 }} className="flex flex-col">
              <FilesPanel sessionId={SESSION_ID} />
            </div>
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
