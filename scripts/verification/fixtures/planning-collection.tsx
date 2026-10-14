/** Deterministic renderer race harness, separate from production performance measurements. */
import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useWorkItems } from '../../../apps/electron/src/renderer/hooks/useWorkItems'
import { useCalendarEntries } from '../../../apps/electron/src/renderer/hooks/useCalendarEntries'
import type { WorkItem, CreateWorkItemInput, UpdateWorkItemInput } from '@phaneris/shared/work-items/browser'

const item = (id: string, title: string): WorkItem => ({ id, title, statusId: 'todo', startAt: '2026-10-14', dueAt: '2026-10-15', dependencyIds: [], sessionIds: [id], createdAt: 1, updatedAt: 1 })
const data = new Map([['one', [item('a', 'Alpha'), item('b', 'Beta')]], ['two', [item('z', 'Other workspace')]]])
data.set('initial', [item('a', 'Initial Alpha'), item('b', 'Initial Beta')])
const changed = new Set<(id: string) => void>(), transport = new Set<(state: { status: string }) => void>()
const state = { reads: [] as string[], activeReads: 0, maxActiveReads: 0, writes: 0, holdRead: false, holdWrite: false, failRead: false, failWrite: false }
let releaseRead: (() => void) | undefined, releaseWrite: (() => void) | undefined
let scope: (workspace: string | null) => void, mount: (value: boolean) => void
async function write<T>(operation: () => T): Promise<T> {
  state.writes++
  if (state.holdWrite) { state.holdWrite = false; await new Promise<void>(resolve => { releaseWrite = resolve }) }
  if (state.failWrite) { state.failWrite = false; throw new Error('Injected write rejection') }
  return operation()
}
Object.assign(window, { electronAPI: {
  listWorkItems: async (workspace: string) => {
    state.reads.push(workspace); state.activeReads++; state.maxActiveReads = Math.max(state.maxActiveReads, state.activeReads)
    const snapshot = structuredClone(data.get(workspace) ?? [])
    try {
      if (state.holdRead) { state.holdRead = false; await new Promise<void>(resolve => { releaseRead = resolve }) }
      if (state.failRead) { state.failRead = false; throw new Error('Injected read rejection') }
      return snapshot
    } finally { state.activeReads-- }
  },
  onWorkItemsChanged: (listener: (id: string) => void) => { changed.add(listener); return () => changed.delete(listener) },
  onTransportConnectionStateChanged: (listener: (state: { status: string }) => void) => { transport.add(listener); return () => transport.delete(listener) },
  createWorkItem: (workspace: string, input: CreateWorkItemInput) => write(() => {
    const id = data.get(workspace)!.some(item => item.id === 'created') ? `created-${state.writes}` : 'created'
    const created = { ...item(id, input.title), ...input }
    data.set(workspace, [...data.get(workspace)!, created]); return structuredClone(created)
  }),
  updateWorkItem: (workspace: string, id: string, patch: UpdateWorkItemInput) => write(() => {
    const updated = { ...data.get(workspace)!.find(item => item.id === id)!, ...patch }
    for (const key of Object.keys(updated) as (keyof typeof updated)[]) if (updated[key] === null) delete updated[key]
    data.set(workspace, data.get(workspace)!.map(item => item.id === id ? updated as WorkItem : item)); return structuredClone(updated)
  }),
  deleteWorkItem: (workspace: string, id: string) => write(() => { data.set(workspace, data.get(workspace)!.filter(item => item.id !== id)) }),
} })

function Consumer({ workspace }: { workspace: string | null }) {
  const work = useWorkItems(workspace), calendar = useCalendarEntries(workspace), [failure, setFailure] = useState('')
  const act = async (operation: () => Promise<unknown>) => { setFailure(''); try { await operation() } catch (cause) { setFailure(String(cause)) } }
  return <main>
    <output id="snapshot">{JSON.stringify({ workspace, items: work.items, entries: calendar.entries, loading: work.isLoading, error: work.error, failure })}</output>
    <button onClick={() => void work.refresh()}>Refresh</button>
    <button onClick={() => void work.update('a', { title: 'Accepted local write' })}>Update</button>
    <button onClick={() => void work.create({ title: 'Created during read' })}>Create</button>
    <button onClick={() => void work.remove('b')}>Delete</button>
    <button onClick={() => void act(() => calendar.create({ title: 'Timed calendar entry', date: '2026-11-01', endDate: '2026-11-02', time: '01:30', endTime: '03:45', note: 'Calendar note', projectId: 'project-a' }))}>Create schedule</button>
    <button onClick={() => void act(() => calendar.update('a', { title: 'Calendar updated', date: '2026-10-31', endDate: '2026-11-02', allDay: true }))}>Update schedule</button>
    <button onClick={() => void act(() => calendar.remove('a'))}>Clear schedule</button>
    <button onClick={() => void act(() => calendar.update('a', { title: 'Invalid', date: '2026-11-03', endDate: '2026-11-01' }))}>Invalid schedule</button>
  </main>
}
function App() {
  const [workspace, setScope] = useState<string | null>('one'), [mounted, setMounted] = useState(true)
  scope = setScope; mount = setMounted
  return mounted ? <Consumer workspace={workspace} /> : <p>Inactive</p>
}
Object.assign(window, { planningFixture: {
  metrics: () => ({ ...state, listeners: changed.size, transportListeners: transport.size, heldRead: Boolean(releaseRead), heldWrite: Boolean(releaseWrite) }),
  configure: (patch: Partial<typeof state>) => Object.assign(state, patch),
  releaseRead: () => { const resolve = releaseRead; releaseRead = undefined; resolve?.() },
  releaseWrite: () => { const resolve = releaseWrite; releaseWrite = undefined; resolve?.() },
  change: (workspace = 'one', title?: string) => {
    if (title) data.set(workspace, data.get(workspace)!.map(item => ({ ...item, title })))
    for (const listener of changed) listener(workspace)
  },
  connection: (status: string) => { for (const listener of transport) listener({ status }) },
  scope: (workspace: string | null) => scope(workspace), mount: (value: boolean) => mount(value),
  facts: () => [...data],
} })
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
