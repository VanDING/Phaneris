import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEEPLINK_SCHEME_PREFIX } from '@phaneris/shared'
import {
  DEFAULT_DOCS_LOCALE,
  DOCS_HOME_SLUG,
  DOCS_LOCALES,
  DOCS_PAGES,
  DOCS_SECTIONS,
  findDocsPage,
  findDocsSection,
} from '../manifest'

const guideDir = resolve(import.meta.dir, '..', 'guide')

/** Every `guide/<locale>/<slug>.md` on disk, as `<locale>/<slug>`. */
function contentFilesOnDisk(): string[] {
  const found: string[] = []
  if (!existsSync(guideDir)) return found

  for (const locale of readdirSync(guideDir, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue
    const localeDir = join(guideDir, locale.name)

    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), `${prefix}${entry.name}/`)
        } else if (entry.name.endsWith('.md')) {
          found.push(`${locale.name}/${prefix}${entry.name.slice(0, -3)}`)
        }
      }
    }
    walk(localeDir, '')
  }
  return found.sort()
}

const manifestKeys = DOCS_LOCALES.flatMap((locale) =>
  DOCS_PAGES.map((page) => `${locale}/${page.slug}`),
).sort()

/** Markdown link destinations, excluding the optional title. */
function linksIn(markdown: string): string[] {
  const targets: string[] = []
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    if (match[1]) targets.push(match[1])
  }
  return targets
}

describe('docs manifest', () => {
  it('has unique slugs', () => {
    const slugs = DOCS_PAGES.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has a non-empty home page that the manifest declares', () => {
    expect(DOCS_HOME_SLUG.length).toBeGreaterThan(0)
    expect(findDocsPage(DOCS_HOME_SLUG)).toBeDefined()
  })

  it('places every page in exactly one non-empty section', () => {
    for (const section of DOCS_SECTIONS) {
      expect(section.pages.length).toBeGreaterThan(0)
      for (const page of section.pages) {
        expect(findDocsSection(page.slug)?.id).toBe(section.id)
      }
    }
  })

  // The load-bearing invariant: `import.meta.glob` silently proves nothing, so
  // a slug with no file behind it would render as "not written yet" in the app
  // and look like a content bug rather than a manifest bug.
  it('has a markdown file on disk for every page in every locale', () => {
    const missing = manifestKeys.filter(
      (key) => !existsSync(join(guideDir, `${key}.md`)),
    )
    expect(missing).toEqual([])
  })

  // The reverse drift: a renamed slug leaves its file behind, and the stale
  // page then ships in the bundle while being unreachable.
  it('has no markdown file that the manifest does not declare', () => {
    expect(contentFilesOnDisk()).toEqual(manifestKeys)
  })

  it('starts every page with a level-1 heading matching its title', () => {
    const mismatched: string[] = []
    for (const page of DOCS_PAGES) {
      const file = join(guideDir, DEFAULT_DOCS_LOCALE, `${page.slug}.md`)
      if (!existsSync(file)) continue
      const firstHeading = readFileSync(file, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('# '))
      if (firstHeading !== `# ${page.title}`) {
        mismatched.push(`${page.slug}: ${firstHeading ?? '(no heading)'}`)
      }
    }
    expect(mismatched).toEqual([])
  })

  /**
   * Cross-references are written as `phaneris://docs/<slug>` and intercepted by
   * the docs overlay. A relative path would classify as a *file* link, and the
   * overlay passes no `onFileClick` — so it would render as a normal-looking link
   * that does nothing when clicked, with no error anywhere. A slug that names a
   * page the manifest does not declare fails the same silent way.
   */
  it('links only to real pages, external https URLs, or in-page anchors', () => {
    const prefix = `${DEEPLINK_SCHEME_PREFIX}docs/`
    const problems: string[] = []

    for (const page of DOCS_PAGES) {
      const file = join(guideDir, DEFAULT_DOCS_LOCALE, `${page.slug}.md`)
      if (!existsSync(file)) continue

      for (const target of linksIn(readFileSync(file, 'utf8'))) {
        if (target.startsWith('#') || /^https?:\/\//i.test(target)) continue

        if (!target.startsWith(prefix)) {
          problems.push(`${page.slug}: not an internal docs link or https URL: ${target}`)
          continue
        }
        const slug = target.slice(prefix.length)
        if (!findDocsPage(slug)) {
          problems.push(`${page.slug}: links to undeclared page: ${slug}`)
        }
      }
    }

    expect(problems).toEqual([])
  })
})
