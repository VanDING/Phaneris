import type { BuiltInKanbanColumnId } from './types'

/**
 * Column identity colours — theme roles only, never raw hex.
 *
 * The 2026-10-21 audit found four raw Tailwind 500 hexes here
 * (`#64748b / #6366f1 / #f59e0b / #10b981`) with a hard-coded white
 * `onAccent`: column headers measured 2.15–4.76:1, the count chip 1.21–1.38:1,
 * and the board carried four hues next to a separate status palette that
 * disagreed with them (DONE green column, purple "Done" chip).
 *
 * A column now expresses *progress*, not decoration: work that has not started
 * is neutral, active work is `info`, and finished work is `success`. Every value
 * resolves through the theme, so Ink / Cyberpunk 2077 govern the board too and
 * `check:contrast-floor` measures the same tokens it measures everywhere else.
 * Column identity is carried by the label plus a coloured dot; the text itself
 * sits on the neutral header surface.
 */
export const DEFAULT_KANBAN_COLUMN_COLORS: Record<BuiltInKanbanColumnId, string> = {
  backlog: 'var(--foreground-dimmed)',
  todo: 'var(--foreground-dimmed)',
  'in-progress': 'var(--info)',
  done: 'var(--success)',
}
