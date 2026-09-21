export interface ScrollFollowing { current: boolean }

export function isChatAtBottom(viewport: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): boolean {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 20
}

/** A nested response/code pane owns the gesture while it can still scroll. */
function nestedScrollerConsumes(target: EventTarget | null, viewport: HTMLElement, delta: number): boolean {
  let element = target instanceof Element ? target : null
  while (element && element !== viewport) {
    if (element instanceof HTMLElement && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
      if (delta < 0 && element.scrollTop > 0) return true
      if (delta > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true
    }
    element = element.parentElement
  }
  return false
}

/** Bind follow-to-bottom to user intent rather than every layout-induced scroll.
 * All resize work is coalesced into one frame; the frame rechecks intent so a
 * wheel gesture wins even when it arrives after ResizeObserver queued a follow.
 */
export function observeChatScrollAnchor(
  viewport: HTMLElement,
  content: Element,
  following: ScrollFollowing,
): () => void {
  let frame = 0
  let userScrollUntil = 0
  let userDirection = 0
  let draggingScrollbar = false
  let touchY: number | undefined

  const noteIntent = (delta: number, target: EventTarget | null) => {
    if (!delta || nestedScrollerConsumes(target, viewport, delta)) return
    userScrollUntil = performance.now() + 250
    userDirection = delta
    if (delta < 0) {
      following.current = false
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
  const onWheel = (event: WheelEvent) => noteIntent(event.deltaY, event.target)
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY }
  const onTouchMove = (event: TouchEvent) => {
    const next = event.touches[0]?.clientY
    if (next !== undefined && touchY !== undefined) noteIntent(touchY - next, event.target)
    touchY = next
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]')) return
    const delta = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)
      ? -1 : ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) ? 1 : 0
    noteIntent(delta, event.target)
  }
  const onPointerDown = (event: PointerEvent) => {
    if (event.target === viewport) {
      draggingScrollbar = true
      userScrollUntil = performance.now() + 250
    }
  }
  const onPointerUp = () => { draggingScrollbar = false }
  const onScroll = () => {
    if (draggingScrollbar || performance.now() < userScrollUntil) {
      following.current = !draggingScrollbar && userDirection < 0 ? false : isChatAtBottom(viewport)
      // Keep momentum scrolling associated with the user's gesture.
      userScrollUntil = performance.now() + 250
    }
  }
  const observer = new ResizeObserver(() => {
    if (frame || !following.current || draggingScrollbar) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!following.current || draggingScrollbar || viewport.clientHeight === 0) return
      // Continuous following is positional maintenance, not a navigation animation.
      // Write only this viewport: scrollIntoView can also move ancestor panes.
      viewport.scrollTo({ top: Math.max(0, viewport.scrollHeight - viewport.clientHeight), behavior: 'instant' })
    })
  })
  observer.observe(content)
  observer.observe(viewport)
  viewport.addEventListener('wheel', onWheel, { passive: true })
  viewport.addEventListener('touchstart', onTouchStart, { passive: true })
  viewport.addEventListener('touchmove', onTouchMove, { passive: true })
  viewport.addEventListener('keydown', onKeyDown)
  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    viewport.removeEventListener('wheel', onWheel)
    viewport.removeEventListener('touchstart', onTouchStart)
    viewport.removeEventListener('touchmove', onTouchMove)
    viewport.removeEventListener('keydown', onKeyDown)
    viewport.removeEventListener('pointerdown', onPointerDown)
    viewport.removeEventListener('scroll', onScroll)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }
}
