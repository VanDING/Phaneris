/**
 * Markdown pop-out overlay state.
 *
 * The chat's "pop out" affordances (message pop-out, raw response, turn
 * details, activity details) used to feed a per-session Preview panel tab
 * stack. Files panels now own exactly one job each — Browse / Artifacts /
 * Changed — so a pop-out is a single read-only document shown in the shared
 * PreviewOverlay, not a second place to browse files.
 */

import { atom } from 'jotai'

export interface MarkdownPopout {
  /** Stable per source (message id / turn key / activity id). */
  id: string
  title: string
  content: string
  sessionId: string
}

/** Currently shown pop-out document, or null when the overlay is closed. */
export const markdownPopoutAtom = atom<MarkdownPopout | null>(null)

/** Open (or replace) the pop-out document. */
export const openMarkdownPopoutAtom = atom(
  null,
  (_get, set, popout: MarkdownPopout) => {
    set(markdownPopoutAtom, popout)
  },
)

export const closeMarkdownPopoutAtom = atom(null, (_get, set) => {
  set(markdownPopoutAtom, null)
})
