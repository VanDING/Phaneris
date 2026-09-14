import { createHash, randomBytes } from 'node:crypto'
import { PAGE_DOCUMENT_SCHEME, pageDocumentCsp, type PageDocumentInput } from '../shared/page-document'

/** In-memory immutable documents; URLs contain no paths, lease nonce, or credentials. */
export class PageDocumentStore {
  private documents = new Map<string, PageDocumentInput & { owner: number }>()

  register(owner: number, input: PageDocumentInput): string {
    this.prune()
    if (!input || typeof input.content !== 'string' || Buffer.byteLength(input.content) > 10 * 1024 * 1024
      || !['static', 'interactive', 'live'].includes(input.kind)
      || !input.lease || !Number.isFinite(input.lease.expiresAt) || input.lease.expiresAt <= Date.now()
      || createHash('sha256').update(input.content, 'utf8').digest('hex') !== input.lease.contentDigest) {
      throw new Error('Invalid or expired page document')
    }
    if (this.documents.size >= 256) throw new Error('Too many page documents')
    const url = `${PAGE_DOCUMENT_SCHEME}://${randomBytes(24).toString('hex')}/index.html`
    this.documents.set(url, { content: input.content, kind: input.kind, lease: { ...input.lease }, owner })
    return url
  }

  release(owner: number, url: string): void {
    if (this.documents.get(url)?.owner === owner) this.documents.delete(url)
  }

  releaseOwner(owner: number): void {
    for (const [url, doc] of this.documents) if (doc.owner === owner) this.documents.delete(url)
  }

  private prune(): void {
    for (const [url, doc] of this.documents) if (doc.lease.expiresAt <= Date.now()) this.documents.delete(url)
  }

  respond(request: Request): Response {
    this.prune()
    const doc = this.documents.get(request.url)
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': pageDocumentCsp(doc?.kind ?? 'static'),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    }
    if (request.method !== 'GET') return new Response(null, { status: 405, headers })
    if (!doc) return new Response(null, { status: 404, headers })
    return new Response(doc.content, { headers })
  }
}
