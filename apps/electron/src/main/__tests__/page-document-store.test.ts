import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { PageDocumentStore } from '../page-document-store'
import type { PageDocumentInput } from '../../shared/page-document'

function input(kind: PageDocumentInput['kind'] = 'live'): PageDocumentInput {
  const content = '<h1>等待数据</h1><script>window.started = true</script>'
  return { content, kind, lease: {
    leaseId: 'lease', nonce: 'secret', pageSlug: 'dashboard', issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    contentDigest: createHash('sha256').update(content).digest('hex'),
  } }
}

describe('page document transport', () => {
  it('serves exact digest-bound bytes with an independent CSP and no cache', async () => {
    const store = new PageDocumentStore()
    const doc = input()
    const url = store.register(1, doc)
    expect(url).not.toContain('secret')
    const response = store.respond(new Request(url))
    expect(await response.text()).toBe(doc.content)
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'unsafe-inline'")
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'")
    expect(response.headers.get('Content-Security-Policy')).not.toContain('allow-same-origin')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects mismatched and expired leases and forbids static scripts', () => {
    const store = new PageDocumentStore()
    const bad = input()
    bad.content += 'changed'
    expect(() => store.register(1, bad)).toThrow()
    const expired = input()
    expired.lease.expiresAt = 0
    expect(() => store.register(1, expired)).toThrow()
    const url = store.register(1, input('static'))
    expect(store.respond(new Request(url)).headers.get('Content-Security-Policy')).toContain("script-src 'none'")
  })

  it('serves no paths or alternate methods and revokes only for the owning window', () => {
    const store = new PageDocumentStore()
    const url = store.register(1, input())
    expect(store.respond(new Request(url.replace('index.html', 'snapshot.json'))).status).toBe(404)
    expect(store.respond(new Request(url, { method: 'POST' })).status).toBe(405)
    store.release(2, url)
    expect(store.respond(new Request(url)).status).toBe(200)
    store.release(1, url)
    expect(store.respond(new Request(url)).status).toBe(404)
    const other = store.register(2, input())
    store.register(1, input())
    store.releaseOwner(1)
    expect(store.respond(new Request(other)).status).toBe(200)
  })

  it('does not let caller mutations replace content or extend document expiry', () => {
    const store = new PageDocumentStore()
    const doc = input()
    const url = store.register(1, doc)
    doc.content = 'replaced'
    doc.lease.expiresAt = 0
    expect(store.respond(new Request(url)).status).toBe(200)
  })
})
