import type { WorkItem } from '@phaneris/shared/work-items/browser'

type Patch = Pick<WorkItem, 'startAt' | 'dueAt'>
interface Change { patch: Patch; saving: boolean; savedAt?: number }
const changes = new Map<string, Change>(), listeners = new Set<() => void>()
let snapshot: ReadonlyMap<string, Readonly<Change>> = new Map()
const key = (workspace: string, id: string) => JSON.stringify([workspace, id])
function notify() { snapshot = new Map([...changes].map(([key, change]) => [key, { ...change, patch: { ...change.patch } }])); for (const listener of listeners) listener() }
export const subscribeGanttChanges = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const ganttChangesSnapshot = () => snapshot
export const ganttChange = (workspace: string, id: string, source: ReadonlyMap<string, Readonly<Change>> = changes) => source.get(key(workspace, id))
export function acknowledgeGanttChanges(workspace: string, items: WorkItem[]): void {
  let changed = false
  for (const item of items) {
    const id = key(workspace, item.id), entry = changes.get(id)
    if (entry && !entry.saving && entry.savedAt !== undefined && item.updatedAt >= entry.savedAt
      && item.startAt === entry.patch.startAt && item.dueAt === entry.patch.dueAt) { changes.delete(id); changed = true }
    else if (entry && !entry.saving && entry.savedAt !== undefined && item.updatedAt > entry.savedAt) { changes.delete(id); changed = true }
  }
  if (changed) notify()
}
/** Transient optimistic overlay survives view unmount; only the native write result acknowledges it. */
export async function saveGanttChange(workspace: string, id: string, patch: Patch, update: () => Promise<WorkItem | null>): Promise<boolean> {
  const idKey = key(workspace, id)
  if (changes.get(idKey)?.saving) return false
  const change: Change = { patch, saving: true }; changes.set(idKey, change); notify()
  try {
    const saved = await update()
    if (!saved) throw new Error('Schedule save failed')
    change.patch = { startAt: saved.startAt, dueAt: saved.dueAt }; change.savedAt = saved.updatedAt; change.saving = false
    notify(); return true
  } catch { changes.delete(idKey); notify(); return false }
}
