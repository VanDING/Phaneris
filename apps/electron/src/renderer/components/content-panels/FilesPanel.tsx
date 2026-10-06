/**
 * Files panel — the session's file workbench.
 *
 * Three views, one job each:
 * - Browse: find and open a file (working directory + this session's folder)
 * - Artifacts: review and accept what the agent produced
 * - Changed: see exactly what this session modified
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { FolderTree, Search } from 'lucide-react'
import { Spinner } from '@phaneris/ui'
import type { StoredAttachment } from '../../../shared/types'
import { Input } from '@/components/ui/input'
import { PanelEmptyState } from './PanelEmptyState'
import { ChangedFilesView } from './ChangedFilesView'
import { BrowseTree } from './BrowseTree'
import { ArtifactsPanel } from './ArtifactsPanel'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { filesPanelFocusRequestAtom, filesPanelViewAtom, type FilesPanelView } from '@/atoms/content-panel-ui'
import { useSessionActivities } from '@/lib/use-session-activities'
import { collectFileChangesFromActivities } from '@/lib/file-changes'
import { useAppShellContext } from '@/context/AppShellContext'

const FILE_VIEWS: ReadonlyArray<{ id: FilesPanelView; key: string }> = [
  { id: 'browse', key: 'contentPanel.files.view.browse' },
  { id: 'artifacts', key: 'contentPanel.files.view.artifacts' },
  { id: 'changed', key: 'contentPanel.files.view.changed' },
]

export function FilesPanel({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation()
  const currentActiveSessionId = useAtomValue(activeSessionIdAtom)
  const activeSessionId = sessionId ?? currentActiveSessionId
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const session = useAtomValue(sessionAtomFamily(activeSessionId ?? 'missing'))
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const [view, setView] = useAtom(filesPanelViewAtom)
  const [query, setQuery] = useState('')
  const [loadError, setLoadError] = useState(false)
  const { onOpenFile, workspaces } = useAppShellContext()
  const focusRequest = useAtomValue(filesPanelFocusRequestAtom)
  const setFilesFocusRequest = useSetAtom(filesPanelFocusRequestAtom)

  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const workingDirectory = meta?.workingDirectory
  const messagesLoaded = activeSessionId ? loadedSessions.has(activeSessionId) : false
  // Browse reads its pinned attachments straight from the transcript, and
  // Changed derives its diffs from tool activities — both need the messages.
  // A restored session starts with an empty message list, so ask for them
  // rather than rendering an attachment-less tree until something else loads.
  const needsMessages = view === 'changed' || (view === 'browse' && (session?.messages?.length ?? 0) === 0)
  const activities = useSessionActivities(session)
  const changes = useMemo(() => collectFileChangesFromActivities(activities), [activities])
  const attachments = useMemo(() => {
    const seen = new Set<string>()
    return (session?.messages ?? []).flatMap(message => message.attachments ?? []).filter(attachment => {
      if (seen.has(attachment.id)) return false
      seen.add(attachment.id)
      return true
    })
  }, [session]) as StoredAttachment[]

  useEffect(() => {
    if (focusRequest?.sessionId !== activeSessionId) return
    if (focusRequest.view && focusRequest.view !== view) setView(focusRequest.view)
    if (!focusRequest.changeId) setFilesFocusRequest(null)
  }, [activeSessionId, focusRequest, setFilesFocusRequest, setView, view])

  useEffect(() => {
    if (!activeSessionId || !needsMessages) return
    let cancelled = false
    setLoadError(false)
    void ensureMessagesLoaded(activeSessionId).catch(() => {
      if (!cancelled) setLoadError(true)
    })
    return () => { cancelled = true }
  }, [activeSessionId, ensureMessagesLoaded, needsMessages])

  if (!activeSessionId) {
    return <PanelEmptyState title={t('contentPanel.noActiveSession')} icon={<FolderTree className="h-6 w-6" />} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col @container/files">
      <div className="flex h-10 shrink-0 items-end gap-5 overflow-x-auto border-b border-border/50 bg-background/80 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={t('contentPanel.files.views')}>
        {FILE_VIEWS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={`relative h-10 shrink-0 px-0.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.id ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t after:bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t(item.key)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {needsMessages && !messagesLoaded && !loadError && (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        )}
        {needsMessages && loadError && (
          <PanelEmptyState title={t('errors.failedToLoadSession')} hint={t('errors.pleaseReload')} />
        )}

        {view === 'browse' && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-border/50 bg-background/60 px-2.5 pb-2.5 pt-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('contentPanel.files.filterPlaceholder')}
                  className="h-8 rounded-lg border-border/60 bg-foreground/[0.02] pl-8 text-[13px] shadow-none focus-visible:bg-background"
                  aria-label={t('contentPanel.files.filterPlaceholder')}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-foreground/[0.012] pt-1">
              <BrowseTree
                sessionId={activeSessionId}
                workingDirectory={workingDirectory}
                attachments={attachments}
                filterQuery={query}
                onOpenFile={(path) => onOpenFile(path, activeSessionId)}
              />
            </div>
          </div>
        )}

        {view === 'artifacts' && <ArtifactsPanel sessionId={activeSessionId} />}

        {view === 'changed' && messagesLoaded && <ChangedFilesView sessionId={activeSessionId} changes={changes} />}
      </div>
    </div>
  )
}
