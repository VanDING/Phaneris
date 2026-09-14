import { protocol, type WebContents } from 'electron'
import { PAGE_DOCUMENT_SCHEME } from '../shared/page-document'
import { PageDocumentStore } from './page-document-store'

export const pageDocuments = new PageDocumentStore()

export function registerPageDocumentHandler(): void {
  protocol.handle(PAGE_DOCUMENT_SCHEME, request => pageDocuments.respond(request))
}

const observed = new WeakSet<WebContents>()

/** Keep init messages confined to the original document, including after link clicks. */
export function observePageDocumentOwner(contents: WebContents, releaseOnNavigation = true): void {
  if (observed.has(contents)) return
  observed.add(contents)
  const owner = contents.id
  contents.on('will-frame-navigate', event => {
    if (event.frame?.url.startsWith(`${PAGE_DOCUMENT_SCHEME}:`)) event.preventDefault()
  })
  contents.on('render-process-gone', () => pageDocuments.releaseOwner(owner))
  contents.once('destroyed', () => pageDocuments.releaseOwner(owner))
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (releaseOnNavigation && isMainFrame && !isInPlace) pageDocuments.releaseOwner(owner)
  })
}
