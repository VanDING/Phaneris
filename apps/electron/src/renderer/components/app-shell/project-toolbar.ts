/**
 * The one description of a project view's toolbar row geometry.
 *
 * Four views (board, list, calendar, gantt) each hand-wrote the same 42px row:
 * the same height, the same stoplight compensation, the same gap. That is the
 * kind of four-way copy that drifts one view at a time, and this row is the first
 * thing a screenshot compares across views.
 *
 * The props are returned rather than rendered so each view keeps its own inner
 * layout and its own surface (the board's hairline is /70, the calendar's /50 over
 * `bg-background`); what they share is the geometry, which is what must not drift.
 */
import type * as React from 'react'

/** macOS traffic lights occupy the first 84px; the overlay's restore button the last 48. */
const STOPLIGHT_INSET = 84
const OVERLAY_CONTROL_INSET = 48
const EDGE_INSET = 16

/** 42px: above the control band, so it is space, not a hit target. */
const ROW_HEIGHT = 42

function insets(compensateForStoplight?: boolean): React.CSSProperties {
  return {
    paddingLeft: compensateForStoplight ? STOPLIGHT_INSET : EDGE_INSET,
    paddingRight: compensateForStoplight ? OVERLAY_CONTROL_INSET : EDGE_INSET,
    height: ROW_HEIGHT,
  }
}

/** Standard row: filters and search on the left, actions on the right. */
export function projectToolbarProps(compensateForStoplight: boolean | undefined, surfaceClassName: string) {
  return {
    className: `flex flex-none items-center justify-between gap-2 ${surfaceClassName}`,
    style: insets(compensateForStoplight),
  }
}

/** Calendar and gantt centre a date range, so their row is a three-slot grid. */
export function projectToolbarGridProps(compensateForStoplight: boolean | undefined, surfaceClassName: string) {
  return {
    className: `grid flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 ${surfaceClassName}`,
    style: insets(compensateForStoplight),
  }
}
