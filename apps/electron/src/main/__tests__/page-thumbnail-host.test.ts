import { describe, it, expect } from 'bun:test'
import {
  buildThumbnailHostHtml,
  escapeSrcdocAttribute,
  sandboxForKind,
  THUMB_LOGICAL_WIDTH,
} from '../page-thumbnail-host'

describe('page-thumbnail-host', () => {
  it('applies the same sandbox rule as PageFrame', () => {
    expect(sandboxForKind('static')).toBe('')
    expect(sandboxForKind('interactive')).toBe('allow-scripts allow-forms')
    expect(sandboxForKind('live')).toBe('allow-scripts allow-forms')
    // Never same-origin (the whole opaque-origin guarantee).
    expect(sandboxForKind('interactive')).not.toContain('allow-same-origin')
  })

  it('escapes content for safe srcdoc embedding', () => {
    const escaped = escapeSrcdocAttribute('<img src="x" onerror=\'a&b\'>')
    expect(escaped).not.toContain('"')
    expect(escaped).not.toContain('<img')
    expect(escaped).toContain('&quot;')
    expect(escaped).toContain('&lt;img')
    expect(escaped).toContain('&amp;')
  })

  it('embeds the independent document address with the kind sandbox', () => {
    const html = buildThumbnailHostHtml({
      documentUrl: 'craft-page://test/index.html',
      slug: 'demo',
      kind: 'interactive',
      snapshot: null,
    })
    expect(html).toContain(`width: ${THUMB_LOGICAL_WIDTH}px`)
    expect(html).toContain('sandbox="allow-scripts allow-forms"')
    // The host contains only an address, not a second copy of the page.
    expect(html).not.toContain('<h1>Hello')
    expect(html).toContain('src="craft-page://test/index.html"')
  })

  it('delivers the data snapshot via the phaneris-pages/v1 init message, keeping the legacy alias', () => {
    const snapshot = { version: 1 as const, generatedAt: 5, kv: { total: 42 }, series: {} }
    const html = buildThumbnailHostHtml({ documentUrl: 'craft-page://test/index.html', slug: 's', kind: 'live', snapshot })
    expect(html).toContain('phaneris-pages/v1')
    expect(html).toContain('craft-pages/v1')
    expect(html).toContain("type: 'init'")
    expect(html).toContain('"total":42')
  })

  it('neutralizes a </script> sequence inside snapshot data', () => {
    const snapshot = { version: 1 as const, generatedAt: 1, kv: { x: '</script><script>alert(1)' }, series: {} }
    const html = buildThumbnailHostHtml({ documentUrl: 'craft-page://test/index.html', slug: 's', kind: 'live', snapshot })
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain('\\u003c/script>')
  })

  it('static pages still embed content (no scripts, snapshot irrelevant)', () => {
    const html = buildThumbnailHostHtml({ documentUrl: 'craft-page://test/index.html', slug: 's', kind: 'static', snapshot: null })
    expect(html).toContain('sandbox=""')
    expect(html).not.toContain('srcdoc=')
  })
})
