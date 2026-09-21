/**
 * InlineExpand — the single rule for inline disclosure (expand/collapse in place).
 *
 * Settings rows, panel sections, markdown headings and detail disclosures are
 * all the same semantic, so they open at the same pace: `emphasis` over `move`.
 * Before this, four settings pages carried their own `0.2s` + Material curve
 * while the generic collapsible used a spring, and the same disclosure felt
 * different depending on which screen it was on.
 *
 * Height returns to `auto`, which CSS cannot animate — hence Motion — and the
 * shared reduced-motion contract collapses height and opacity to a single frame
 * ("尺寸直接到终态" in the motion rules).
 *
 * The layer that is closing loses interaction immediately: the off switch the
 * user just dismissed must not stay clickable or reachable by Tab while it
 * animates out.
 */

import * as React from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'motion/react'
import { motionTween } from '../../lib/motion'
import { cn } from '../../lib/utils'

export interface InlineExpandProps {
  isOpen: boolean
  children: React.ReactNode
  className?: string
  /**
   * How the collapsing box clips its content.
   *
   * - `overflow` (default): `overflow: hidden`, the usual choice.
   * - `clip`: `clip-path: inset(0 -20px)`, for rows whose focus rings are drawn
   *   outside the box and must not be shaved off at the sides.
   */
  clip?: 'overflow' | 'clip'
}

function InlineExpandLayer({
  className,
  clip,
  children,
}: Pick<InlineExpandProps, 'className' | 'clip' | 'children'>) {
  const isPresent = useIsPresent()
  const reduceMotion = useReducedMotionConfig()

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={motionTween(reduceMotion, 'emphasis', 'move')}
      className={cn(clip === 'clip' ? undefined : 'overflow-hidden', className)}
      style={clip === 'clip' ? { clipPath: 'inset(0 -20px)' } : undefined}
      inert={!isPresent}
      aria-hidden={!isPresent || undefined}
    >
      {children}
    </motion.div>
  )
}

export function InlineExpand({ isOpen, children, className, clip = 'overflow' }: InlineExpandProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <InlineExpandLayer className={className} clip={clip}>
          {children}
        </InlineExpandLayer>
      )}
    </AnimatePresence>
  )
}
