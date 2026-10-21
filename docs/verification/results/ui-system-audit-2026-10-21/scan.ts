/**
 * Read-only UI consistency scan for the Phaneris frontend audit.
 *
 * Reproduces the `cn()` merge path with the installed tailwind-merge and reports
 * class expressions that silently lose a contract type tier. It also counts
 * review-only signals the current gates do not measure (legacy tokens, non-tier
 * heights, native titles, tab strips).
 *
 * Run: bun run docs/verification/results/ui-system-audit-2026-10-21/scan.ts
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { twMerge } from 'tailwind-merge'

const ROOT = process.cwd()
const HOSTS = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const TIERS = ['micro', 'meta', 'label', 'body', 'reading', 'title', 'display'] as const
const TIER_RE = new RegExp(`\\btext-(${TIERS.join('|')})\\b`)
const OTHER_TEXT_RE = /\btext-(?!micro\b|meta\b|label\b|body\b|reading\b|title\b|display\b)[a-zA-Z0-9[\]#/().,%_-]+/g
const PALETTE_RE = /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g
const RAW_HEIGHT_RE = /\bh-(?:5|6|7|8|9|10|11|12)\b/g
const INLINE_HEX_RE = /#[0-9a-fA-F]{3,8}\b/g

type Hit = { file: string; line: number; input: string; output: string; lost: string }
type Counts = Record<string, number>
const counts: Counts = {}
const lostHits: Hit[] = []
const buttonTitleHits: Hit[] = []
const paletteHits: string[] = []
const heightHits: string[] = []
const tabStrips: string[] = []
const cvaHits: string[] = []
const buttonSizes: Counts = {}

const bump = (key: string, by = 1) => { counts[key] = (counts[key] ?? 0) + by }
const lineAt = (source: string, index: number) => source.slice(0, index).split(/\r?\n/).length

function walk(dir: string): string[] {
  const out: string[] = []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (['node_modules', 'dist', 'release'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(path)
  }
  return out
}

/** Extract string literals (including template text) from an expression, in order. */
function literals(expression: string): string[] {
  const out: string[] = []
  for (const match of expression.matchAll(/(?<q>['"`])((?:\\.|(?!\k<q>).)*?)\k<q>/gs)) {
    const value = match[2]
    if (/[a-z]/.test(value) && value.includes('-')) out.push(value)
  }
  return out
}

function matchingParen(source: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (quote) {
      if (char === '\\') { i++; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue }
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function classifyLoss(input: string, output: string): string | null {
  for (const tier of TIERS) {
    const token = `text-${tier}`
    if (input.includes(token) && !output.includes(token)) return tier
  }
  return null
}

function scanCnCall(file: string, source: string, start: number, end: number) {
  const inner = source.slice(start, end)
  bump('cn() calls')
  // Evaluate each top-level argument; ternaries contribute both branches. This
  // over-approximates (both branches cannot render at once) but never hides a
  // real collision inside one branch.
  const variants: string[][] = [[]]
  let depth = 0
  let quote: string | null = null
  let token = ''
  const flush = () => {
    if (!token.trim()) { token = ''; return }
    const found = literals(token)
    if (found.length) variants[variants.length - 1].push(...found)
    token = ''
  }
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]
    if (quote) {
      token += char
      if (char === '\\') { token += inner[++i] ?? ''; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '\'' || char === '"' || char === '`') { quote = char; token += char; continue }
    if ('([{'.includes(char)) depth++
    if (')]}'.includes(char)) depth--
    if (char === ',' && depth === 0) { flush(); continue }
    token += char
  }
  flush()
  for (const parts of variants) {
    const input = parts.join(' ')
    if (!TIER_RE.test(input)) continue
    if (!OTHER_TEXT_RE.test(input)) continue
    OTHER_TEXT_RE.lastIndex = 0
    const output = twMerge(input)
    const lost = classifyLoss(input, output)
    if (!lost) continue
    bump(`cn() tier lost: ${lost}`)
    lostHits.push({ file, line: lineAt(source, start), input: input.slice(0, 260), output, lost })
  }
}

function scanCvaDefinition(file: string, source: string, start: number, end: number) {
  const block = source.slice(start, end)
  const found = literals(block)
  if (!found.length) return
  // The first string is the base; every later string is a variant value. cva
  // concatenates them without merging, and callers conventionally wrap the
  // result in cn(), which is where the tier/colour collision happens.
  const [base, ...variants] = found
  let mixed = 0
  for (const variant of variants) {
    const joined = `${base} ${variant}`
    if (!TIER_RE.test(joined) || !OTHER_TEXT_RE.test(joined)) { OTHER_TEXT_RE.lastIndex = 0; continue }
    OTHER_TEXT_RE.lastIndex = 0
    const output = twMerge(joined)
    const lost = classifyLoss(joined, output)
    if (!lost) continue
    mixed++
    bump(`cva output would lose: ${lost}`)
    if (mixed <= 6) cvaHits.push(`${file}:${lineAt(source, start)} ${variant.slice(0, 100)}`)
  }
  if (mixed) bump('cva definitions with a colliding variant', 1)
}

for (const host of HOSTS) {
  for (const file of walk(join(ROOT, host))) {
    if (/[\\/]playground[\\/]/.test(file) || /[\\/]__tests__[\\/]/.test(file)) continue
    const rel = relative(ROOT, file)
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(/\bcn\s*\(/g)) {
      const open = match.index + match[0].length - 1
      const close = matchingParen(source, open)
      if (close > 0) scanCnCall(rel, source, open + 1, close)
    }
    for (const match of source.matchAll(/\bcva\s*\(/g)) {
      const open = match.index + match[0].length - 1
      const close = matchingParen(source, open)
      if (close > 0) scanCvaDefinition(rel, source, open + 1, close)
    }

    for (const match of source.matchAll(/<button\b[\s\S]{0,900}?>/g)) {
      if (/\btitle=/.test(match[0])) {
        buttonTitleHits.push({ file: rel, line: lineAt(source, match.index), input: match[0].replace(/\s+/g, ' ').slice(0, 150), output: '', lost: '' })
        bump('title attribute on <button>')
      }
    }
    for (const match of source.matchAll(/role=["']tablist["']/g)) {
      tabStrips.push(`${rel}:${lineAt(source, match.index)}`)
      bump('role=tablist')
    }
    for (const match of source.matchAll(/role=["']tab["']/g)) bump('role=tab')
    for (const match of source.matchAll(PALETTE_RE)) { paletteHits.push(`${rel}:${lineAt(source, match.index)} ${match[0]}`); bump('raw palette classes') }
    for (const match of source.matchAll(RAW_HEIGHT_RE)) { heightHits.push(`${rel}:${lineAt(source, match.index)} ${match[0]}`); bump('non-tier h-5..h-12') }
    for (const match of source.matchAll(INLINE_HEX_RE)) bump('inline hex colours')
    for (const match of source.matchAll(/<Button\b[^>]*\bsize=["'](xs|compact|sm|lg|icon)["']/g)) buttonSizes[match[1]] = (buttonSizes[match[1]] ?? 0) + 1
    bump('Button elements', (source.match(/<Button\b/g) ?? []).length)
    if (/\btext-muted-foreground\b/.test(source)) bump('files using legacy text-muted-foreground')
    if (/\btext-text-secondary\b/.test(source)) bump('files using contract text-text-secondary')
    if (/\brounded-(?:xl|2xl)\b/.test(source)) bump('files using rounded-xl/2xl')
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  counts,
  lostTier: {
    total: lostHits.length,
    byTier: Object.fromEntries(TIERS.map(tier => [tier, lostHits.filter(hit => hit.lost === tier).length])),
    byHost: Object.fromEntries(HOSTS.map(host => [host, lostHits.filter(hit => hit.file.replaceAll('\\', '/').startsWith(host)).length])),
  },
  buttonSizes,
  samples: {
    lostTier: lostHits.slice(0, 80),
    buttonTitle: buttonTitleHits.slice(0, 40),
    tabStrips,
    cva: cvaHits,
    palette: paletteHits.slice(0, 40),
    height: heightHits.slice(0, 40),
  },
}
const outDir = join(process.env.TEMP ?? ROOT, 'ui-audit')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'scan.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ counts, lostTier: summary.lostTier, buttonSizes }, null, 2))
