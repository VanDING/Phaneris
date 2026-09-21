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
  PANEL_SASH_FLEX_MARGIN,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
} from './panel-constants'

interface WorkbenchResizeSashProps {
  primaryWidth: number
  /**
   * Reports an in-progress pointer drag. The panel follows the cursor directly,
   * so the layout transition has to be off for the duration: easing a value that
   * changes every frame reads as the panel lagging behind the pointer.
   */
  onDraggingChange?: (isDragging: boolean) => void
}

/** Divider between the reading-width Primary Surface and flexible Workbench. */
export function WorkbenchResizeSash({ primaryWidth, onDraggingChange }: WorkbenchResizeSashProps) {
  const { t } = useTranslation()
  const setWidth = useSetAtom(setCompanionPrimaryWidthAtom)
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

    const flush = () => {
      resizeRafRef.current = 0
      const next = pendingWidthRef.current
      pendingWidthRef.current = null
      if (next !== null) setWidth(next)
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pendingWidthRef.current = startWidthRef.current + (moveEvent.clientX - startXRef.current)
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
      onDraggingChange?.(false)
    }
    endDragRef.current = endDrag

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', endDrag)
  }, [handlers, primaryWidth, setWidth, onDraggingChange])

  return (
    <div
      ref={ref}
      className="relative h-full w-0 shrink-0 cursor-col-resize"
      style={{ margin: `0 ${PANEL_SASH_FLEX_MARGIN}px` }}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('contentPanel.resize')}
      aria-valuemin={MIN_COMPANION_PRIMARY_WIDTH}
      aria-valuemax={MAX_COMPANION_PRIMARY_WIDTH}
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
        else if (event.key === 'End') setWidth(MAX_COMPANION_PRIMARY_WIDTH)
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
