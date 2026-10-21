/**
 * Resolves each Kanban column's color set, merging the user's localStorage
 * overrides (`kanbanColumnColorsAtom`) over `DEFAULT_KANBAN_COLUMN_COLORS`.
 *
 * Returns a map keyed by column id; each entry carries the `solid` colour used
 * for the identity dot and the drop outline, a faint `tint` for callers that
 * still want a wash, and `onAccent` text for use **on** the solid colour.
 *
 * `onAccent` is computed from the colour's luminance instead of a hard-coded
 * white: user and project colours are arbitrary, and white text on amber or
 * emerald was the audit's 2.15:1 column header. Theme-role colours
 * (`var(--info)` and friends) cannot be parsed here, so they resolve to the
 * foreground tone and are only ever used as dots/outlines, never as a text
 * background.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { kanbanColumnColorsAtom } from '@/atoms/kanban'
import { KANBAN_COLUMNS } from '@/components/app-shell/kanban/status-column'
import { DEFAULT_KANBAN_COLUMN_COLORS } from '@/components/app-shell/kanban/kanban-colors'
import type { BuiltInKanbanColumnId, KanbanColumnId } from '@/components/app-shell/kanban/types'

export interface KanbanColumnColor {
  /** The accent colour (identity dot, drop outline, optional bar). */
  solid: string
  /** Faint surface tint for the column body — `color-mix` so it works in light/dark. */
  tint: string
  /** Foreground color for text/icons sitting on the `solid` accent. */
  onAccent: string
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** WCAG relative luminance for a `#rgb`/`#rrggbb` colour, or null when the
 *  value is not a literal (theme roles are resolved by CSS, not here). */
function luminanceOf(color: string): number | null {
  if (!HEX.test(color)) return null
  const digits = color.slice(1)
  const expanded = digits.length === 3 ? [...digits].map(char => char + char).join('') : digits
  const value = Number.parseInt(expanded, 16)
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map(channel => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

/**
 * Build a full color set from a single accent.
 *
 * Shared by the built-in column hook and by custom (per-project) columns that
 * carry their own `color` — so the tint/onAccent formula never drifts between
 * the two. Picks black or white by measured contrast, which is the only choice
 * that cannot fail for an arbitrary user colour.
 */
export function makeColumnColor(solid: string): KanbanColumnColor {
  const luminance = luminanceOf(solid)
  let onAccent = 'var(--foreground)'
  if (luminance !== null) {
    const againstWhite = 1.05 / (luminance + 0.05)
    const againstBlack = (luminance + 0.05) / 0.05
    onAccent = againstBlack >= againstWhite ? '#000000' : '#ffffff'
  }
  return {
    solid,
    tint: `color-mix(in srgb, ${solid} 6%, transparent)`,
    onAccent,
  }
}

export function useKanbanColumnColors(): Map<KanbanColumnId, KanbanColumnColor> {
  const overrides = useAtomValue(kanbanColumnColorsAtom)
  return React.useMemo(() => {
    const map = new Map<KanbanColumnId, KanbanColumnColor>()
    for (const { id } of KANBAN_COLUMNS) {
      const builtInId = id as BuiltInKanbanColumnId
      const solid = overrides[builtInId] || DEFAULT_KANBAN_COLUMN_COLORS[builtInId]
      map.set(id, makeColumnColor(solid))
    }
    return map
  }, [overrides])
}
