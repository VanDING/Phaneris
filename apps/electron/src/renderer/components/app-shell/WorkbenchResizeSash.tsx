import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import {
  DEFAULT_COMPANION_PRIMARY_WIDTH,
  MAX_COMPANION_PRIMARY_WIDTH,
  MIN_COMPANION_PRIMARY_WIDTH,
  setCompanionPrimaryWidthAtom,
} from '@/atoms/workbench'
import { useResizeGradient } from '@/hooks/useResizeGradient'
import {
  PANEL_SASH_DEAD_ZONE,
  PANEL_GAP,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
} from './panel-constants'

interface WorkbenchResizeSashProps {
  primaryWidth: number
  /**
   * Row-aware ceiling: the widest the Primary may become without pushing the
   * Workbench below its own minimum. The constant is only a fallback, because a
   * fixed maximum either forbids widening the transcript on a large window or
   * lets the drag pass the point where the Workbench can no longer shrink.
   */
  maxWidth?: number
  /**
   * Reports an in-progress pointer drag. The panel follows the cursor directly,
   * so the layout transition has to be off for the duration: easing a value that
   * changes every frame reads as the panel lagging behind the pointer.
   */
  onDraggingChange?: (isDragging: boolean) => void
}

/** Divider between the reading-width Primary Surface and flexible Workbench. */
export function WorkbenchResizeSash({ primaryWidth, maxWidth, onDraggingChange }: WorkbenchResizeSashProps) {
  const ceiling = Math.max(MIN_COMPANION_PRIMARY_WIDTH, maxWidth ?? MAX_COMPANION_PRIMARY_WIDTH)
  const { t } = useTranslation()
  const setPrimaryWidth = useSetAtom(setCompanionPrimaryWidthAtom)
  // The measured row is authoritative even beyond the legacy fallback ceiling.
  const setWidth = useCallback((width: number) => setPrimaryWidth(width, ceiling), [setPrimaryWidth, ceiling])
  const { ref, handlers, gradientStyle } = useResizeGradient()
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const resizeRafRef = useRef(0)
  const pendingWidthRef = useRef<number | null>(null)
  // Torn down by mouseup or by unmount, whichever happens first: closing the
  // panel mid-drag must not leave document listeners and a locked cursor behind.
  const endDragRef = useRef<(() => void) | null>(null)

  useEffect(() => () => endDragRef.current?.(), [])

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    handlers.onMouseDown()
    startXRef.current = event.clientX
    startWidthRef.current = primaryWidth
    onDraggingChange?.(true)
    document.body.dataset.paneDragging = 'true'

    const flush = () => {
      resizeRafRef.current = 0
      const next = pendingWidthRef.current
      pendingWidthRef.current = null
      if (next !== null) setWidth(next)
    }

    let armed = false
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current
      // The first 4px of travel are a dead zone: a click that drifts must not
      // resize the panel. Once armed, subtract the threshold so the panel does
      // not jump ahead of the pointer.
      if (!armed && Math.abs(delta) < PANEL_SASH_DEAD_ZONE) return
      armed = true
      const adjusted = Math.abs(delta) - PANEL_SASH_DEAD_ZONE
      pendingWidthRef.current = Math.min(ceiling, Math.max(MIN_COMPANION_PRIMARY_WIDTH, startWidthRef.current + Math.sign(delta) * Math.max(0, adjusted)))
      if (!resizeRafRef.current) resizeRafRef.current = requestAnimationFrame(flush)
    }

    const endDrag = () => {
      endDragRef.current = null
      cancelAnimationFrame(resizeRafRef.current)
      flush()
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', endDrag)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      delete document.body.dataset.paneDragging
      onDraggingChange?.(false)
    }
    endDragRef.current = endDrag

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', endDrag)
  }, [ceiling, handlers, primaryWidth, setWidth, onDraggingChange])

  // A focusable `role="separator"` carrying aria-valuenow and arrow-key handling
  // is a window-splitter widget; jsx-a11y models the role as static, so the two
  // findings are registered in scripts/visual-debt-ledger.json with that reason.
  return (
    <div
      ref={ref}
      className="absolute h-full w-0 cursor-col-resize"
      style={{ left: -PANEL_GAP / 2 }}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('contentPanel.resize')}
      aria-valuemin={MIN_COMPANION_PRIMARY_WIDTH}
      aria-valuemax={ceiling}
      aria-valuenow={primaryWidth}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handlers.onMouseMove}
      onMouseLeave={handlers.onMouseLeave}
      onDoubleClick={() => setWidth(DEFAULT_COMPANION_PRIMARY_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setWidth(primaryWidth - 16)
        else if (event.key === 'ArrowRight') setWidth(primaryWidth + 16)
        else if (event.key === 'Home') setWidth(MIN_COMPANION_PRIMARY_WIDTH)
        else if (event.key === 'End') setWidth(ceiling)
        else return
        event.preventDefault()
      }}
    >
      <div
        className="absolute inset-y-0 flex cursor-col-resize justify-center"
        style={{ left: -PANEL_SASH_HALF_HIT_WIDTH, right: -PANEL_SASH_HALF_HIT_WIDTH }}
      >
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            ...gradientStyle,
            width: PANEL_SASH_LINE_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
          }}
        />
      </div>
    </div>
  )
}
