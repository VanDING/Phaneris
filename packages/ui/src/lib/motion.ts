import type { Transition } from 'motion/react'

/**
 * Product motion language.
 *
 * Keep these values independent from color themes: themes describe appearance,
 * while motion describes interaction causality and product behavior.
 */
export const MOTION_DURATION = {
  instant: 0.06,
  fast: 0.1,
  standard: 0.16,
  emphasis: 0.22,
  spatial: 0.28,
} as const

export const MOTION_EASE = {
  enter: [0.16, 1, 0.3, 1],
  move: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1],
  linear: 'linear',
} as const

export const MOTION_DISTANCE = {
  micro: 2,
  floating: 6,
  content: 12,
} as const

export const MOTION_SCALE = {
  pressed: 0.98,
  floating: 0.98,
  dialog: 0.96,
} as const

export const MOTION_SPRING = {
  responsive: { type: 'spring', stiffness: 500, damping: 42, mass: 0.8 },
  spatial: { type: 'spring', stiffness: 400, damping: 36, mass: 0.8 },
} satisfies Record<string, Transition>

export type MotionPace = keyof typeof MOTION_DURATION
export type MotionEase = keyof typeof MOTION_EASE

/**
 * Stagger for rows that are revealed together.
 *
 * The step conveys order; the cap keeps the wait independent of list length, so
 * a long list never makes its last row late. Rows that mount *after* the reveal
 * must pass no delay at all — they are new information and belong on screen
 * immediately, not queued behind a sequence meant for the initial paint.
 */
export const MOTION_STAGGER_STEP = 0.03
export const MOTION_STAGGER_MAX = MOTION_DURATION.fast

export function motionStaggerDelay(index: number): number {
  return Math.min(index * MOTION_STAGGER_STEP, MOTION_STAGGER_MAX)
}

/** Entrance for one row of a revealing list, stagger included. */
export function motionRowEnter(reduceMotion: boolean | null, delay = 0): Transition {
  // A delayed instant change is still a delay: reduced motion drops the stagger
  // along with the tween.
  return { ...motionTween(reduceMotion, 'standard', 'enter'), delay: reduceMotion ? 0 : delay }
}

/** Resolve a tokenized tween and collapse it to an instant transition when requested. */
export function motionTween(
  reduceMotion: boolean | null,
  pace: MotionPace = 'standard',
  ease: MotionEase = 'enter',
): Transition {
  if (reduceMotion) return { duration: 0 }

  return {
    type: 'tween',
    duration: MOTION_DURATION[pace],
    ease: MOTION_EASE[ease],
  }
}

/** Resolve a shared spring without duplicating physics constants in components. */
export function motionSpring(
  reduceMotion: boolean | null,
  kind: keyof typeof MOTION_SPRING = 'responsive',
): Transition {
  return reduceMotion ? { duration: 0 } : MOTION_SPRING[kind]
}
