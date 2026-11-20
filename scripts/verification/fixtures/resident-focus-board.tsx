import React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { FocusBoard } from '@/components/resident-assistant/FocusBoard'
import '@/index.css'

/**
 * The implemented FocusBoard, rendered on both of its surfaces with Host
 * projections shaped exactly like session-tools-core's contracts.
 *
 * What this checks is the *shipped* component and CSS, not a mock of them:
 * the peek must stay a two-column popover, the dock must be a right-anchored
 * floating panel stacked top to bottom, and the gauge must keep one equal-height
 * bar per task with its state in the fill.
 */
declare global {
  interface Window {
    focusBoardData: { items: unknown[]; deliverables: unknown[]; scheduling: unknown }
    focusBoardSurface: (surface: 'peek' | 'dock') => void
  }
}

const data = window.focusBoardData
const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

const freeze = document.createElement('style')
freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'
document.head.append(freeze)

Object.assign(window, {
  electronAPI: {
    getAssistantTasks: async () => ({ observedAt: Date.now(), items: data.items, counts: {}, total: data.items.length }),
    getAssistantWork: async (_workspaceId: string, options: { view: string }) => options.view === 'current'
      ? { scheduling: data.scheduling, items: [] }
      : { scheduling: data.scheduling, deliverables: data.deliverables },
    getArtifact: async () => { throw new Error('no preview in this fixture') },
    onAssistantTasksChanged: () => () => {},
  },
})

let surface: 'peek' | 'dock' = 'peek'
const root = createRoot(document.getElementById('root')!)
function render() {
  root.render(<I18nextProvider i18n={i18n}>
    <div className="h-screen bg-background" data-mode="light" data-surface={surface}
      style={{ display: 'flex', justifyContent: surface === 'dock' ? 'flex-end' : 'center',
        alignItems: surface === 'dock' ? 'stretch' : 'flex-start', padding: surface === 'dock' ? 12 : 24 }}>
      <div style={surface === 'dock' ? { width: 384, display: 'flex', borderRadius: 'var(--shape-xl)', overflow: 'hidden', boxShadow: '0 0 0 1px var(--border)' } : { width: 620, display: 'flex', borderRadius: 'var(--shape-xl)', overflow: 'hidden', boxShadow: '0 0 0 1px var(--border)' }}>
        <FocusBoard workspaceId="fixture" surface={surface} />
      </div>
    </div>
  </I18nextProvider>)
}
window.focusBoardSurface = next => { surface = next; render() }
render()
