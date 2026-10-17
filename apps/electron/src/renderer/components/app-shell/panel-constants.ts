/** Gap between adjacent paper surfaces (navigator ↔ Primary ↔ Workbench). */
export const PANEL_GAP = 6
/** Sidebar shares the navigator canvas edge; only paper panels need a seam. */
export const SIDEBAR_GAP = 0

/** Padding from window edges to outermost panels (right, bottom, left when sidebar hidden) */
export const PANEL_EDGE_INSET = 6

/** Host-adapted window corners; authored theme radii flow through the shape roles. */
export const RADIUS_EDGE = 'var(--shape-window)'

/** Corner radius for interior corners between panels */
export const RADIUS_INNER = 'var(--shape-inner)'

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440

/** Extra vertical space reserved in panel stack for box-shadows. */
export const PANEL_STACK_VERTICAL_OVERFLOW = 8

/**
 * Shared resize sash geometry.
 *
 * Keep all seams (sidebar, navigator/content, panel/panel) aligned by deriving
 * offsets from these constants instead of hardcoded pixel literals.
 */
export const PANEL_SASH_HIT_WIDTH = 8
export const PANEL_SASH_LINE_WIDTH = 2

/** Pointer travel below this ignores accidental micro-drags. */
export const PANEL_SASH_DEAD_ZONE = 4

/**
 * When the sash is inserted between two flex items, flex gap would apply twice
 * (item↔sash and sash↔item). Pull it back by half the gap on both sides so
 * the visible distance remains exactly PANEL_GAP.
 */
export const PANEL_SASH_FLEX_MARGIN = -(PANEL_GAP / 2)

/** Half-width helper for centering sash containers on seam coordinates. */
export const PANEL_SASH_HALF_HIT_WIDTH = PANEL_SASH_HIT_WIDTH / 2

/** Default expanded width; a user's saved resize remains authoritative. */
export const SIDEBAR_DEFAULT_WIDTH = 200
/** Room for centered 28px squares with 10px on either side. */
export const SIDEBAR_RAIL_WIDTH = 48
/** 44px touch control plus the same 8px inset on either side. */
export const SIDEBAR_TOUCH_RAIL_WIDTH = 60
