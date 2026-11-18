import { useCallback, useSyncExternalStore } from 'react'
import type { ResourceIcon, ResourceIcons } from '@phaneris/shared/resources/icons'
import type { LoadedSkill } from '@phaneris/shared/skills'
import { readAfterReconnect } from './read-after-reconnect'

type Snapshot = { icons: ResourceIcons; phase: 'loading' | 'ready' | 'error' }
interface WorkspaceIcons {
  snapshot: Snapshot
  listeners: Set<() => void>
  stop: () => void
  updates: Map<string, ResourceIcon | null>
}

const pending: Snapshot = { icons: {}, phase: 'loading' }
const workspaces = new Map<string, WorkspaceIcons>()

export function skillIconKey(skill: LoadedSkill) {
  return `skill:${skill.source}:${skill.source === 'project' ? skill.path : skill.slug}`
}

function applyIcon(store: WorkspaceIcons, key: string, icon: ResourceIcon | null) {
  const icons = { ...store.snapshot.icons }
  if (icon) icons[key] = icon
  else delete icons[key]
  store.snapshot = { ...store.snapshot, icons }
  if (store.snapshot.phase === 'loading') store.updates.set(key, icon)
  for (const notify of store.listeners) notify()
}

function subscribe(workspaceId: string, notify: () => void) {
  if (!workspaceId || !window.electronAPI?.getResourceIcons) return () => {}
  let store = workspaces.get(workspaceId)
  if (!store) {
    const entry: WorkspaceIcons = { snapshot: pending, listeners: new Set(), updates: new Map(), stop: () => {} }
    workspaces.set(workspaceId, entry)
    entry.stop = window.electronAPI.onResourceIconChanged((id, key, icon) => {
      if (id === workspaceId) applyIcon(entry, key, icon)
    })
    void readAfterReconnect(() => window.electronAPI.getResourceIcons(workspaceId))
      .then(icons => {
        for (const [key, icon] of entry.updates) {
          if (icon) icons[key] = icon
          else delete icons[key]
        }
        entry.snapshot = { icons, phase: 'ready' }
      }, () => {
        entry.snapshot = { ...entry.snapshot, phase: 'error' }
      })
      .finally(() => {
        entry.updates.clear()
        for (const listener of entry.listeners) listener()
      })
    store = entry
  }
  const entry = store
  entry.listeners.add(notify)
  return () => {
    entry.listeners.delete(notify)
    if (entry.listeners.size === 0) {
      entry.stop()
      workspaces.delete(workspaceId)
    }
  }
}

export function useResourceIcon(workspaceId: string, key: string) {
  const snapshot = useSyncExternalStore(
    useCallback(notify => subscribe(workspaceId, notify), [workspaceId]),
    () => workspaces.get(workspaceId)?.snapshot ?? pending,
    () => pending,
  )
  return { icon: snapshot.icons[key], phase: snapshot.phase }
}

export async function saveResourceIcon(workspaceId: string, key: string, icon: ResourceIcon | null) {
  const entry = workspaces.get(workspaceId)
  const previous = entry?.snapshot.icons[key]
  await window.electronAPI.setResourceIcon(workspaceId, key, icon)
  // The server also broadcasts the change. Do not replace a newer event.
  const current = workspaces.get(workspaceId)
  if (current && current.snapshot.icons[key] === previous) applyIcon(current, key, icon)
}
