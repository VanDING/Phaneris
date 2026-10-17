/**
 * PanelEmptyState - Shared guidance empty-state for content-workbench panels.
 *
 * Used by bound workbench views when there is
 * no active session to bind to, and by SurfaceSlot when a bound route fails to
 * parse (invalid URL) — in both cases showing a hint instead of crashing or
 * falling through to the global navigation.
 */

import type { ReactNode } from 'react'
import { motion, useReducedMotionConfig } from 'motion/react'
import { motionTween } from '@phaneris/ui/motion'
import { EmptyState } from '@phaneris/ui'

interface PanelEmptyStateProps {
  /** Primary message (usually an i18n key result) */
  title: ReactNode
  /** Optional secondary hint shown under the title */
  hint?: ReactNode
  /** Optional icon rendered above the text */
  icon?: ReactNode
}

export function PanelEmptyState({ title, hint, icon }: PanelEmptyStateProps) {
  const reduceMotion = useReducedMotionConfig()

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTween(reduceMotion, 'standard', 'enter')}
    >
      <EmptyState title={title} description={hint} icon={icon} className="h-full" />
    </motion.div>
  )
}
