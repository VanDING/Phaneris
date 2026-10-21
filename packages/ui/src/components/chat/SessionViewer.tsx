/**
 * SessionViewer - Read-only session transcript viewer
 *
 * Platform-agnostic component for viewing session transcripts.
 * Used by the web viewer app. For interactive chat, Electron uses ChatDisplay.
 *
 * Renders a session's messages as turn cards with gradient fade at top/bottom.
 */

import type { ReactNode } from 'react'
import { memo, useMemo, useRef, useState, useCallback } from 'react'
import type { StoredSession } from '@phaneris/core'
import { cn } from '../../lib/utils'
import { CHAT_LAYOUT, CHAT_CLASSES } from '../../lib/layout'
import { PlatformProvider, type PlatformActions } from '../../context'
import { TurnCard } from './TurnCard'
import { UserMessageBubble } from './UserMessageBubble'
import { SystemMessage } from './SystemMessage'
import {
  groupMessagesByTurn,
  storedToMessage,
  getAssistantTurnUiKey,
  reuseStableTurns,
  type ActivityItem,
  type AssistantTurn,
  type Turn,
} from './turn-utils'

export type SessionViewerMode = 'interactive' | 'readonly'

export interface SessionViewerProps {
  /** Session data to display */
  session: StoredSession
  /** View mode - 'readonly' for web viewer, 'interactive' for Electron */
  mode?: SessionViewerMode
  /** Platform-specific actions (file opening, URL handling, etc.) */
  platformActions?: PlatformActions
  /** Additional className for the container */
  className?: string
  /** Callback when a turn is clicked */
  onTurnClick?: (turnId: string) => void
  /** Callback when an activity is clicked */
  onActivityClick?: (activity: ActivityItem) => void
  /** Default expanded state for turns (true for readonly, false for interactive) */
  defaultExpanded?: boolean
  /** Custom header content */
  header?: ReactNode
  /** Custom footer content (input area for interactive mode) */
  footer?: ReactNode
  /** Optional session folder path for stripping from file paths in tool display */
  sessionFolderPath?: string
}

/**
 * PhanerisLogo - Monochrome Phaneris mark from the canonical icon artwork
 */
function PhanerisLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1000 1000"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="currentColor">
        <polygon points="180,270 500,90 500,270 330,365" />
        <polygon points="180,270 330,365 330,790 180,875" />
        <polygon points="500,90 760,235 610,320 500,270" />
        <polygon points="610,320 760,235 760,510 610,595" />
        <polygon points="380,555 610,425 610,595 380,725" />
      </g>
    </svg>
  )
}

/**
 * Stable empty actions object.
 *
 * `platformActions = {}` in the destructuring default would allocate a new
 * object on every render, which defeats the memo boundary below and re-renders
 * every turn card on every append.
 */
const EMPTY_PLATFORM_ACTIONS: PlatformActions = {}

/**
 * One memoised turn row.
 *
 * The viewer re-renders whenever `session.messages` changes (an append, a
 * reload). Without this boundary every `TurnCard` rebuilt its whole subtree —
 * the measured 66–300ms append cost in `long-session-budget`. All props here are
 * either data (`turn`, `expandedActivityGroups`) or stable callbacks, so an
 * unchanged turn bails out of rendering; only the appended row is new.
 */
interface ViewerTurnCardProps {
  turn: AssistantTurn
  turnKey: string
  isExpanded: boolean
  expandedActivityGroups: Set<string>
  platformActions: PlatformActions
  sessionId: string
  sessionFolderPath?: string
  annotationInteractionMode: 'interactive' | 'tooltip-only'
  onToggleExpanded: (turnKey: string, expanded: boolean) => void
  onOpenTurnDetails: (turnId: string) => void
  onOpenActivityDetails: (activity: ActivityItem) => void
  onExpandedActivityGroupsChange: (groups: Set<string>) => void
  onOpenMultiFileDiff?: (sessionId: string, turnId: string) => void
}

const ViewerTurnCard = memo(function ViewerTurnCard({
  turn,
  turnKey,
  isExpanded,
  expandedActivityGroups,
  platformActions,
  sessionId,
  sessionFolderPath,
  annotationInteractionMode,
  onToggleExpanded,
  onOpenTurnDetails,
  onOpenActivityDetails,
  onExpandedActivityGroupsChange,
  onOpenMultiFileDiff,
}: ViewerTurnCardProps) {
  const handleExpandedChange = useCallback(
    (expanded: boolean) => onToggleExpanded(turnKey, expanded),
    [onToggleExpanded, turnKey],
  )
  const handleOpenDetails = useCallback(() => onOpenTurnDetails(turn.turnId), [onOpenTurnDetails, turn.turnId])
  const handleOpenMultiFileDiff = useMemo(
    () => (onOpenMultiFileDiff ? () => onOpenMultiFileDiff(sessionId, turn.turnId) : undefined),
    [onOpenMultiFileDiff, sessionId, turn.turnId],
  )

  return (
    <TurnCard
      turnId={turn.turnId}
      activities={turn.activities}
      response={turn.response}
      intent={turn.intent}
      isStreaming={turn.isStreaming}
      isComplete={turn.isComplete}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      onOpenFile={platformActions.onOpenFile}
      onOpenUrl={platformActions.onOpenUrl}
      onPopOut={platformActions.onOpenMarkdownPreview}
      onOpenDetails={handleOpenDetails}
      onOpenActivityDetails={onOpenActivityDetails}
      todos={turn.todos}
      expandedActivityGroups={expandedActivityGroups}
      onExpandedActivityGroupsChange={onExpandedActivityGroupsChange}
      hasEditOrWriteActivities={turn.activities.some(a => a.toolName === 'Edit' || a.toolName === 'Write')}
      onOpenMultiFileDiff={handleOpenMultiFileDiff}
      sessionFolderPath={sessionFolderPath}
      annotationInteractionMode={annotationInteractionMode}
    />
  )
})

/**
 * SessionViewer - Read-only session transcript viewer component
 */
export function SessionViewer({
  session,
  mode = 'readonly',
  platformActions = EMPTY_PLATFORM_ACTIONS,
  className,
  onTurnClick,
  onActivityClick,
  defaultExpanded = false,
  header,
  footer,
  sessionFolderPath,
}: SessionViewerProps) {
  // Convert StoredMessage[] to Message[] and group into turns.
  // Viewer is always a snapshot of a finished session, so we mark it as not processing
  // to force the open turn (if any) to flush with the intermediate-text fallback applied.
  //
  // `reuseStableTurns` keeps the previous object for every completed turn whose
  // signature did not move, so an append leaves earlier `ViewerTurnCard`s with
  // identical props and their memo boundary skips them.
  const previousTurnsRef = useRef<Turn[] | undefined>(undefined)
  const turns = useMemo(() => {
    const grouped = groupMessagesByTurn(session.messages.map(storedToMessage), { isSessionProcessing: false })
    const stable = reuseStableTurns(previousTurnsRef.current, grouped)
    previousTurnsRef.current = stable
    return stable
  }, [session.messages])

  // Track expanded turns (for controlled state)
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => {
    // Default: all turns collapsed, can override with defaultExpanded prop
    if (defaultExpanded) {
      return new Set(
        turns
          .map((turn, index) => turn.type === 'assistant' ? getAssistantTurnUiKey(turn, index) : null)
          .filter((key): key is string => !!key)
      )
    }
    return new Set()
  })

  // Track expanded activity groups
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(new Set())

  const handleExpandedChange = useCallback((turnId: string, expanded: boolean) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (expanded) {
        next.add(turnId)
      } else {
        next.delete(turnId)
      }
      return next
    })
  }, [])

  const handleExpandedActivityGroupsChange = useCallback((groups: Set<string>) => {
    setExpandedActivityGroups(groups)
  }, [])

  const handleOpenActivityDetails = useCallback((activity: ActivityItem) => {
    if (onActivityClick) {
      onActivityClick(activity)
    } else if (platformActions.onOpenActivityDetails) {
      platformActions.onOpenActivityDetails(session.id, activity.id)
    }
  }, [onActivityClick, platformActions, session.id])

  const handleOpenTurnDetails = useCallback((turnId: string) => {
    if (onTurnClick) {
      onTurnClick(turnId)
    } else if (platformActions.onOpenTurnDetails) {
      platformActions.onOpenTurnDetails(session.id, turnId)
    }
  }, [onTurnClick, platformActions, session.id])

  const handleOpenMultiFileDiff = useCallback((sessionId: string, turnId: string) => {
    platformActions.onOpenMultiFileDiff?.(sessionId, turnId)
  }, [platformActions])

  return (
    <PlatformProvider actions={platformActions}>
      <div className={cn("flex flex-col h-full", className)}>
        {/* Header */}
        {header && (
          <div className="shrink-0 border-b">
            {header}
          </div>
        )}

        {/* Messages area with gradient fade mask at top/bottom */}
        <div
          className="flex-1 min-h-0"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
          }}
        >
          <div className="h-full overflow-y-auto">
            <div className={cn(CHAT_LAYOUT.maxWidth, "mx-auto", CHAT_LAYOUT.containerPadding, CHAT_LAYOUT.messageSpacing)}>
            {turns.map((turn, index) => {
              if (turn.type === 'user') {
                return (
                  <div key={turn.message.id} className={CHAT_LAYOUT.userMessagePadding}>
                    <UserMessageBubble
                      content={turn.message.content}
                      attachments={turn.message.attachments}
                      badges={turn.message.badges}
                      inputReception={turn.message.inputReception}
                      onUrlClick={platformActions.onOpenUrl}
                      onFileClick={platformActions.onOpenFile}
                    />
                  </div>
                )
              }

              if (turn.type === 'system') {
                const msgType = turn.message.role === 'error' ? 'error' :
                               turn.message.role === 'warning' ? 'warning' :
                               turn.message.role === 'info' ? 'info' : 'system'
                return (
                  <SystemMessage
                    key={turn.message.id}
                    content={turn.message.content}
                    type={msgType}
                  />
                )
              }

              if (turn.type === 'assistant') {
                const assistantUiKey = getAssistantTurnUiKey(turn, index)
                return (
                  <ViewerTurnCard
                    key={assistantUiKey}
                    turnKey={assistantUiKey}
                    turn={turn}
                    isExpanded={expandedTurns.has(assistantUiKey)}
                    expandedActivityGroups={expandedActivityGroups}
                    platformActions={platformActions}
                    sessionId={session.id}
                    sessionFolderPath={sessionFolderPath}
                    annotationInteractionMode={mode === 'readonly' ? 'tooltip-only' : 'interactive'}
                    onToggleExpanded={handleExpandedChange}
                    onOpenTurnDetails={handleOpenTurnDetails}
                    onOpenActivityDetails={handleOpenActivityDetails}
                    onExpandedActivityGroupsChange={handleExpandedActivityGroupsChange}
                    onOpenMultiFileDiff={platformActions.onOpenMultiFileDiff ? handleOpenMultiFileDiff : undefined}
                  />
                )
              }

              return null
            })}

            {/* Bottom branding */}
            <div className={CHAT_CLASSES.brandingContainer}>
              <PhanerisLogo className="w-8 h-8 text-[#9570BE]/40" />
            </div>
            </div>
          </div>
        </div>

        {/* Footer (input area) */}
        {footer && (
          <div className="shrink-0 border-t">
            {footer}
          </div>
        )}
      </div>
    </PlatformProvider>
  )
}
