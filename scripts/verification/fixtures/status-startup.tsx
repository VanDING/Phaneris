/** Production StatusIcon with delayed/failing read boundaries; no implementation substitutes. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { StatusIcon } from '@/components/ui/status-icon'
import { useStatuses } from '@/hooks/useStatuses'
import { DEFAULT_ICON_SVGS } from '../../../packages/shared/src/statuses/default-icons'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'
import '@/index.css'

const scenario = new URLSearchParams(location.search).get('scenario') ?? 'healthy'
let failures = 0
const reads: string[] = []
let connected = true, recovered = false, release = () => {}
const listeners = new Set<(state: { status: string }) => void>()
const publish = (status: string) => { connected = status === 'connected'; listeners.forEach(listener => listener({ status })) }
window.electronAPI = {
  readWorkspaceImage: async (workspace: string, path: string) => {
    reads.push(`${workspace}:${path}`)
    if (scenario === 'missing' || !path.endsWith('.svg')) return null
    if (scenario === 'transient' && failures++ === 0) throw new Error('Request timeout: workspace:readImage (30000ms)')
    if (scenario === 'persistent' || (scenario === 'failed-reconnect' && !recovered)) throw new Error('Request timeout: workspace:readImage (30000ms)')
    if (scenario === 'reconnect' && failures++ === 0) { publish('disconnected'); throw new Error('Connection lost') }
    if ((scenario === 'stale-workspace' || scenario === 'unmount') && workspace === 'fixture' && failures++ === 0) {
      await new Promise<void>(resolve => { release = resolve })
    }
    await new Promise(resolve => setTimeout(resolve, 50))
    return DEFAULT_ICON_SVGS.done!.replace('<svg ', `<svg data-workspace="${workspace}" `)
  },
  listStatuses: async () => {
    reads.push('statuses')
    if (scenario === 'statuses-transient' && failures++ === 0) throw new Error('Request timeout: statuses:list (30000ms)')
    if (scenario === 'statuses-reconnect' && !recovered) throw new Error('Request timeout: statuses:list (30000ms)')
    return [{ id: 'done', label: 'Completed', category: 'closed', isFixed: true, isDefault: false, order: 1 }]
  },
  onStatusesChanged: () => () => {},
  getTransportConnectionState: async () => ({ status: connected ? 'connected' : 'disconnected' }),
  onTransportConnectionStateChanged: (listener: (state: { status: string }) => void) => {
    listeners.add(listener); return () => listeners.delete(listener)
  },
} as unknown as ElectronAPI
function StatusConfiguration() {
  const state = useStatuses('fixture')
  return <div data-testid="configuration" data-error={!!state.error}>{state.statuses.map(status => status.label).join(',')}</div>
}
function Fixture() {
  const [workspace, setWorkspace] = React.useState('fixture'), [mounted, setMounted] = React.useState(true)
  Object.assign(window, { statusStartup: { reads, setWorkspace, setMounted, release: () => release(),
    reconnect: () => { recovered = true; publish('disconnected'); publish('connected') } } })
  return <main className="p-8">{scenario.startsWith('statuses-') ? <StatusConfiguration /> :
    mounted && <div data-testid="status"><StatusIcon statusId="done" workspaceId={workspace} bare /></div>}</main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
