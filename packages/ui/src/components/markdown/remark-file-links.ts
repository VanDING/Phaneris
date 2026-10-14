import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * CommonMark treats a backslash before punctuation as an escape, including the
 * separator in Windows paths such as E:\project\.cache\report.md. Recover the
 * destination from this already-parsed link's source range before conversion
 * to HTML percent-encodes it. Labels, code, HTML and non-file URLs are untouched.
 */
export function remarkFileLinks() {
  return (tree: Root, file: { value: unknown }) => {
    if (typeof file.value !== 'string') return
    const source = file.value
    visit(tree, ['link', 'definition'], node => {
      if (node.type !== 'link' && node.type !== 'definition') return
      if (!/^[A-Za-z]:/.test(node.url)) return
      const start = node.position?.start.offset, end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const raw = source.slice(start, end)
      const prefix = node.type === 'link'
        ? /\]\(\s*(<?[A-Za-z]:[\\/])/.exec(raw)
        : /^\s{0,3}\[[^\n]*\]:\s*(<?[A-Za-z]:[\\/])/.exec(raw)
      if (!prefix) return
      const destination = raw.slice(prefix.index + prefix[0].length - prefix[1]!.length)
      let path: string
      if (destination.startsWith('<')) {
        const close = destination.indexOf('>')
        if (close < 0) return
        path = destination.slice(1, close)
      } else {
        path = destination.split(/\s/, 1)[0]!
        if (node.type === 'link' && path.length === destination.length && path.endsWith(')')) path = path.slice(0, -1)
      }
      node.url = path
    })
  }
}
