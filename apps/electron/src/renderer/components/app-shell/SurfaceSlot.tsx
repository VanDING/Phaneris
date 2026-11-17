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
import { useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { X, ChevronLeft } from 'lucide-react'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import type { ViewRoute } from '../../../shared/routes'
import { navigate } from '@/lib/navigate'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import {
  activateForegroundSessionAtom,
  focusedSurfaceEntryIdAtom,
  removeForegroundSessionAtom,
  type SurfaceRenderEntry,
} from '@/atoms/workbench'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { PreviewHeaderIconButton } from '@phaneris/ui'
import { MainContentPanel } from './MainContentPanel'
import { residentNavigationAtom } from '../resident-assistant/resident-navigation'
import { BoundPanelContent, isBoundPanelType } from '@/components/content-panels/bound-panel-content'
import { RADIUS_EDGE, RADIUS_INNER } from './panel-constants'
import { surfaceLauncherLabelKey, type SurfaceLauncherKind } from '@/lib/surface-launchers'

interface SurfaceSlotProps {
  entry: SurfaceRenderEntry
  isOnly: boolean
  /** Whether this surface currently owns keyboard focus. */
  isFocusedPanel: boolean
  /** True when two or more conversations are presented side by side. */
  isConversationGroup?: boolean
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
  /** Compact replacement-mode back behavior. */
  onCompactBack?: () => void
}

export function SurfaceSlot({
  entry,
  isOnly,
  isFocusedPanel,
  isConversationGroup = false,
  isSidebarAndNavigatorHidden,
  isAtLeftEdge,
  isAtRightEdge,
  topSlot,
  sash,
  isCompact,
  hidden = false,
  onCompactBack,
}: SurfaceSlotProps) {
  const { t } = useTranslation()
  const activateForegroundSession = useSetAtom(activateForegroundSessionAtom)
  const removeForegroundSession = useSetAtom(removeForegroundSessionAtom)
  const setFocusedSurface = useSetAtom(focusedSurfaceEntryIdAtom)
  const parentContext = useAppShellContext()
  const assistantPresentation = useAtomValue(residentNavigationAtom)
  const assistantOpen = !!(assistantPresentation?.open || assistantPresentation?.closing) && assistantPresentation?.workspaceId === parentContext.activeWorkspaceId
  const navState = parseRouteToNavigationState(entry.route)
  // Session titles, for naming the content landmark uniquely per pane.
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionTitles = useMemo(() => {
    const titles = new Map<string, string>()
    for (const [id, meta] of sessionMetaMap) {
      const title = getSessionTitle(meta).trim()
      if (title) titles.set(id, title)
    }
    return titles
  }, [sessionMetaMap])

  // Build close button for PanelHeader (via context override)
  const closeButton = useMemo(() => {
    if (!entry.sessionId || (!isConversationGroup && window.electronAPI.getRuntimeEnvironment?.() !== 'electron')) return undefined
    return (
      <PreviewHeaderIconButton
        onClick={() => {
          if (!removeForegroundSession(entry.sessionId!)) navigate(entry.route.replace(/\/session\/.*$/, '') as ViewRoute, { skipAutoSelect: true })
        }}
        onPointerDown={(event) => event.stopPropagation()}
        tooltip={t("common.close")}
        aria-label={t("common.close")}
      ><X className="h-4 w-4" /></PreviewHeaderIconButton>
    )
  }, [entry.sessionId, entry.route, isConversationGroup, removeForegroundSession, t])

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

  // A landmark needs a name that is unique on the page. Several conversation
  // panes can be open side by side, all sharing the "Sessions" launcher label, so
  // the name is qualified by the pane's own identity: its session title when it
  // has one, otherwise its position among the open surfaces.
  const paneLabel = useMemo(() => {
    const base = t(surfaceLauncherLabelKey(entry.panelType as SurfaceLauncherKind))
    const title = entry.sessionId ? sessionTitles.get(entry.sessionId) : undefined
    if (title) return `${base} — ${title}`
    return isOnly ? base : `${base} ${entry.id}`
  }, [entry.id, entry.panelType, entry.sessionId, isOnly, sessionTitles, t])

  // Override AppShellContext so page headers receive surface controls and
  // session input behavior follows the currently focused surface.
  const contextOverride = useMemo(() => ({
    ...parentContext,
    trailingAction: closeButton,
    expandButton: undefined,
    leadingAction: backButton,
    isFocusedPanel: isFocusedPanel && !assistantOpen,
  }), [parentContext, closeButton, backButton, isFocusedPanel, assistantOpen])

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
        // A content pane is a landmark: it holds the pane's header and its
        // scrolling body. Without one, axe reported every panel header and its
        // masked scroll viewport as "content not contained by landmarks" — 139
        // nodes across the app, the largest remaining accessibility rule. Named
        // so several panes side by side stay distinguishable in a landmark list
        // (the workbench and the converse make that the normal case).
        role="region"
        aria-label={paneLabel}
        inert={hidden}
        aria-hidden={hidden || undefined}
        data-compact={isCompact || undefined}
        data-active-conversation={isConversationGroup ? isFocusedPanel : undefined}
        className={cn(
          'h-full overflow-hidden relative @container/panel',
          !isOnly && isFocusedPanel
            ? cn('shadow-panel-focused z-component-overlay', isConversationGroup && 'ring-1 ring-inset ring-accent/30')
            : 'shadow-middle z-component-content',
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
          flex: '1 1 0px',
          minWidth: 0,
        }}
      >
        {isConversationGroup && !isFocusedPanel && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-component-header bg-foreground/[0.02]"
          />
        )}
        {isConversationGroup && isFocusedPanel && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 z-component-controls h-0.5 w-7 -translate-x-1/2 rounded-b-full bg-accent/65"
          />
        )}
        <div className="h-full flex flex-col">
          {topSlot}
          {/* A workbench panel that fills the whole content row has no header of
              its own (its tabs carry the names visually), so the screen would
              have no `h1` (`page-has-heading-one` on every full-width workbench).
              Give assistive technology the same name the active tab shows. Only
              when it is the only surface: beside a chat, that chat owns the h1. */}
          {isOnly && entry.surfaceRole === 'workbench' && (
            <h1 className="sr-only">{t(surfaceLauncherLabelKey(entry.panelType as SurfaceLauncherKind))}</h1>
          )}
          <div className="min-h-0 flex-1">
            <AppShellProvider value={contextOverride}>
              {isBoundPanelType(entry.panelType) ? (
                <BoundPanelContent entry={entry} />
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

