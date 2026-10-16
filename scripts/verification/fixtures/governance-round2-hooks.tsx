// Failure matrix: old workspace success/rejection after a new workspace load;
// initial read arriving after a changed push; clearing the selected workspace.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore, useAtomValue } from 'jotai'
import { WsRpcClient } from '../../../packages/server-core/src/transport/client'
import { RPC_CHANNELS } from '../../../packages/shared/src/protocol'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { usePages } from '../../../apps/electron/src/renderer/hooks/usePages'
import { useProjects } from '../../../apps/electron/src/renderer/hooks/useProjects'
import { useAutomations } from '../../../apps/electron/src/renderer/hooks/useAutomations'
import { pagesAtom } from '../../../apps/electron/src/renderer/atoms/pages'
import { projectsAtom } from '../../../apps/electron/src/renderer/atoms/projects'
import { automationsAtom } from '../../../apps/electron/src/renderer/atoms/automations'
let sequence = 0
const pending: { id: number; kind: string; ws: string; resolve: (v: any) => void; reject: (e: unknown) => void }[] = []
const listeners: Record<string, Set<Function>> = { pages: new Set(), projects: new Set(), automations: new Set() }
const request = (kind: string, ws: string) => new Promise((resolve, reject) => pending.push({ id: ++sequence, kind, ws, resolve, reject }))
const subscribe = (kind: string, fn: Function) => { listeners[kind]!.add(fn); return () => listeners[kind]!.delete(fn) }
const value = (kind: string, marker: string) => kind === 'automations'
  ? { automations: { SessionStart: [{ id: marker, name: marker, actions: [{ type: 'prompt', prompt: marker }] }] } }
  : [{ config: { id: marker, name: marker, slug: marker } }]
const api: any = {
  select: (_ws: string | null) => {}, state: {}, nextWorkspace: 'A', refresh: () => {},
  pending: () => pending.map(({ kind, ws }) => ({ kind, ws })),
  settle: (ws: string, marker: string, reject = false, newest = false) => {
    const matching = pending.filter(p => p.ws === ws)
    const selected = newest ? [...new Map(matching.map(p => [p.kind, p])).values()] : matching
    for (const p of selected) {
      pending.splice(pending.indexOf(p), 1)
      if (reject) p.reject(new Error('audit delayed failure')); else p.resolve(value(p.kind, marker))
    }
  },
  push: (ws: string, marker: string) => {
    for (const kind of ['pages', 'projects']) for (const listener of listeners[kind]!) listener(ws, value(kind, marker))
  },
}
const rpcUrl = (window as any).__R2_RPC_URL as string | undefined
const rpc = rpcUrl ? new WsRpcClient(rpcUrl, { workspaceId: 'a', autoReconnect: false }) : null
api.createRpcPage = (name: string) => rpc!.invoke(RPC_CHANNELS.pages.CREATE, 'a', { name })
Object.assign(window, { audit: api, electronAPI: rpc ? {
  getPages: (ws: string) => rpc.invoke(RPC_CHANNELS.pages.GET, ws),
  getProjects: (ws: string) => rpc.invoke(RPC_CHANNELS.projects.GET, ws),
  getAutomations: (ws: string) => rpc.invoke(RPC_CHANNELS.automations.GET, ws),
  getAutomationLastExecuted: (ws: string) => rpc.invoke(RPC_CHANNELS.automations.GET_LAST_EXECUTED, ws),
  onPagesChanged: (fn: (...args: unknown[]) => void) => rpc.on(RPC_CHANNELS.pages.CHANGED, fn),
  onProjectsChanged: (fn: (...args: unknown[]) => void) => rpc.on(RPC_CHANNELS.projects.CHANGED, fn),
  onAutomationsChanged: (fn: (...args: unknown[]) => void) => rpc.on(RPC_CHANNELS.automations.CHANGED, fn),
} : {
  getPages: (ws: string) => request('pages', ws), getProjects: (ws: string) => request('projects', ws),
  getAutomations: (ws: string) => request('automations', ws), getAutomationLastExecuted: async () => ({}),
  onPagesChanged: (fn: Function) => subscribe('pages', fn), onProjectsChanged: (fn: Function) => subscribe('projects', fn),
  onAutomationsChanged: (fn: Function) => subscribe('automations', fn),
} })
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
function Fixture() {
  const [ws, setWorkspace] = useState<string | null>(api.nextWorkspace); api.select = setWorkspace
  const pages = usePages(ws), projects = useProjects(ws), automations = useAutomations(ws)
  api.refresh = () => { void pages.refresh(); void projects.refresh(); for (const listener of listeners.automations!) listener() }
  const pageAtomValue = useAtomValue(pagesAtom), projectAtomValue = useAtomValue(projectsAtom), automationAtomValue = useAtomValue(automationsAtom)
  api.state = { workspace: ws, pages: pages.pages.map(p => p.config.name), projects: projects.projects.map(p => p.config.name),
    automations: automations.automations.map(a => a.name), atoms: { pages: pageAtomValue.map(p => p.config.name),
      projects: projectAtomValue.map(p => p.config.name), automations: automationAtomValue.map(a => a.name) } }
  return <pre id="observed">{JSON.stringify(api.state, null, 2)}</pre>
}
const root = createRoot(document.getElementById('root')!), store = createStore()
api.mount = (workspace = 'B') => { api.nextWorkspace = workspace; root.render(<Provider store={store}><Fixture /></Provider>) }
api.unmount = () => root.render(<Provider store={store}><p>Unmounted</p></Provider>)
api.mount(rpc ? 'a' : 'A')
