/**
 * DocsOverlay — the in-app documentation reader.
 *
 * Reads pages from the bundled manifest (see `@/docs/manifest`), so it needs no
 * network, no custom protocol, and no filesystem access, and behaves identically
 * in the Electron renderer and the Web UI.
 *
 * Layout note: `FullscreenOverlayBase` owns the scroll container and floats a
 * 48px header above it (`HEADER_HEIGHT` there). The nav is therefore `sticky
 * top-0` with internal top padding rather than a separately scrolling column —
 * staying inside the base's scroll model is what keeps the overlay's ESC
 * handling, traffic-light behaviour, and Windows caption-strip inset working.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom } from 'jotai'
import { BookOpen, Search } from 'lucide-react'
import { FullscreenOverlayBase, Markdown } from '@phaneris/ui'
import { DEEPLINK_SCHEME_PREFIX } from '@phaneris/shared'
import { docsViewAtom, showDocsPage } from '@/atoms/docs'
import {
  DOCS_HOME_SLUG,
  DOCS_SECTIONS,
  findDocsPage,
  findDocsSection,
  type DocsPage,
} from '@/docs/manifest'
import { getDocsContent } from '@/docs/content'
import { cn } from '@/lib/utils'

/** Internal links are written as `phaneris://docs/<slug>` — see `docsLink()`. */
const DOCS_LINK_PREFIX = `${DEEPLINK_SCHEME_PREFIX}docs/`

/** The markdown link form for a page, used by the guide content itself. */
export function docsLink(slug: string): string {
  return `${DOCS_LINK_PREFIX}${slug}`
}

/** Extract a manifest slug from an internal docs link, or null if it isn't one. */
export function parseDocsLink(url: string): string | null {
  if (!url.startsWith(DOCS_LINK_PREFIX)) return null
  const slug = url.slice(DOCS_LINK_PREFIX.length).split('#')[0]?.replace(/\/$/, '')
  return slug && findDocsPage(slug) ? slug : null
}

interface SearchHit {
  page: DocsPage
  sectionTitle: string
}

/** Case-insensitive substring match over page titles and bodies. */
function searchPages(query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []

  const hits: SearchHit[] = []
  for (const section of DOCS_SECTIONS) {
    for (const page of section.pages) {
      const body = getDocsContent(page.slug) ?? ''
      if (page.title.toLowerCase().includes(needle) || body.toLowerCase().includes(needle)) {
        hits.push({ page, sectionTitle: section.title })
      }
    }
  }
  return hits
}

export function DocsOverlay() {
  const { t } = useTranslation()
  const [state, setState] = useAtom(docsViewAtom)
  const [query, setQuery] = React.useState('')

  const page = findDocsPage(state.slug) ?? findDocsPage(DOCS_HOME_SLUG)
  const section = page ? findDocsSection(page.slug) : undefined
  const content = page ? getDocsContent(page.slug) : null

  const hits = React.useMemo(() => searchPages(query), [query])
  const searching = query.trim().length > 0

  const goTo = React.useCallback((slug: string) => {
    setQuery('')
    showDocsPage(slug)
  }, [])

  const handleUrlClick = React.useCallback((url: string) => {
    const slug = parseDocsLink(url)
    if (slug) {
      goTo(slug)
      return
    }
    // Anything else is a real external link — hand it to the OS, which applies
    // the same scheme classification the rest of the app uses.
    void window.electronAPI?.openUrl(url)
  }, [goTo])

  const close = React.useCallback(() => setState((prev) => ({ ...prev, open: false })), [setState])

  return (
    <FullscreenOverlayBase
      isOpen={state.open}
      onClose={close}
      accessibleTitle={t('docs.title')}
      title={t('docs.title')}
      headerActions={
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('docs.searchPlaceholder')}
            aria-label={t('docs.searchPlaceholder')}
            className="h-7 w-40 rounded-md border border-border/60 bg-background/60 pl-7 pr-2 text-xs outline-none placeholder:text-foreground/40 focus:w-56 sm:w-56 sm:focus:w-72"
          />
        </div>
      }
    >
      <div className="flex w-full flex-1 items-start gap-8 px-6 pb-16">
        {/* Nav — sticky within FullscreenOverlayBase's scroll container, with
            top padding so its content clears the floating 48px header. */}
        <nav
          aria-label={t('docs.title')}
          className="sticky top-0 hidden max-h-[100dvh] w-56 shrink-0 overflow-y-auto pt-16 md:block"
        >
          {searching ? (
            <ul className="flex flex-col gap-0.5 pb-8">
              {hits.map((hit) => (
                <li key={hit.page.slug}>
                  <NavButton
                    active={hit.page.slug === page?.slug}
                    label={hit.page.title}
                    hint={hit.sectionTitle}
                    onClick={() => goTo(hit.page.slug)}
                  />
                </li>
              ))}
              {hits.length === 0 && (
                <li className="px-2 text-xs text-foreground/50">{t('docs.noResults')}</li>
              )}
            </ul>
          ) : (
            <div className="flex flex-col gap-4 pb-8">
              {DOCS_SECTIONS.map((docsSection) => (
                <div key={docsSection.id}>
                  {/* A single-page section whose name matches its page needs no
                      group label — "Skills" over "Skills" is noise. */}
                  {!(docsSection.pages.length === 1 && docsSection.pages[0]!.title === docsSection.title) && (
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
                      {docsSection.title}
                    </div>
                  )}
                  <ul className="flex flex-col gap-0.5">
                    {docsSection.pages.map((sectionPage) => (
                      <li key={sectionPage.slug}>
                        <NavButton
                          active={sectionPage.slug === page?.slug}
                          label={sectionPage.title}
                          onClick={() => goTo(sectionPage.slug)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </nav>

        <article className="mx-auto min-w-0 w-full max-w-[760px]">
          <div className="rounded-[16px] bg-background px-8 py-8 shadow-strong sm:px-10">
            {section && page && (
              <div className="flex items-center gap-1.5 pb-2 text-[11px] text-foreground/40">
                <BookOpen className="h-3 w-3" />
                <span>{section.title}</span>
              </div>
            )}
            {content === null ? (
              <p className="text-sm text-foreground/60">{t('docs.notWritten')}</p>
            ) : (
              <div className="text-sm">
                <Markdown mode="minimal" onUrlClick={handleUrlClick}>
                  {content}
                </Markdown>
              </div>
            )}
          </div>
        </article>
      </div>
    </FullscreenOverlayBase>
  )
}

function NavButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'w-full rounded-md px-2 py-1 text-left text-xs transition-colors',
        active
          ? 'bg-accent/12 font-medium text-accent'
          : 'text-foreground/70 hover:bg-foreground/6 hover:text-foreground',
      )}
    >
      <span className="block truncate">{label}</span>
      {hint && <span className="block truncate text-[10px] text-foreground/40">{hint}</span>}
    </button>
  )
}
