import { useCallback } from 'react'
import type { CreateWorkItemInput, UpdateWorkItemInput, WorkItem } from '@phaneris/shared/work-items/browser'
import { useWorkItemsCollection } from './work-items-collection'

export interface UseWorkItemsResult {
  items: WorkItem[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (input: CreateWorkItemInput) => Promise<WorkItem | null>
  update: (itemId: string, patch: UpdateWorkItemInput) => Promise<WorkItem | null>
  remove: (itemId: string) => Promise<void>
}

/** All planning consumers in this window share one workspace projection. */
export function useWorkItems(workspaceId: string | null): UseWorkItemsResult {
  const { collection, ...snapshot } = useWorkItemsCollection(workspaceId)
  const refresh = useCallback(async () => { await collection?.refresh() }, [collection])
  const create = useCallback(async (input: CreateWorkItemInput) => {
    try { return await collection?.create(input) ?? null }
    catch (cause) { console.error('[useWorkItems] Failed to create work item:', cause); return null }
  }, [collection])
  const update = useCallback(async (id: string, patch: UpdateWorkItemInput) => {
    try { return await collection?.update(id, patch) ?? null }
    catch (cause) { console.error('[useWorkItems] Failed to update work item:', cause); return null }
  }, [collection])
  const remove = useCallback(async (id: string) => {
    try { await collection?.remove(id) }
    catch (cause) { console.error('[useWorkItems] Failed to delete work item:', cause) }
  }, [collection])
  return { ...snapshot, refresh, create, update, remove }
}
