/**
 * CompactWorkbenchTransition
 *
 * Compact-mode layers inside the detail slot: the session, and the workbench
 * that opens over it.
 *
 * Why a layer instead of a swap: the Primary Surface stays mounted while the
 * Workbench covers it. Swapping the two by key destroyed the session instance
 * on every open and replayed its entrance (and reseated the scroll position) on
 * every return, which is what made opening a tool feel like leaving the
 * conversation. As a layer, the back action reveals the same session, at the
 * same reading position.
 *
 * Animation rules, matching CompactPanelTransition (the navigator/detail pair):
 * - GPU-only properties: transform + opacity.
 * - Forward (session → workbench) slides in from the right; back is the exact
 *   reverse, so the gesture reads the same in both directions.
 * - The layer underneath is `inert` and out of the accessibility tree — being
 *   covered is not the same as being gone.
 * - prefers-reduced-motion: nothing travels; the layers swap in place.
 */

import * as React from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'motion/react'
import { motionSpring } from '@phaneris/ui/motion'

interface CompactWorkbenchTransitionProps {
  /** True while the workbench layer covers the primary entry. */
  isWorkbenchActive: boolean
  /** Identity of the workbench layer; a change re-plays the forward slide. */
  workbenchKey?: string
  primary: React.ReactNode
  /** Rendered only while the workbench is active. */
  workbench: React.ReactNode | null
}

interface LayerProps {
  /** Whether this layer is the one on screen. */
  isTop: boolean
  /** Nulled out on unmount so focus checks never read a detached node. */
  layerRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}

/**
 * One workbench layer. `useIsPresent` keeps the isolation correct through the
 * exit animation, which is the only signal that stays live after the layer
 * leaves the tree.
 */
function WorkbenchLayer({ isTop, layerRef, children }: LayerProps) {
  const isPresent = useIsPresent()
  const reduceMotion = useReducedMotionConfig()
  const interactive = isTop && isPresent

  return (
    <motion.div
      ref={layerRef}
      className="absolute inset-0 z-[1] bg-paper"
      initial={{ x: '100%' }}
      animate={{ x: '0%' }}
      exit={{ x: '100%' }}
      transition={motionSpring(reduceMotion, 'spatial')}
      inert={!interactive}
      aria-hidden={!interactive || undefined}
    >
      {children}
    </motion.div>
  )
}

export function CompactWorkbenchTransition({
  isWorkbenchActive,
  workbenchKey,
  primary,
  workbench,
}: CompactWorkbenchTransitionProps) {
  const primaryRef = React.useRef<HTMLDivElement>(null)
  const workbenchRef = React.useRef<HTMLDivElement>(null)
  const wasActiveRef = React.useRef(isWorkbenchActive)

  // Closing the workbench takes the control that was focused with it (its own
  // back button), which would otherwise drop focus onto the document body.
  React.useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = isWorkbenchActive
    if (!wasActive || isWorkbenchActive) return

    const active = document.activeElement
    const focusCameFromWorkbench = active instanceof HTMLElement && !!workbenchRef.current?.contains(active)
    const focusWasLost = active === null || active === document.body
    if (!focusCameFromWorkbench && !focusWasLost) return

    primaryRef.current
      ?.querySelector<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex="0"]')
      ?.focus({ preventScroll: true })
  }, [isWorkbenchActive])

  return (
    <div className="relative flex h-full w-full">
      <div
        ref={primaryRef}
        className="h-full w-full"
        inert={isWorkbenchActive}
        aria-hidden={isWorkbenchActive || undefined}
      >
        {primary}
      </div>
      <AnimatePresence initial={false}>
        {isWorkbenchActive && workbench && (
          <WorkbenchLayer key={workbenchKey ?? 'workbench'} isTop layerRef={workbenchRef}>
            {workbench}
          </WorkbenchLayer>
        )}
      </AnimatePresence>
    </div>
  )
}
