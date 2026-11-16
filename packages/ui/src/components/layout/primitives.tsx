/**
 * Layout primitives.
 *
 * The app has 257 hand-rolled `flex items-center justify-center` and 140-odd
 * local `flex gap-*` rows. Each is individually reasonable; together they mean
 * two people writing "a row of things" produce two different DOM shapes with two
 * different gap semantics, and neither can be tuned globally.
 *
 * These five cover the shapes that actually recur (Every Layout's vocabulary):
 *
 * - `Stack`    vertical rhythm. The *only* thing that should ever set a
 *              between-children margin, so no component needs `space-y-*`.
 * - `Cluster`  a wrapping row of small things (tags, actions, badges).
 * - `Center`   the "center this in the space it has" box, for empty states.
 * - `Truncate` one line, ellipsis, correct `min-width: 0` chain.
 * - `Switcher` two things side by side that become stacked when the container
 *              is too narrow — without a media query, because the decision is
 *              about the *container*, not the window.
 *
 * All spacing comes from `--layout-space-*` so a density change is one edit, and
 * every primitive defaults to `min-width: 0` so a long CJK string truncates
 * instead of pushing the layout wider.
 *
 * What these deliberately are NOT: a flex wrapper with a dozen props. If a call
 * site needs per-child control, it should compose these (or use plain utilities)
 * rather than grow a prop.
 */
import * as React from 'react'
import { cn } from '../../lib/utils'

/** Vertical rhythm. Children are separated by exactly one gap; margins do not stack. */
export function Stack({
  gap = 'md',
  align = 'stretch',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg'
  align?: 'stretch' | 'start' | 'center' | 'end'
}) {
  return (
    <div
      {...rest}
      className={cn(
        'flex min-w-0 flex-col',
        gap === 'none' && 'gap-0',
        gap === 'xs' && 'gap-1',
        gap === 'sm' && 'gap-2',
        gap === 'md' && 'gap-3',
        gap === 'lg' && 'gap-4',
        align === 'start' && 'items-start',
        align === 'center' && 'items-center',
        align === 'end' && 'items-end',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A horizontal row of small items that wraps instead of overflowing. */
export function Cluster({
  gap = 'sm',
  align = 'center',
  justify = 'start',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  gap?: 'xs' | 'sm' | 'md'
  align?: 'start' | 'center' | 'end' | 'baseline'
  justify?: 'start' | 'center' | 'end' | 'between'
}) {
  return (
    <div
      {...rest}
      className={cn(
        'flex min-w-0 flex-wrap',
        gap === 'xs' && 'gap-1',
        gap === 'sm' && 'gap-2',
        gap === 'md' && 'gap-3',
        align === 'start' && 'items-start',
        align === 'center' && 'items-center',
        align === 'end' && 'items-end',
        align === 'baseline' && 'items-baseline',
        justify === 'center' && 'justify-center',
        justify === 'end' && 'justify-end',
        justify === 'between' && 'justify-between',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Center a block in the space it is given, at its intrinsic size. */
export function Center({
  axis = 'both',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { axis?: 'both' | 'horizontal' | 'vertical' }) {
  return (
    <div
      {...rest}
      className={cn(
        'flex min-w-0',
        axis !== 'vertical' && 'justify-center',
        axis !== 'horizontal' && 'items-center',
        axis === 'both' && 'text-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * One line, ellipsis.
 *
 * Carries the `min-w-0` that every truncating flex child needs — forgetting it is
 * the single most common cause of a layout that will not shrink, and it is
 * invisible until someone pastes a long title.
 */
export function Truncate({
  as: Tag = 'span',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: 'span' | 'div' | 'p' }) {
  return (
    <Tag {...rest} className={cn('min-w-0 truncate', className)}>
      {children}
    </Tag>
  )
}

/**
 * Side-by-side until the *container* is narrower than `threshold`, then stacked.
 *
 * A container query, not a media query: a 320px panel in a 1600px window has the
 * same problem as a 320px window, and only the container knows that.
 */
export function Switcher({
  threshold = 30,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { threshold?: number }) {
  return (
    <div {...rest} className={cn('flex min-w-0 flex-wrap gap-3', className)}>
      {React.Children.map(children, child =>
        child == null ? null : (
          <div className="min-w-0 flex-1" style={{ flexBasis: `calc((${threshold}rem - 100%) * 999)` }}>
            {child}
          </div>
        ),
      )}
    </div>
  )
}
