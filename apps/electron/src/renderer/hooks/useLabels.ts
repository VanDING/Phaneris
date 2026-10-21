/**
 * useLabels Hook
 *
 * React hook to load and manage workspace labels.
 * Returns the label tree (nested structure with children) from config.
 * Also exposes a flattened version for components that need flat lookups.
 * Auto-refreshes when workspace changes or label config changes.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { readAfterReconnect } from '@/lib/read-after-reconnect'
import type { LabelConfig } from '@phaneris/shared/labels'
import { flattenLabels } from '@phaneris/shared/labels'

export interface UseLabelsResult {
  /** Label tree (root-level nodes with nested children) */
  labels: LabelConfig[]
  /** Flattened label list for lookups and non-hierarchical display */
  flatLabels: LabelConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Load labels for a workspace via IPC.
 * Returns the tree structure (labels with nested children).
 * Auto-refreshes when workspaceId changes.
 * Subscribes to live label config changes via LABELS_CHANGED event.
 */
export function useLabels(workspaceId: string | null): UseLabelsResult {
  const [labels, setLabels] = useState<LabelConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  // Memoized flat version of the tree for lookups
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  const refresh = useCallback(async () => {
    const request = ++generation.current
    if (!workspaceId) {
      setLabels([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await readAfterReconnect(() => window.electronAPI.listLabels(workspaceId))
      if (request !== generation.current) return
      setLabels(configs)
      setError(null)
    } catch (err) {
      if (request !== generation.current) return
      console.error('[useLabels] Failed to load labels:', err)
      setError(err instanceof Error ? err.message : 'Failed to load labels')
    } finally {
      if (request === generation.current) setIsLoading(false)
    }
  }, [workspaceId])

  // Load labels when workspace changes
  useEffect(() => {
    void refresh()
    return () => { generation.current = generation.current + 1 }
  }, [refresh])

  // Subscribe to live label changes (config file changes)
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onLabelsChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace
      if (changedWorkspaceId === workspaceId) {
        refresh()
      }
    })

    return cleanup
  }, [workspaceId, refresh])

  return {
    labels,
    flatLabels,
    isLoading,
    error,
    refresh,
  }
}
