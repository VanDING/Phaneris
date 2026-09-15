import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
})
