/**
 * Documentation content loader.
 *
 * Every `guide/<locale>/<slug>.md` is compiled into the renderer bundle by
 * Vite's `import.meta.glob`, so the docs need no runtime filesystem access, no
 * custom protocol, and no CSP change — and they work identically in the
 * Electron renderer and the Web UI, which alias the same source tree.
 *
 * Kept separate from `manifest.ts` on purpose: the manifest stays importable
 * from a plain bun test, while this module cannot be (bun has no
 * `import.meta.glob`).
 */

import { DEFAULT_DOCS_LOCALE, DOCS_LOCALES, type DocsLocale } from './manifest'

const RAW = import.meta.glob('./guide/*/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Normalize glob keys to `<locale>/<slug>` form.
 *
 * Vite emits POSIX-style keys relative to this module, but normalizing the
 * separators and the leading `./` costs nothing and removes a platform
 * assumption from a lookup that would otherwise fail silently (an unmatched
 * page renders as "not written yet", which looks like a content bug).
 */
const CONTENT = new Map<string, string>()
for (const [path, text] of Object.entries(RAW)) {
  CONTENT.set(path.replace(/\\/g, '/').replace(/^\.\//, ''), text)
}

function lookup(locale: string, slug: string): string | null {
  return CONTENT.get(`guide/${locale}/${slug}.md`) ?? null
}

/**
 * Markdown for a page, falling back to the default locale.
 *
 * Returns `null` only when the page has no content in any locale — a state
 * `manifest.test.ts` is supposed to prevent, and which the overlay reports
 * explicitly rather than rendering an empty pane.
 */
export function getDocsContent(slug: string, locale: string = DEFAULT_DOCS_LOCALE): string | null {
  return lookup(locale, slug) ?? lookup(DEFAULT_DOCS_LOCALE, slug)
}

/** Locales that actually have content compiled in, in declared order. */
export function getAvailableDocsLocales(): DocsLocale[] {
  return DOCS_LOCALES.filter((locale) =>
    [...CONTENT.keys()].some((key) => key.startsWith(`guide/${locale}/`)),
  )
}
