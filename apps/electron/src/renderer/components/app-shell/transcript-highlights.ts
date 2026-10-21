/**
 * Transcript search highlighting, as a module instead of two inline effects.
 *
 * The CSS Custom Highlight API is document-global and takes `Range` objects, so
 * the interesting logic is: walk a subtree, concatenate its text nodes so a match
 * can cross elements (a highlighted `<strong>` splits a word into three nodes),
 * map the match back to one Range spanning those nodes, and keep two registries —
 * `search-passive` for the rest and `search-active` for the current match.
 *
 * Kept out of the component so it can be exercised against a real DOM: the
 * browser workflow renders a fixed subtree, collects, applies and clears, and
 * asserts the ranges. Inside ChatDisplay the same code was only reachable by
 * mounting a whole session.
 */

/** Guard: a pathological query on a long transcript must not build unbounded ranges. */
export const MAX_HIGHLIGHT_RANGES = 5000

export const PASSIVE_HIGHLIGHT = 'search-passive'
export const ACTIVE_HIGHLIGHT = 'search-active'

/** `CSS.highlights` is not in every Chromium/Electron build, and HMR can leave it untyped. */
export function getCSSHighlights(): Map<string, Highlight> | undefined {
  return (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights
}

/** Text under these selectors is never searchable (markup, code chrome, excluded cells). */
const EXCLUDED_SELECTOR = '[data-search-exclude="true"]'

function isEligibleTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return false
  const tag = parent.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style') return false
  return !parent.closest(EXCLUDED_SELECTOR)
}

/**
 * Collect every match of `query` inside `root` as a Range, crossing element
 * boundaries when the match spans them. Case-insensitive.
 */
export function collectHighlightRanges(root: Node, query: string, maxRanges = MAX_HIGHLIGHT_RANGES): Range[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return []

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => isEligibleTextNode(node as Text)
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT,
  })

  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) textNodes.push(current as Text)
  if (textNodes.length === 0) return []

  const offsets: Array<{ node: Text; start: number; end: number }> = []
  let total = 0
  for (const node of textNodes) {
    const text = node.textContent ?? ''
    offsets.push({ node, start: total, end: total + text.length })
    total += text.length
  }
  const haystack = textNodes.map(node => node.textContent ?? '').join('').toLowerCase()

  const ranges: Range[] = []
  let position = 0
  while (position < haystack.length && ranges.length < maxRanges) {
    const index = haystack.indexOf(needle, position)
    if (index === -1) break
    const end = index + needle.length

    try {
      const range = new Range()
      let started = false
      for (const offset of offsets) {
        if (offset.end <= index) continue
        if (offset.start >= end) break
        if (!started) {
          range.setStart(offset.node, index - offset.start)
          started = true
        }
        range.setEnd(offset.node, Math.min(offset.end - offset.start, end - offset.start))
      }
      if (started) ranges.push(range)
    } catch {
      // The node was removed mid-walk (streaming markdown): skip the match.
    }

    position = end
  }
  return ranges
}

/**
 * Paint `ranges`, with `activeIndex` in its own registry so the current match can
 * be styled differently from the rest. No-op when the API or the ranges are absent.
 */
export function applyHighlightRanges(ranges: Range[], activeIndex: number): void {
  const registry = getCSSHighlights()
  if (!registry) return
  try {
    if (ranges.length === 0) {
      registry.delete(PASSIVE_HIGHLIGHT)
      registry.delete(ACTIVE_HIGHLIGHT)
      return
    }
    const active = ranges[activeIndex]
    if (active) {
      registry.set(PASSIVE_HIGHLIGHT, new Highlight(...ranges.filter((_, index) => index !== activeIndex)))
      registry.set(ACTIVE_HIGHLIGHT, new Highlight(active))
    } else {
      registry.set(PASSIVE_HIGHLIGHT, new Highlight(...ranges))
      registry.delete(ACTIVE_HIGHLIGHT)
    }
  } catch {
    // Highlight construction failed — degrade to no highlighting.
  }
}

/** Remove both registries. Safe when the API is unavailable. */
export function clearHighlightRanges(): void {
  const registry = getCSSHighlights()
  try {
    registry?.delete(PASSIVE_HIGHLIGHT)
    registry?.delete(ACTIVE_HIGHLIGHT)
  } catch { /* API unavailable — no-op */ }
}

/** Total ranges currently painted, for tests and diagnostics. */
export function countHighlightRanges(): { passive: number; active: number } {
  const registry = getCSSHighlights()
  const size = (name: string): number => {
    const highlight = registry?.get(name) as unknown as { size?: number } | undefined
    if (!highlight) return 0
    return typeof highlight.size === 'number' ? highlight.size : 0
  }
  return { passive: size(PASSIVE_HIGHLIGHT), active: size(ACTIVE_HIGHLIGHT) }
}
