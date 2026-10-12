/** The production standalone entries, with only their IPC boundary replaced. */
import { BUILTIN_THEMES, type ThemeFile, type ThemePreferences } from '@config/theme'
const updates = new Set<(value: unknown) => void>()
let sequence = 0
const choose = (id: string, mode: ThemePreferences['mode'], theme: ThemeFile = BUILTIN_THEMES[id]!) => {
  const input = { sequence: ++sequence, requestedId: id, preferences: { mode, colorTheme: id, font: 'inter' }, preset: { id, path: `fixture:${id}`, theme } }
  ;(window as unknown as { __phanerisBrowserTheme: unknown }).__phanerisBrowserTheme = input
  updates.forEach(listener => listener(input))
  window.dispatchEvent(new CustomEvent('craft-browser-theme', { detail: input }))
}
choose('ink', 'light')
Object.assign(window, { browserToolbar: {
  instanceId: 'theme-fixture', navigate: async () => {}, goBack: async () => {}, goForward: async () => {}, reload: async () => {}, stop: async () => {},
  setMenuGeometry: async () => {}, hideWindow: async () => {}, closeWindowEntirely: async () => {},
  onStateUpdate: () => () => {}, onThemeColor: () => () => {}, onForceCloseMenu: () => () => {},
  getHostTheme: async () => (window as unknown as { __phanerisBrowserTheme: unknown }).__phanerisBrowserTheme,
  onHostTheme: (callback: (input: unknown) => void) => { updates.add(callback); return () => { updates.delete(callback) } },
  reportHostTheme: async () => {},
}, themeBrowserHost: { choose } })
declare global { interface Window { themeBrowserHost: { choose: typeof choose } } }
if (new URLSearchParams(location.search).get('host') === 'toolbar') await import('../../../apps/electron/src/renderer/browser-toolbar')
else await import('../../../apps/electron/src/renderer/browser-empty-state')
