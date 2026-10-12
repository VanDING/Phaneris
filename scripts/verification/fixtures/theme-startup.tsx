/** Actual ThemeProvider/compiler; bounded delayed API inputs for startup races. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { DEFAULT_THEME_FILE } from '@config/theme'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'

const params = new URLSearchParams(location.search), scenario = params.get('scenario') ?? 'preferences'
const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = params.get('css')!; document.head.append(style)
localStorage.setItem('craft-theme', JSON.stringify({ version: 3, mode: 'light', colorTheme: 'default', font: 'inter' }))
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
if (scenario !== 'preview') window.electronAPI = {
  getThemePreferences: async () => {
    await delay(scenario.startsWith('workspace') ? 100 : 2200)
    if (scenario === 'preferences-error') throw new Error('Startup read failed')
    return { mode: 'light', colorTheme: scenario === 'theme-error' ? 'missing' : 'small', font: 'inter' }
  },
  getWorkspaceColorTheme: async () => { await delay(2600); return scenario === 'workspace-event' ? 'small' : 'workspace-small' },
  loadPresetTheme: async (id: string) => id === 'missing' ? null : ({ id, path: `fixture:${id}`, theme: {
    ...DEFAULT_THEME_FILE, name: id, fontSize: id === 'workspace-small' ? '14px' : '13px',
  } }),
  onThemePreferencesChange: () => () => {}, onWorkspaceThemeChange: (callback: (value: { workspaceId: string; themeId: string }) => void) => {
    const timer = scenario === 'workspace-event' ? setTimeout(() => callback({ workspaceId: 'fixture', themeId: 'workspace-small' }), 200) : undefined
    return () => clearTimeout(timer)
  },
} as unknown as ElectronAPI

function State() {
  const theme = useTheme()
  return <output data-startup-ready={theme.startupReady} data-status={theme.themeLoadStatus} data-applied={theme.appliedColorTheme}>
    {JSON.stringify({ ready: theme.startupReady, preferencesError: theme.themePreferenceError, themeError: theme.themeLoadError })}
  </output>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider activeWorkspaceId={scenario.startsWith('workspace') ? 'fixture' : null}><State /></ThemeProvider></React.StrictMode>)
