/** Browser lifecycle canary for delayed reads, event ordering and subscription cleanup. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import type { ElectronAPI, TransportConnectionState } from '../../../apps/electron/src/shared/types'
import type { ThemePreferences } from '@config/theme'

const preferenceListeners = new Set<(value: ThemePreferences) => void>()
const connectionListeners = new Set<(value: TransportConnectionState) => void>()
let preferences: ThemePreferences = { mode: 'light', colorTheme: 'default', font: 'inter' }
let hold = false, writes = 0
const pending: (() => void)[] = []
const harness = {
  setServer(value: ThemePreferences) { preferences = value },
  emit(value: ThemePreferences) { preferences = value; for (const callback of preferenceListeners) callback(value) },
  reconnect() {
    for (const status of ['reconnecting', 'connected'] as const)
      for (const callback of connectionListeners) callback({ status } as TransportConnectionState)
  },
  hold() { hold = true },
  release() { hold = false; pending.splice(0).forEach(resolve => resolve()) },
  counts() { return { pending: pending.length, writes, preferences: preferenceListeners.size, connections: connectionListeners.size } },
  setFont: (_font: ThemePreferences['font']) => {},
  unmount: () => {},
}
declare global { interface Window { themePreferencesLifecycle: typeof harness } }
window.themePreferencesLifecycle = harness
window.electronAPI = {
  getThemePreferences: () => {
    const snapshot = { ...preferences }
    if (hold) return new Promise<ThemePreferences>(resolve => pending.push(() => resolve(snapshot)))
    return Promise.resolve(snapshot)
  },
  setThemePreferences: async value => { writes++; harness.emit(value); return value },
  onThemePreferencesChange: callback => { preferenceListeners.add(callback); return () => { preferenceListeners.delete(callback) } },
  onTransportConnectionStateChanged: callback => {
    connectionListeners.add(callback); callback({ status: 'connected' } as TransportConnectionState)
    return () => { connectionListeners.delete(callback) }
  },
} as ElectronAPI
function State() {
  const theme = useTheme()
  React.useEffect(() => { harness.setFont = theme.setFont }, [theme.setFont])
  return <output data-testid="preference-state">{JSON.stringify({ mode: theme.mode, font: theme.font, error: theme.themePreferenceError })}</output>
}
const root = createRoot(document.getElementById('root')!)
harness.unmount = () => root.unmount()
root.render(<React.StrictMode><ThemeProvider><State /></ThemeProvider></React.StrictMode>)
