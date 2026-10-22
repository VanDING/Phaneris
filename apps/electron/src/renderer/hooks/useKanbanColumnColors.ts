/**
 * Resolves each Kanban column's color set, merging the user's localStorage
 * overrides (`kanbanColumnColorsAtom`) over `DEFAULT_KANBAN_COLUMN_COLORS`.
 *
 * Returns a map keyed by column id; each entry carries the `solid` accent, a
 * faint `tint` for the column body / card surfaces (derived via `color-mix`, so
 * it adapts to light/dark), and `onAccent` text for use on the solid header.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { kanbanColumnColorsAtom } from '@/atoms/kanban'
import { KANBAN_COLUMNS } from '@/components/app-shell/kanban/status-column'
import { DEFAULT_KANBAN_COLUMN_COLORS } from '@/components/app-shell/kanban/kanban-colors'
import type { BuiltInKanbanColumnId, KanbanColumnId } from '@/components/app-shell/kanban/types'

export interface KanbanColumnColor {
  /** The accent hex (header pill background, dots). */
  solid: string
  /** Faint surface tint for the column body — `color-mix` so it works in light/dark. */
  tint: string
  /** Foreground color for text/icons sitting on the `solid` accent. */
  onAccent: string
}

/**
 * Build a full color set from a single accent hex. Shared by the built-in
 * column hook and by custom (per-project) columns that carry their own
 * `color` — so the tint/onAccent formula never drifts between the two.
 *
 * `onAccent` is measured from the fill instead of hard-coded white: white on the
 * amber column measured 2.15:1, and every palette colour a user can pick must
 * stay above the 4.5:1 floor (the chrome workflow asserts the painted pair).
 */
export function makeColumnColor(solid: string): KanbanColumnColor {
  return {
    solid,
    tint: `color-mix(in srgb, ${solid} 6%, transparent)`,
    onAccent: readableOn(solid),
  }
}

/** White or near-black, whichever clears the fill it is painted on. */
function readableOn(solid: string): string {
  const hex = solid.trim().replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff'
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  const white = 1.05 / (luminance + 0.05)
  const black = (luminance + 0.05) / 0.05
  // Pure black, not a near-black grey: the ratio has to describe the colour that
  // is actually painted, and #111111 dropped indigo from 4.71:1 to 4.24:1.
  return white >= black ? '#ffffff' : '#000000'
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
