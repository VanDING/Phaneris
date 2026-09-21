/**
 * SurfaceSlot
 *
 * Renders a foreground conversation/Primary Surface or active Workbench item.
 *
 * Foreground conversations share the available area and can be removed from
 * the presentation without deleting their Session. Beside Workbench, Primary
 * keeps a reading width while Workbench fills the remaining space.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { motion, useReducedMotionConfig } from 'motion/react'
import { motionTween } from '@phaneris/ui/motion'
import { cn } from '@/lib/utils'
import { X, ChevronLeft } from 'lucide-react'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import {
  activateForegroundSessionAtom,
  focusedSurfaceEntryIdAtom,
  removeForegroundSessionAtom,
  type SurfaceRenderEntry,
} from '@/atoms/workbench'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'
import { BoundPanelContent, isBoundPanelType } from '@/components/content-panels/bound-panel-content'
import { MIN_WORKBENCH_WIDTH } from '@/atoms/workbench'
import { PANEL_MIN_WIDTH, RADIUS_EDGE, RADIUS_INNER } from './panel-constants'

interface SurfaceSlotProps {
  entry: SurfaceRenderEntry
  isOnly: boolean
  /** Whether this surface currently owns keyboard focus. */
  isFocusedPanel: boolean
  /** True when two or more conversations are presented side by side. */
  isConversationGroup?: boolean
  /** True for the single Primary conversation beside an open Workbench. */
  isWorkbenchCompanion?: boolean
  companionPrimaryWidth?: number
  isSidebarAndNavigatorHidden: boolean
  /** Whether this panel's left corners touch the window edge (no sidebar/navigator before it) */
  isAtLeftEdge: boolean
  /** Whether this surface's right corners touch the window edge */
  isAtRightEdge: boolean
  /** Optional strip rendered above the surface content (Workbench tabs). */
  topSlot?: React.ReactNode
  /** Optional sash element rendered before this panel */
  sash?: React.ReactNode
  /** Compact (mobile) mode — shows back button in panel header */
  isCompact?: boolean
  hidden?: boolean
  /** A pointer drag owns the panel width right now — never ease it. */
  isResizing?: boolean
  /** Compact replacement-mode back behavior. */
  onCompactBack?: () => void
}

/**
 * How a panel takes its share of the layout row.
 *
 * Every state declares the same properties so the row can interpolate between
 * them: opening or closing the workbench moves the Primary's share of the free
 * space, and that share is the only geometry that changes. The Workbench keeps
 * `flex-grow: 1`, so it takes whatever the Primary leaves and the two panels
 * never animate against each other. `min-width` moves with `flex-basis` so the
 * minimum can never freeze the panel mid-transition.
 */
function panelShareStyle({
  isCompact,
  isOnly,
  isWorkbench,
  isWorkbenchCompanion,
  companionPrimaryWidth,
}: Pick<SurfaceSlotProps, 'isCompact' | 'isOnly' | 'isWorkbenchCompanion'> & {
  isWorkbench: boolean
  companionPrimaryWidth: number
}): React.CSSProperties {
  if (isCompact || isOnly) {
    return { flexGrow: 1, flexShrink: 1, flexBasis: '0px', minWidth: '0px' }
  }
  if (isWorkbench) {
    return { flexGrow: 1, flexShrink: 1, flexBasis: '0px', minWidth: `${MIN_WORKBENCH_WIDTH}px` }
  }
  if (isWorkbenchCompanion) {
    return {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: `${companionPrimaryWidth}px`,
      minWidth: `${companionPrimaryWidth}px`,
    }
  }
  return { flexGrow: 1, flexShrink: 1, flexBasis: '0px', minWidth: `${PANEL_MIN_WIDTH}px` }
}

export function SurfaceSlot({
  entry,
  isOnly,
  isFocusedPanel,
  isConversationGroup = false,
  isWorkbenchCompanion = false,
  companionPrimaryWidth,
  isSidebarAndNavigatorHidden,
  isAtLeftEdge,
  isAtRightEdge,
  topSlot,
  sash,
  isCompact,
  hidden = false,
  isResizing = false,
  onCompactBack,
}: SurfaceSlotProps) {
  const { t } = useTranslation()
  const activateForegroundSession = useSetAtom(activateForegroundSessionAtom)
  const removeForegroundSession = useSetAtom(removeForegroundSessionAtom)
  const setFocusedSurface = useSetAtom(focusedSurfaceEntryIdAtom)
  const parentContext = useAppShellContext()
  const reduceMotion = useReducedMotionConfig()
  const navState = parseRouteToNavigationState(entry.route)
  const isWorkbench = entry.surfaceRole === 'workbench'

  // Build close button for PanelHeader (via context override)
  const closeButton = useMemo(() => {
    if (!(isConversationGroup && entry.sessionId)) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<X className="h-4 w-4" />}
        onClick={() => removeForegroundSession(entry.sessionId!)}
        onPointerDown={(event) => event.stopPropagation()}
        tooltip={t("common.close")}
      />
    )
  }, [entry.sessionId, isConversationGroup, removeForegroundSession, t])

  // Build back button for compact mode — closes the panel to reveal the session list.
  // Same PanelHeaderCenterButton style as X and share, just on the left side.
  const backButton = useMemo(() => {
    if (!isCompact || !onCompactBack) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={onCompactBack}
        tooltip={t("common.backToList")}
      />
    )
  }, [isCompact, onCompactBack, t])

  // Override AppShellContext so page headers receive surface controls and
  // session input behavior follows the currently focused surface.
  const contextOverride = useMemo(() => ({
    ...parentContext,
    trailingAction: closeButton,
    expandButton: undefined,
    leadingAction: backButton,
    isFocusedPanel,
  }), [parentContext, closeButton, backButton, isFocusedPanel])

  const handlePointerDown = useCallback(() => {
    if (entry.surfaceRole === 'primary' && entry.sessionId) activateForegroundSession(entry.sessionId)
    if (!isFocusedPanel) {
      setFocusedSurface(entry.id)
    }
  }, [activateForegroundSession, entry.id, entry.sessionId, entry.surfaceRole, isFocusedPanel, setFocusedSurface])

  return (
    <>
      {sash}
      <div
        onPointerDown={handlePointerDown}
        data-panel-role="content"
        data-surface-id={entry.id}
        inert={hidden}
        aria-hidden={hidden || undefined}
        data-compact={isCompact || undefined}
        data-active-conversation={isConversationGroup ? isFocusedPanel : undefined}
        className={cn(
          'h-full overflow-hidden relative @container/panel',
          !isOnly && isFocusedPanel
            ? cn('shadow-panel-focused z-[1]', isConversationGroup && 'ring-1 ring-inset ring-accent/30')
            : 'shadow-middle z-0',
          'bg-paper',
        )}
        style={{
          // Keep Primary mounted while a tool temporarily fills the content area.
          display: hidden ? 'none' : undefined,
          // The unfocused surface overrides --background so all
          // bg-background children render at the elevated (dimmed) background.
          ...(!isFocusedPanel && !isOnly
            ? {
                '--background': 'var(--background-elevated)',
                '--shadow-minimal': 'var(--shadow-minimal-flat)',
                '--user-message-bubble': 'var(--user-message-bubble-dimmed)',
              } as React.CSSProperties
            : {}
          ),
          // Corner radii: edge corners (touching window boundary) vs interior corners.
          // Compact mode panels run flush to the viewport floor — no rounded bottom.
          borderTopLeftRadius: RADIUS_INNER,
          borderBottomLeftRadius: isCompact ? 0 : (isAtLeftEdge ? RADIUS_EDGE : RADIUS_INNER),
          borderTopRightRadius: RADIUS_INNER,
          borderBottomRightRadius: isCompact ? 0 : (isAtRightEdge ? RADIUS_EDGE : RADIUS_INNER),
          ...panelShareStyle({
            isCompact,
            isOnly,
            isWorkbench,
            isWorkbenchCompanion,
            companionPrimaryWidth: companionPrimaryWidth ?? PANEL_MIN_WIDTH,
          }),
          // Layout process for the panel set: opening or closing the Workbench
          // changes this panel's share of the row, and the share is the only
          // geometry that moves. Content above it animates through the shared
          // tokens, so a panel never fades out and back in to hide a reflow.
          // A pointer drag owns the width directly and must not be eased; the
          // global reduced-motion rule collapses these durations to 1ms.
          transitionProperty: 'flex-grow, flex-basis, min-width',
          transitionDuration: isResizing ? '0s' : 'var(--motion-duration-spatial)',
          transitionTimingFunction: 'var(--motion-ease-move)',
        }}
      >
        {isConversationGroup && !isFocusedPanel && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[2] bg-foreground/[0.018]"
          />
        )}
        {isConversationGroup && isFocusedPanel && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 z-[3] h-0.5 w-7 -translate-x-1/2 rounded-b-full bg-accent/65"
          />
        )}
        <div className="h-full flex flex-col">
          {topSlot}
          <div className="min-h-0 flex-1">
            <AppShellProvider value={contextOverride}>
              {isBoundPanelType(entry.panelType) ? (
              /* Bound workbench panels are dispatched by panelType (never by the
                 parsed nav state) so a stale/unparseable route can neither render
                 the wrong content nor fall through to the global navigation.
                 Light opacity fade on open; reduced motion renders instantly. */
              reduceMotion ? (
                <BoundPanelContent entry={entry} />
              ) : (
                <motion.div
                  className="h-full min-h-0"
                  initial={{ opacity: 0, x: 8, scale: 0.997 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={motionTween(reduceMotion, 'standard', 'enter')}
                >
                  <BoundPanelContent entry={entry} />
                </motion.div>
              )
              ) : (
                <MainContentPanel
                  navStateOverride={navState}
                  isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
                />
              )}
            </AppShellProvider>
          </div>
        </div>
      </div>
    </>
  )
}
