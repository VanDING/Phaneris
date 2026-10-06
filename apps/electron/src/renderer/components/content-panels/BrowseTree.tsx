/**
 * BrowseTree - Files > Browse.
 *
 * One tree with two collapsible roots:
 * - the session's working directory (real folder structure)
 * - this session's folder, with the message attachments pinned on top
 *
 * Attachments are ordinary files inside the session's `attachments/` folder, so
 * each real attachment is listed exactly once: the pinned rows are the human
 * names from the transcript, and their files are dropped from the scanned tree.
 * Thumbnails and markdown conversions that live next to them stay out of the
 * pinned list by construction.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MessageSquare, Paperclip } from 'lucide-react'
import type { StoredAttachment } from '../../../shared/types'
import {
  FileTreeNode,
  filterFileTree,
  normalizeTreePath,
  omitFileTreePaths,
  type SessionFile,
} from '@/lib/session-file-tree'
import { useFileTreeExpansion, useSessionFileTree } from '@/lib/use-session-file-tree'
import { getPathBasename } from '@/lib/platform'

const TREE_ICON_CLASS = 'h-3.5 w-3.5 text-muted-foreground'

function TreeSpinner() {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-[12px] text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    </div>
  )
}

function TreeMessage({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-2 text-[12px] text-muted-foreground">{children}</div>
}

export interface BrowseTreeProps {
  sessionId: string
  workingDirectory?: string
  attachments: readonly StoredAttachment[]
  filterQuery: string
  onOpenFile: (path: string) => void
}

export function BrowseTree({
  sessionId,
  workingDirectory,
  attachments,
  filterQuery,
  onOpenFile,
}: BrowseTreeProps) {
  const { t } = useTranslation()
  const working = useSessionFileTree(sessionId, 'working')
  const session = useSessionFileTree(sessionId, 'session')
  const [selectedPath, setSelectedPath] = useState<string>()

  const workingExpansion = useFileTreeExpansion(sessionId, 'working', working.files)
  const sessionExpansion = useFileTreeExpansion(sessionId, 'session', session.files)

  // Attachments are shown as pinned rows; drop their files from the scanned
  // session tree so nothing is listed twice.
  const pinnedPaths = useMemo(
    () => new Set(attachments.map((attachment) => normalizeTreePath(attachment.storedPath))),
    [attachments],
  )

  const matchingAttachments = useMemo(() => {
    const needle = filterQuery.trim().toLowerCase()
    if (!needle) return attachments
    return attachments.filter((attachment) => attachment.name.toLowerCase().includes(needle))
  }, [attachments, filterQuery])

  const visibleWorking = useMemo(
    () => filterFileTree(working.files, filterQuery),
    [filterQuery, working.files],
  )
  const visibleSession = useMemo(
    () => omitFileTreePaths(filterFileTree(session.files, filterQuery), pinnedPaths),
    [filterQuery, pinnedPaths, session.files],
  )

  const handleFileClick = useCallback((file: SessionFile) => {
    setSelectedPath(file.path)
    onOpenFile(file.path)
  }, [onOpenFile])

  // Double-click keeps the section's semantics: hand a file to the system
  // default app instead of the in-app preview.
  const openExternal = useCallback((path: string) => {
    // eslint-disable-next-line craft-links/no-direct-file-open -- external open is the intended double-click semantic
    window.electronAPI.openFile(path)
  }, [])

  const revealInFileManager = useCallback((path: string) => {
    window.electronAPI.showInFolder(path)
  }, [])

  // Root nodes are synthetic rows over the two real roots.
  const workingRoot: SessionFile = useMemo(() => ({
    name: getPathBasename(workingDirectory ?? '') || workingDirectory || '',
    path: 'working',
    type: 'directory',
    children: visibleWorking,
  }), [visibleWorking, workingDirectory])

  const sessionRoot: SessionFile = useMemo(() => ({
    name: t('contentPanel.files.browse.session'),
    path: 'session',
    type: 'directory',
    children: [
      ...matchingAttachments.map((attachment): SessionFile => ({
        name: attachment.name,
        path: attachment.storedPath,
        type: 'file',
        size: attachment.size,
      })),
      ...visibleSession,
    ],
  }), [matchingAttachments, t, visibleSession])

  const showWorkingGroup = Boolean(workingDirectory) && (filterQuery.trim() === '' || visibleWorking.length > 0)
  const showSessionGroup = filterQuery.trim() === '' || visibleSession.length > 0 || matchingAttachments.length > 0

  return (
    <nav className="grid gap-0.5 px-2" aria-label={t('contentPanel.files.views')}>
      {showWorkingGroup && (
        <FileTreeNode
          file={workingRoot}
          depth={0}
          isRoot
          selectedPath={selectedPath}
          expandedPaths={workingExpansion.expandedPaths}
          onToggleExpand={workingExpansion.toggleExpand}
          onFileClick={handleFileClick}
          onFileDoubleClick={(file) => openExternal(file.path)}
          onRevealInFileManager={revealInFileManager}
        />
      )}
      {showWorkingGroup && working.isLoading && working.files.length === 0 && <TreeSpinner />}
      {showWorkingGroup && working.loadError && <TreeMessage>{t('chat.sessionFilesError')}</TreeMessage>}
      {showWorkingGroup && !working.isLoading && !working.loadError && visibleWorking.length === 0 && filterQuery.trim() === '' && (
        <TreeMessage>{t('chat.sessionFilesEmpty')}</TreeMessage>
      )}

      {showSessionGroup && (
        <FileTreeNode
          file={sessionRoot}
          depth={0}
          isRoot
          icon={<MessageSquare className={TREE_ICON_CLASS} />}
          selectedPath={selectedPath}
          expandedPaths={sessionExpansion.expandedPaths}
          onToggleExpand={sessionExpansion.toggleExpand}
          onFileClick={handleFileClick}
          onFileDoubleClick={(file) => openExternal(file.path)}
          onRevealInFileManager={revealInFileManager}
          iconForPath={(path) => (pinnedPaths.has(normalizeTreePath(path))
            ? <Paperclip className={TREE_ICON_CLASS} />
            : null)}
        />
      )}
      {showSessionGroup && session.isLoading && session.files.length === 0 && <TreeSpinner />}
      {showSessionGroup && session.loadError && <TreeMessage>{t('chat.sessionFilesError')}</TreeMessage>}
    </nav>
  )
}
