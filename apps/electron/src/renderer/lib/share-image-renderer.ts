import { SHARE_IMAGE, isShareImageSizeAllowed, type SharePageSpec } from '../../shared/share-image'

export class ShareImageError extends Error {
  constructor(public readonly reason: 'resource' | 'tooLong' | 'tooMany' | 'encode') { super(reason) }
}

export function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1]!)
    reader.onerror = () => reject(new ShareImageError('encode'))
    reader.readAsDataURL(blob)
  })
}

async function resourceData(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  if (url.startsWith('file:') && /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url) && window.electronAPI.shareImages) {
    return window.electronAPI.shareImages.readFont(url)
  }
  if (url.startsWith('file:') && !/\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url)) {
    return window.electronAPI.readFileDataUrl(decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
  }
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new ShareImageError('resource')
  const blob = await response.blob()
  if (blob.size > 16 * 1024 * 1024) throw new ShareImageError('resource')
  return 'data:' + blob.type + ';base64,' + await blobBase64(blob)
}

/** Wait for asynchronous rich blocks, all images and bundled font slices. */
export async function settleShareContent(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + 15_000
  while (root.querySelector('[data-share-resource-state="loading"]')) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (performance.now() > deadline) throw new ShareImageError('resource')
    await new Promise<void>(resolve => setTimeout(resolve, 30))
  }
  await document.fonts.ready
  const images = [...root.querySelectorAll('img')]
  await Promise.all(images.map(async image => {
    await image.decode().catch(() => { throw new ShareImageError('resource') })
    if (!image.naturalWidth) throw new ShareImageError('resource')
  }))
  if (root.querySelector('[data-share-resource-state="error"]')) throw new ShareImageError('resource')
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}

function fontRules(): CSSFontFaceRule[] {
  const result: CSSFontFaceRule[] = []
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) result.push(rule)
      else if (rule instanceof CSSGroupingRule) walk(rule.cssRules)
      else if (rule instanceof CSSImportRule && rule.styleSheet && new URL(rule.href, location.href).origin === location.origin) walk(rule.styleSheet.cssRules)
    }
  }
  // All application stylesheets are same-origin bundled files.
  for (const sheet of document.styleSheets) {
    if (sheet.href && new URL(sheet.href).origin !== location.origin) continue
    walk(sheet.cssRules)
  }
  return result
}

function hasGlyph(range: string, codepoints: number[]): boolean {
  if (!range) return true
  return range.split(',').some(part => {
    const match = part.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i)
    if (!match) return false
    const start = parseInt(match[1]!.replace(/\?/g, '0'), 16)
    const end = match[2] ? parseInt(match[2], 16) : parseInt(match[1]!.replace(/\?/g, 'F'), 16)
    return codepoints.some(point => point >= start && point <= end)
  })
}

/** Self-contained PNG: resolved DOM styles, font subsets and image bytes. */
export async function renderSharePng(page: HTMLElement, resources = new Map<string, Promise<string>>()): Promise<Blob> {
  const resource = (url: string) => {
    let promise = resources.get(url)
    if (!promise) { promise = resourceData(url); resources.set(url, promise); void promise.catch(() => resources.delete(url)) }
    return promise
  }
  const width = Number(page.dataset.shareWidth) || SHARE_IMAGE.cssWidth
  const height = Number(page.dataset.shareHeight)
    || Math.ceil(page.getBoundingClientRect().height / (Number(page.dataset.previewScale) || 1))
  if (!isShareImageSizeAllowed(Math.ceil(width * SHARE_IMAGE.scale), Math.ceil(height * SHARE_IMAGE.scale))) throw new ShareImageError('tooLong')
  const clone = page.cloneNode(true) as HTMLElement
  const originals = [page, ...page.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  const families = new Set<string>()
  for (const [index, source] of originals.entries()) {
    const target = copies[index] as HTMLElement | SVGElement
    const css = getComputedStyle(source)
    // Copy paint/layout values, not hundreds of inherited application tokens.
    // This keeps large tables/code exports bounded without changing their pixels.
    for (const property of [
      'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'margin', 'padding', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
      'border-collapse', 'border-spacing', 'table-layout', 'vertical-align', 'background', 'color', 'opacity',
      'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'line-height',
      'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing',
      'letter-spacing', 'word-spacing', 'white-space', 'overflow-wrap', 'word-break', 'text-align', 'text-indent',
      'text-transform', 'text-decoration', 'text-shadow', 'text-overflow', 'text-rendering', 'direction', 'writing-mode',
      'list-style', 'counter-reset', 'counter-increment', 'flex', 'flex-direction', 'flex-wrap', 'align-items',
      'align-self', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
      'top', 'right', 'bottom', 'left', 'transform', 'transform-origin', 'overflow', 'clip-path', 'visibility',
      'object-fit', 'object-position', 'aspect-ratio', 'box-shadow', 'fill', 'fill-opacity', 'stroke', 'stroke-width',
      'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'paint-order', 'dominant-baseline',
    ]) target.style.setProperty(property, css.getPropertyValue(property))
    css.fontFamily.split(',').forEach(family => families.add(family.trim().replace(/["']/g, '')))
    if (!(source instanceof SVGElement)) target.removeAttribute('id')
    target.removeAttribute('tabindex')
    target.removeAttribute('role')
    for (const attribute of [...target.attributes]) if (attribute.name.startsWith('on')) target.removeAttribute(attribute.name)
    // No scrolling, clipping fades, or entrance motion in a static export.
    target.style.setProperty('animation', 'none')
    target.style.setProperty('transition', 'none')
    target.style.setProperty('caret-color', 'transparent')
  }
  clone.style.setProperty('transform', 'none')
  clone.style.setProperty('margin', '0')
  clone.style.setProperty('box-shadow', 'none')
  clone.style.setProperty('height', height + 'px')
  clone.style.setProperty('width', width + 'px')
  clone.querySelectorAll('button').forEach(node => {
    if (node.querySelector('img')) node.replaceWith(...node.childNodes)
    else node.remove()
  })
  clone.querySelectorAll('input, textarea, script, iframe, object').forEach(node => node.remove())
  await Promise.all([...clone.querySelectorAll('img')].map(async image => {
    image.src = await resource(image.currentSrc || image.src)
    image.removeAttribute('srcset')
  }))
  const points = [...new Set(Array.from(page.textContent ?? '').map(char => char.codePointAt(0)!))]
  const faces = fontRules().filter(face =>
    families.has(face.style.fontFamily.replace(/["']/g, '')) && hasGlyph(face.style.getPropertyValue('unicode-range'), points))
  const embedded = await Promise.all(faces.map(async face => {
    let css = face.cssText
    for (const match of [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
      const absolute = new URL(match[1]!, face.parentStyleSheet?.href ?? location.href).href
      css = css.replace(match[0], 'url("' + await resource(absolute) + '")')
    }
    return css
  }))
  const wrapper = document.createElementNS('http://www.w3.org/1999/xhtml', 'div')
  const style = document.createElement('style')
  style.textContent = embedded.join('\n')
  wrapper.append(style, clone)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '"><foreignObject width="100%" height="100%">' + new XMLSerializer().serializeToString(wrapper) + '</foreignObject></svg>'
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await image.decode().catch(() => { throw new ShareImageError('encode') })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * SHARE_IMAGE.scale)
  canvas.height = Math.ceil(height * SHARE_IMAGE.scale)
  const context = canvas.getContext('2d')
  if (!context) throw new ShareImageError('encode')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new ShareImageError('encode')
  if (blob.size > SHARE_IMAGE.maxPngBytes) throw new ShareImageError('tooLong')
  return blob
}

/** Pages are assembled from semantic blocks; the source remains untouched. */
export function paginateShareContent(source: HTMLElement, mount: HTMLElement, page: SharePageSpec, continuation: string): HTMLElement[] {
  const fullHeight = source.getBoundingClientRect().height
  mount.replaceChildren()

  if (page.mode === 'single') {
    if (fullHeight * SHARE_IMAGE.scale > SHARE_IMAGE.maxHeight) throw new ShareImageError('tooLong')
    const single = source.cloneNode(true) as HTMLElement
    single.removeAttribute('id')
    single.dataset.shareWidth = String(page.width)
    single.dataset.shareHeight = String(Math.ceil(fullHeight))
    single.querySelector('[data-share-page-number]')!.textContent = '01'
    mount.append(single)
    return [single]
  }

  if (page.height * SHARE_IMAGE.scale > SHARE_IMAGE.pageBudget) throw new ShareImageError('tooLong')
  const pages: HTMLElement[] = []
  const makePage = (withHeader: boolean) => {
    if (pages.length >= SHARE_IMAGE.maxPages) throw new ShareImageError('tooMany')
    const next = source.cloneNode(true) as HTMLElement
    next.removeAttribute('id')
    next.dataset.shareWidth = String(page.width)
    next.dataset.shareHeight = String(page.height)
    if (!withHeader) {
      next.querySelector('.share-page-header')?.remove()
      next.querySelector('.share-page-footer > span:first-child')?.remove()
    }
    next.querySelector('[data-share-content]')!.replaceChildren()
    next.querySelector('[data-share-page-number]')!.textContent = ''
    mount.append(next)
    pages.push(next)
    return next
  }
  let current = makePage(true)
  let body = current.querySelector<HTMLElement>('[data-share-content]')!
  let bodyLimit = body.clientHeight
  const add = (atom: HTMLElement, messageId: string) => {
    body.append(atom)
    if (body.scrollHeight <= bodyLimit + 1 || body.children.length === 1) return
    atom.remove()
    current = makePage(false)
    body = current.querySelector<HTMLElement>('[data-share-content]')!
    bodyLimit = body.clientHeight
    if (atom.dataset.shareRole === 'assistant' && !atom.querySelector('[data-share-role-label]')) {
      const label = document.createElement('div')
      label.className = 'share-role'
      label.textContent = continuation
      atom.prepend(label)
    }
    atom.dataset.shareMessageId = messageId
    body.append(atom)
  }
  const splitAtom = (atom: HTMLElement, messageId: string) => {
    body.append(atom)
    const atomHeight = atom.getBoundingClientRect().height
    const pre = atom.querySelector('pre')
    // Measure while attached: detached blocks have no computed line height.
    const codeLineHeight = pre ? parseFloat(getComputedStyle(pre).lineHeight) || 22 : 22
    const codeOverhead = pre ? atomHeight - pre.getBoundingClientRect().height : 100
    atom.remove()
    if (atomHeight <= bodyLimit) { add(atom, messageId); return }
    const code = atom.querySelector('pre code')
    if (code) {
      const highlighted = [...code.children].filter(node => node.classList.contains('line'))
      const lines = highlighted.length ? highlighted : (code.textContent ?? '').split('\n').map(text => document.createTextNode(text))
      if (lines.length > 1) {
        const count = Math.max(1, Math.min(lines.length - 1, Math.floor((bodyLimit - codeOverhead) / codeLineHeight)))
        for (let start = 0; start < lines.length; start += count) {
          const fragment = atom.cloneNode(true) as HTMLElement
          fragment.querySelector('code')!.replaceChildren(...lines.slice(start, start + count).flatMap((line, index) =>
            index === 0 ? [line.cloneNode(true)] : [document.createTextNode('\n'), line.cloneNode(true)]))
          splitAtom(fragment, messageId)
        }
        return
      }
    }
    const table = atom.querySelector('table')
    if (table && (table.tBodies[0]?.rows.length ?? 0) > 1) {
      const rows = [...table.tBodies[0].rows]
      let fragment = atom.cloneNode(true) as HTMLElement
      fragment.querySelector('tbody')!.replaceChildren()
      for (const row of rows) {
        fragment.querySelector('tbody')!.append(row.cloneNode(true))
        body.append(fragment)
        const over = fragment.getBoundingClientRect().height > bodyLimit
        fragment.remove()
        if (over && fragment.querySelector('tbody')!.children.length > 1) {
          fragment.querySelector('tbody')!.lastElementChild!.remove()
          splitAtom(fragment, messageId)
          fragment = atom.cloneNode(true) as HTMLElement
          fragment.querySelector('tbody')!.replaceChildren(row.cloneNode(true))
        }
      }
      splitAtom(fragment, messageId)
      return
    }
    const list = atom.querySelector('ul,ol')
    if (list && list.children.length > 1) {
      for (const [index, item] of [...list.children].entries()) {
        const fragment = atom.cloneNode(true) as HTMLElement
        const part = fragment.querySelector('ul,ol')!
        part.replaceChildren(item.cloneNode(true))
        if (part.tagName === 'OL') part.setAttribute('start', String(index + Number(list.getAttribute('start') ?? 1)))
        splitAtom(fragment, messageId)
      }
      return
    }
    // Oversized rich blocks retain every pixel through consecutive viewports.
    // This also keeps giant code blocks and single table rows from being lost.
    for (let offset = 0; offset < atomHeight; offset += bodyLimit) {
      const slice = document.createElement('div')
      slice.className = 'share-block share-continuation-slice'
      slice.style.height = Math.min(bodyLimit, atomHeight - offset) + 'px'
      slice.style.overflow = 'hidden'
      const inner = atom.cloneNode(true) as HTMLElement
      inner.style.transform = 'translateY(-' + offset + 'px)'
      inner.style.margin = '0'
      slice.append(inner)
      add(slice, messageId)
    }
  }
  for (const message of source.querySelectorAll<HTMLElement>('[data-share-message]')) {
    const messageId = message.dataset.shareMessage!
    if (message.dataset.shareGap === 'true') {
      const gap = message.querySelector<HTMLElement>('[data-share-gap]')!.cloneNode(true) as HTMLElement
      add(gap, messageId)
    }
    const markdown = message.querySelector<HTMLElement>('.share-markdown')!
    const children = [...markdown.children]
    for (let index = 0; index < children.length; index++) {
      const atom = document.createElement('section')
      atom.className = 'share-block' + (message.dataset.shareRole === 'user' ? ' share-question' : '')
      atom.dataset.shareMessageId = messageId
      atom.dataset.shareMessageStart = index === 0 ? 'true' : 'false'
      atom.dataset.shareRole = message.dataset.shareRole
      if (index === 0) atom.append(message.querySelector('[data-share-role-label]')!.cloneNode(true))
      atom.append(children[index]!.cloneNode(true))
      // A heading is never left alone at the bottom of a page.
      if (/^H[1-6]$/.test(children[index]!.tagName) && children[index + 1]) atom.append(children[++index]!.cloneNode(true))
      // Wide GFM tables are split into groups, repeating their identifying column.
      const table = atom.querySelector('table')
      const columns = table?.rows[0]?.cells.length ?? 0
      if (table && columns > 6) {
        for (let start = 1; start < columns; start += 4) {
          const fragment = atom.cloneNode(true) as HTMLElement
          for (const row of fragment.querySelectorAll('tr')) {
            for (const [column, cell] of [...row.cells].entries()) {
              if (column !== 0 && (column < start || column >= start + 4)) cell.remove()
            }
          }
          splitAtom(fragment, messageId)
        }
      } else splitAtom(atom, messageId)
    }
  }
  for (const [index, item] of pages.entries()) {
    item.querySelector('[data-share-page-number]')!.textContent = pages.length > 1
      ? String(index + 1) + ' / ' + pages.length
      : '01'
  }
  return pages
}

/** One in-memory image surface: pages stay at their original size and order. */
export function composeSharePages(pages: readonly HTMLElement[], mount: HTMLElement): HTMLElement {
  const width = pages.reduce((sum, page) => sum + Number(page.dataset.shareWidth), 0)
  const height = Math.max(...pages.map(page => Number(page.dataset.shareHeight)))
  if (!isShareImageSizeAllowed(width * SHARE_IMAGE.scale, height * SHARE_IMAGE.scale)) throw new ShareImageError('tooLong')
  const image = document.createElement('div')
  image.className = 'share-spread'
  image.dataset.shareWidth = String(width)
  image.dataset.shareHeight = String(height)
  image.style.width = width + 'px'
  image.style.height = height + 'px'
  image.style.backgroundColor = getComputedStyle(pages[0]!).backgroundColor
  image.append(...pages)
  mount.replaceChildren(image)
  return image
}
