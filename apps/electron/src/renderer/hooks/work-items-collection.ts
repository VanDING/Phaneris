import { useSyncExternalStore } from 'react'
import type { CreateWorkItemInput, UpdateWorkItemInput, WorkItem } from '@phaneris/shared/work-items/browser'

interface Snapshot {
  items: WorkItem[]
  isLoading: boolean
  error: string | null
}

/** A disposable renderer projection; Session responses remain authoritative. */
class WorkItemsCollection {
  private snapshot: Snapshot = { items: [], isLoading: true, error: null }
  private listeners = new Set<() => void>()
  private disconnect: (() => void) | undefined
  private active = false
  private revision = 0
  private writeVersion = 0
  private writes = 0
  private request: Promise<void> | null = null
  private overrides = new Map<string, { version: number; item: WorkItem | null }>()

  constructor(private api: Window['electronAPI'], private workspaceId: string, private prune: () => void) {}

  get idle(): boolean { return !this.active && !this.request && this.writes === 0 }
  getSnapshot = (): Snapshot => this.snapshot

  private publish(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.active) {
      this.active = true
      const changed = this.api.onWorkItemsChanged(workspaceId => {
        if (workspaceId === this.workspaceId) void this.refresh()
      })
      let disconnected = false
      const transport = this.api.onTransportConnectionStateChanged?.(state => {
        if (state.status !== 'connected') disconnected = true
        else if (disconnected) { disconnected = false; void this.refresh() }
      })
      this.disconnect = () => { changed(); transport?.() }
      void this.refresh()
    }
    return () => {
      this.listeners.delete(listener)
      // StrictMode's synchronous unsubscribe/subscribe pair shares its read.
      queueMicrotask(() => {
        if (this.listeners.size) return
        this.active = false
        this.disconnect?.()
        this.disconnect = undefined
        this.prune()
      })
    }
  }

  refresh = (): Promise<void> => {
    this.revision++
    if (this.request) return this.request
    this.request = this.load().finally(() => { this.request = null; this.prune() })
    return this.request
  }

  private async load(): Promise<void> {
    let revision: number
    do {
      revision = this.revision
      const writeVersion = this.writeVersion
      this.publish({ isLoading: this.snapshot.items.length === 0 })
      try {
        const loaded = await this.api.listWorkItems(this.workspaceId)
        // Don't publish a snapshot already invalidated by a newer notification.
        if (revision !== this.revision && this.active) continue
        const items = new Map(loaded.map(item => [item.id, item]))
        for (const [id, override] of this.overrides) {
          if (override.version > writeVersion) {
            if (override.item) items.set(id, override.item)
            else items.delete(id)
          } else this.overrides.delete(id)
        }
        this.publish({ items: [...items.values()], error: null })
      } catch (cause) {
        if (revision === this.revision) this.publish({ error: cause instanceof Error ? cause.message : 'Failed to load work items' })
      }
    } while (this.active && revision !== this.revision)
    this.publish({ isLoading: false })
  }

  private accept(id: string, item: WorkItem | null): void {
    this.overrides.set(id, { version: ++this.writeVersion, item })
    const items = new Map(this.snapshot.items.map(item => [item.id, item]))
    if (item) items.set(id, item)
    else items.delete(id)
    this.publish({ items: [...items.values()] })
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.writes++
    try { return await operation() } finally { this.writes--; this.prune() }
  }

  create = (input: CreateWorkItemInput): Promise<WorkItem> => this.mutate(async () => {
    const item = await this.api.createWorkItem(this.workspaceId, input)
    this.accept(item.id, item)
    return item
  })

  update = (id: string, patch: UpdateWorkItemInput): Promise<WorkItem> => this.mutate(async () => {
    const item = await this.api.updateWorkItem(this.workspaceId, id, patch)
    this.accept(id, item)
    return item
  })

  remove = (id: string): Promise<void> => this.mutate(async () => {
    await this.api.deleteWorkItem(this.workspaceId, id)
    this.accept(id, null)
  })
}

const collections = new WeakMap<Window['electronAPI'], Map<string, WorkItemsCollection>>()
const empty: Snapshot = { items: [], isLoading: false, error: null }
const emptySnapshot = () => empty
const emptySubscribe = () => () => {}

export function useWorkItemsCollection(workspaceId: string | null) {
  const api = window.electronAPI
  let scopes = collections.get(api)
  if (!scopes) { scopes = new Map(); collections.set(api, scopes) }
  let collection = workspaceId ? scopes.get(workspaceId) : undefined
  if (workspaceId && !collection) {
    const cache = scopes
    const prune = () => {
      // Inactive scopes hold no subscriptions. Bound retained projections while
      // keeping pending writes available across view unmount/remount.
      const idle = [...cache].filter(([, value]) => value.idle)
      for (const [id] of idle.slice(0, Math.max(0, idle.length - 8))) cache.delete(id)
    }
    collection = new WorkItemsCollection(api, workspaceId, prune)
    scopes.set(workspaceId, collection)
  }
  const snapshot = useSyncExternalStore(collection?.subscribe ?? emptySubscribe, collection?.getSnapshot ?? emptySnapshot)
  return { ...snapshot, collection }
}
