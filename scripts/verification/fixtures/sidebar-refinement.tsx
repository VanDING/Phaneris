import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Provider } from 'jotai'
import { Inbox, Tag, Database, Zap, Shapes, Folder, PanelsTopLeft, ListTodo, CircleCheck } from 'lucide-react'
import { Button, TooltipProvider } from '@phaneris/ui'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { SidebarProfile } from '@/components/app-shell/SidebarProfile'
import { PhanerisSymbol } from '@/components/icons/PhanerisSymbol'
import { SquarePenRounded } from '@/components/icons/SquarePenRounded'
import en from '../../../packages/shared/src/i18n/locales/en.json'

window.electronAPI = { readPreferences: async () => ({ content: JSON.stringify({ name: 'Sidebar review' }) }) } as typeof window.electronAPI
const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

function Fixture() {
  const [collapsed, setCollapsed] = React.useState(false)
  const [children, setChildren] = React.useState(false)
  const [selected, setSelected] = React.useState('Sessions')
  const [profile, setProfile] = React.useState(false)
  const rail = matchMedia('(pointer: coarse)').matches ? 60 : 48
  return <main style={{ padding: 24, background: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
    <div className="flex items-center gap-4 mb-4">
      <Button onClick={() => setCollapsed(value => !value)} data-toggle-sidebar>Toggle sidebar</Button>
      <span data-brand><PhanerisSymbol className="h-4 text-accent" /></span>
      <span className="menu-icon" data-menu-icon><Inbox /></span>
    </div>
    <div className="flex gap-4">
      <aside data-sidebar-fixture className="sidebar-navigation bg-muted" data-collapsed={collapsed || undefined}
        style={{ width: collapsed ? rail : 200, height: 640, transition: 'width var(--motion-duration-spatial) var(--motion-ease-move)' }}>
        <div className="flex h-full flex-col">
          <div className="sidebar-top flex-1 flex flex-col min-h-0">
            <div className="sidebar-first-row shrink-0"><div><Button variant="ghost" className="sidebar-new-session text-body w-full justify-start gap-2 font-normal rounded-control"
              onClick={() => setSelected('New session')} aria-label="New session"><SquarePenRounded /><span className="sidebar-label">New session</span></Button></div></div>
            <div className="sidebar-scroll flex-1 overflow-y-auto min-h-0">
              <LeftSidebar isCollapsed={collapsed} links={[
                { id:'sessions', title:'Sessions', icon:Inbox, variant:selected === 'Sessions' ? 'default' : 'ghost', onClick:() => setSelected('Sessions'), expandable:true, expanded:children, onToggle:() => setChildren(value => !value),
                  items:[{ id:'done', title:'Completed', icon:CircleCheck, iconColor:'var(--success)', variant:'ghost', onClick:() => setSelected('Completed') }] },
                { id:'labels', title:'Labels', icon:Tag, variant:'ghost' },
                { id:'group', type:'separator' },
                ...([['Sources',Database],['Skills',Zap],['Plugins',Shapes],['Projects',Folder],['Pages',PanelsTopLeft],['Automations',ListTodo]] as const).map(([title,icon]) => ({ id:title, title, icon, variant:selected === title ? 'default' as const : 'ghost' as const, onClick:() => setSelected(title) })),
              ]} />
            </div>
          </div>
          <div className="sidebar-footer shrink-0 pb-2"><SidebarProfile isCollapsed={collapsed} open={profile} onOpenChange={setProfile}
            onOpenProfile={() => setSelected('Profile')} onOpenSettings={() => setSelected('Settings')}
            profileButtonProps={{}} settingsButtonProps={{}} /></div>
        </div>
      </aside>
      <section><h1 className="text-title font-medium">Sidebar review</h1><p className="text-body mt-2">Production sidebar components and theme styles.</p><output data-selection className="text-body">{selected}</output></section>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><Provider><TooltipProvider><Fixture /></TooltipProvider></Provider></I18nextProvider>)
