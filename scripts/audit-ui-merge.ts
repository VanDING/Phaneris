/**
 * `audit:ui-merge` — prove the merge layer keeps every contract font-size tier.
 *
 * ## Why this gate exists
 *
 * `cn()` runs `twMerge(clsx(...))`. Everything visual goes through it: every
 * `cva` variant, every conditional class string. The stock `tailwind-merge`
 * configuration files a custom `text-meta` under *text colour*, so
 * `cn('text-meta text-foreground')` returned `text-foreground` — the font-size
 * tier vanished and the element inherited the 15px root. That single mismatch
 * produced the 2026-10-21 audit's "字号层级随机" finding: Badges at 15px instead
 * of 11px, filled small buttons whose `text-background` was eaten (invisible
 * labels), panel filters larger than the view title they filter.
 *
 * The fix lives in `packages/ui/src/lib/utils.ts` (tiers registered with
 * `extendTailwindMerge`). This script is the ratchet: it imports *that* merger,
 * replays every class literal in the product source through it, and fails if a
 * contract tier present in the input is missing from the output.
 *
 * A literal that puts two tiers in one string (`text-meta text-label`) is a real
 * loss too — `cn` keeps only the last, so which tier wins depends on author
 * order rather than intent. Keep one tier per element.
 *
 * Usage:
 *   bun run scripts/audit-ui-merge.ts           # human report, exit 1 on loss
 *   bun run scripts/audit-ui-merge.ts --json    # machine report
 */
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONTRACT_FONT_SIZE_TIERS, twMerge } from '../packages/ui/src/lib/utils'

const root = resolve(import.meta.dir, '..')

/** Every product source file the design contract governs (same roots as the drift gate). */
const DESIGN_ROOTS = [
  'apps/electron/src/renderer',
  'packages/ui/src',
  'apps/webui/src',
  'apps/viewer/src',
] as const

const EXCLUDED_PATH =
  /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.generated\./

const TIER = new RegExp(`(?<![\\w-])text-(${CONTRACT_FONT_SIZE_TIERS.join('|')})(?![\\w-])`, 'g')
/** A class literal: single/double quoted, or a template without interpolation. */
const CLASS_LITERAL = /(['"`])([^'"`\n]{0,400}?)\1/g

export interface TierLoss {
  file: string
  line: number
  literal: string
  /** Tiers present in the literal but absent from the merged output. */
  lost: string[]
  merged: string
}

export function scanSource(relativePath: string, text: string): TierLoss[] {
  const losses: TierLoss[] = []
  const lines = text.split('\n')
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const lineAt = (index: number) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (lineStarts[middle]! <= index) low = middle
      else high = middle - 1
    }
    return low + 1
  }

  for (const match of text.matchAll(CLASS_LITERAL)) {
    const literal = match[2]!
    if (!literal.includes('text-')) continue
    if (literal.includes('${')) continue
    const tiers = [...literal.matchAll(TIER)].map(found => found[1]!)
    if (tiers.length === 0) continue
    const merged = twMerge(literal)
    const lost = tiers.filter(tier => !new RegExp(`(?<![\\w-])text-${tier}(?![\\w-])`).test(merged))
    if (lost.length === 0) continue
    losses.push({
      file: relativePath,
      line: lineAt(match.index!),
      literal: literal.trim(),
      lost: [...new Set(lost)],
      merged,
    })
  }
  return losses
}

export function auditUiMerge(): { filesScanned: number; losses: TierLoss[] } {
  const losses: TierLoss[] = []
  let filesScanned = 0
  for (const directory of DESIGN_ROOTS) {
    const glob = new Glob('**/*.{ts,tsx}')
    for (const path of glob.scanSync({ cwd: resolve(root, directory), absolute: true })) {
      const relativePath = path.slice(root.length + 1).replaceAll('\\', '/')
      if (EXCLUDED_PATH.test(relativePath)) continue
      filesScanned++
      losses.push(...scanSource(relativePath, readFileSync(path, 'utf8')))
    }
  }
  return { filesScanned, losses }
}

const report = auditUiMerge()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), tiers: CONTRACT_FONT_SIZE_TIERS, ...report }, null, 2))
} else {
  console.log(`files scanned: ${report.filesScanned}`)
  console.log(`tiers registered: ${CONTRACT_FONT_SIZE_TIERS.join(', ')}`)
  if (report.losses.length === 0) {
    console.log('Merge layer OK: every literal keeps its contract font-size tier.')
  } else {
    for (const loss of report.losses) {
      console.log(`  LOST ${loss.lost.join('+')} — ${loss.file}:${loss.line}`)
      console.log(`    in:     ${loss.literal}`)
      console.log(`    merged: ${loss.merged}`)
    }
  }
}

if (report.losses.length > 0) {
  console.error(`\naudit:ui-merge failed: ${report.losses.length} literal(s) lose a contract tier in cn().`)
  process.exit(1)
}
