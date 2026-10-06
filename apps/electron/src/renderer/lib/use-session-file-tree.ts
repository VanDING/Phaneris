/**
 * Hooks behind Files > Browse.
 *
 * Browse shows several roots of one tree, so the loading/watching logic lives
 * here instead of inside a single-root section component. Both roots share the
 * same storage layout the sidebar already uses for expanded folders
 * (`session-files-expanded`, suffixed per session + root).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionFile, SessionFileScope } from '../../shared/types'
import * as storage from './local-storage'
import { collectDirectoryPaths } from './session-file-tree'
import { restoreSessionFileWatch } from '@/components/right-sidebar/session-files-watch'

export interface SessionFileTreeState {
  files: SessionFile[]
  isLoading: boolean
  loadError: boolean
}

/** Load and watch one file scope of a session (working directory / session folder). */
export function useSessionFileTree(
  sessionId: string | undefined,
  scope: SessionFileScope,
): SessionFileTreeState {
  const [files, setFiles] = useState<SessionFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const mountedRef = useRef(true)

  // Never leave the previous root visible while a changed scope loads.
  useEffect(() => {
    setFiles([])
    setLoadError(false)
  }, [sessionId, scope])

  const loadFiles = useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      return
    }
    setIsLoading(true)
    try {
      const next = await window.electronAPI.getSessionFiles(sessionId, scope)
      if (!mountedRef.current) return
      setLoadError(false)
      setFiles(next)
    } catch (error) {
      console.error(`Failed to load ${scope} files:`, error)
      if (!mountedRef.current) return
      setLoadError(true)
      setFiles([])
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [scope, sessionId])

  useEffect(() => {
    mountedRef.current = true
    void loadFiles()
    if (!sessionId) {
      return () => { mountedRef.current = false }
    }

    void window.electronAPI.watchSessionFiles(sessionId, scope)
    const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId, changedScope = 'session') => {
      if (changedSessionId === sessionId && changedScope === scope && mountedRef.current) {
        void loadFiles()
      }
    })
    const unsubscribeReconnect = window.electronAPI.onReconnected(() => {
      if (!mountedRef.current) return
      void restoreSessionFileWatch(sessionId, loadFiles, scope)
    })

    return () => {
      mountedRef.current = false
      unsubscribe()
      unsubscribeReconnect()
      void window.electronAPI.unwatchSessionFiles(scope)
    }
  }, [loadFiles, scope, sessionId])

  return { files, isLoading, loadError }
}

/**
 * Expanded folder paths for one tree root, persisted per session + root.
 *
 * The first visit seeds the expansion: a work folder opens at its root only
 * (children stay collapsed — the tree can be enormous), while a session folder
 * opens its structure too.
 */
export function useFileTreeExpansion(
  sessionId: string | undefined,
  rootKey: 'working' | 'session',
  files: SessionFile[],
): {
  expandedPaths: Set<string>
  toggleExpand: (path: string) => void
} {
  const storageKey = `${sessionId ?? 'none'}:browse:${rootKey}`
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  // Whether the current (session, root) pair has a persisted or seeded value.
  const initializedRef = useRef(false)

  // Reload expansion whenever the session or root changes.
  useEffect(() => {
    const raw = sessionId ? storage.getRaw(storage.KEYS.sessionFilesExpandedFolders, storageKey) : null
    if (raw === null) {
      initializedRef.current = false
      setExpandedPaths(new Set())
      return
    }
    initializedRef.current = true
    setExpandedPaths(new Set(storage.get<string[]>(storage.KEYS.sessionFilesExpandedFolders, [], storageKey)))
  }, [rootKey, sessionId, storageKey])

  // First visit only, once the tree has loaded: seed the default expansion.
  useEffect(() => {
    if (!sessionId || initializedRef.current || files.length === 0) return
    const seeded = rootKey === 'working'
      ? [rootKey]
      : [rootKey, ...collectDirectoryPaths(files)]
    initializedRef.current = true
    setExpandedPaths(new Set(seeded))
    storage.set(storage.KEYS.sessionFilesExpandedFolders, seeded, storageKey)
  }, [files, rootKey, sessionId, storageKey])

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      if (sessionId) {
        storage.set(storage.KEYS.sessionFilesExpandedFolders, Array.from(next), storageKey)
      }
      return next
    })
  }, [sessionId, storageKey])

  return { expandedPaths, toggleExpand }
}
