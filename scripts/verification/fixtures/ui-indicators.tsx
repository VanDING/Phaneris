import React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Inbox, PanelTop, FolderKanban } from 'lucide-react'
import { Spinner, LoadingIndicator, TooltipProvider } from '@phaneris/ui'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

function Fixture() {
  const [collapsed, setCollapsed] = React.useState(false)
  const [selection, setSelection] = React.useState('')
  return <main style={{ padding: 32, color: 'var(--foreground)', background: 'var(--background)', minHeight: '100vh' }}>
    <h1>Navigation and loading indicators</h1>
    <button onClick={() => setCollapsed(value => !value)}>Toggle sidebar</button>
    <div className="sidebar-navigation" data-collapsed={collapsed || undefined} style={{ width: collapsed ? 48 : 200, marginTop: 24 }}>
      <LeftSidebar isCollapsed={collapsed} links={[
        { id: 'nav:sessions', title: 'Sessions', icon: Inbox, variant: 'ghost' },
        { id: 'nav:projects', title: 'Projects', icon: FolderKanban, variant: 'ghost' },
        { id: 'nav:pages', title: 'Pages', icon: PanelTop, variant: 'ghost', onClick: () => setSelection('Pages selected') },
      ]} />
    </div>
    <output>{selection}</output>
    <section aria-label="Loading sizes" style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 32 }}>
      {[8, 10, 12, 16].map(size => <span key={size} data-size={size} style={{ fontSize: size }}><Spinner /></span>)}
      <span data-size="explicit" style={{ fontSize: 16 }}><Spinner className="h-3 w-3" /></span>
    </section>
    <div style={{ marginTop: 24 }}><LoadingIndicator label="Thinking…" /></div>
  </main>
}

createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><TooltipProvider><Fixture /></TooltipProvider></I18nextProvider>)
