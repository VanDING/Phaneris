import React from 'react'
import { createRoot } from 'react-dom/client'
import { createStore, Provider } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { KanbanBoardContainer } from '@/components/app-shell/kanban/KanbanBoardContainer'
import { AppShellProvider } from '@/context/AppShellContext'
import { NavigationContext } from '@/context/NavigationContext'
import { initializeSessionsAtom } from '@/atoms/sessions'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { TooltipProvider } from '@phaneris/ui'
import type { Session } from '@phaneris/shared/protocol'
import type { WorkItem } from '@phaneris/shared/work-items/browser'
import '@/index.css'

declare global { interface Window { taskBoardData: { sessions: Session[]; items: WorkItem[] }; taskBoardTheme(mode: 'light' | 'dark'): void } }
const data = window.taskBoardData, store = createStore()
store.set(initializeSessionsAtom, data.sessions)
const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
// State/relationship snapshots are steady-state checks; motion is verified by
// the existing animation workflows, not during a theme interpolation here.
const freeze = document.createElement('style')
freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'
document.head.append(freeze)
const statuses = ['todo', 'needs-review', 'done', 'cancelled'].map(id => ({ id, label: id, icon: null,
  category: ['done', 'cancelled'].includes(id) ? 'closed' : 'open', resolvedColor: 'var(--foreground)', iconColorable: true }))
Object.assign(window, { electronAPI: {
  listWorkItems: async () => data.items,
  listLabels: async () => [],
  onWorkItemsChanged: () => () => {}, onLabelsChanged: () => () => {},
  onTransportConnectionStateChanged: () => () => {},
} })
function Board() {
  const theme = useTheme()
  window.taskBoardTheme = theme.setMode
  return <div data-mode={theme.resolvedMode} data-ready={theme.startupReady} className="@container/panel h-screen bg-background"><KanbanBoardContainer /></div>
}
createRoot(document.getElementById('root')!).render(
  <Provider store={store}><I18nextProvider i18n={i18n}><TooltipProvider><ThemeProvider defaultMode="light">
    <AppShellProvider value={{ activeWorkspaceId: 'alpha', sessionStatuses: statuses, llmConnections: [], workspaces: [], onCreateSession: () => {} } as never}>
      <NavigationContext.Provider value={{ navigate: () => {}, navigateToSession: () => {} } as never}>
        <Board />
      </NavigationContext.Provider>
    </AppShellProvider>
  </ThemeProvider></TooltipProvider></I18nextProvider></Provider>,
)
