import { useCallback, useEffect, useRef } from 'react'

/**
 * Explicit first-field focus.
 *
 * `autoFocus` is an HTML attribute that fires whenever the element mounts — it
 * cannot tell "the dialog just opened because the user asked for it" from "this
 * page loaded". `jsx-a11y/no-autofocus` exists because of the second case, and
 * the 2026-10-20 design review asked for the first case to be *declared* rather
 * than inherited.
 *
 * This hook makes the declaration explicit and keeps the behaviour correct
 * inside a focus-managing container (Radix `Dialog`, `Popover`, `FocusScope`):
 * the focus runs on the next frame, after the container has placed focus
 * itself, so the field wins deterministically instead of racing it.
 *
 * Returns a stable callback ref, so re-renders never re-focus.
 *
 * Policy (DESIGN.md → Interaction States):
 *   - A surface the user just opened may take focus, and it returns to the
 *     trigger on close (Radix restores it).
 *   - Nothing on initial page load takes focus.
 *   - `active` lets a caller pick the first field of a list (`index === 0`).
 */
export function useInitialFocus<T extends HTMLElement = HTMLInputElement>(active = true) {
  const frame = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  return useCallback((node: T | null) => {
    cancel()
    if (!node || !active) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      node.focus()
    })
  }, [active, cancel])
}
