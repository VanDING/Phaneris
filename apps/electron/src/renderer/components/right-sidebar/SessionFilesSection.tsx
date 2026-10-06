/**
 * SessionFilesSection - Displays files in the session directory as a tree view
 *
 * Features:
 * - Recursive tree view with expandable folders (matches sidebar styling)
 * - File watcher for auto-refresh when files change
 * - Click to preview in-app, double-click to open
 * - Right-click context menu with "Open" / "Show in {file manager}" actions
 * - Persisted expanded folder state per session
 *
 * Row rendering, filtering, and iconography live in `@/lib/session-file-tree`
 * so Files > Browse can reuse them for its multi-root tree.
 */

import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { SessionFile } from '../../../shared/types'
import * as storage from '@/lib/local-storage'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { cn } from '@/lib/utils'
import {
  collectDirectoryPaths,
  FileTreeNode,
  filterFileTree,
  type SessionFilesSectionProps,
} from '@/lib/session-file-tree'
import { restoreSessionFileWatch } from './session-files-watch'

/**
 * Section displaying session files as a tree
 */
export function SessionFilesSection({
  sessionId,
  className,
  fileScope = 'session',
  rootPath,
  sessionFolderPath,
  hideHeader = false,
  filterQuery = '',
}: SessionFilesSectionProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<SessionFile[]>([])
  const expansionStorageKey = `${sessionId ?? 'none'}:${fileScope}:${rootPath ?? 'default'}`

  // Apply the optional filename filter (keeps matching directories' paths open).
  const visibleFiles = useMemo(
    () => filterFileTree(files, filterQuery),
    [files, filterQuery],
  )
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string>()
  const [hasSavedExpandedState, setHasSavedExpandedState] = useState(false)
  const mountedRef = useRef(true)

  // Never leave the previous root visible while a changed work folder loads.
  useEffect(() => {
    setFiles([])
    setLoadError(false)
    setSelectedPath(undefined)
  }, [sessionId, fileScope, rootPath])

  // Load expanded paths from storage when session changes.
  // If no value exists yet, we default to "expand all" after files load.
  useEffect(() => {
    if (sessionId) {
      const raw = storage.getRaw(storage.KEYS.sessionFilesExpandedFolders, expansionStorageKey)
      if (raw !== null) {
        const saved = storage.get<string[]>(storage.KEYS.sessionFilesExpandedFolders, [], expansionStorageKey)
        setExpandedPaths(new Set(saved))
        setHasSavedExpandedState(true)
      } else {
        setExpandedPaths(new Set())
        setHasSavedExpandedState(false)
      }
    } else {
      setExpandedPaths(new Set())
      setHasSavedExpandedState(false)
    }
  }, [sessionId, expansionStorageKey])

  // Save expanded paths to storage when they change
  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    if (sessionId) {
      storage.set(storage.KEYS.sessionFilesExpandedFolders, Array.from(paths), expansionStorageKey)
    }
  }, [sessionId, expansionStorageKey])

  // Load files
  const loadFiles = useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      return
    }

    setIsLoading(true)
    try {
      const sessionFiles = await window.electronAPI.getSessionFiles(sessionId, fileScope)
      if (mountedRef.current) {
        setLoadError(false)
        setFiles(sessionFiles)

        // Session assets are small and start expanded. Work folders can be large,
        // so they start collapsed and expand only on explicit user action.
        if (!hasSavedExpandedState) {
          const initialPaths = fileScope === 'session'
            ? new Set(collectDirectoryPaths(sessionFiles))
            : new Set<string>()
          setExpandedPaths(initialPaths)
          saveExpandedPaths(initialPaths)
          setHasSavedExpandedState(true)
        }
      }
    } catch (error) {
      console.error('Failed to load session files:', error)
      if (mountedRef.current) {
        setLoadError(true)
        setFiles([])
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [sessionId, fileScope, hasSavedExpandedState, saveExpandedPaths])

  // Initial load and file watcher setup
  useEffect(() => {
    mountedRef.current = true
    loadFiles()

    if (sessionId) {
      // Start watching for file changes
      void window.electronAPI.watchSessionFiles(sessionId, fileScope)

      // Listen for file change events
      const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId, changedScope = 'session') => {
        if (changedSessionId === sessionId && changedScope === fileScope && mountedRef.current) {
          void loadFiles()
        }
      })

      const unsubscribeReconnect = window.electronAPI.onReconnected(() => {
        if (!mountedRef.current) return
        void restoreSessionFileWatch(sessionId, loadFiles, fileScope)
      })

      return () => {
        mountedRef.current = false
        unsubscribe()
        unsubscribeReconnect()
        void window.electronAPI.unwatchSessionFiles(fileScope)
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [sessionId, fileScope, rootPath, loadFiles])

  // Use the link interceptor (via context) so file clicks show in-app previews
  // instead of always opening in the file manager / default app.
  const { onOpenFile } = useAppShellContext()
  const fileManagerName = getFileManagerName()

  // Reveal a file/folder in the system file manager
  const handleRevealInFileManager = useCallback((path: string) => {
    window.electronAPI.showInFolder(path)
  }, [])

  // Handle file click — preview in-app if possible, open directory in file manager
  const handleFileClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      // eslint-disable-next-line craft-links/no-direct-file-open -- directories can't be previewed in-app
      window.electronAPI.openFile(file.path)
    } else {
      setSelectedPath(file.path)
      onOpenFile(file.path, sessionId)
    }
  }, [onOpenFile, sessionId])

  // Handle double-click — open in the system default app (distinct from the
  // in-app preview on single click; directories go to the file manager).
  const handleFileDoubleClick = useCallback((file: SessionFile) => {
    // eslint-disable-next-line craft-links/no-direct-file-open -- external open is the intended double-click semantic
    window.electronAPI.openFile(file.path)
  }, [])

  // Toggle folder expanded state
  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      saveExpandedPaths(next)
      return next
    })
  }, [saveExpandedPaths])

  if (!sessionId) {
    return null
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Header - matches sidebar styling with select-none, extra top padding for visual balance */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 select-none">
          <span className="text-xs font-medium text-muted-foreground">{t("chat.sessionFiles")}</span>
          {sessionFolderPath && (
            <button
              type="button"
              onClick={() => window.electronAPI.showInFolder(sessionFolderPath)}
              className="text-xs text-foreground/50 hover:text-foreground/80 hover:underline underline-offset-2 transition-colors"
            >
              {t("chat.viewInFileManager", { fileManager: fileManagerName })}
            </button>
          )}
        </div>
      )}

      {/* File tree - px-2 is on nav to match LeftSidebar exactly (constrains grid width) */}
      {/* overflow-x-hidden prevents horizontal scroll, forcing truncation */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
        {loadError ? (
          <div className="px-4 text-destructive select-none">
            <p className="text-xs">{t('chat.sessionFilesError')}</p>
          </div>
        ) : files.length === 0 ? (
          isLoading ? (
            <div className="grid gap-1 px-2 pt-1" aria-label={t('chat.sessionFilesLoading')}>
              {[72, 56, 84, 64, 76].map((width, index) => (
                <div key={width} className="flex h-8 animate-pulse items-center gap-2 rounded-lg px-2" style={{ paddingLeft: 8 + (index % 3) * 12 }}>
                  <span className="h-3.5 w-3.5 rounded bg-foreground/[0.07]" />
                  <span className="h-2.5 rounded-full bg-foreground/[0.07]" style={{ width: `${width}%` }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-center text-muted-foreground select-none">
              <p className="text-xs">{t('chat.sessionFilesEmpty')}</p>
            </div>
          )
        ) : visibleFiles.length === 0 ? (
          <div className="px-4 text-muted-foreground select-none">
            <p className="text-xs">{t('contentPanel.files.noFilterMatches')}</p>
          </div>
        ) : (
          /* Root nav has px-2 to match LeftSidebar exactly - this constrains grid width */
          <nav className="grid gap-0.5 px-2">
            {visibleFiles.map((file) => (
              <FileTreeNode
                key={file.path}
                file={file}
                depth={0}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onRevealInFileManager={handleRevealInFileManager}
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
