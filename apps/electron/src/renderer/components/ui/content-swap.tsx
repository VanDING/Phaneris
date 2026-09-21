/**
 * ContentSwap — same-level content replacement (tabs, view modes, entries).
 *
 * The incoming content takes the slot immediately: it *is* the new state, and a
 * tab that has already switched must not wait for the previous content to
 * finish leaving. With `mode="wait"` every swap played both animations back to
 * back — around 320ms at the shared `standard` pace — and during that window
 * the tab, the content and the focus disagreed about which identity was
 * current.
 *
 * `mode="popLayout"` pops the outgoing child out of the flow so it keeps its
 * measured box while it fades, and the incoming child lays out at full size
 * right away. That also keeps the container from holding two laid-out children,
 * which is what the serial version was protecting against.
 *
 * The parent must be positioned (`relative`): the popped child is placed
 * absolutely from its own measured box.
 *
 * The layer that just left loses interaction immediately (see
 * `useExitIsolation`), so it can never take a click or a Tab stop while fading.
 */

import * as React from 'react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import { MOTION_DISTANCE, motionTween } from '@phaneris/ui/motion'
import { useExitIsolation } from '@phaneris/ui/presence'

interface ContentSwapProps {
  /** Identity of the current content. A change starts the swap. */
  swapKey: string | number | null
  children: React.ReactNode
  /** Applied to the animating layer; should carry the box the content fills. */
  className?: string
}

interface ContentSwapLayerProps {
  className?: string
  reduceMotion: boolean | null
  swapKey: string | number
  children: React.ReactNode
}

function ContentSwapLayer({ className, reduceMotion, swapKey, children }: ContentSwapLayerProps) {
  const exitIsolation = useExitIsolation()
  return (
    <motion.div
      className={className}
      // Marks the layer's identity and whether it is still the current one.
      // Used by the Playground motion checks to tell a handoff (two layers) from
      // a settled state (one layer) without inferring it from timing.
      data-content-swap={String(swapKey)}
      data-content-swap-current={!exitIsolation.inert || undefined}
      // Reduced motion keeps the fade (the change stays perceivable) and drops
      // the offset, so no content travels.
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: MOTION_DISTANCE.micro }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -MOTION_DISTANCE.micro }}
      transition={motionTween(reduceMotion, 'standard', 'enter')}
      {...exitIsolation}
    >
      {children}
    </motion.div>
  )
}

export function ContentSwap({ swapKey, children, className }: ContentSwapProps) {
  const reduceMotion = useReducedMotionConfig()

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <ContentSwapLayer
        key={swapKey ?? 'empty'}
        swapKey={swapKey ?? 'empty'}
        className={className}
        reduceMotion={reduceMotion}
      >
        {children}
      </ContentSwapLayer>
    </AnimatePresence>
  )
}
