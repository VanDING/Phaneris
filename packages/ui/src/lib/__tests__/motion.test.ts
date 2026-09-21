import { describe, expect, it } from 'bun:test'
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING,
  MOTION_STAGGER_MAX,
  motionRowEnter,
  motionSpring,
  motionStaggerDelay,
  motionTween,
} from '../motion'

describe('motion language', () => {
  it('keeps interaction paces ordered and spatial motion below 300ms', () => {
    expect(MOTION_DURATION.instant).toBeLessThan(MOTION_DURATION.fast)
    expect(MOTION_DURATION.fast).toBeLessThan(MOTION_DURATION.standard)
    expect(MOTION_DURATION.standard).toBeLessThan(MOTION_DURATION.emphasis)
    expect(MOTION_DURATION.emphasis).toBeLessThan(MOTION_DURATION.spatial)
    expect(MOTION_DURATION.spatial).toBeLessThanOrEqual(0.3)
  })

  it('resolves tokenized tweens and instant reduced-motion fallbacks', () => {
    expect(motionTween(false, 'standard', 'enter')).toEqual({
      type: 'tween',
      duration: MOTION_DURATION.standard,
      ease: MOTION_EASE.enter,
    })
    expect(motionTween(true, 'spatial', 'move')).toEqual({ duration: 0 })
  })

  it('uses shared springs and disables them for reduced motion', () => {
    expect(motionSpring(false, 'responsive')).toBe(MOTION_SPRING.responsive)
    expect(motionSpring(true, 'spatial')).toEqual({ duration: 0 })
  })

  it('keeps a revealed list from waiting longer than the stagger cap', () => {
    // The cap is what stops a long list from making its last row late: the wait
    // is independent of how many rows are revealed.
    expect(motionStaggerDelay(0)).toBe(0)
    expect(motionStaggerDelay(2)).toBeLessThan(motionStaggerDelay(3))
    expect(motionStaggerDelay(50)).toBe(MOTION_STAGGER_MAX)
    expect(MOTION_STAGGER_MAX).toBeLessThanOrEqual(MOTION_DURATION.fast)
  })

  it('drops the stagger for a row that arrives on its own', () => {
    // Rows appended to an already-open list pass no delay — they are new
    // information and must not queue behind the reveal sequence.
    expect(motionRowEnter(false, 0)).toEqual({
      type: 'tween',
      duration: MOTION_DURATION.standard,
      ease: MOTION_EASE.enter,
      delay: 0,
    })
    // A delayed instant change is still a delay, so reduced motion drops it.
    expect(motionRowEnter(true, motionStaggerDelay(4))).toEqual({ duration: 0, delay: 0 })
  })
})
