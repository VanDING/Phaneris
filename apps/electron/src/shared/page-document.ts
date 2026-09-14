import type { PageKind, PageRenderLease } from '@craft-agent/shared/pages/types'

export const PAGE_DOCUMENT_SCHEME = 'craft-page'

export interface PageDocumentInput {
  content: string
  kind: PageKind
  lease: PageRenderLease
}

export function sandboxForPageKind(kind: PageKind): string {
  return kind === 'static' ? '' : 'allow-scripts allow-forms'
}

/** Pages are self-contained. Source actions go through the authenticated bridge. */
export function pageDocumentCsp(kind: PageKind): string {
  return [
    "default-src 'none'",
    `script-src ${kind === 'static' ? "'none'" : "'unsafe-inline' 'wasm-unsafe-eval'"}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'img-src data: blob: https:',
    'font-src data: https://fonts.gstatic.com',
    'media-src data: blob: https:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `sandbox${kind === 'static' ? '' : ' allow-scripts allow-forms'}`,
  ].join('; ')
}
