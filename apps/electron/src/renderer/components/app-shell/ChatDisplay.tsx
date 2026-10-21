import { getMessageStructureSource } from '@phaneris/core/utils'
import { pinSessionCacheAtom } from '@/atoms/sessions'
import * as React from "react"
import { useTranslation } from "react-i18next"
import { useEffect, useState, useMemo, useCallback } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Info,
  X,
} from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { MOTION_DURATION, MOTION_EASE } from '@phaneris/ui/motion'
import { useScrollBehavior } from '@phaneris/ui/scroll-intent'
import { toast } from "sonner"
import { useAtom, useSetAtom } from "jotai"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { coerceInputText, appendRestoredInput } from "@/lib/input-text"
import { observeChatScrollAnchor } from '@/lib/chat-scroll-anchor'
import { contextBadgeUsage } from '@/lib/context-usage'
import { confirmDialog } from '@/components/ConfirmDialogHost'
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from "@/components/markdown"
import { ContentSwap } from "@/components/ui/content-swap"
import {
  InlineExpand,
  Spinner,
  ThinkingIndicator,
  parseReadResult,
  parseBashResult,
  parseGrepResult,
  parseGlobResult,
  type ActivityItem,
} from "@phaneris/ui"
import { useFocusZone } from "@/hooks/keyboard"
import { useTheme } from "@/hooks/useTheme"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest, CredentialRequest, CredentialResponse, AskUserRequest, AskUserResponse, LoadedSource, LoadedSkill } from "../../../shared/types"
import type { PermissionMode } from "@phaneris/shared/agent/modes"
import type { ThinkingLevel } from "@phaneris/shared/agent/thinking-levels"
import {
  TurnCard,
  UserMessageBubble,
  groupImmutableMessagesByTurn,
  reuseStableTurns,
  formatTurnAsMarkdown,
  formatActivityAsMarkdown,
  getAssistantTurnUiKey,
  asRecord,
  getAnnotationNoteText,
  isAnnotationFollowUpSent,
  extractAnnotationSelectedText,
  normalizeFollowUpText,
  type Turn,
  type AssistantTurn,
  type UserTurn,
  type SystemTurn,
  type AuthRequestTurn,
} from "@phaneris/ui"
import { MemoizedAuthRequestCard } from "@/components/chat/AuthRequestCard"
import { NewSessionLanding } from "@/components/chat/NewSessionLanding"
import { ChatStarters } from "@/components/chat/ChatStarters"
import { resolveChatStarterAction } from "@/lib/chat-starter-action"
import { ChatInputZone } from "./input/ChatInputZone"
import type { StructuredInputState, StructuredResponse, PermissionResponse, AdminApprovalResponse, QuestionResponse } from "./input"
import type { RichTextInputHandle } from "@/components/ui/rich-text-input"
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks"
import { useTurnCardExpansion } from "@/hooks/useTurnCardExpansion"
import { useNavigation } from "@/context/NavigationContext"
import { useAppShellContext } from "@/context/AppShellContext"
import { navigate, routes } from "@/lib/navigate"
import { CHAT_LAYOUT } from "@/config/layout"
import { collectFileChangesFromActivities, getFirstFileChangeIdForActivity } from "@/lib/file-changes"
import { handleErrorMessageAction } from "./error-message-actions"
import { ErrorMessage } from './ChatErrorMessage'
import { ProcessingIndicator, ScrollOnMount } from './ChatProcessingIndicator'
import {
  MAX_HIGHLIGHT_RANGES,
  applyHighlightRanges,
  clearHighlightRanges,
  collectHighlightRanges,
  getCSSHighlights,
} from './transcript-highlights'
import { MemoizedMessageBubble } from './ChatMessageBubble'
import { nextMatchIndex, previousMatchIndex } from './search-navigation'
import { openMarkdownPopoutAtom, type MarkdownPopout } from "@/atoms/preview"
import { chatFocusRequestAtom, filesPanelFocusRequestAtom } from "@/atoms/content-panel-ui"
import { usePanelTriggerOpener } from "@/lib/panel-triggers"
import { useArtifacts } from "@/hooks/useArtifacts"
import { ArtifactTurnCards } from "@/components/artifacts/ArtifactTurnCards"
import { artifactEventsForTurn } from "@/components/artifacts/artifact-events"
import { dedupeArtifactPreviews } from "@/components/artifacts/artifact-preview-dedupe"
import { RecoveryReconciliationDialog } from "./RecoveryReconciliationDialog"
import { ModelRecoveryReconciliationDialog } from "./ModelRecoveryReconciliationDialog"

// ============================================================================
// CSS Custom Highlight API: the helper lives in transcript-highlights.ts
// ============================================================================

// ============================================================================
// (Overlay types removed — overlays converged into workbench panels, Task 10)
// ============================================================================

// ============================================================================
// History-turn paint containment
// ============================================================================

/**
 * Class extent for turns that carry `content-visibility: auto` (`historyStyle`).
 *
 * `content-visibility: auto` implies paint containment, which clips descendant
 * paint to the wrapper's padding box. Every card frame in the chat is drawn by
 * `--shadow-minimal` — a 1px OUTER ring (`0 0 0 1px var(--border)`) painted
 * outside the border box — so a wrapper with no horizontal/bottom padding
 * shaves that ring off its left, right and bottom edges. The top edge only
 * survives because the wrapper pads it (`pt-2`/`pt-4`).
 *
 * One pixel of padding plus a matching negative horizontal margin puts the ring
 * back inside the clip without moving the card box (same shadow-room trick as
 * ActiveOptionBadges). No negative vertical margins on purpose: they would
 * fight the turn list's `space-y-2.5` margins.
 */
const HISTORY_SHADOW_ROOM = 'px-px -mx-px pb-px'
/** Same, for wrappers that carry no vertical padding of their own (system / auth). */
const HISTORY_SHADOW_ROOM_BOXED = 'px-px -mx-px py-px'

function getTurnKey(turn: Turn): string {
  if (turn.type === 'user') return `user-${turn.message.id}`
  if (turn.type === 'system') return `system-${turn.message.id}`
  if (turn.type === 'auth-request') return `auth-${turn.message.id}`
  return `turn-${turn.turnId}-${turn.timestamp}`
}

interface ChatDisplayProps {
  session: Session | null
  onSendMessage: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void | Promise<boolean | void>
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  // Model selection
  currentModel: string
  onModelChange: (model: string, connection?: string) => void
  // Connection selection (switchable while the session is idle)
  /** Callback when LLM connection changes (only works when session is empty) */
  onConnectionChange?: (connectionSlug: string) => void
  /** Ref for the input, used for external focus control */
  textareaRef?: React.RefObject<RichTextInputHandle>
  /** When true, disables input (e.g., when agent needs activation) */
  disabled?: boolean
  /** Pending permission request for this session */
  pendingPermission?: PermissionRequest
  /** Callback to respond to permission request */
  onRespondToPermission?: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: import('../../../shared/types').PermissionResponseOptions
  ) => void
  /** Pending credential request for this session */
  pendingCredential?: CredentialRequest
  /** Callback to respond to credential request */
  onRespondToCredential?: (sessionId: string, requestId: string, response: CredentialResponse) => void
  /** Pending ask_user question for this session (the agent is blocked on the answer) */
  pendingQuestion?: AskUserRequest
  /** Callback to answer or dismiss a pending question */
  onRespondToAskUser?: (sessionId: string, requestId: string, response: AskUserResponse) => void
  // Thinking level (session-level setting)
  /** Current thinking level ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel
  /** Callback when thinking level changes */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  // Advanced options
  /** Current permission mode */
  permissionMode?: PermissionMode
  previousPermissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Enabled permission modes for Shift+Tab cycling */
  enabledModes?: PermissionMode[]
  // Input value preservation (controlled from parent)
  /** Current input value - preserved across mode switches and conversation changes */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  /** Persisted attachment draft for this session (hydrated from disk in ChatPage) */
  attachmentsValue?: FileAttachment[]
  /** Callback when attachment draft changes (add, remove, clear on send) */
  onAttachmentsChange?: (attachments: FileAttachment[]) => void
  // Source selection
  /** Available sources (enabled only) */
  sources?: LoadedSource[]
  /** Callback when source selection changes. Awaitable so a caller can wait for
   * the server to apply the selection before acting on it (chat starters). */
  onSourcesChange?: (slugs: string[]) => void | Promise<void>
  // Skill selection (for @mentions)
  /** Available skills for @mention autocomplete */
  skills?: LoadedSkill[]
  /** Workspace-level prompt chips shown on the new-chat screen (max 3) */
  chatStarters?: Array<{ label: string; prompt: string }>
  // Plugin bundles (for the `/` menu roster)
  /** Installed plugin bundles for this workspace */
  plugins?: import('../../../shared/types').PluginSummary[]
  /** Plugin bundle active for this session (D12 single slot) */
  activePlugin?: string
  /** Activate a plugin bundle by name; null clears the slot */
  onActivePluginChange?: (pluginName: string | null) => void
  // Label selection (for #labels)
  /** Available label configs (tree) for label menu and badge display */
  labels?: import('@phaneris/shared/labels').LabelConfig[]
  /** Callback when labels change */
  onLabelsChange?: (labels: string[]) => void
  // State/status selection (for # menu and ActiveOptionBadges)
  /** Available workflow states */
  sessionStatuses?: import('@/config/session-status-config').SessionStatus[]
  /** Callback when session state changes */
  onSessionStatusChange?: (stateId: string) => void
  /** Workspace ID for loading skill icons */
  workspaceId?: string
  // Working directory (per session)
  /** Current working directory for this session */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
  /** Session folder path (for "Reset to Session Root" option) */
  sessionFolderPath?: string
  // Lazy loading
  /** When true, messages are still loading - show spinner in messages area */
  messagesLoading?: boolean
  /** Message load failure shown instead of an infinite spinner */
  messagesLoadError?: string | null
  /** Whether a retry is currently in flight */
  messagesRetrying?: boolean
  /** Retry lazy-loading the session transcript */
  onRetryMessagesLoad?: () => void
  // Tutorial
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  // Search highlighting (from session list search)
  /** Search query for highlighting matches - passed from session list */
  searchQuery?: string
  /** Whether search mode is active (prevents focus stealing to chat input) */
  isSearchModeActive?: boolean
  /** Callback when match info changes - for immediate UI updates */
  onMatchInfoChange?: (info: { count: number; index: number; isHighlighting: boolean; sessionId: string | null }) => void
  // Compact mode (for EditPopover embedding and auto-compact / WebUI mobile)
  /** Enable compact mode - hides non-essential UI elements for popover embedding */
  compactMode?: boolean
  /**
   * When compactMode is true, enable the compact (drawer-based) model selector
   * next to the permission-mode pill. Defaults to false so EditPopover keeps
   * its current behavior; ChatPage opts in when in auto-compact / mobile.
   */
  enableCompactModelPicker?: boolean
  /** Custom placeholder for input (used in compact mode for edit context) */
  placeholder?: string | string[]
  /** Label shown as empty state in compact mode (e.g., "Permission Settings") */
  emptyStateLabel?: string
  /** When true, the session's locked connection has been removed - disables send and shows unavailable state */
  connectionUnavailable?: boolean
}

import {
  formatFollowUpSection,
  normalizeFollowUpsMarkdown,
  truncateForChipTooltip,
  type PendingFollowUpAnnotation,
} from './ChatDisplay.follow-ups'

/**
 * Imperative handle exposed via forwardRef for navigation between matches
 */
export interface ChatDisplayHandle {
  goToNextMatch: () => void
  goToPrevMatch: () => void
  matchCount: number
  currentMatchIndex: number
  isHighlighting: boolean
}

/**
 * Processing status messages - cycles through these randomly
 * Inspired by Claude Code's playful status messages
 */


/**
 * ChatDisplay - Main chat interface for a selected session
 *
 * Structure:
 * - Session Header: Avatar + workspace name
 * - Messages Area: Scrollable list of MessageBubble components
 * - Input Area: Textarea + Send button
 *
 * Shows empty state when no session is selected
 */
export const ChatDisplay = React.forwardRef<ChatDisplayHandle, ChatDisplayProps>(function ChatDisplay({
  session,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
  currentModel,
  onModelChange,
  onConnectionChange,
  textareaRef: externalTextareaRef,
  disabled = false,
  pendingPermission,
  onRespondToPermission,
  pendingCredential,
  onRespondToCredential,
  pendingQuestion,
  onRespondToAskUser,
  // Thinking level
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  // Advanced options
  permissionMode = 'ask',
  previousPermissionMode,
  onPermissionModeChange,
  enabledModes,
  // Input value preservation
  inputValue,
  onInputChange,
  attachmentsValue,
  onAttachmentsChange,
  // Sources
  sources,
  onSourcesChange,
  // Skills (for @mentions)
  skills,
  // Workspace prompt chips on the new-chat screen
  chatStarters,
  // Plugins (for the `/` menu roster)
  plugins,
  activePlugin,
  onActivePluginChange,
  // Labels (for #labels)
  labels,
  onLabelsChange,
  // States (for # menu and badge)
  sessionStatuses,
  onSessionStatusChange,
  workspaceId,
  // Working directory
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  // Lazy loading
  messagesLoading = false,
  messagesLoadError,
  messagesRetrying = false,
  onRetryMessagesLoad,
  // Tutorial
  disableSend = false,
  // Search highlighting
  searchQuery: externalSearchQuery,
  isSearchModeActive = false,
  onMatchInfoChange,
  // Compact mode (for EditPopover embedding and auto-compact / WebUI mobile)
  compactMode = false,
  enableCompactModelPicker = false,
  placeholder,
  emptyStateLabel,
  // Connection unavailable
  connectionUnavailable = false,
}, ref) {
  const pinSessionCache = useSetAtom(pinSessionCacheAtom)
  React.useEffect(() => {
    if (!session?.id) return
    pinSessionCache(session.id, true)
    return () => pinSessionCache(session.id, false)
  }, [session?.id, pinSessionCache])
  const { t } = useTranslation()
  const [chatFocusRequest, setChatFocusRequest] = useAtom(chatFocusRequestAtom)
  const [focusedTrajectoryTurnKey, setFocusedTrajectoryTurnKey] = useState<string | null>(null)

  // Surface focus state gates auto-scroll and input focus while Workbench is active.
  const appShellContext = useAppShellContext()
  const isFocusedPanel = appShellContext?.isFocusedPanel ?? true

  // Input is only disabled when explicitly disabled (e.g., agent needs activation)
  // User can type during streaming - submitting will stop the stream and send
  const isInputDisabled = disabled
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  // Programmatic scrolls resolve their behavior through the shared policy so an
  // explicit `behavior` argument can never outrun `prefers-reduced-motion`.
  const scrollBehavior = useScrollBehavior()
  const prevSessionIdRef = React.useRef<string | null>(null)
  // Reverse pagination: show last N turns initially, load more on scroll up
  const TURNS_PER_PAGE = 20
  const [visibleTurnCount, setVisibleTurnCount] = React.useState(TURNS_PER_PAGE)
  // Sticky-bottom: When true, auto-scroll on content changes. Toggled by user scroll behavior.
  const isStickToBottomRef = React.useRef(true)
  // Mirror isFocusedPanel into a ref so the ResizeObserver closure reads the latest value
  const isFocusedPanelRef = React.useRef(isFocusedPanel)
  isFocusedPanelRef.current = isFocusedPanel
  // Skip smooth scroll briefly after session switch (instant scroll already happened)
  const skipSmoothScrollUntilRef = React.useRef(0)
  // Track message commit boundaries so we can auto-scroll when a new user message
  // actually lands in state (important when attachments delay optimistic insertion).
  const prevLastMessageIdRef = React.useRef<string | null>(null)
  const prevMessageCountRef = React.useRef(0)
  const prevSessionIdForCommitScrollRef = React.useRef<string | null>(null)
  const internalTextareaRef = React.useRef<RichTextInputHandle>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter'>('enter')
  const [recoveryActivity, setRecoveryActivity] = useState<ActivityItem | null>(null)
  const [modelRecoveryMessage, setModelRecoveryMessage] = useState<Message | null>(null)
  const [resolvedModelOperationIds, setResolvedModelOperationIds] = useState<Set<string>>(() => new Set())
  const [openAnnotationRequest, setOpenAnnotationRequest] = React.useState<{
    messageId: string
    annotationId: string
    mode: 'view' | 'edit'
    anchorX?: number
    anchorY?: number
    nonce: number
  } | null>(null)
  const followUpOpenNonceRef = React.useRef(0)

  // Navigation for session branching
  const { navigate } = useNavigation()

  // Get isDark from useTheme hook for overlay theme
  // This accounts for scenic themes (like Haze) that force dark mode
  const { isDark } = useTheme()

  // Register as focus zone - when zone gains focus, focus the textarea
  // Guard so only the focused surface responds.
  const { zoneRef, isFocused } = useFocusZone({
    zoneId: 'chat',
    enabled: isFocusedPanel,
    focusFirst: () => {
      if (isFocusedPanelRef.current) {
        textareaRef.current?.focus()
      }
    },
  })

  // Background tasks management
  const { tasks: backgroundTasks, killTask } = useBackgroundTasks({
    sessionId: session?.id ?? ''
  })

  // TurnCard expansion state — persisted to localStorage across session switches
  const {
    expandedTurns,
    toggleTurn,
    expandedActivityGroups,
    setExpandedActivityGroups,
  } = useTurnCardExpansion(session?.id)


  // ============================================================================
  // Search Highlighting (from session list search)
  // ============================================================================
  // Current match index for navigation (internal state, exposed via ref)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const turnRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())
  // Inject ::highlight() styles at runtime to avoid LightningCSS build warnings
  // (the optimizer doesn't recognize ::highlight as a valid pseudo-element yet)
  React.useEffect(() => {
    const id = 'search-highlight-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      ::highlight(search-passive) { background-color: rgb(253 224 71 / 0.3); color: inherit; }
      ::highlight(search-active) { background-color: rgb(253 224 71); color: rgb(0 0 0 / 0.9); }
    `
    document.head.appendChild(style)
  }, [])
  // Flag to control when scrolling to matches should happen
  // Only scroll when: session changes with search active, or user clicks navigation
  const shouldScrollToMatchRef = React.useRef(false)
  const prevSessionIdForScrollRef = React.useRef<string | null>(null)

  // Use the external search query from props
  const searchQuery = externalSearchQuery || ''
  // Require 2+ characters to activate in-chat search (aligned with session list isSearchMode)
  const isSearchActive = searchQuery.trim().length >= 2

  // Focus textarea when zone gains focus via keyboard (Tab, Cmd+3, ArrowRight)
  // Requires isFocused to be true - respects zone architecture
  // Does NOT auto-focus just because session changed (that would steal focus from SessionList)
  // Uses isSearchModeActive (prop) instead of isSearchActive (query-based) to prevent
  // focus stealing when search is open but query is empty
  // Only the focused surface should auto-focus its textarea.
  useEffect(() => {
    if (session?.id && !isSearchModeActive && isFocused && isFocusedPanel) {
      textareaRef.current?.focus()
    }
  }, [session?.id, isFocused, isSearchModeActive, isFocusedPanel, textareaRef])

  useEffect(() => {
    let isMounted = true

    const loadSendMessageKey = async () => {
      if (!window.electronAPI) return

      try {
        const key = await window.electronAPI.getSendMessageKey()
        if (!isMounted) return
        setSendMessageKey(key ?? 'enter')
      } catch (error) {
        console.error('Failed to load send message key for follow-up view:', error)
      }
    }

    loadSendMessageKey()

    return () => {
      isMounted = false
    }
  }, [])

  // Reset match state when session or search query changes
  useEffect(() => {
    const isSessionSwitch = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
    prevSessionIdForScrollRef.current = session?.id ?? null

    // If session switched with search active, trigger scroll to first match
    if (isSessionSwitch && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }

    setCurrentMatchIndex(0)
  }, [session?.id, searchQuery, isSearchActive])

  // Helper to count occurrences of a substring
  const countOccurrences = useCallback((text: string, query: string): number => {
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    let count = 0
    let pos = 0
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      count++
      pos += lowerQuery.length
    }
    return count
  }, [])

  // Streaming text updates reuse completed turns. Structural selectors below
  // do not need to traverse history again when only unannotated pending text changes.
  const structuralMessages = session?.messages ? getMessageStructureSource(session.messages) : undefined
  const turnMessages = session?.messages
  const turnProcessing = session?.isProcessing
  const previousTurnsRef = React.useRef<Turn[] | undefined>(undefined)
  const allTurns = React.useMemo(() => {
    if (!turnMessages) return []
    const grouped = groupImmutableMessagesByTurn(turnMessages, { isSessionProcessing: turnProcessing })
    // Reuse the previous object for every completed turn whose signature did
    // not move: an append or a streaming delta then leaves earlier rows with
    // identical `turn` props instead of re-rendering the whole transcript.
    const stable = reuseStableTurns(previousTurnsRef.current, grouped)
    previousTurnsRef.current = stable
    return stable
  }, [turnMessages, turnProcessing])

  // Find ALL individual match occurrences (not just turns)
  // Returns array with unique matchId for each occurrence
  const matchingOccurrences = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase()
    const matches: { matchId: string; turnId: string; turnIndex: number; matchIndexInTurn: number }[] = []

    for (let turnIndex = 0; turnIndex < allTurns.length; turnIndex++) {
      const turn = allTurns[turnIndex]
      let textContent = ''
      let turnId = ''

      // Use getTurnKey() for consistent IDs between text scan and DOM refs
      turnId = getTurnKey(turn)

      if (turn.type === 'user') {
        const content = turn.message.content as unknown
        if (typeof content === 'string') {
          textContent = content
        } else if (Array.isArray(content)) {
          textContent = content
            .filter((block: { type?: string }) => block.type === 'text')
            .map((block: { text?: string }) => block.text || '')
            .join('\n')
        }
      } else if (turn.type === 'assistant') {
        if (turn.response?.text) {
          textContent = turn.response.text
        }
      } else if (turn.type === 'system') {
        textContent = turn.message.content
      }

      // Count occurrences in this turn's text content
      const occurrenceCount = countOccurrences(textContent, query)
      for (let i = 0; i < occurrenceCount; i++) {
        matches.push({
          matchId: `${turnId}-match-${i}`,
          turnId,
          turnIndex,
          matchIndexInTurn: i,
        })
      }
    }
    return matches
  }, [searchQuery, allTurns, countOccurrences])

  // Auto-expand pagination when search is active to show all matching turns
  // This ensures match count is stable and all matches are highlightable from the start
  useEffect(() => {
    if (!isSearchActive || matchingOccurrences.length === 0) return

    // Find the earliest matching turn index (reduce to avoid RangeError on large arrays)
    const earliestMatchTurnIndex = matchingOccurrences.reduce(
      (min, m) => m.turnIndex < min ? m.turnIndex : min,
      matchingOccurrences[0]!.turnIndex
    )
    const totalTurns = allTurns.length

    // Calculate how many turns we need to show to include all matches
    // totalTurns - visibleTurnCount = startIndex, so we need visibleTurnCount = totalTurns - earliestMatchTurnIndex + buffer
    const requiredVisibleCount = totalTurns - earliestMatchTurnIndex + 5 // +5 buffer for context

    if (requiredVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(requiredVisibleCount)
    }
  }, [isSearchActive, matchingOccurrences, allTurns.length, visibleTurnCount])

  // Extract unique turn IDs that have matches (for highlighting)
  const matchingTurnIds = useMemo(() => {
    const uniqueTurnIds = new Set(matchingOccurrences.map(m => m.turnId))
    return Array.from(uniqueTurnIds)
  }, [matchingOccurrences])

  // With CSS Custom Highlight API, navigation is driven by logical matches — no DOM verification needed.
  const validMatches = matchingOccurrences

  // Auto-scroll to match ONLY when there's exactly one match
  // Multiple matches: user navigates with chevrons to avoid jarring scroll
  useEffect(() => {
    if (validMatches.length === 1 && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }
  }, [validMatches.length, isSearchActive])

  // Scroll to current match turn
  // Only scrolls when shouldScrollToMatchRef is true (single match auto-scroll or nav button click)
  useEffect(() => {
    if (!shouldScrollToMatchRef.current) return

    if (validMatches.length > 0 && currentMatchIndex < validMatches.length) {
      const matchData = validMatches[currentMatchIndex]
      const { turnId, turnIndex } = matchData
      const totalTurns = totalTurnCountRef.current

      // Check if the match is outside the visible range
      const currentStartIndex = Math.max(0, totalTurns - visibleTurnCount)
      if (turnIndex < currentStartIndex) {
        const newVisibleCount = totalTurns - turnIndex + 5
        setVisibleTurnCount(newVisibleCount)
        return
      }

      // Scroll the turn into view
      const turnEl = turnRefs.current.get(turnId)
      if (turnEl) {
        const rect = turnEl.getBoundingClientRect()
        const buffer = 128
        const isVisible = rect.top >= buffer && rect.bottom <= window.innerHeight - buffer
        if (!isVisible) {
          turnEl.scrollIntoView({ behavior: 'instant', block: 'center' })
        }
      }
      shouldScrollToMatchRef.current = false
    }
  }, [validMatches, currentMatchIndex, session?.id, visibleTurnCount])

  // ---------------------------------------------------------------------------
  // CSS Custom Highlight API — non-destructive text highlighting
  // Creates browser-native highlight ranges over matching text without
  // modifying the DOM tree. Safe with React re-renders and streaming.
  // Uses cross-node matching: concatenates text across node boundaries
  // to find matches that span multiple DOM nodes (e.g. Shiki-split tokens).
  // ---------------------------------------------------------------------------

  // Store computed ranges so the active-match effect can restyle without re-walking the DOM
  const highlightRangesRef = React.useRef<Range[]>([])

  // Effect 1: Collect ranges when search, session or pagination changes. The
  // walk itself lives in transcript-highlights.ts so it can be exercised against
  // a real DOM without mounting a transcript.
  useEffect(() => {
    highlightRangesRef.current = []
    clearHighlightRanges()

    if (!searchQuery.trim() || !isSearchActive || !getCSSHighlights()) return
    const matchingTurnIdSet = new Set(matchingTurnIds)
    if (matchingTurnIdSet.size === 0) return

    const rafId = requestAnimationFrame(() => {
      const allRanges: Range[] = []
      turnRefs.current.forEach((container, turnKey) => {
        if (allRanges.length >= MAX_HIGHLIGHT_RANGES) return
        if (!matchingTurnIdSet.has(turnKey)) return
        const searchRoot = container.querySelector('[data-search-root="response"]') || container
        allRanges.push(...collectHighlightRanges(searchRoot, searchQuery, MAX_HIGHLIGHT_RANGES - allRanges.length))
      })

      highlightRangesRef.current = allRanges
      if (allRanges.length === 0) {
        if (matchingTurnIdSet.size > 0) {
          console.warn('[search-highlight] 0 ranges from', matchingTurnIdSet.size, 'matching turns — possible turn ID mismatch')
        }
        return
      }
      applyHighlightRanges(allRanges, -1)
    })

    return () => cancelAnimationFrame(rafId)
  }, [searchQuery, isSearchActive, matchingTurnIds, session?.id, visibleTurnCount])

  // CSS.highlights is document-global: a transcript that unmounts while a search
  // is active would otherwise leave its ranges painted over whatever renders
  // next. Unmount only — clearing here on every re-run would blank a frame.
  useEffect(() => () => clearHighlightRanges(), [])

  // Effect 2: Reshuffle the existing ranges between the passive and active
  // registries when navigation moves — no DOM walk.
  useEffect(() => {
    const allRanges = highlightRangesRef.current
    if (allRanges.length === 0) return
    applyHighlightRanges(allRanges, currentMatchIndex)
  }, [currentMatchIndex])

  // Navigate to next match (no looping - stops at last match). The policy lives in
  // search-navigation.ts so "it does not wrap" can be asserted without a transcript.
  const goToNextMatch = useCallback(() => {
    if (validMatches.length === 0) return
    setCurrentMatchIndex(prev => {
      const next = nextMatchIndex(prev, validMatches.length)
      if (next !== prev) shouldScrollToMatchRef.current = true
      return next
    })
  }, [validMatches])

  // Navigate to previous match (no looping - stops at first match)
  const goToPrevMatch = useCallback(() => {
    if (validMatches.length === 0) return
    setCurrentMatchIndex(prev => {
      const next = previousMatchIndex(prev, validMatches.length)
      if (next !== prev) shouldScrollToMatchRef.current = true
      return next
    })
  }, [validMatches])

  // With CSS Highlight API, highlighting is instant — no settling phase
  const isHighlighting = false

  // Expose navigation via imperative handle (for session list navigation controls)
  React.useImperativeHandle(ref, () => ({
    goToNextMatch,
    goToPrevMatch,
    matchCount: validMatches.length,
    currentMatchIndex,
    isHighlighting,
  }), [goToNextMatch, goToPrevMatch, validMatches.length, currentMatchIndex, isHighlighting])

  // Notify parent when match info (count, index, highlighting state) changes
  useEffect(() => {
    onMatchInfoChange?.({
      count: validMatches.length,
      index: currentMatchIndex,
      isHighlighting,
      sessionId: session?.id ?? null,
    })
  }, [validMatches.length, currentMatchIndex, isHighlighting, session?.id, onMatchInfoChange])

  // ============================================================================
  // Pop-out / changed-files triggers (Files workbench + shared preview overlay)
  // ============================================================================

  const openTriggeredPanel = usePanelTriggerOpener()
  const openMarkdownPopout = useSetAtom(openMarkdownPopoutAtom)
  const setFilesPanelFocusRequest = useSetAtom(filesPanelFocusRequestAtom)
  const artifactStore = useArtifacts(workspaceId ?? session?.workspaceId ?? null, session?.id)

  const openArtifact = useCallback((artifactId: string) => {
    navigate(routes.view.artifact(artifactId))
  }, [navigate])

  const acceptArtifact = useCallback(async (artifactId: string) => {
    try {
      const result = await artifactStore.accept(artifactId)
      if (result.accepted) toast.success(t('artifact.accepted'))
      else toast.error(t('artifact.conflictDetected'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    }
  }, [artifactStore, t])

  const discardArtifact = useCallback(async (artifactId: string) => {
    const confirmed = await confirmDialog({
      title: t('artifact.discardConfirm'),
      confirmLabel: t('artifact.discard'),
    })
    if (!confirmed) return
    try {
      await artifactStore.discard(artifactId)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    }
  }, [artifactStore, t])

  const reviseArtifact = useCallback(async (artifactId: string) => {
    try {
      await artifactStore.revise(artifactId)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('artifact.actionFailed'))
    }
  }, [artifactStore, t])

  // Show a chat pop-out as a read-only document in the shared preview overlay.
  // Files panels stay single-purpose; pop-outs no longer open a second browser.
  const openPreviewEntry = useCallback((entry: Omit<MarkdownPopout, 'sessionId'>) => {
    if (!session) return
    openMarkdownPopout({ ...entry, sessionId: session.id })
  }, [session, openMarkdownPopout])

  // Pop-out handler - a message shown read-only (read-only markdown preview)
  const handlePopOut = useCallback((message: Message) => {
    openPreviewEntry({ content: message.content, title: t('contentPanel.preview.message'), id: `msg:${message.id}` })
  }, [openPreviewEntry, t])

  // Open Files > Changed, optionally scrolling to a specific change.
  const openDiffPanel = useCallback((focusedChangeId?: string) => {
    if (session?.id) setFilesPanelFocusRequest({ sessionId: session.id, view: 'changed', changeId: focusedChangeId, nonce: Date.now() })
    openTriggeredPanel('files')
  }, [openTriggeredPanel, session?.id, setFilesPanelFocusRequest])

  // Ref to track total turn count for scroll handler
  const totalTurnCountRef = React.useRef(0)

  // Latest message metadata (for commit-time auto-scroll)
  const messageCount = session?.messages.length ?? 0
  const lastMessage = messageCount > 0 ? session?.messages[messageCount - 1] : undefined
  const lastMessageId = lastMessage?.id
  const lastMessageRole = lastMessage?.role

  const pendingFollowUpAnnotations = useMemo<PendingFollowUpAnnotation[]>(() => {
    if (!structuralMessages?.length) return []

    const pending: PendingFollowUpAnnotation[] = []

    for (const message of structuralMessages) {
      if (message.role !== 'assistant' && message.role !== 'plan') continue
      if (!message.annotations?.length) continue

      for (const annotation of message.annotations) {
        const note = getAnnotationNoteText(annotation)
        if (!note) continue
        if (isAnnotationFollowUpSent(annotation)) continue

        pending.push({
          messageId: message.id,
          annotationId: annotation.id,
          note,
          selectedText: extractAnnotationSelectedText(annotation, message.content),
          createdAt: annotation.updatedAt ?? annotation.createdAt,
          color: annotation.style?.color,
          meta: asRecord(annotation.meta) ?? undefined,
        })
      }
    }

    return pending.sort((a, b) => a.createdAt - b.createdAt)
  }, [structuralMessages])

  const followUpInputItems = useMemo(() => {
    return pendingFollowUpAnnotations.map((followUp, idx) => ({
      id: `${followUp.messageId}:${followUp.annotationId}`,
      messageId: followUp.messageId,
      annotationId: followUp.annotationId,
      index: idx + 1,
      noteLabel: normalizeFollowUpText(followUp.note),
      selectedText: truncateForChipTooltip(followUp.selectedText, 260),
      color: followUp.color,
    }))
  }, [pendingFollowUpAnnotations])

  // Track scroll position to toggle sticky-bottom behavior
  // - User scrolls up → unstick (stop auto-scrolling)
  // - User scrolls back to bottom → re-stick (resume auto-scrolling)
  // Also handles loading more turns when scrolling near top
  const handleScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const { scrollTop } = viewport

    // Load more turns when scrolling near top (within 100px)
    if (scrollTop < 100) {
      setVisibleTurnCount(prev => {
        // Check if there are more turns to load
        const currentStartIndex = Math.max(0, totalTurnCountRef.current - prev)
        if (currentStartIndex <= 0) return prev // Already showing all

        // Remember scroll height before adding more items
        const prevScrollHeight = viewport.scrollHeight

        // Schedule scroll position adjustment after render
        requestAnimationFrame(() => {
          const newScrollHeight = viewport.scrollHeight
          viewport.scrollTop = newScrollHeight - prevScrollHeight + scrollTop
        })

        return prev + TURNS_PER_PAGE
      })
    }
  }, [])

  // Set up scroll event listener
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Follow layout changes without overriding the user's reading position.
  // Initial scroll is handled by ScrollOnMount (useLayoutEffect, before paint)
  React.useEffect(() => {
    if (messagesLoading) return
    // Scroll to bottom when messages finish loading (session switch or lazy load).
    // This covers the case where ScrollOnMount fires before the loaded content
    // has fully rendered (e.g. AnimatePresence transition timing).
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messagesLoading])
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    // On session switch: reset UI state (scroll handled by ScrollOnMount)
    if (isSessionSwitch) {
      isStickToBottomRef.current = true
      setVisibleTurnCount(TURNS_PER_PAGE)
    }

    const content = viewport.firstElementChild
    if (content) return observeChatScrollAnchor(viewport, content, isStickToBottomRef)
  }, [session?.id])

  // Commit-time auto-scroll for new user messages.
  // This complements submit-time scrolling and covers cases where attachments delay
  // optimistic message insertion (e.g., thumbnail generation/resizing).
  React.useEffect(() => {
    const currentSessionId = session?.id ?? null

    // Reset baseline on session switch; defer to ScrollOnMount/session-switch logic.
    if (prevSessionIdForCommitScrollRef.current !== currentSessionId) {
      prevSessionIdForCommitScrollRef.current = currentSessionId
      prevLastMessageIdRef.current = lastMessageId ?? null
      prevMessageCountRef.current = messageCount
      return
    }

    const previousCount = prevMessageCountRef.current
    const previousLastId = prevLastMessageIdRef.current
    const messageActuallyChanged = !!lastMessageId && lastMessageId !== previousLastId
    const countIncreased = messageCount > previousCount

    // Update baselines before early returns to keep refs consistent.
    prevLastMessageIdRef.current = lastMessageId ?? null
    prevMessageCountRef.current = messageCount

    if (!messageActuallyChanged || !countIncreased) return
    if (lastMessageRole !== 'user') return

    // Sending a message should always re-stick to bottom.
    isStickToBottomRef.current = true

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: isFocusedPanelRef.current ? scrollBehavior('follow') : 'instant',
      })
    })
  }, [session?.id, messageCount, lastMessageId, lastMessageRole, scrollBehavior])

  // Handle message submission from InputContainer
  // Backend handles interruption and queueing if currently processing
  const handleSubmit = async (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => {
    const hasBaseMessage = message.trim().length > 0
    const followUpSection = formatFollowUpSection(pendingFollowUpAnnotations, {
      includeTopSeparator: hasBaseMessage,
    })
    const messageWithFollowUps = followUpSection.length > 0
      ? (hasBaseMessage ? `${message}\n\n${followUpSection}` : followUpSection)
      : message
    const normalizedMessage = normalizeFollowUpsMarkdown(messageWithFollowUps)

    // Force stick-to-bottom when user sends a message
    isStickToBottomRef.current = true
    if (await onSendMessage(normalizedMessage, attachments, skillSlugs) === false) return false

    // Persist sent marker on follow-up annotations so TurnCard can distinguish
    // sent vs pending follow-ups. If user edits a follow-up later, TurnCard
    // clears these markers and the annotation becomes pending again.
    if (session && pendingFollowUpAnnotations.length > 0) {
      const sentAt = Date.now()
      void Promise.all(pendingFollowUpAnnotations.map((followUp) => {
        const currentMeta = followUp.meta ?? {}
        const currentFollowUpMeta = asRecord(currentMeta.followUp) ?? {}

        return window.electronAPI.sessionCommand(session.id, {
          type: 'updateAnnotation',
          messageId: followUp.messageId,
          annotationId: followUp.annotationId,
          patch: {
            meta: {
              ...currentMeta,
              followUp: {
                ...currentFollowUpMeta,
                text: followUp.note,
                lastSentAt: sentAt,
                lastSentText: followUp.note,
              },
            },
          },
        })
      })).catch((error) => {
        console.error('[ChatDisplay] Failed to mark follow-up annotations as sent:', error)
      })
    }

    // Immediately scroll to bottom after sending - use requestAnimationFrame
    // to ensure the DOM has updated with the new message
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior('follow') })
    })
    return true
  }

  const handleSaveAndSendFollowUp = useCallback((_target: {
    messageId: string
    annotationId: string
    note: string
    selectedText: string
  }) => {
    if (!session) return

    if (isInputDisabled || disableSend || connectionUnavailable) {
      toast.error(t('toast.cannotSendRightNow'), {
        description: 'Sending is currently disabled for this session.',
      })
      return
    }

    // Mimic pressing Send in the input after Save completes.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('craft:submit-input', {
        detail: { sessionId: session.id },
      }))
    }, 0)
  }, [session, isInputDisabled, disableSend, connectionUnavailable, t])

  // Handle stop request from InputContainer
  // silent=true when redirecting (sending new message), silent=false when user clicks Stop button
  const handleStop = (silent = false) => {
    if (starterRunRef.current) {
      starterRunRef.current.cancelled = true
      starterRunRef.current = null
      return
    }
    if (!session?.isProcessing) return

    // Explicit Stop (not a redirect/new-message send): put the in-flight prompt
    // back in the input so the user can tweak and resend. Append to any draft.
    // Exclude isQueued messages — those are restored separately by the backend
    // `restore_input` effect (App.tsx) and would otherwise double up here.
    if (!silent) {
      const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user' && !m.isQueued)
      const restoredText = coerceInputText(lastUserMsg?.content)
      if (restoredText) {
        onInputChange?.(appendRestoredInput(inputValue, restoredText))
      }
    }

    window.electronAPI.cancelProcessing(session.id, silent).catch(error => {
      console.error('[ChatDisplay] Failed to cancel processing:', error)
    })
  }

  // Per-frame scroll compensation during input height animation
  // Only compensate when user is "stuck to bottom" - otherwise let them control their scroll position
  const handleAnimatedHeightChange = React.useCallback((delta: number) => {
    if (!isStickToBottomRef.current) return
    const viewport = scrollViewportRef.current
    if (!viewport) return
    // Adjust scroll to maintain position relative to content
    viewport.scrollTop += delta
  }, [])

  // Handle structured input responses (permissions and credentials)
  const handleStructuredResponse = (response: StructuredResponse) => {
    if ((response.type === 'permission' || response.type === 'admin_approval') && pendingPermission && onRespondToPermission) {
      if (response.type === 'permission') {
        const permResponse = response as PermissionResponse
        onRespondToPermission(
          pendingPermission.sessionId,
          pendingPermission.requestId,
          permResponse.allowed,
          permResponse.alwaysAllow
        )
        return
      }

      const adminResponse = response as AdminApprovalResponse
      onRespondToPermission(
        pendingPermission.sessionId,
        pendingPermission.requestId,
        adminResponse.approved,
        false,
        { rememberForMinutes: adminResponse.rememberForMinutes }
      )
    } else if (response.type === 'credential' && pendingCredential && onRespondToCredential) {
      const credResponse = response as CredentialResponse
      onRespondToCredential(
        pendingCredential.sessionId,
        pendingCredential.requestId,
        credResponse
      )
    } else if (response.type === 'question' && pendingQuestion && onRespondToAskUser) {
      const questionResponse = response as QuestionResponse
      onRespondToAskUser(
        pendingQuestion.sessionId,
        pendingQuestion.requestId,
        { answers: questionResponse.answers, cancelled: questionResponse.cancelled }
      )
    }
  }

  // Build structured input state from pending requests.
  // Priority: permission > question > credential. A permission gate blocks the
  // tool that is about to run, so answering it first unblocks real work; a
  // question is the agent waiting on a decision; a credential request belongs
  // to auth setup and can wait behind both.
  const structuredInput: StructuredInputState | undefined = React.useMemo(() => {
    if (pendingPermission) {
      if (pendingPermission.type === 'admin_approval') {
        return {
          type: 'admin_approval',
          data: {
            appName: pendingPermission.appName || pendingPermission.toolName || 'System action',
            reason: pendingPermission.reason || pendingPermission.description,
            impact: pendingPermission.impact,
            command: pendingPermission.command || '',
            requiresSystemPrompt: pendingPermission.requiresSystemPrompt ?? true,
            rememberForMinutes: pendingPermission.rememberForMinutes ?? 10,
          },
        }
      }
      return { type: 'permission', data: pendingPermission }
    }
    if (pendingQuestion) {
      return { type: 'question', data: pendingQuestion }
    }
    if (pendingCredential) {
      return { type: 'credential', data: pendingCredential }
    }
    return undefined
  }, [pendingPermission, pendingQuestion, pendingCredential])

  // Keep ref in sync for scroll handler
  totalTurnCountRef.current = allTurns.length

  // Reverse pagination: only render last N turns for fast initial render
  const startIndex = Math.max(0, allTurns.length - visibleTurnCount)
  const turns = allTurns.slice(startIndex)
  const hasMoreAbove = startIndex > 0

  const assistantTurnIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>()
    const structuralTurns = structuralMessages ? groupImmutableMessagesByTurn(structuralMessages, { isSessionProcessing: session?.isProcessing }) : []
    structuralTurns.forEach((turn, index) => {
      if (turn.type !== 'assistant') return
      const messageId = turn.response?.messageId
      if (messageId) map.set(messageId, index)
    })
    return map
  }, [structuralMessages, session?.isProcessing])

  useEffect(() => {
    if (!chatFocusRequest || chatFocusRequest.sessionId !== session?.id) return
    const targetIndex = allTurns.findIndex((turn) => {
      if (turn.type === 'assistant') return turn.response?.messageId === chatFocusRequest.messageId
      return 'message' in turn && turn.message.id === chatFocusRequest.messageId
    })
    if (targetIndex < 0) {
      setChatFocusRequest(null)
      return
    }

    const targetTurn = allTurns[targetIndex]
    const turnKey = getTurnKey(targetTurn)
    const reveal = () => {
      const element = turnRefs.current.get(turnKey)
      if (!element) return false
      element.scrollIntoView({ behavior: scrollBehavior('reveal'), block: 'center' })
      setFocusedTrajectoryTurnKey(turnKey)
      window.setTimeout(() => setFocusedTrajectoryTurnKey(current => current === turnKey ? null : current), 1800)
      return true
    }

    const requiredVisibleCount = allTurns.length - targetIndex
    if (requiredVisibleCount > visibleTurnCount) setVisibleTurnCount(requiredVisibleCount)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!reveal()) window.setTimeout(() => { void reveal() }, 80)
    }))
    setChatFocusRequest(null)
  }, [allTurns, chatFocusRequest, session?.id, setChatFocusRequest, visibleTurnCount, scrollBehavior])

  const scrollToFollowUpTurn = useCallback((item: {
    messageId: string
    annotationId: string
  }) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(item.messageId)
    if (targetTurnIndex == null) return

    const ensureVisibleCount = allTurns.length - targetTurnIndex

    const scrollToTurn = () => {
      const targetTurn = allTurns[targetTurnIndex]
      if (!targetTurn) return false

      const turnKey = getTurnKey(targetTurn)
      const turnContainer = turnRefs.current.get(turnKey)
      if (!turnContainer) return false

      turnContainer.scrollIntoView({ behavior: scrollBehavior('reveal'), block: 'center' })
      return true
    }

    if (ensureVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(ensureVisibleCount)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollToTurn()) {
            setTimeout(() => {
              void scrollToTurn()
            }, 80)
          }
        })
      })
      return
    }

    if (!scrollToTurn()) {
      requestAnimationFrame(() => {
        void scrollToTurn()
      })
    }
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount, scrollBehavior])

  const handleFollowUpChipClick = useCallback((item: {
    messageId: string
    annotationId: string
  }, anchor?: { x: number; y: number }) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(item.messageId)
    if (targetTurnIndex != null) {
      const ensureVisibleCount = allTurns.length - targetTurnIndex
      if (ensureVisibleCount > visibleTurnCount) {
        setVisibleTurnCount(ensureVisibleCount)
      }
    }

    followUpOpenNonceRef.current += 1
    setOpenAnnotationRequest({
      messageId: item.messageId,
      annotationId: item.annotationId,
      mode: 'view',
      anchorX: anchor?.x,
      anchorY: anchor?.y,
      nonce: followUpOpenNonceRef.current,
    })
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount])

  const handleFollowUpIndexClick = useCallback((item: {
    messageId: string
    annotationId: string
  }) => {
    scrollToFollowUpTurn(item)
  }, [scrollToFollowUpTurn])

  // Compute if we should skip scroll-to-bottom (when search is active on session switch)
  // At render time, prevSessionIdForScrollRef still has the OLD session ID, so we can detect the switch
  const isSessionSwitchForScroll = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
  const skipScrollToBottom = isSessionSwitchForScroll && isSearchActive
  const hasUnrenderedLoadedMessages = !messagesLoading
    && turns.length === 0
    && ((session?.messages?.length ?? 0) > 0 || (session?.messageCount ?? 0) > 0)

  // Brand surface for a session with no messages yet.
  // All three guards matter: a session switch renders this component with the
  // previous session's messages still loaded (`messagesLoading` true) and with
  // lazy-loaded history not yet arrived, so a bare `messages.length === 0` test
  // would flash the hero over an existing conversation.
  // compactMode is excluded on purpose — EditPopover's mini sessions reach
  // `turns.length === 0` too, and a hero does not belong in a 400px popover.
  const showNewSessionLanding = !!session
    && !compactMode
    && !messagesLoading
    && !messagesLoadError
    && session.messages.length === 0

  /**
   * A starter behaves exactly like the same text typed into the composer: its
   * `[source:slug]` / `[skill:slug]` mentions are resolved against what this
   * workspace actually has, mentioned sources are enabled through the same
   * callback the @-mention flow uses, and mentioned skills ride along on the send
   * so the server can pre-enable their required sources. Unknown mentions are
   * ignored by `parseMentions`, so a stale starter cannot enable a deleted source.
   */
  // Deliberately not a useCallback: the send path (handleSubmit) closes over a
  // dozen live values and is not memoized, so memoizing this wrapper would only
  // add a dependency warning without stabilising anything.
  //
  // A starter click is an enable-then-send transaction, so it needs the state of
  // the moment it finishes, not of the moment it started: the refs below are
  // updated on every render and decide whether the click is still valid.
  const liveSessionRef = React.useRef(session)
  liveSessionRef.current = session
  const liveWorkspaceRef = React.useRef(workspaceId)
  liveWorkspaceRef.current = workspaceId
  const liveSendableRef = React.useRef(false)
  liveSendableRef.current = !(isInputDisabled || disableSend || connectionUnavailable)
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  /** One enable-then-send at a time: a double click must not send twice. */
  const starterRunRef = React.useRef<{ sessionId: string; cancelled: boolean } | null>(null)
  React.useEffect(() => {
    const cancelPendingStarter = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      if (!starterRunRef.current || !zoneRef.current?.contains(event.target as Node)) return
      starterRunRef.current.cancelled = true
      starterRunRef.current = null
      event.preventDefault()
    }
    window.addEventListener('keydown', cancelPendingStarter)
    return () => window.removeEventListener('keydown', cancelPendingStarter)
  }, [zoneRef])

  const handleRunChatStarter = async (starter: { label: string; prompt: string }) => {
    if (!session) return
    if (isInputDisabled || disableSend || connectionUnavailable) {
      toast.error(t('toast.cannotSendRightNow'), {
        description: 'Sending is currently disabled for this session.',
      })
      return
    }
    if (starterRunRef.current !== null) return
    const runSessionId = session.id
    const runWorkspaceId = workspaceId ?? session.workspaceId
    const action = resolveChatStarterAction({
      prompt: starter.prompt,
      availableSources: (sources ?? []).map(source => source.config.slug),
      availableSkills: (skills ?? []).map(skill => skill.slug),
      enabledSources: session.enabledSourceSlugs ?? [],
    })
    const run = { sessionId: runSessionId, cancelled: false }
    starterRunRef.current = run
    try {
      if (action.enableSources.length > 0 && onSourcesChange) {
        // Wait for the server to apply the selection: a starter enables its source
        // and sends in the same click, and the send path reads the session's
        // enabled sources when the turn starts. Awaited, the empty-list case is a
        // no-op round trip and the mentioned case is ordered by construction.
        try {
          await onSourcesChange([...(session.enabledSourceSlugs ?? []), ...action.enableSources])
        } catch (error) {
          // The message must not go out when the source it depends on was not
          // enabled: report it and stop, rather than sending a prompt whose
          // context is missing.
          toast.error(t('toast.failedToEnableSource'), {
            description: t('toast.failedToEnableSourceDescription', { error: error instanceof Error ? error.message : String(error) }),
          })
          return
        }
        // The click is only still valid for the session, workspace and sendable
        // state it started with.
        if (run.cancelled || !mountedRef.current) return
        if (liveSessionRef.current?.id !== runSessionId) return
        if ((liveWorkspaceRef.current ?? liveSessionRef.current?.workspaceId) !== runWorkspaceId) return
        if (!liveSendableRef.current) return
      }
      await handleSubmit(action.prompt, undefined, action.skillSlugs.length > 0 ? action.skillSlugs : undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (starterRunRef.current === run) starterRunRef.current = null
    }
  }

  /**
   * The composer's source toggles are fire-and-forget; now that the shell no
   * longer swallows the command's rejection, report it instead of letting it
   * surface as an unhandled rejection.
   */
  const handleComposerSourcesChange = React.useCallback((slugs: string[]) => {
    const pending = onSourcesChange?.(slugs)
    if (pending && typeof (pending as Promise<void>).then === 'function') {
      void (pending as Promise<void>).catch(error => {
        toast.error(t('toast.failedToEnableSource'), {
          description: t('toast.failedToEnableSourceDescription', { error: error instanceof Error ? error.message : String(error) }),
        })
      })
    }
  }, [onSourcesChange, t])

  return (
    <div ref={zoneRef} className="flex h-full flex-col min-w-0" data-focus-zone="chat">
      {session ? (
        <div className="flex flex-1 flex-col min-h-0 min-w-0 relative">
          {/* Content layer */}
          <div className="flex flex-1 flex-col min-h-0 min-w-0 relative z-component-chrome">
          {/* Both the transcript and the landing occupy this same grid cell, so the
              landing is exactly the space above the composer and centres the mark
              against the room that is actually free — not against the full panel,
              which would push it below optical centre once the composer is counted. */}
          <div className="grid min-h-0 flex-1 grid-cols-1">
          {/* === MESSAGES AREA: Scrollable list of message bubbles === */}
          {/* Left in flow (and left empty) when the landing shows: this cell is what
              reserves the height, and the landing overlays it. */}
          <div className="relative col-start-1 row-start-1 min-h-0">
            {/* Mask wrapper - fades content at top and bottom over transparent/image backgrounds */}
            <div
              className="h-full"
              style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
              }}
            >
              <ScrollArea className="h-full min-w-0" viewportRef={scrollViewportRef}>
              <div className={cn(
                CHAT_LAYOUT.maxWidth,
                "mx-auto min-w-0",
                compactMode ? [CHAT_LAYOUT.compactPaddingX, "py-4 space-y-2"] : [CHAT_LAYOUT.containerPadding, CHAT_LAYOUT.messageSpacing]
              )}>
                {/* Ready sessions replace immediately; never queue behind the old exit. */}
                <AnimatePresence mode="sync" initial={false}>
                  <motion.div
                    key={compactMode ? 'compact-session' : session?.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0 } }}
                    transition={compactMode ? { duration: 0 } : { duration: MOTION_DURATION.fast, ease: MOTION_EASE.enter }}
                  >
                    {/* Loading/Content AnimatePresence: sync mode avoids stale loading exits masking ready content */}
                    <AnimatePresence mode="sync" initial={false}>
                    {messagesLoading ? (
                      /* Loading State: Show spinner while messages are being lazy loaded */
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={compactMode ? { duration: 0 } : { duration: MOTION_DURATION.fast, ease: MOTION_EASE.enter }}
                        className="flex items-center justify-center h-64"
                      >
                        <Spinner className="text-text-secondary" />
                      </motion.div>
                    ) : messagesLoadError ? (
                      <motion.div
                        key="load-error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={compactMode ? { duration: 0 } : { duration: MOTION_DURATION.fast, ease: MOTION_EASE.enter }}
                        className="flex items-center justify-center h-64 px-4"
                      >
                        <div
                          className="max-w-sm rounded-shape-lg border border-destructive/20 px-4 py-3 text-center shadow-tinted"
                          style={{
                            backgroundColor: 'oklch(from var(--destructive) l c h / 0.03)',
                            '--shadow-color': 'var(--destructive)',
                          } as React.CSSProperties}
                        >
                          <AlertTriangle className="mx-auto mb-2 h-4 w-4 text-destructive-text" />
                          <div className="text-body font-medium text-destructive">{t("chat.failedToLoadConversation")}</div>
                          <p className="mt-1 break-words text-meta text-destructive-text">{messagesLoadError}</p>
                          {onRetryMessagesLoad && (
                            <button
                              type="button"
                              onClick={onRetryMessagesLoad}
                              disabled={messagesRetrying}
                              className="mt-3 rounded border border-destructive/20 px-2 py-0.5 text-meta text-destructive-text transition-colors hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {messagesRetrying ? t("common.retrying") : t("common.retry")}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ) : (
                    /* Turn-based Message Display - memoized to avoid re-grouping on every render */
                    /* AnimatePresence handles the fade-in animation when transitioning from loading */
                    <motion.div
                      key={compactMode ? 'loaded-compact' : `loaded-${session?.id}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={compactMode ? { duration: 0 } : { duration: MOTION_DURATION.fast, ease: MOTION_EASE.enter }}
                    >
                  {/* Scroll to bottom before paint - fires via useLayoutEffect */}
                  {/* Skip when search is active on session switch - scroll to first match instead */}
                  <ScrollOnMount
                    targetRef={messagesEndRef}
                    skip={skipScrollToBottom}
                    onScroll={() => {
                      skipSmoothScrollUntilRef.current = Date.now() + 500
                    }}
                  />
                  {/* Empty state for compact mode - inviting conversational prompt, centered in full popover */}
                  {compactMode && turns.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center select-none gap-1 pointer-events-none">
                      <span className="text-body text-muted-foreground">{t("editPopover.whatToChange")}</span>
                      <span className="text-meta text-text-secondary">{t("editPopover.justDescribe")}</span>
                    </div>
                  )}
                  {!compactMode && hasUnrenderedLoadedMessages && (
                    <div className="flex h-64 items-center justify-center px-4 text-center">
                      <div className="max-w-sm rounded-shape-lg border border-border/50 bg-foreground/[0.04] px-4 py-3">
                        <CircleAlert className="mx-auto mb-2 h-4 w-4 text-text-secondary" />
                        <div className="text-body font-medium text-text-secondary">Conversation loaded, but no renderable messages were found.</div>
                        <p className="mt-1 text-meta text-text-secondary">Try reloading the session. If this persists, the message history may contain an unsupported format.</p>
                      </div>
                    </div>
                  )}
                  {/* Load more indicator - shown when there are older messages */}
                  {hasMoreAbove && (
                    <div className="text-center text-text-secondary text-meta py-3 select-none">
                      ↑ {t('chat.scrollUpForEarlier', { count: startIndex })}
                    </div>
                  )}
                  {turns.map((turn, index) => {
                    // Compute turn key and check if it's a search match
                    const turnKey = getTurnKey(turn)
                    const isCurrentMatch = isSearchActive && matchingTurnIds[currentMatchIndex] === turnKey
                    const isAnyMatch = isSearchActive && matchingTurnIds.includes(turnKey)
                    // Chromium skips layout/paint for distant completed turns while
                    // keeping card state, text selection and find-in-page intact.
                    const historyStyle: React.CSSProperties | undefined = !isSearchActive
                      && focusedTrajectoryTurnKey !== turnKey && !chatFocusRequest
                      && index < turns.length - 3 && (turn.type !== 'assistant' || turn.isComplete)
                      ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }
                      : undefined

                    // User turns - render with MemoizedMessageBubble
                    // Extra padding creates visual separation from AI responses
                    if (turn.type === 'user') {
                      return (
                        <div
                          key={turnKey}
                          style={historyStyle}
                          ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                          className={cn(
                            compactMode ? "pt-2 pb-1" : CHAT_LAYOUT.userMessagePadding,
                            historyStyle && HISTORY_SHADOW_ROOM,
                            "motion-content rounded-lg transition-[box-shadow,background-color]",
                            isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                            isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30",
                            focusedTrajectoryTurnKey === turnKey && "ring-2 ring-accent ring-offset-2 ring-offset-background"
                          )}
                        >
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                            sessionId={session?.id}
                            compactMode={compactMode}
                          />
                        </div>
                      )
                    }

                    // System turns (error, status, info, warning) - render with MemoizedMessageBubble
                    if (turn.type === 'system') {
                      return (
                        <div
                          key={turnKey}
                          style={historyStyle}
                          ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                          className={cn(
                            historyStyle && HISTORY_SHADOW_ROOM_BOXED,
                            "motion-content rounded-lg transition-[box-shadow,background-color]",
                            isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                            isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30",
                            focusedTrajectoryTurnKey === turnKey && "ring-2 ring-accent ring-offset-2 ring-offset-background"
                          )}
                        >
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                            sessionId={session?.id}
                            onRetry={turn.message.role === 'error' ? () => {
                              const msgs = session?.messages
                              if (!msgs) return
                              const errorIdx = msgs.findIndex(m => m.id === turn.message.id)
                              const lastUserMsg = msgs.slice(0, errorIdx).findLast(m => m.role === 'user')
                              if (lastUserMsg) {
                                onSendMessage(lastUserMsg.content)
                              }
                            } : undefined}
                            onReconcileModel={turn.message.role === 'warning'
                              && turn.message.durableOperationId
                              && !resolvedModelOperationIds.has(turn.message.durableOperationId)
                              ? setModelRecoveryMessage
                              : undefined}
                          />
                        </div>
                      )
                    }

                    // Auth-request turns - render inline auth UI
                    // mt-2 matches ResponseCard spacing for visual consistency
                    if (turn.type === 'auth-request') {
                      // Interactive only if no user message follows
                      const isAuthInteractive = !turns.slice(index + 1).some(t => t.type === 'user')
                      return (
                        <div
                          key={turnKey}
                          style={historyStyle}
                          ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                          className={cn(
                            historyStyle && HISTORY_SHADOW_ROOM_BOXED,
                            "motion-content mt-2 rounded-lg transition-[box-shadow,background-color]",
                            isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                            isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30",
                            focusedTrajectoryTurnKey === turnKey && "ring-2 ring-accent ring-offset-2 ring-offset-background"
                          )}
                        >
                          <MemoizedAuthRequestCard
                            message={turn.message}
                            sessionId={session.id}
                            onRespondToCredential={onRespondToCredential}
                            isInteractive={isAuthInteractive}
                          />
                        </div>
                      )
                    }

                    // Check if this is the last response (for Accept Plan button visibility)
                    const isLastResponse = index === turns.length - 1 || !turns.slice(index + 1).some(t => t.type === 'user')

                    // Assistant turns - render with TurnCard (buffered streaming)
                    const assistantUiKey = getAssistantTurnUiKey(turn, index)
                    const turnArtifactEvents = artifactEventsForTurn(turn.activities)
                    const response = turn.response && turnArtifactEvents.length > 0
                      ? {
                          ...turn.response,
                          text: dedupeArtifactPreviews(
                            turn.response.text,
                            turnArtifactEvents,
                            artifactStore.artifacts,
                          ),
                        }
                      : turn.response
                    return (
                      <div
                        key={turnKey}
                          style={historyStyle}
                        ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                        className={cn(
                          "pt-2",
                          historyStyle && HISTORY_SHADOW_ROOM,
                          "motion-content rounded-lg transition-[box-shadow,background-color]",
                          isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                          isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30",
                          focusedTrajectoryTurnKey === turnKey && "ring-2 ring-accent ring-offset-2 ring-offset-background"
                        )}
                      >
                      <TurnCard
                        sessionId={session.id}
                        sessionFolderPath={session.sessionFolderPath}
                        hasActiveFollowUpAnnotations={pendingFollowUpAnnotations.length > 0}
                        turnId={turn.turnId}
                        activities={turn.activities}
                        response={response}
                        responseSupplement={turnArtifactEvents.length > 0 ? (
                          <ArtifactTurnCards
                            activities={turn.activities}
                            events={turnArtifactEvents}
                            artifacts={artifactStore.artifacts}
                            onOpen={openArtifact}
                            onAccept={acceptArtifact}
                            onDiscard={discardArtifact}
                            onRevise={reviseArtifact}
                          />
                        ) : undefined}
                        intent={turn.intent}
                        isStreaming={turn.isStreaming}
                        isComplete={turn.isComplete}
                        isExpanded={expandedTurns.has(assistantUiKey)}
                        onExpandedChange={(expanded) => toggleTurn(assistantUiKey, expanded)}
                        expandedActivityGroups={expandedActivityGroups}
                        onExpandedActivityGroupsChange={setExpandedActivityGroups}
                        todos={turn.todos}
                        onOpenFile={onOpenFile}
                        onOpenUrl={onOpenUrl}
                        isLastResponse={isLastResponse}
                        compactMode={compactMode}
                        sendMessageKey={sendMessageKey}
                        openAnnotationRequest={openAnnotationRequest}
                        onReviewRecovery={compactMode ? undefined : setRecoveryActivity}
                        onBranch={session?.supportsBranching ? async (messageId: string, _options?: { newPanel?: boolean }) => {
                          if (!session) return
                          try {
                            const child = await appShellContext.onCreateSession(
                              session.workspaceId,
                              {
                                branchFromMessageId: messageId,
                                branchFromSessionId: session.id,
                                name: `Branch of ${session.name || 'Untitled'}`,
                                // Keep branch on the same backend/provider by inheriting parent session settings.
                                llmConnection: session.llmConnection,
                                model: session.model,
                                permissionMode: session.permissionMode,
                                workingDirectory: session.workingDirectory,
                                enabledSourceSlugs: session.enabledSourceSlugs,
                              }
                            )
                            navigate(routes.view.allSessions(child.id))
                          } catch (error) {
                            const rawMessage = error instanceof Error ? error.message : 'Failed to create branch'
                            const message = rawMessage.includes('source and target providers must match')
                              || rawMessage.includes('same provider/backend')
                              ? 'Branching is only supported within the same provider/backend. Switch this session connection and try again.'
                              : rawMessage
                            toast.error(t('toast.couldNotCreateBranch'), { description: message })
                          }
                        } : undefined}
                        onAddAnnotation={async (messageId, annotation) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'addAnnotation',
                              messageId,
                              annotation,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotSaveHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                            throw error
                          }
                        }}
                        onRemoveAnnotation={async (messageId, annotationId) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'removeAnnotation',
                              messageId,
                              annotationId,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotRemoveHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                          }
                        }}
                        onUpdateAnnotation={async (messageId, annotationId, patch) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'updateAnnotation',
                              messageId,
                              annotationId,
                              patch,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotUpdateHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                            throw error
                          }
                        }}
                        onSaveAndSendFollowUp={handleSaveAndSendFollowUp}
                        onAcceptPlan={() => {
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          window.dispatchEvent(new CustomEvent('craft:approve-plan', {
                            detail: {
                              sessionId: session?.id,
                              planPath,
                              includeDraftInput: true,
                              source: 'plan-card',
                            },
                          }))
                        }}
                        onAcceptPlanWithCompact={() => {
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          window.dispatchEvent(new CustomEvent('craft:approve-plan-with-compact', {
                            detail: {
                              sessionId: session?.id,
                              planPath,
                              includeDraftInput: true,
                              source: 'plan-card',
                            },
                          }))
                        }}
                        onPopOut={(text) => {
                          // Raw markdown source → code card with syntax and line numbers intact
                          openPreviewEntry({ content: text, title: t('contentPanel.preview.response'), id: `raw:${assistantUiKey}`, renderMode: 'source' })
                        }}
                        onOpenDetails={() => {
                          // Turn details → read-only pop-out document
                          const markdown = formatTurnAsMarkdown(turn)
                          openPreviewEntry({ content: markdown, title: t('contentPanel.preview.turnDetails'), id: `turn:${assistantUiKey}` })
                        }}
                        onOpenActivityDetails={(activity) => {
                          // Write tool for .md/.txt → pop-out document rather than a
                          // diff, since these are better viewed as formatted documents
                          const isDocumentWrite = activity.toolName === 'Write' && (() => {
                            const actInput = activity.toolInput as Record<string, unknown> | undefined
                            const fp = (actInput?.file_path as string) || ''
                            const ext = fp.split('.').pop()?.toLowerCase()
                            return ext === 'md' || ext === 'txt'
                          })()

                          // Edit/Write tool → Files > Changed (focused on this change)
                          // Exception: Write to .md/.txt files goes to preview panel instead
                          if ((activity.toolName === 'Edit' || activity.toolName === 'Write') && !isDocumentWrite) {
                            const changes = collectFileChangesFromActivities(turn.activities)
                            const focusedChangeId = getFirstFileChangeIdForActivity(activity.id, changes)
                            if (changes.length > 0) {
                              openDiffPanel(focusedChangeId)
                            }
                          } else {
                            // All other tools → preview panel markdown entry (formatted activity)
                            openPreviewEntry({
                              content: formatActivityAsMarkdown(activity),
                              title: activity.displayName || activity.toolName || t('contentPanel.preview.activity'),
                              id: `activity:${activity.id}`,
                            })
                          }
                        }}
                        hasEditOrWriteActivities={turn.activities.some(a =>
                          a.toolName === 'Edit' || a.toolName === 'Write'
                        )}
                        onOpenMultiFileDiff={() => {
                          const changes = collectFileChangesFromActivities(turn.activities)
                          if (changes.length > 0) {
                            openDiffPanel()
                          }
                        }}
                      />
                      </div>
                    )
                  })}
                    </motion.div>
                    )}
                    </AnimatePresence>
                  </motion.div>
                </AnimatePresence>
                {/* Processing Indicator - always visible while processing */}
                {session.isProcessing && (() => {
                  // Find the last user message timestamp for accurate elapsed time
                  const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
                  return (
                    <ProcessingIndicator
                      startTime={lastUserMsg?.timestamp}
                      statusMessage={session.currentStatus?.message}
                    />
                  )
                })()}
                {/* Scroll Anchor: For auto-scroll to bottom */}
                <div ref={messagesEndRef} />
              </div>
              </ScrollArea>
            </div>
          </div>

          {/* === NEW SESSION LANDING: brand surface for a session with no messages ===
              Same grid cell as the transcript, not a child of it: the ScrollArea's
              content layer is `display: table` (so `h-full` cannot fill it) and the
              mask wrapper above would fade the outer 32px of the mark. */}
          {showNewSessionLanding && <NewSessionLanding />}
          </div>

          {/* === INPUT CONTAINER: FreeForm or Structured Input === */}
          {/* Workspace prompt chips: only while the session is still empty, since a
              starter sends one message and then stops being relevant. */}
          {showNewSessionLanding && (chatStarters?.length ?? 0) > 0 && (
            <ChatStarters
              starters={chatStarters ?? []}
              disabled={isInputDisabled || disableSend || connectionUnavailable}
              onSelect={handleRunChatStarter}
            />
          )}
          <ChatInputZone
            compactMode={compactMode}
            permissionMode={permissionMode}
            previousPermissionMode={previousPermissionMode}
            onPermissionModeChange={onPermissionModeChange}
            tasks={backgroundTasks}
            sessionId={session.id}
            sessionFolderPath={sessionFolderPath}
            onKillTask={(taskId) => killTask(taskId, backgroundTasks.find(t => t.id === taskId)?.type === 'shell' ? 'shell' : 'agent')}
            onInsertMessage={onInputChange}
            sessionLabels={session.labels}
            labels={labels}
            onLabelsChange={onLabelsChange}
            sessionStatuses={sessionStatuses}
            currentSessionStatus={session.sessionStatus || 'todo'}
            onSessionStatusChange={onSessionStatusChange}
            activePlugin={activePlugin}
            onActivePluginChange={onActivePluginChange}
            inputProps={{
              placeholder,
              disabled: isInputDisabled,
              isProcessing: session.isProcessing,
              onAnimatedHeightChange: handleAnimatedHeightChange,
              onSubmit: handleSubmit,
              onStop: handleStop,
              textareaRef,
              currentModel,
              onModelChange,
              thinkingLevel,
              onThinkingLevelChange,
              enabledModes,
              enableCompactModelPicker,
              structuredInput,
              onStructuredResponse: handleStructuredResponse,
              inputValue,
              onInputChange,
              attachmentsValue,
              onAttachmentsChange,
              sources,
              enabledSourceSlugs: session.enabledSourceSlugs,
              onSourcesChange: handleComposerSourcesChange,
              skills,
              plugins,
              activePlugin,
              onActivePluginChange,
              workspaceId,
              workingDirectory,
              onWorkingDirectoryChange,
              disableSend: disableSend || connectionUnavailable,
              connectionUnavailable,
              isEmptySession: session.messages.length === 0,
              currentConnection: session.llmConnection,
              onConnectionChange,
              contextStatus: {
                isCompacting: session.currentStatus?.statusType === 'compacting',
                ...contextBadgeUsage(session.tokenUsage),
              },
              followUpItems: followUpInputItems,
              onFollowUpClick: handleFollowUpChipClick,
              onFollowUpIndexClick: handleFollowUpIndexClick,
            }}
          />
          </div>

          <RecoveryReconciliationDialog
            open={recoveryActivity !== null}
            sessionId={session.id}
            activity={recoveryActivity}
            onClose={() => setRecoveryActivity(null)}
          />
          <ModelRecoveryReconciliationDialog
            open={modelRecoveryMessage !== null}
            sessionId={session.id}
            modelOperationId={modelRecoveryMessage?.durableOperationId}
            onClose={() => setModelRecoveryMessage(null)}
            onResolved={(operationId) => setResolvedModelOperationIds(previous => {
              const next = new Set(previous)
              next.add(operationId)
              return next
            })}
          />
        </div>
      ) : null}

    </div>
  )
})

/**
 * MessageBubble - Renders a single message based on its role
 *
 * Message Roles & Styles:
 * - user:      Right-aligned, blue (bg-foreground), white text
 * - assistant: Left-aligned, gray (bg-muted), markdown rendered with clickable links
 * - error:     Left-aligned, red border/bg, warning icon + error message
 * - status:    Centered pill badge with pulsing dot (e.g., t("chat.processing.thinking"))
 *
 * Note: Tool messages are rendered by TurnCard, not MessageBubble
 */
