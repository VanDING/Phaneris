/** Read-only product inspection. All actions and content use the existing playground mocks. */
import '@/playground/mock-utils'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { setupI18n } from '@phaneris/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '@phaneris/ui'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { PlaygroundAppShellProvider } from '@/playground/PlaygroundAppShellProvider'
import { componentRegistry } from '@/playground/registry'
import { Button } from '@/components/ui/button'
import { MetadataBadge } from '@/components/ui/metadata-badge'
import { ContextWorkbenchTabs } from '@/components/app-shell/ContextWorkbenchTabs'
import type { WorkbenchState } from '@/atoms/workbench'
import { createClientPlatform, initializeClient } from '@/platform/client'
import './inspect.css'

setupI18n([initReactI18next])
// Bring the existing mocks up to the platform handshake required by current production views.
window.electronAPI.getTransportConnectionState = async () => ({ status: 'connected' } as never)
window.electronAPI.onTransportConnectionStateChanged = () => () => {}
window.electronAPI.reconnectTransport = async () => ({ status: 'connected' } as never)
await initializeClient(createClientPlatform('web', window.electronAPI), window.electronAPI)
const workbench = { open: true, activeItemId: 'audit-files', primaryWidth: 600, expandedItemId: null, items: [
  { id: 'audit-run', kind: 'trajectory', route: 'allSessions/trajectory/audit', binding: { type: 'follow-primary' } },
  { id: 'audit-files', kind: 'files', route: 'allSessions/files/audit', binding: { type: 'follow-primary' } },
] } as WorkbenchState

function Specimens() {
  const { setMode } = useTheme()
  const [selected, setSelected] = React.useState(new URLSearchParams(location.search).get('view') ?? 'controls')
  const entry = componentRegistry.find(item => item.id === selected)
  const Component = entry?.component as React.ComponentType<Record<string, unknown>> | undefined
  const props = entry ? { ...Object.fromEntries(entry.props.map(prop => [prop.name, prop.defaultValue])), ...entry.mockData?.() } : {}
  const Wrapper = entry?.wrapper ?? React.Fragment
  return <div className="h-full overflow-auto bg-background text-foreground">
    <header className="flex flex-wrap items-center gap-3 border-b p-3 text-body">
      <strong>UI inspection · synthetic data</strong>
      <label>Surface <select aria-label="Audit surface" value={selected} onChange={event => setSelected(event.target.value)} className="border rounded-md px-2 py-1 bg-background">
        <option value="controls">Production button sizes</option>
        {componentRegistry.map(item => <option key={item.id} value={item.id}>{item.category} · {item.name}</option>)}
      </select></label>
      <Button size="sm" onClick={() => setMode('light')}>Light</Button>
      <Button size="sm" onClick={() => setMode('dark')}>Dark</Button>
    </header>
    {selected === 'controls' ? <main className="p-5 space-y-6">
      <h1 className="text-title">Unmodified production control variants</h1>
      <div className="flex flex-wrap items-center gap-3" data-audit="button-sizes">
        <Button size="xs" data-audit-size="xs">XS · 22px contract</Button>
        <Button size="compact" data-audit-size="compact">Compact · 26px contract</Button>
        <Button size="sm" data-audit-size="sm">SM · 30px contract</Button>
        <Button data-audit-size="default">Default · 34px contract</Button>
        <Button size="lg" data-audit-size="lg">LG · 38px contract</Button>
      </div>
      <div className="flex items-center gap-3" data-audit="metadata"><MetadataBadge label="Priority" value="2" interactive /><MetadataBadge label="Needs review" interactive showChevron /></div>
      <div className="max-w-[800px] border"><ContextWorkbenchTabs state={workbench} /></div>
    </main> : Component ? <main className="p-4" data-audit="registry"><Wrapper><Component key={selected} {...props} /></Wrapper></main> : null}
  </div>
}

createRoot(document.getElementById('root')!).render(<Provider><ThemeProvider><EscapeInterruptProvider><PlaygroundAppShellProvider><TooltipProvider><Specimens /></TooltipProvider></PlaygroundAppShellProvider></EscapeInterruptProvider></ThemeProvider></Provider>)
