import { useIsPresent } from 'motion/react'

/**
 * Interaction isolation for layers that animate out.
 *
 * A layer that is exiting still paints, but it must already be out of the
 * click, keyboard and screen-reader order. Otherwise the form the user just
 * dismissed can still take a submit, and Tab can walk into content that is
 * fading away. `pointer-events: none` alone is not enough — it does nothing
 * about keyboard focus or assistive technology.
 *
 * `useIsPresent` is the only signal that stays live during an exit: the
 * presence boundary re-renders the exiting element through context, while its
 * props keep the values from the render that started the exit. This is the
 * pattern already used by the session list's expandable rows; it is named here
 * so each new exit layer does not re-derive the attribute set (and forget
 * `aria-hidden`).
 *
 * Spread the result onto the animating element:
 *
 *   const exitIsolation = useExitIsolation()
 *   <motion.div {...exitIsolation} initial={...} exit={...} />
 */
export interface ExitIsolationProps {
  inert?: true
  'aria-hidden'?: true
}

export function useExitIsolation(): ExitIsolationProps {
  const isPresent = useIsPresent()
  // Nothing to say while the layer is live — returning `{}` keeps `inert` and
  // `aria-hidden` off the element entirely instead of setting them to false.
  return isPresent ? {} : { inert: true, 'aria-hidden': true }
}
