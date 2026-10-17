/**
 * Roving focus protocol.
 *
 * One implementation for listbox-style composites: exactly one item is tabbable,
 * arrows move the active item, Home/End jump to the edges, PageUp/PageDown move
 * by a page, and Tab always leaves the composite (no keyboard trap).
 *
 * `resolveRovingIndex` is the pure navigation rule; `useRovingFocus` binds it to
 * element refs. The renderer's item-based hook consumes the same rule, so side
 * bars, trees, menus, boards and segmented controls share one protocol.
 */
import * as React from 'react'

export type RovingOrientation = 'vertical' | 'horizontal' | 'both'

export interface RovingNavigationOptions {
  orientation: RovingOrientation
  loop: boolean
  /** RTL mirrors Left/Right without changing Up/Down. */
  direction?: 'ltr' | 'rtl'
  /** PageUp/PageDown step; defaults to 5. */
  pageSize?: number
}

/** Returns the next index for a handled key, or null when the key is not ours. */
export function resolveRovingIndex(
  key: string,
  current: number,
  length: number,
  options: RovingNavigationOptions,
): number | null {
  if (length <= 0) return null
  const { orientation, loop, direction = 'ltr', pageSize = 5 } = options
  const vertical = orientation === 'vertical' || orientation === 'both'
  const horizontal = orientation === 'horizontal' || orientation === 'both'
  const rtl = direction === 'rtl'

  const step = (delta: number) => {
    if (loop) return ((current + delta) % length + length) % length
    return Math.max(0, Math.min(length - 1, current + delta))
  }

  switch (key) {
    case 'ArrowDown':
      return vertical ? step(1) : null
    case 'ArrowUp':
      return vertical ? step(-1) : null
    case 'ArrowRight':
      return horizontal ? step(rtl ? -1 : 1) : null
    case 'ArrowLeft':
      return horizontal ? step(rtl ? 1 : -1) : null
    case 'Home':
      return 0
    case 'End':
      return length - 1
    case 'PageDown':
      return vertical ? Math.min(length - 1, current + pageSize) : null
    case 'PageUp':
      return vertical ? Math.max(0, current - pageSize) : null
    default:
      return null
  }
}

export interface RovingFocusOptions extends Partial<RovingNavigationOptions> {
  /** Letter-key jump to the next item whose visible text starts with the buffer. */
  typeahead?: boolean
  onActiveChange?: (id: string) => void
}

export interface RovingFocusItemProps {
  tabIndex: 0 | -1
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  onFocus: () => void
  ref: (element: HTMLElement | null) => void
}

export function useRovingFocus(ids: string[], options: RovingFocusOptions = {}) {
  const {
    orientation = 'vertical',
    loop = true,
    direction = 'ltr',
    pageSize = 5,
    typeahead = false,
    onActiveChange,
  } = options
  const [activeId, setActiveIdState] = React.useState<string | null>(ids[0] ?? null)
  const refs = React.useRef(new Map<string, HTMLElement>())
  const typeBuffer = React.useRef({ text: '', at: 0 })

  // Items may arrive asynchronously; keep the active id valid without stealing
  // focus or firing callbacks.
  const idKey = ids.join('\u0000')
  React.useEffect(() => {
    if (activeId === null || !ids.includes(activeId)) setActiveIdState(ids[0] ?? null)
  }, [idKey])

  const setActiveId = React.useCallback((id: string | null) => {
    setActiveIdState(id)
    if (id && typeof onActiveChange === 'function') onActiveChange(id)
  }, [onActiveChange])

  const focusIndex = React.useCallback((index: number) => {
    const id = ids[index]
    if (!id) return
    setActiveId(id)
    requestAnimationFrame(() => refs.current.get(id)?.focus())
  }, [ids, setActiveId])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const currentIndex = activeId ? ids.indexOf(activeId) : -1
    if (currentIndex < 0) return

    if (typeahead && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = performance.now()
      const buffer = now - typeBuffer.current.at > 500 ? event.key : typeBuffer.current.text + event.key
      typeBuffer.current = { text: buffer, at: now }
      const match = ids.findIndex(id => {
        const element = refs.current.get(id)
        return element?.textContent?.trim().toLowerCase().startsWith(buffer.toLowerCase())
      })
      if (match >= 0) {
        event.preventDefault()
        focusIndex(match)
      }
      return
    }

    const nextIndex = resolveRovingIndex(event.key, currentIndex, ids.length, { orientation, loop, direction, pageSize })
    if (nextIndex === null) return
    event.preventDefault()
    if (nextIndex !== currentIndex) focusIndex(nextIndex)
  }, [activeId, ids, typeahead, orientation, loop, direction, pageSize, focusIndex])

  const getItemProps = React.useCallback((id: string): RovingFocusItemProps => ({
    tabIndex: id === activeId ? 0 : -1,
    onKeyDown: handleKeyDown,
    onFocus: () => { if (id !== activeId) setActiveId(id) },
    ref: (element: HTMLElement | null) => {
      if (element) refs.current.set(id, element)
      else refs.current.delete(id)
    },
  }), [activeId, handleKeyDown, setActiveId])

  return {
    activeId,
    setActiveId,
    getItemProps,
    focusActive: () => {
      if (activeId) refs.current.get(activeId)?.focus()
    },
  }
}
