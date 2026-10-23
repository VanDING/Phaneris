/**
 * Run — the session's run view.
 *
 * One frame, five reading paths: Overview answers "how did the run go", the
 * Trajectory ledger shows every record, Decision shows what the auxiliary layer
 * changed, Context shows what the model could see per request, and Map keeps the
 * execution graph. One strip carries the tabs, run state and scope. The
 * workbench already names the session, so the panel needs no second header.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotionConfig } from 'motion/react'
import { motionTween } from '../../lib/motion'
import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react'
import type { SessionDecisionStatus } from '@phaneris/shared/decisions/session'
import type { DecisionLayerFeature } from '@phaneris/shared/decisions/settings'
import type { PiUsage } from '@phaneris/core/types'
import type { TrajectorySnapshot, WorkbenchFocus } from './trajectory-contract'
import { deriveTrajectoryLayout, flattenTurnRecords, type TrajectoryCellProps, type TrajectoryTurnModel } from './trajectory-layout'
import { searchTrajectory } from './trajectory-search-index'
import { trajectoryTimelineFocusIndexes, type TrajectoryTimelineMode, type TrajectoryTimeRange } from './trajectory-timeline'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import { TrajectoryStrip } from './TrajectoryStrip'
import { TrajectoryTable } from './TrajectoryTable'
import { RecordInspector } from './RecordInspector'
import { TrajectoryMapView } from './TrajectoryMapView'
import { RunOverview } from './RunOverview'
import { RunContextView } from './RunContextView'
import type { RunDecisionSummary, RunReliabilityFacts } from './run-model'
import type { TrajectorySessionMap } from './trajectory-session-map'
import css from './run-view.module.css'
import './trajectory-theme.css'

const DURATION_PREFERENCE_KEY = 'craft.trajectory.duration'
const VIEW_PREFERENCE_KEY = 'craft.trajectory.view'
const RUN_VIEWS = ['overview', 'trajectory', 'decisions', 'context', 'map'] as const

export type TrajectoryRunView = typeof RUN_VIEWS[number]

/** A one-shot request from another Run view to focus a decision record. */
export interface RunDecisionIntent {
  nonce: number
  status?: SessionDecisionStatus
  feature?: DecisionLayerFeature
}

export interface RunDecisionSlot {
  onOpenContext: (messageId: string) => void
  intent?: RunDecisionIntent
}

/** Loading / error state of the session evidence the whole view depends on. */
export interface RunViewState {
  loading?: boolean
  error?: boolean
  onRetry?: () => void
}

function readDurationPreference(): boolean {
  try {
    return localStorage.getItem(DURATION_PREFERENCE_KEY) === '1'
  } catch {
    return false
  }
}

function readViewPreference(): TrajectoryRunView {
  try {
    const value = localStorage.getItem(VIEW_PREFERENCE_KEY)
    if (value === 'prompt') return 'context'
    if (value === 'timeline' || value === 'events') return 'trajectory'
    if (value === 'overview' || value === 'trajectory' || value === 'decisions' || value === 'context' || value === 'map') return value
  } catch {
    // Best-effort preference only.
  }
  return 'overview'
}

export interface TrajectoryViewProps {
  /** Decisions view content; the slot receives the Context hand-off callback. */
  decisions?: (slot: RunDecisionSlot) => ReactNode
  snapshot: TrajectorySnapshot
  /** Session cumulative usage for the inspector's usage tab. */
  sessionTotal?: PiUsage
  /** Whether the session is currently processing (reserved for streaming). */
  isProcessing?: boolean
  /** Session/environment facts formerly shown in the standalone Context panel. */
  contextSummary?: TrajectoryContextSummary
  /** Decision facts for the Overview impact card. */
  decisionSummary?: RunDecisionSummary
  /** Retained-runtime reliability facts for the diagnostics card. */
  reliability?: RunReliabilityFacts
  /** Current session and its connected branch/subtask family. */
  sessionMap?: TrajectorySessionMap
  /** Loading / error state for the evidence the view projects. */
  viewState?: RunViewState
  onOpenChat?: (messageId: string) => void
  onOpenReview?: (changeId: string) => void
  onOpenFile?: (path: string) => void
  onOpenSession?: (sessionId: string) => void
  focus?: WorkbenchFocus
  onFocusChange?: (focus: Omit<WorkbenchFocus, 'sessionId' | 'updatedAt'>) => void
}

export interface TrajectoryContextSummary {
  name?: string
  status?: string
  model?: string
  permissionMode?: string
  workingDirectory?: string
  labels?: readonly string[]
  messageCount?: number
  createdAt?: number
  lastActivityAt?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  contextTokens?: number
  /** Model context window when the host knows it; the occupancy ratio stays hidden otherwise. */
  contextWindow?: number
  costUsd?: number
  unknownCostRequests?: number
  estimatedCostRequests?: number
  /** Workspace identity for the run breadcrumb. */
  workspaceName?: string
  /** Remote workspaces are named as such instead of "local session". */
  remote?: boolean
}

/** Stable record identity used for assistant folding. */
function assistantRecordId(cell: TrajectoryCellProps): string {
  return cell.sourceSeq ?? cell.callId ?? `index-${cell.index}`
}

/** The request that first carried a message, for cross-view hand-offs. */
function requestSeqForMessage(snapshot: TrajectorySnapshot, messageId: string): number | undefined {
  let ordinal = 0
  for (const message of snapshot.messages) {
    if (message.role === 'assistant' && message.requestSeq !== undefined) ordinal += 1
    if (message.id !== messageId) continue
    return message.role === 'assistant' && message.requestSeq !== undefined ? ordinal : Math.max(1, ordinal + 1)
  }
  return undefined
}

export function TrajectoryView({
  snapshot, sessionTotal, isProcessing, contextSummary, decisionSummary, reliability, sessionMap, viewState,
  decisions, onOpenChat, onOpenReview, onOpenFile, onOpenSession, focus, onFocusChange,
}: TrajectoryViewProps) {
  const { t } = useTranslation()
  const [runView, setRunView] = useState<TrajectoryRunView>(readViewPreference)
  const [visitedViews, setVisitedViews] = useState(() => new Set<TrajectoryRunView>([runView]))
  const viewId = useId()
  useEffect(() => {
    // Selection can change after native focus scrolling; keep the active tab
    // fully visible once React has committed its selected weight and underline.
    document.getElementById(`${viewId}-tab-${runView}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [runView, viewId])
  const reduceMotion = useReducedMotionConfig()
  const [searchQuery, setSearchQuery] = useState('')
  const [eventFilter, setEventFilter] = useState<'all' | 'conversation' | 'tools' | 'errors'>('all')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set())
  const [selectedCell, setSelectedCell] = useState<TrajectoryCellProps | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [timelineMode, setTimelineMode] = useState<TrajectoryTimelineMode>(() => readDurationPreference() ? 'duration' : 'sequence')
  const [timelineRange, setTimelineRange] = useState<TrajectoryTimeRange | null>(null)
  const [actualDuration, setActualDuration] = useState<boolean>(readDurationPreference)
  const [actualTime, setActualTime] = useState(false)
  const [contextFocus, setContextFocus] = useState<number | undefined>(focus?.requestSeq)
  const [contextCategory, setContextCategory] = useState<string | undefined>()
  const [decisionIntent, setDecisionIntent] = useState<RunDecisionIntent | undefined>()
  const seenAssistantIdsRef = useRef(new Set<string>())

  const turns = useMemo<readonly TrajectoryTurnModel[]>(() => {
    return deriveTrajectoryLayout({
      contributions: snapshot.contributions,
      prompts: snapshot.prompts,
      requestUsage: snapshot.requestUsage,
      callSchemas: snapshot.callSchemas,
    })
  }, [snapshot])

  const flatRecords = useMemo(() => flattenTurnRecords(turns), [turns])
  const eventRecords = useMemo(() => flatRecords.filter(record => {
    if (eventFilter === 'all') return true
    if (eventFilter === 'errors') return record.cell.isError
    if (eventFilter === 'tools') return record.cell.kind === 'tool' || record.cell.kind === 'subtool'
    return record.cell.kind === 'system' || record.cell.kind === 'user' || record.cell.kind === 'message' || record.cell.kind === 'context'
  }), [eventFilter, flatRecords])

  const searchMatchIndexes = useMemo(
    () => searchQuery.trim() === '' ? null : searchTrajectory(flatRecords, searchQuery),
    [flatRecords, searchQuery],
  )

  const timelineFocusIndexes = useMemo(
    () => timelineRange === null
      ? null
      : trajectoryTimelineFocusIndexes(turns, timelineRange, timelineMode),
    [turns, timelineRange, timelineMode],
  )

  const allTurnsCollapsed = turns.length > 0 && turns.every(t => t.turn === null || collapsedTurns.has(t.turn))
  const allAssistantsCollapsed = useMemo(() => {
    if (turns.length === 0) return false
    let hasAssistant = false
    for (const turn of turns) {
      for (const group of turn.groups) {
        for (const cell of group.cells) {
          if (cell.kind === 'message') {
            hasAssistant = true
            if (!collapsedAssistants.has(assistantRecordId(cell))) {
              return false
            }
          }
        }
      }
    }
    return hasAssistant
  }, [turns, collapsedAssistants])

  useEffect(() => {
    const newAssistantIds: string[] = []
    for (const turn of turns) {
      for (const group of turn.groups) {
        for (const cell of group.cells) {
          if (cell.kind !== 'message') continue
          const id = assistantRecordId(cell)
          if (!seenAssistantIdsRef.current.has(id)) newAssistantIds.push(id)
        }
      }
    }
    if (newAssistantIds.length === 0) return
    for (const id of newAssistantIds) seenAssistantIdsRef.current.add(id)
    setCollapsedAssistants((current) => new Set([...current, ...newAssistantIds]))
  }, [turns])

  useEffect(() => {
    if (focus?.requestSeq !== undefined) setContextFocus(focus.requestSeq)
  }, [focus?.requestSeq])

  const toggleAllTurns = () => {
    const all = new Set<number>()
    if (!allTurnsCollapsed) {
      for (const t of turns) if (t.turn !== null) all.add(t.turn)
    }
    setCollapsedTurns(all)
  }

  const toggleTurn = (turn: number | null) => {
    if (turn === null) return
    const next = new Set(collapsedTurns)
    if (next.has(turn)) next.delete(turn)
    else next.add(turn)
    setCollapsedTurns(next)
  }

  const toggleAllAssistants = () => {
    const all = new Set<string>()
    if (!allAssistantsCollapsed) {
      for (const turn of turns) {
        for (const group of turn.groups) {
          for (const cell of group.cells) {
            if (cell.kind === 'message') {
              all.add(assistantRecordId(cell))
            }
          }
        }
      }
    }
    setCollapsedAssistants(all)
  }

  const toggleAssistant = (recordId: string) => {
    const next = new Set(collapsedAssistants)
    if (next.has(recordId)) next.delete(recordId)
    else next.add(recordId)
    setCollapsedAssistants(next)
  }

  const onSelectIndex = (index: number) => {
    setSelectedIndex(index)
    for (const turn of turns) {
      for (const group of turn.groups) {
        for (const cell of group.cells) {
          if (cell.index === index) {
            setSelectedCell(cell)
            onFocusChange?.({
              source: 'run',
              recordIndex: index,
              requestSeq: cell.requestSeq ?? cell.sourceMessage?.requestSeq,
              turn: turn.turn,
              messageId: cell.sourceSeq,
              callId: cell.callId,
            })
            return
          }
        }
      }
    }
  }

  const selectRunView = (view: TrajectoryRunView) => {
    if (view !== 'context') setContextCategory(undefined)
    setVisitedViews(current => current.has(view) ? current : new Set([...current, view]))
    setRunView(view)
    try {
      localStorage.setItem(VIEW_PREFERENCE_KEY, view)
    } catch {
      // Best-effort preference only.
    }
  }

  const focusContext = (requestSeq: number | undefined, category?: string) => {
    if (requestSeq === undefined) return
    setContextFocus(requestSeq)
    if (category) setContextCategory(category)
    onFocusChange?.({ source: 'run', requestSeq })
    selectRunView('context')
  }

  const openDecisionContext = (messageId: string) => {
    focusContext(requestSeqForMessage(snapshot, messageId))
  }

  const openDecisionIssues = (status: 'failed' | 'fallback') => {
    setDecisionIntent({ nonce: Date.now(), status })
    selectRunView('decisions')
  }

  const openTrajectory = (index?: number) => {
    selectRunView('trajectory')
    if (index !== undefined) onSelectIndex(index)
  }

  const handleActualDurationChange = (next: boolean) => {
    setActualDuration(next)
    try {
      localStorage.setItem(DURATION_PREFERENCE_KEY, next ? '1' : '0')
    } catch {
      // storage may be unavailable (private mode) — preference is best-effort
    }
    setTimelineMode(next ? 'duration' : 'sequence')
  }

  const handleActualTimeChange = (next: boolean) => {
    setActualTime(next)
    setTimelineMode(next ? 'actual' : 'duration')
  }

  // Previous request prompt for the inspector diff tab.
  const previousPrompt = useMemo(() => {
    const seq = selectedCell?.requestSeq
    if (seq === undefined) return undefined
    return snapshot.prompts.get(seq - 1)
  }, [selectedCell, snapshot.prompts])

  const toolbar = (showTimelineControls: boolean, showEventFilters = false) => (
    <TrajectoryToolbar
      actualDuration={actualDuration}
      onActualDurationChange={handleActualDurationChange}
      actualTime={actualTime}
      onActualTimeChange={handleActualTimeChange}
      allTurnsCollapsed={allTurnsCollapsed}
      onToggleAllTurns={toggleAllTurns}
      allAssistantsCollapsed={allAssistantsCollapsed}
      onToggleAllAssistants={toggleAllAssistants}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchMatchCount={searchMatchIndexes?.size}
      showTimelineControls={showTimelineControls}
      isProcessing={isProcessing}
      eventFilter={showEventFilters ? eventFilter : undefined}
      onEventFilterChange={showEventFilters ? setEventFilter : undefined}
      eventCount={showEventFilters ? eventRecords.length : undefined}
    />
  )

  const inspector = selectedCell && (
    <RecordInspector
      cell={selectedCell}
      previousPrompt={previousPrompt}
      sessionTotal={sessionTotal}
      onOpenChat={onOpenChat}
      onOpenReview={onOpenReview}
      onOpenFile={onOpenFile}
      onClose={() => setSelectedCell(null)}
    />
  )

  const ledger = (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <TrajectoryTable
        flatRecords={eventRecords}
        collapsedTurns={collapsedTurns}
        onToggleTurn={toggleTurn}
        collapsedAssistants={collapsedAssistants}
        onToggleAssistant={toggleAssistant}
        searchMatchIndexes={searchMatchIndexes}
        timelineFocusIndexes={timelineFocusIndexes}
        selectedIndex={selectedIndex}
        onSelectIndex={onSelectIndex}
      />

      {inspector}
    </div>
  )

  const loading = viewState?.loading === true
  const failed = viewState?.error === true
  const empty = !loading && !failed && snapshot.contributions.length === 0
  const ready = !loading && !failed && !empty
  const turnCount = turns.filter(turn => turn.turn !== null).length
  const requestCount = snapshot.contributions.filter(contribution => contribution.kind === 'request-header').length
  const stateLabel = loading
    ? t('run.state.loading')
    : failed
      ? t('run.state.unavailable')
      : empty
        ? t('run.state.waiting')
        : isProcessing
          ? t('run.state.running')
          : t('run.state.complete')
  const stateTone = loading
    ? css.statusNeutral
    : failed
      ? css.statusWarning
      : empty
        ? css.statusNeutral
        : isProcessing
          ? css.statusAccent
          : css.statusSuccess
  const tailLabel = loading
    ? t('run.state.loadingTail')
    : failed
      ? t('run.state.unavailableTail')
      : empty
        ? t('run.state.waitingTail')
        : isProcessing
          ? t('run.state.runningTail', { requests: requestCount })
          : t('run.state.scope', { turns: turnCount, requests: requestCount })

  const stateView = loading || failed || empty
    ? (
      <div className={css.emptyState} data-run-empty={failed ? 'error' : loading ? 'loading' : 'empty'}>
        {failed ? <AlertTriangle /> : <Activity />}
        <h2>{failed ? t('run.empty.errorTitle') : loading ? t('run.empty.loadingTitle') : t('run.empty.emptyTitle')}</h2>
        <p>{failed ? t('run.empty.errorHint') : loading ? t('run.empty.loadingHint') : t('run.empty.emptyHint')}</p>
        {failed && viewState?.onRetry && (
          <button type="button" className={`${css.outlineButton} craft-control`} onClick={viewState.onRetry}>
            <RefreshCw />{t('run.empty.retry')}
          </button>
        )}
      </div>
    )
    : null

  return (
    <div className="trajectory-root flex h-full min-h-0 flex-col @container/trajectory">
      <div className={css.runView} data-run-view>
        <div className={css.runToolbar} data-run-toolbar>
          <div
            className={css.runTabs}
            role="tablist"
            // Roving focus lives on the tabs. The container is programmatically
            // focusable only so the composite widget satisfies the a11y contract
            // without adding a second tab stop.
            tabIndex={-1}
            aria-label={t('trajectory.views.label')}
            onKeyDown={event => {
              if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
              const index = RUN_VIEWS.indexOf(runView)
              const next = event.key === 'ArrowRight' ? (index + 1) % RUN_VIEWS.length
                : event.key === 'ArrowLeft' ? (index + RUN_VIEWS.length - 1) % RUN_VIEWS.length
                  : event.key === 'Home' ? 0 : RUN_VIEWS.length - 1
              event.preventDefault()
              const target = RUN_VIEWS[next]!
              selectRunView(target)
              document.getElementById(`${viewId}-tab-${target}`)?.focus()
            }}
          >
            {RUN_VIEWS.map(view => (
              <button
                key={view}
                type="button"
                role="tab"
                id={`${viewId}-tab-${view}`}
                aria-controls={`${viewId}-panel-${view}`}
                tabIndex={runView === view ? 0 : -1}
                aria-selected={runView === view}
                className={`${css.runTab} craft-segment`}
                onClick={() => selectRunView(view)}
              >
                {t(`trajectory.views.${view}`)}
                {runView === view && (
                  <motion.span
                    layoutId="run-active-view"
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
                    style={{ background: 'var(--run-accent)' }}
                    transition={motionTween(reduceMotion, 'standard', 'move')}
                  />
                )}
              </button>
            ))}
          </div>
          <div className={css.runState}>
            <span className={`${css.statusBadge} ${stateTone}`} data-run-state>
              <span className={css.statusDot} />{stateLabel}
            </span>
            <span className={css.tabsTail} data-run-scope>{tailLabel}</span>
          </div>
        </div>

          {isProcessing && ready && (
            <div className={css.runningStrip} data-run-running>
              <Activity />
              {t('run.runningStrip', { requests: requestCount + 1 })}
            </div>
          )}
          {stateView ?? (
            <div className={css.runMain}>
              {visitedViews.has('overview') && (
                <section id={`${viewId}-panel-overview`} role="tabpanel" aria-labelledby={`${viewId}-tab-overview`} hidden={runView !== 'overview'} className={`${css.pane} motion-view-enter`}>
                  <RunOverview
                    snapshot={snapshot}
                    turns={turns}
                    records={flatRecords}
                    isProcessing={isProcessing}
                    contextSummary={contextSummary}
                    decisionSummary={decisionSummary}
                    reliability={reliability}
                    onOpenTrajectory={openTrajectory}
                    onOpenContext={focusContext}
                    onOpenDecisions={() => selectRunView('decisions')}
                    onOpenDecisionIssues={openDecisionIssues}
                  />
                </section>
              )}
              {visitedViews.has('trajectory') && (
                <section id={`${viewId}-panel-trajectory`} role="tabpanel" aria-labelledby={`${viewId}-tab-trajectory`} hidden={runView !== 'trajectory'} className={`${css.pane} ${css.ledgerTheme} motion-view-enter`}>
                  <div className="flex h-full min-h-0 flex-col">
                    {toolbar(true, true)}
                    <TrajectoryStrip
                      turns={turns}
                      mode={timelineMode}
                      range={timelineRange}
                      selectedIndex={selectedIndex}
                      onRangeChange={(range) => {
                        setTimelineRange(range)
                        if (range) onFocusChange?.({ source: 'run', timelineRange: { ...range, mode: timelineMode } })
                      }}
                      onRecordSelect={onSelectIndex}
                    />
                    {ledger}
                  </div>
                </section>
              )}
              {visitedViews.has('decisions') && (
                <section id={`${viewId}-panel-decisions`} role="tabpanel" aria-labelledby={`${viewId}-tab-decisions`} hidden={runView !== 'decisions'} className={`${css.pane} motion-view-enter`}>
                  {decisions
                    ? decisions({ onOpenContext: openDecisionContext, intent: decisionIntent })
                    : <div className={css.emptyState}><p>{t('run.decision.unavailable')}</p></div>}
                </section>
              )}
              {visitedViews.has('context') && (
                <section id={`${viewId}-panel-context`} role="tabpanel" aria-labelledby={`${viewId}-tab-context`} hidden={runView !== 'context'} className={`${css.pane} motion-view-enter`}>
                  <RunContextView
                    snapshot={snapshot}
                    focusedRequestSeq={contextFocus ?? focus?.requestSeq}
                  focusCategory={contextCategory}
                    onRequestFocus={requestSeq => {
                      setContextFocus(requestSeq)
                      onFocusChange?.({ source: 'run', requestSeq })
                    }}
                    onOpenChat={onOpenChat}
                    onOpenFile={onOpenFile}
                  />
                </section>
              )}
              {visitedViews.has('map') && sessionMap && (
                <section id={`${viewId}-panel-map`} role="tabpanel" aria-labelledby={`${viewId}-tab-map`} hidden={runView !== 'map'} className={`${css.pane} motion-view-enter`}>
                  <TrajectoryMapView
                    key={sessionMap.currentSessionId}
                    snapshot={snapshot}
                    isProcessing={isProcessing}
                    isActive={runView === 'map'}
                    turns={turns}
                    sessionMap={sessionMap}
                    onSelectRecord={(index) => {
                      setSearchQuery('')
                      setEventFilter('all')
                      setTimelineRange(null)
                      const record = flatRecords.find(record => record.cell.index === index)
                      if (record?.turn !== null && record?.turn !== undefined) {
                        setCollapsedTurns(current => {
                          const next = new Set(current)
                          next.delete(record.turn!)
                          return next
                        })
                      }
                      // Reveal only the owning ledger group; preserve unrelated folds.
                      if (record?.cell.kind === 'tool' || record?.cell.kind === 'subtool') {
                        let position = flatRecords.indexOf(record) - 1
                        while (position >= 0 && (flatRecords[position]?.cell.kind === 'tool' || flatRecords[position]?.cell.kind === 'subtool')) position -= 1
                        const owner = flatRecords[position]?.cell
                        if (owner?.kind === 'message') setCollapsedAssistants(current => {
                          const next = new Set(current)
                          next.delete(assistantRecordId(owner))
                          return next
                        })
                      }
                      onSelectIndex(index)
                      selectRunView('trajectory')
                    }}
                    onOpenSession={onOpenSession}
                  />
                </section>
              )}
            </div>
          )}
      </div>
    </div>
  )
}
