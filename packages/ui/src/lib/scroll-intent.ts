import * as React from 'react'
import { useReducedMotionConfig } from 'motion/react'

/**
 * Programmatic scroll policy.
 *
 * `scroll-behavior: auto` in the reduced-motion stylesheet does not cover this:
 * an explicit `behavior` argument passed to `scrollTo`/`scrollIntoView` always
 * wins over CSS, so every programmatic call site has to resolve the preference
 * itself. Centralising it here keeps the decision consistent across entries.
 *
 * The intent is what the scroll means, not how long it should take:
 *
 * - `immediate` — the destination is the point of the interaction. Keyboard list
 *   navigation and reveal-on-select land instantly so repeated key presses never
 *   queue up animations.
 * - `reveal` — an explicit jump to a target the user asked for (a named record,
 *   file or turn). May be animated so the reader keeps the spatial relationship.
 * - `follow` — keeping a live edge (streaming output, growing activity list) in
 *   view. May be animated, but the caller must already have established that the
 *   user is still following; `follow` never overrides a manual scroll position.
 */
export type ScrollIntent = 'immediate' | 'reveal' | 'follow'

/** Resolve the DOM scroll behavior for an intent under the current preference. */
export function resolveScrollBehavior(
  reduceMotion: boolean | null,
  intent: ScrollIntent,
): ScrollBehavior {
  if (intent === 'immediate') return 'instant'
  return reduceMotion ? 'instant' : 'smooth'
}

/**
 * Scroll behavior resolver bound to the active motion preference.
 *
 * Uses `useReducedMotionConfig` rather than `useReducedMotion` so a host that
 * forces a branch through `MotionConfig` (the Playground switch, tests) also
 * controls scrolling.
 */
export function useScrollBehavior(): (intent: ScrollIntent) => ScrollBehavior {
  const reduceMotion = useReducedMotionConfig()
  return React.useCallback(
    (intent: ScrollIntent) => resolveScrollBehavior(reduceMotion, intent),
    [reduceMotion],
  )
}
