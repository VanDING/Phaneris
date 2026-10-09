/**
 * TrajectoryPanel — trajectory ledger bound to the active session.
 *
 * Builds a trajectory snapshot from the session's enriched messages
 * (timestamp / usage / requestSeq / promptSnapshot / parentToolUseId /
 * compaction added by the Pi event pipeline) and renders the trajectory view.
 * Empty states cover no-active-session and no-messages; while messages are
 * still loading a placeholder is shown so "no records" is never a false
 * positive.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Activity } from 'lucide-react'
import { TrajectoryView, buildTrajectorySnapshot, EMPTY_TRAJECTORY_SNAPSHOT, Spinner, type TrajectorySessionMap } from '@phaneris/ui'
import { useSessionDecisions } from '@/hooks/useSessionDecisions'
import { DecisionSummary, SessionDecisions } from './SessionDecisions'
import { openDecisionModelSettings } from '@/lib/ai-settings-navigation'
import { PanelEmptyState } from './PanelEmptyState'
import { activeSessionIdAtom } from '@/atoms/active-session'
import { sessionAtomFamily, sessionMetaMapAtom, ensureSessionMessagesLoadedAtom } from '@/atoms/sessions'
import { chatFocusRequestAtom, filesPanelFocusRequestAtom, updateWorkbenchFocusAtom, workbenchFocusBySessionAtom } from '@/atoms/content-panel-ui'
import { collapseWorkbenchAtom, openWorkbenchItemAtom, setWorkbenchItemBindingAtom } from '@/atoms/workbench'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useLabels } from '@/hooks/useLabels'
import { findLabelById } from '@phaneris/shared/labels'
import { contextBadgeUsage } from '@/lib/context-usage'

export function TrajectoryPanel({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation()
  const currentActiveSessionId = useAtomValue(activeSessionIdAtom)
  const activeSessionId = sessionId ?? currentActiveSessionId
  const session = useAtomValue(sessionAtomFamily(activeSessionId ?? 'missing'))
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const setChatFocusRequest = useSetAtom(chatFocusRequestAtom)
  const setFilesFocusRequest = useSetAtom(filesPanelFocusRequestAtom)
  const focusBySession = useAtomValue(workbenchFocusBySessionAtom)
  const updateWorkbenchFocus = useSetAtom(updateWorkbenchFocusAtom)
  const openWorkbenchItem = useSetAtom(openWorkbenchItemAtom)
  const setWorkbenchItemBinding = useSetAtom(setWorkbenchItemBindingAtom)
  const collapseWorkbench = useSetAtom(collapseWorkbenchAtom)
  const { activeWorkspaceId, workspaces, onOpenFile } = useAppShellContext()
  const { navigateToSession } = useNavigation()
  const { labels: labelConfigs } = useLabels(activeWorkspaceId)

  const [messagesLoading, setMessagesLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!activeSessionId) {
      setMessagesLoading(false)
      setLoadError(false)
      return
    }
    let cancelled = false
    setMessagesLoading(true)
    setLoadError(false)
    void ensureMessagesLoaded(activeSessionId)
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeSessionId, ensureMessagesLoaded])

  const snapshot = useMemo(() => {
    if (!session) return EMPTY_TRAJECTORY_SNAPSHOT
    return buildTrajectorySnapshot({
      messages: session.messages,
      isProcessing: session.isProcessing,
      tokenUsage: session.tokenUsage,
      lastFullUsage: session.lastFullUsage,
    })
  }, [session])
  const meta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const workspace = workspaces.find(candidate => candidate.id === activeWorkspaceId)
  const decisionWorkspaceId = session?.workspaceId ?? meta?.workspaceId ?? workspace?.remoteServer?.remoteWorkspaceId ?? activeWorkspaceId ?? undefined
  const decisionServerScope = JSON.stringify([activeWorkspaceId, workspace?.remoteServer])
  const decisions = useSessionDecisions(activeSessionId ?? undefined, decisionWorkspaceId, {}, true, decisionServerScope)
  const labelNames = useMemo(() => (
    meta?.labels?.map((id) => findLabelById(labelConfigs, id)?.name ?? id) ?? []
  ), [labelConfigs, meta?.labels])
  const sessionMap = useMemo<TrajectorySessionMap | undefined>(() => {
    if (!activeSessionId || !session) return undefined
    const summaries = [...sessionMetaMap.values()]
      .filter(candidate => candidate.workspaceId === session.workspaceId)
      .map(candidate => ({
        id: candidate.id,
        title: candidate.name?.trim() || candidate.preview?.trim() || t('menu.newChat'),
        preview: candidate.preview,
        status: candidate.sessionStatus,
        isProcessing: candidate.isProcessing,
        parentSessionId: candidate.parentSessionId,
        branchFromSessionId: candidate.branchFromSessionId,
        branchFromMessageId: candidate.branchFromMessageId,
        messageCount: candidate.messageCount,
        createdAt: candidate.createdAt,
      }))
    if (!summaries.some(candidate => candidate.id === activeSessionId)) {
      summaries.push({
        id: activeSessionId,
        title: session.name?.trim() || session.preview?.trim() || t('menu.newChat'),
        preview: session.preview,
        status: session.sessionStatus,
        isProcessing: session.isProcessing,
        parentSessionId: session.parentSessionId,
        branchFromSessionId: session.branchFromSessionId,
        branchFromMessageId: session.branchFromMessageId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
      })
    }
    return { currentSessionId: activeSessionId, sessions: summaries }
  }, [activeSessionId, session, sessionMetaMap, t])

  if (!activeSessionId) {
    return (
      <div className="flex h-full flex-col">
        <PanelEmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('contentPanel.trajectory.noSession')}
          hint={t('contentPanel.trajectory.noSessionHint')}
        />
      </div>
    )
  }

  const trajectoryState = messagesLoading ? <div className="flex flex-1 items-center justify-center"><Spinner /></div>
    : loadError ? <PanelEmptyState icon={<Activity className="h-8 w-8" />} title={t('errors.failedToLoadSession')} hint={t('errors.pleaseReload')} />
      : snapshot.contributions.length === 0 ? <PanelEmptyState icon={<Activity className="h-8 w-8" />} title={t('contentPanel.trajectory.noRecords')} hint={t('contentPanel.trajectory.noRecordsHint')} /> : undefined

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 bg-background">
        <div className="h-full min-h-0 overflow-hidden bg-background">
          <TrajectoryView
            key={`${decisionServerScope}:${decisionWorkspaceId}:${activeSessionId}`}
            snapshot={snapshot}
            trajectoryState={trajectoryState}
            decisionSummary={onOpen => <DecisionSummary data={decisions} onOpen={onOpen} />}
            decisions={<SessionDecisions sessionId={activeSessionId} workspaceId={decisionWorkspaceId} serverScope={decisionServerScope} data={decisions}
              onConfigure={openDecisionModelSettings} onOpenChat={messageId => {
                navigateToSession(activeSessionId)
                setChatFocusRequest({ sessionId: activeSessionId, messageId, nonce: Date.now() })
                collapseWorkbench()
              }} />}
            sessionTotal={snapshot.totalUsage}
            isProcessing={session?.isProcessing}
            contextSummary={{
              name: meta?.name,
              status: meta?.isProcessing ? t('contentPanel.context.status.processing') : meta?.sessionStatus,
              model: meta?.model,
              permissionMode: meta?.permissionMode,
              workingDirectory: meta?.workingDirectory,
              labels: labelNames,
              messageCount: meta?.messageCount,
              createdAt: meta?.createdAt,
              lastActivityAt: meta?.lastMessageAt,
              inputTokens: meta?.tokenUsage?.inputTokens,
              outputTokens: meta?.tokenUsage?.outputTokens,
              totalTokens: meta?.tokenUsage?.totalTokens,
              contextTokens: contextBadgeUsage(meta?.tokenUsage).inputTokens,
              costUsd: meta?.tokenUsage?.costUsd,
              unknownCostRequests: meta?.tokenUsage?.unknownCostRequests,
              estimatedCostRequests: meta?.tokenUsage?.estimatedCostRequests,
            }}
            sessionMap={sessionMap}
            focus={focusBySession[activeSessionId]}
            onFocusChange={(focus) => updateWorkbenchFocus({
              ...focus,
              sessionId: activeSessionId,
            })}
            onOpenChat={(messageId) => {
              navigateToSession(activeSessionId)
              setChatFocusRequest({ sessionId: activeSessionId, messageId, nonce: Date.now() })
              collapseWorkbench()
            }}
            onOpenReview={(changeId) => {
              setFilesFocusRequest({ sessionId: activeSessionId, view: 'changed', changeId, nonce: Date.now() })
              const filesItemId = openWorkbenchItem('files')
              if (filesItemId) {
                setWorkbenchItemBinding({
                  id: filesItemId,
                  binding: { type: 'session', sessionId: activeSessionId },
                })
              }
            }}
            onOpenFile={(path) => onOpenFile?.(path, activeSessionId)}
            onOpenSession={(targetSessionId) => navigateToSession(targetSessionId)}
          />
        </div>
      </div>
    </div>
  )
}
