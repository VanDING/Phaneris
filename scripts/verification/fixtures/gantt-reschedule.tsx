import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { GanttView } from '@/components/app-shell/kanban/GanttView'
import { AppShellProvider } from '@/context/AppShellContext'
import { NavigationContext } from '@/context/NavigationContext'
import { TooltipProvider } from '@phaneris/ui'
import { Toaster } from 'sonner'
import '@/index.css'

const i18n = createInstance(); await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
const api = new URLSearchParams(location.search).get('api')!, listeners = new Set<(workspace: string) => void>()
async function invoke(method: string, args: unknown[] = []) {
  const response = await fetch(`${api}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (!response.ok) throw new Error(await response.text()); return response.json()
}
Object.assign(window, { electronAPI: {
  listWorkItems: () => invoke('list'), updateWorkItem: async (_workspace: string, id: string, patch: unknown) => { const item = await invoke('update', [id, patch]); for (const listener of listeners) listener('fixture'); return item },
  onWorkItemsChanged: (callback: (workspace: string) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
} })
function App() {
  const [mounted, setMounted] = useState(true)
  Object.assign(window, { ganttFixture: { remount: () => { setMounted(false); setTimeout(() => setMounted(true), 30) }, broadcast: () => { for (const listener of listeners) listener('fixture') }, invoke } })
  return <Provider><I18nextProvider i18n={i18n}><TooltipProvider><AppShellProvider value={{ activeWorkspaceId: 'fixture', sessionStatuses: [], workspaces: [] } as never}>
    <NavigationContext.Provider value={{ navigateToSession: () => {}, navigate: () => {} } as never}>
      <div className="@container/panel h-screen bg-background">{mounted && <GanttView />}</div><Toaster />
    </NavigationContext.Provider>
  </AppShellProvider></TooltipProvider></I18nextProvider></Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
