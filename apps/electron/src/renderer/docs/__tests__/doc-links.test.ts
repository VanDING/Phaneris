import { describe, expect, it } from 'bun:test'
import { DOCS, getDocSlug, getDocInfo, type DocFeature } from '@phaneris/shared/docs/doc-links'
import { DOCS_HOME_SLUG, findDocsPage } from '../manifest'

const FEATURES = Object.keys(DOCS) as DocFeature[]

/**
 * The help links in the app are addressed by `DocFeature` and resolved to a
 * manifest slug. Nothing else connects the two, so a renamed page would leave a
 * help link pointing at nothing — which renders as a "not written yet" pane and
 * looks like missing content rather than a broken cross-reference.
 */
describe('doc feature links', () => {
  it('resolves every feature to a page that exists', () => {
    const dangling = FEATURES.filter((feature) => !findDocsPage(getDocSlug(feature)))
    expect(dangling).toEqual([])
  })

  it('resolves every feature to a non-empty slug with no leading slash', () => {
    for (const feature of FEATURES) {
      const slug = getDocSlug(feature)
      expect(slug.length).toBeGreaterThan(0)
      // A leading slash would address the upstream path shape rather than a
      // manifest slug, and would fail the lookup above on a technicality.
      expect(slug.startsWith('/')).toBe(false)
    }
  })

  it('points each feature at a distinct page', () => {
    const slugs = FEATURES.map(getDocSlug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('describes every feature with a title and a summary', () => {
    for (const feature of FEATURES) {
      const info = getDocInfo(feature)
      expect(info.title.length).toBeGreaterThan(0)
      expect(info.summary.length).toBeGreaterThan(0)
    }
  })

  it('never hands out a URL', () => {
    // The whole point of the change: help links open the bundled docs. A slug
    // that looks like a URL would either reach the network or — in the Web UI,
    // which drops `phaneris://` — do nothing at all.
    for (const feature of FEATURES) {
      expect(getDocSlug(feature)).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
      expect(getDocSlug(feature)).not.toContain('//')
    }
  })

  it('has a home page the help menu can open with no argument', () => {
    expect(findDocsPage(DOCS_HOME_SLUG)).toBeDefined()
  })
})
