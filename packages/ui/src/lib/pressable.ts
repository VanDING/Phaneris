import type { KeyboardEvent } from 'react'

/**
 * Keyboard semantics for an element that has to stay a `<span>` or `<div>`.
 *
 * The 2026-10-20 review's first accessibility batch is "make the clickable
 * surfaces reachable": a click handler on a static element is invisible to the
 * keyboard and to the accessibility tree. Where the markup cannot become a
 * `<button>` — a badge nested inside another interactive row, a value inside a
 * popover trigger — the two things that are actually required are a role, a tab
 * stop, and Enter/Space activation. This spreads all three.
 *
 * Prefer a real `<button>`/`<a>` whenever the markup allows it: `role="button"`
 * does not give you the browser's own Enter-on-keydown, double-tap suppression
 * or form semantics. This helper exists for the nesting cases where a button
 * would be invalid HTML.
 */
export function pressable(
  onActivate: () => void,
  options: { role?: 'button' | 'link'; label?: string } = {},
) {
  return {
    role: options.role ?? 'button',
    tabIndex: 0 as const,
    ...(options.label ? { 'aria-label': options.label } : {}),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      // Space would scroll the panel and Enter would re-trigger an enclosing
      // control; neither is the intent.
      event.preventDefault()
      event.stopPropagation()
      onActivate()
    },
  }
}

/**
 * Keyboard activation for a row inside a roving-focus listbox.
 *
 * The container owns ArrowUp/ArrowDown and a document-level Enter handler, and
 * the rows are `tabIndex={-1}` so Tab never reaches them. Assistive technology
 * can still put a virtual cursor on a row, and Enter there has to do what a
 * click does — so the row dispatches its own click rather than re-implementing
 * the selection logic (which would drift the moment the row changes).
 *
 * `stopPropagation` keeps the container's document listener from firing a
 * second time for the same key.
 */
export function activateOnKey(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement | null)?.click()
}
