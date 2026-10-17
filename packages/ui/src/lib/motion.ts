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
  snap: 0.12,
  standard: 0.16,
  emphasis: 0.22,
  spatial: 0.28,
  sheet: 0.3,
  slow: 0.45,
} as const

export const MOTION_EASE = {
  enter: [0.16, 1, 0.3, 1],
  move: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1],
  /** Jelly settle for pills and sliders: ~30% overshoot, quick convergence. */
  overshoot: [0.34, 1.3, 0.64, 1],
  /** Strong spring pop for dialogs and emphasis feedback. */
  pop: [0.34, 1.56, 0.64, 1],
  /** Grid-height expansion that avoids a visible step. */
  expand: [0.19, 1, 0.22, 1],
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
  /** Buttons, switches, icon presses: +8.8% overshoot, ~0.22s settle. */
  snappy: { type: 'spring', stiffness: 600, damping: 30, mass: 1 },
  /** Cards, popovers, bubbles: +1.8% overshoot, ~0.35s settle. */
  gentle: { type: 'spring', stiffness: 320, damping: 28, mass: 1 },
  /** Success feedback, likes: +19.4% overshoot, two visible cycles. */
  bouncy: { type: 'spring', stiffness: 380, damping: 18, mass: 1 },
  /** Drag settle and edge snap: zero overshoot, ~0.14s bite. */
  heavySnap: { type: 'spring', stiffness: 1200, damping: 80, mass: 0.1 },
} satisfies Record<string, Transition>

export type MotionSpring = keyof typeof MOTION_SPRING

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
