import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '../../lib/utils'
import { MOTION_SPRING } from '../../lib/motion'
import { InlineExpand } from '../ui/inline-expand'

interface CollapsibleSectionProps {
  sectionId: string
  headingLevel: number
  isCollapsed: boolean
  onToggle: (sectionId: string) => void
  children: React.ReactNode
}

/**
 * CollapsibleSection
 *
 * Renders a markdown section with a collapsible heading.
 * - First child is the heading (rendered as trigger)
 * - Remaining children are the content (collapsible)
 * - Chevron appears on hover, rotates when expanded
 * - Only H1-H4 are collapsible; H5-H6 render normally
 */
export function CollapsibleSection({
  sectionId,
  headingLevel,
  isCollapsed,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  // Extract heading (first child) and content (rest)
  const childArray = React.Children.toArray(children)
  const heading = childArray[0]
  const content = childArray.slice(1)

  // Only make H1-H4 collapsible
  if (headingLevel > 4) {
    return <>{children}</>
  }

  const isExpanded = !isCollapsed
  const hasContent = content.length > 0

  return (
    <div className="markdown-collapsible-section" data-section-id={sectionId}>
      {/* Heading with toggle trigger. The heading text is the control, so the
          wrapper is a disclosure button: a heading full of inline markup cannot
          become a <button> (it may contain code and links), and role="button"
          plus aria-expanded is the correct pattern for that nesting. */}
      <div
        role={hasContent ? 'button' : undefined}
        tabIndex={hasContent ? 0 : undefined}
        aria-expanded={hasContent ? isExpanded : undefined}
        className={cn(
          'relative group',
          hasContent && 'cursor-pointer'
        )}
        onClick={() => hasContent && onToggle(sectionId)}
        onKeyDown={(event) => {
          if (!hasContent) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          onToggle(sectionId)
        }}
      >
        {/* Chevron - always visible when collapsed, hover-only when expanded */}
        <motion.div
          initial={false}
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={MOTION_SPRING.responsive}
          className={cn(
            'absolute -left-4 top-[5px] select-none transition-opacity',
            !hasContent && 'opacity-0',
            hasContent && isCollapsed && 'opacity-100',
            hasContent && isExpanded && 'opacity-0 group-hover:opacity-100'
          )}
        >
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </motion.div>

        {/* Heading content */}
        {heading}
      </div>

      {/* Collapsible content */}
      {hasContent && (
        <InlineExpand isOpen={isExpanded}>
          <div className="collapsible-section-content">
            {content}
          </div>
        </InlineExpand>
      )}
    </div>
  )
}
