/**
 * Design drift audit.
 *
 * Counts the five class of drift the frontend design review (2026-10-20) found
 * accumulating without a gate. It is value-based and file-attributed, in the
 * same spirit as `measure-scale-drift.ts`: the *report* never fails CI, the
 * frozen baseline in `scripts/design-drift-baseline.json` is what
 * `check:design-drift` ratchets against.
 *
 * What is counted, and why each one needs a number:
 *
 *   1. `defaultFontSize`   — `text-xs|sm|base|lg|…`: Tailwind's rem defaults,
 *      which land between contract tiers (11.25 / 13.125 / 16.875px at a 15px
 *      root). DESIGN.md says every size comes from a tier.
 *   2. `translucentText`   — `text-<role>/NN`: alpha text composites against
 *      whatever is behind it, so its contrast is unknowable at review time.
 *   3. `strokeWidthLiteral`— `<svg strokeWidth={2}>`: bypasses
 *      `--icon-stroke-width`, so themes cannot restyle the icon.
 *   4. `interactiveTitle`  — `title=` on a button-ish element: a native tooltip
 *      is unreachable by touch, slow, and unstyled next to the shared Tooltip.
 *   5. `focusRingSuppressed` — `focus-visible:ring-0`: removes the only visible
 *      keyboard affordance and can silently cancel a `craft-*` focus ring.
 *
 * Plus one zero-tolerance check: every `animate-*` utility and its keyframes in
 * `motion.css` must have a consumer, or the motion vocabulary is lying about
 * what the product does.
 *
 * Usage:
 *   bun run scripts/measure-design-drift.ts                  # report
 *   bun run scripts/measure-design-drift.ts --write-baseline # freeze baseline
 *   bun run scripts/measure-design-drift.ts --json
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')

export const DESIGN_ROOTS = [
  'apps/electron/src/renderer',
  'packages/ui/src',
  'apps/webui/src',
  'apps/viewer/src',
] as const

const EXCLUDED_PATH = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.generated\./

export interface DriftCounter {
  count: number
  /** file → occurrences, so a failure names the surface that grew. */
  files: Record<string, number>
}

export interface MotionVocabulary {
  /** `animate-*` utilities declared in motion.css. */
  declared: string[]
  /** Declared utilities with at least one consumer outside motion.css. */
  consumed: string[]
  /** Declared and consumed by nobody: the vocabulary claims a product language
   *  the product does not speak. */
  orphaned: string[]
}

export interface DesignDriftReport {
  generatedAt: string
  filesScanned: number
  counters: {
    defaultFontSize: DriftCounter
    translucentText: DriftCounter
    strokeWidthLiteral: DriftCounter
    interactiveTitle: DriftCounter
    focusRingSuppressed: DriftCounter
  }
  motion: MotionVocabulary
}

/** Tailwind's own rem type scale. None of these is a contract tier. */
const DEFAULT_FONT_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g
/** Alpha text on any semantic colour. Opaque role tokens are the contract. */
const TRANSLUCENT_TEXT = /(?<![\w-])text-(?:foreground|muted-foreground|accent|info|success|destructive|text-primary|text-secondary|text-tertiary)\/(?:\d{1,3})\b/g
/** A numeric stroke width under 4 is an optical weight; 4+ is authored in
 *  viewBox units (a brand glyph) and is not a pixel decision. */
const STROKE_WIDTH = /\bstrokeWidth=(?:"([0-3](?:\.\d+)?)"|\{([0-3](?:\.\d+)?)\})/g
const TITLE_ATTR = /(?<![\w-])title=(?:"[^"]*"|\{'[^']*'\}|\{[^}]*\})/g
const TAG_START = /<([A-Za-z][\w.$-]*)/g
const INTERACTIVE_TAG = /button|Button/i
const FOCUS_SUPPRESSED = /(?<![\w-])focus-visible:ring-0\b/g
const ANIMATION_CLASS = /\.(animate-[a-z0-9-]+)\s*\{/g
/** A raw Tailwind hue where a semantic role belongs. Brand marks are exempt:
 *  a vendor logo keeps its identity colour on every theme. */
const PALETTE_HUE = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:red|rose|amber|orange|yellow|emerald|green|teal|lime|sky|blue|cyan|indigo|violet|purple|fuchsia|pink|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d{1,3})?/g
/** Files allowed to carry raw hues, with the reason. */
const PALETTE_HUE_EXEMPT = ['apps/electron/src/renderer/components/icons/ConnectionIcon.tsx']

/**
 * `title=` inside a button-ish JSX opening tag.
 *
 * A line-based match misses the common multi-line form, so the tag extent is
 * scanned properly: from `<Name` forward, tracking `{}` depth and quotes, until
 * the `>` that closes the opening tag. `=>` inside a handler therefore cannot
 * end the tag early.
 */
export function countInteractiveTitles(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(TAG_START)) {
    const tagName = match[1]!
    let depth = 0
    let quote: string | null = null
    let end = -1
    for (let index = match.index! + match[0].length; index < text.length; index++) {
      const char = text[index]!
      if (quote) {
        if (char === '\\') { index++; continue }
        if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '{') depth++
      else if (char === '}') depth = Math.max(0, depth - 1)
      else if (char === '>' && depth === 0) { end = index; break }
    }
    if (end < 0) continue
    const tag = text.slice(match.index, end)
    const interactive = INTERACTIVE_TAG.test(tagName) || /role="button"/.test(tag)
    if (!interactive) continue
    for (const title of tag.matchAll(TITLE_ATTR)) found.push(title[0])
  }
  return found
}

const COUNTERS = {
  defaultFontSize: DEFAULT_FONT_SIZE,
  translucentText: TRANSLUCENT_TEXT,
  strokeWidthLiteral: STROKE_WIDTH,
  focusRingSuppressed: FOCUS_SUPPRESSED,
  paletteHue: PALETTE_HUE,
} as const

type CounterName = keyof typeof COUNTERS | 'interactiveTitle'

function emptyCounters(): Record<CounterName, DriftCounter> {
  return Object.fromEntries(
    (['defaultFontSize', 'translucentText', 'strokeWidthLiteral', 'interactiveTitle', 'focusRingSuppressed', 'paletteHue'] as CounterName[])
      .map(name => [name, { count: 0, files: {} }]),
  ) as Record<CounterName, DriftCounter>
}

/** Every product source file the design contract governs. */
export function designSourceFiles(): { path: string; relativePath: string }[] {
  const files: { path: string; relativePath: string }[] = []
  for (const directory of DESIGN_ROOTS) {
    const glob = new Glob('**/*.{ts,tsx,css}')
    for (const path of glob.scanSync({ cwd: resolve(root, directory), absolute: true })) {
      const relativePath = path.slice(root.length + 1).replaceAll('\\', '/')
      if (EXCLUDED_PATH.test(relativePath)) continue
      files.push({ path, relativePath })
    }
  }
  return files
}

/**
 * A declared motion utility is "consumed" when its class name appears in any
 * non-CSS product source. The declaration file itself never counts.
 */
export function measureMotionVocabulary(sources: { relativePath: string; text: string }[]): MotionVocabulary {
  const cssPath = 'packages/ui/src/styles/motion.css'
  const css = sources.find(source => source.relativePath === cssPath)?.text
    ?? readFileSync(resolve(root, cssPath), 'utf8')
  const declared = [...new Set([...css.matchAll(ANIMATION_CLASS)].map(match => match[1]!))].sort()
  const consumers = sources.filter(source => source.relativePath !== cssPath)
  const consumed = declared.filter(name => consumers.some(source => source.text.includes(name)))
  return { declared, consumed, orphaned: declared.filter(name => !consumed.includes(name)) }
}

export function measureDesignDrift(): DesignDriftReport {
  const counters = emptyCounters()
  const sources: { relativePath: string; text: string }[] = []
  for (const { path, relativePath } of designSourceFiles()) {
    const text = readFileSync(path, 'utf8')
    sources.push({ relativePath, text })
    const lines = text.split('\n')
    // Comment lines describe intent; they do not ship a class. Block comments
    // are tracked across lines because a CSS header explains the very tokens
    // the counters look for (`--text-sm` in prose is not a `text-sm` utility).
    let inBlockComment = false
    const codeLines: string[] = []
    for (const line of lines) {
      const trimmed = line.trimStart()
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false
        continue
      }
      if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true
        continue
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      codeLines.push(line)
    }
    const paletteExempt = PALETTE_HUE_EXEMPT.includes(relativePath)
    for (const [name, pattern] of Object.entries(COUNTERS) as [CounterName, RegExp][]) {
      if (name === 'paletteHue' && paletteExempt) continue
      for (const line of codeLines) {
        const found = [...line.matchAll(pattern)].length
        if (!found) continue
        counters[name].count += found
        counters[name].files[relativePath] = (counters[name].files[relativePath] ?? 0) + found
      }
    }
    const titles = countInteractiveTitles(text).length
    if (titles) {
      counters.interactiveTitle.count += titles
      counters.interactiveTitle.files[relativePath] = (counters.interactiveTitle.files[relativePath] ?? 0) + titles
    }
  }
  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    filesScanned: sources.length,
    counters,
    motion: measureMotionVocabulary(sources),
  }
}

/** Baseline artifact: the ratchet. Counts may fall, never rise. */
export interface DesignDriftBaseline {
  version: 1
  policy: string
  /** Partial on purpose: a baseline frozen before a counter existed must not
   *  crash the gate — `check:design-drift` reports the missing counter instead. */
  counters: Partial<Record<CounterName, { count: number; files: Record<string, number> }>>
  /** `orphaned` is the state at freeze time (expected: empty). `reserved` lists
   *  utilities deliberately kept without a product consumer, e.g. a playground
   *  fixture — each one needs a reason. */
  motion: { orphaned: string[]; reserved?: string[] }
}

export function buildBaseline(report: DesignDriftReport): DesignDriftBaseline {
  return {
    version: 1,
    policy:
      'Frozen drift counts. check:design-drift fails when any counter grows; lower a count with '
      + '`bun run design:drift --write-baseline` after migrating a batch. Orphaned motion utilities must stay empty: '
      + 'delete a utility or give it a consumer.',
    counters: report.counters,
    motion: { orphaned: report.motion.orphaned },
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const report = measureDesignDrift()
  if (args.includes('--write-baseline')) {
    writeFileSync(resolve(root, 'scripts/design-drift-baseline.json'), JSON.stringify(buildBaseline(report), null, 2) + '\n')
    console.log('Baseline written: scripts/design-drift-baseline.json')
  }
  if (args.includes('--write-evidence')) {
    const path = `docs/verification/design-drift-baseline-${report.generatedAt}.json`
    writeFileSync(resolve(root, path), JSON.stringify(report, null, 2) + '\n')
    console.log(`Evidence written: ${path}`)
  }
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`files scanned: ${report.filesScanned}`)
    for (const [name, counter] of Object.entries(report.counters)) {
      const top = Object.entries(counter.files).sort((a, b) => b[1] - a[1]).slice(0, 3)
      console.log(`${name}: ${counter.count} in ${Object.keys(counter.files).length} files` + (top.length ? ` (top: ${top.map(([file, count]) => `${file.split('/').pop()} ${count}`).join(', ')})` : ''))
    }
    console.log(`motion utilities: ${report.motion.declared.length} declared, ${report.motion.consumed.length} consumed, ${report.motion.orphaned.length} orphaned`)
    if (report.motion.orphaned.length) console.log(`  orphaned: ${report.motion.orphaned.join(', ')}`)
  }
}
