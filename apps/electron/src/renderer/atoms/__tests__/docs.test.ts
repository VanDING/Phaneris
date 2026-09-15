/**
 * The docs overlay is opened from module scope — click handlers, and the
 * deep-link listener — so `openDocs()` writes through `getDefaultStore()`.
 *
 * A Jotai `<Provider>` with no `store` prop creates a store of its own; the
 * default store is only what you get when there is *no* provider. Wiring the
 * app's provider without an explicit store therefore turned every help link
 * into a no-op: the write landed in a store nothing was reading. The overlay
 * mounted, the atom changed, and the UI never noticed.
 *
 * These tests pin both halves of that contract, plus the entry-point wiring the
 * unit tests cannot see.
 */

import { describe, expect, it, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider as JotaiProvider, getDefaultStore, useAtomValue } from 'jotai'
import { DOCS_HOME_SLUG } from '@/docs/manifest'
import { closeDocs, docsViewAtom, openDocs, showDocsPage } from '../docs'

function Probe() {
  const state = useAtomValue(docsViewAtom)
  return React.createElement('span', null, `${state.open ? 'open' : 'closed'}:${state.slug}`)
}

function renderInside(providerProps: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(JotaiProvider, providerProps, React.createElement(Probe)),
  )
}

beforeEach(() => {
  getDefaultStore().set(docsViewAtom, { open: false, slug: DOCS_HOME_SLUG })
})

describe('docs overlay state', () => {
  it('opens a named page where the app provider can see it', () => {
    openDocs('sources/overview')
    expect(renderInside({ store: getDefaultStore() })).toContain('open:sources/overview')
  })

  it('opens the home page when given no slug', () => {
    openDocs()
    expect(renderInside({ store: getDefaultStore() })).toContain(`open:${DOCS_HOME_SLUG}`)
  })

  it('navigates to another page while open', () => {
    openDocs('sources/overview')
    showDocsPage('skills/overview')
    expect(renderInside({ store: getDefaultStore() })).toContain('open:skills/overview')
  })

  it('closes without forgetting which page was being read', () => {
    openDocs('labels/overview')
    closeDocs()
    // Reopening resumes where you were, which is the whole point of keeping the
    // slug through a close.
    expect(renderInside({ store: getDefaultStore() })).toContain(`closed:labels/overview`)
  })

  /**
   * The negative case, kept deliberately. If this ever starts passing, Jotai's
   * provider semantics changed and the `store={getDefaultStore()}` prop in the
   * entry points became redundant — at which point the comment there is stale
   * and this test is the place that says so.
   */
  it('is invisible to a provider that makes its own store', () => {
    openDocs('skills/overview')
    expect(renderInside({})).not.toContain('open:skills/overview')
  })
})

describe('app entry wiring', () => {
  // Source-level on purpose: the failure mode is a missing prop on a Provider in
  // an entry point, and there is no DOM harness in this repository to render the
  // real application. A behavioural test here would be testing a Provider the
  // test itself configured — which is exactly how the original bug survived.
  const ENTRIES = [
    'apps/electron/src/renderer/main.tsx',
    'apps/webui/src/main.tsx',
  ]

  for (const entry of ENTRIES) {
    it(`${entry} hands the provider the shared store`, () => {
      const source = readFileSync(resolve(import.meta.dir, '../../../../../../', entry), 'utf8')
      // Asserted as a boolean so a failure says which entry point regressed
      // instead of printing the whole file.
      const handsOverTheStore = /<JotaiProvider\s+store=\{getDefaultStore\(\)\}/.test(source)
      expect(handsOverTheStore).toBe(true)
    })
  }
})
