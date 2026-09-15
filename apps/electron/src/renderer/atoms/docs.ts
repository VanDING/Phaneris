/**
 * Documentation overlay state.
 *
 * The docs viewer is a fullscreen overlay rather than a navigation route, so its
 * state is a plain atom. That choice is load-bearing for one reason: the Web UI's
 * `openUrl` drops `phaneris://` URLs on the floor (`apps/webui/src/adapter/web-api.ts`),
 * so routing help links through a deep link would make documentation silently
 * dead in browser mode. An atom works identically in both targets with no IPC.
 *
 * `openDocs` is callable from non-React code (menu handlers, event callbacks) via
 * jotai's default store, which is how the deep-link listener opens a page.
 */

import { atom, getDefaultStore } from 'jotai'
import { DOCS_HOME_SLUG } from '@/docs/manifest'

export interface DocsViewState {
  open: boolean
  /** A slug from the manifest. Unknown slugs fall back to the home page at render time. */
  slug: string
}

export const docsViewAtom = atom<DocsViewState>({ open: false, slug: DOCS_HOME_SLUG })

/** Open the documentation, optionally at a specific page. */
export function openDocs(slug: string = DOCS_HOME_SLUG): void {
  getDefaultStore().set(docsViewAtom, { open: true, slug })
}

/** Close it (state is kept so reopening returns to the same page). */
export function closeDocs(): void {
  getDefaultStore().set(docsViewAtom, (previous) => ({ ...previous, open: false }))
}

/** Move to another page while the overlay is open. */
export function showDocsPage(slug: string): void {
  getDefaultStore().set(docsViewAtom, { open: true, slug })
}
