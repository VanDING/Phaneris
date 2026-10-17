/**
 * Mechanical migration of exact contract tiers.
 *
 * Batch 1 only rewrites values that map 1:1 to a contract tier, so the diff is
 * pixel-identical by construction. Near-miss values (10.5px, 3px, 10px, …)
 * stay in the legacy allowlist until their surface gets a screenshot review.
 *
 * Usage: bun run scripts/migrate-scale-literals.ts [--apply]
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { CONTROL_HEIGHT_TIERS, FONT_SIZE_TIERS, RADIUS_TIERS } from '../packages/ui/src/lib/scale-contract'

const root = resolve(import.meta.dir, '..')
const apply = process.argv.includes('--apply')
const batch2 = process.argv.includes('--batch2')

const FONT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FONT_SIZE_TIERS).map(([tier, px]) => [`${px}px`, `text-${tier}`]),
)
const RADIUS_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RADIUS_TIERS).map(([tier, px]) => [`${px}px`, `shape-${tier}`]),
)
/** Only `h-` and `size-` are migrated: min/max heights describe layout bounds. */
const HEIGHT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CONTROL_HEIGHT_TIERS).map(([tier, px]) => [`${px}px`, `control-${tier}`]),
)

/** Batch 2: near-miss values converge by 1–2px (screenshot-reviewed batch). */
const FONT_BATCH2: Record<string, string> = {
  '8px': 'text-micro', '9px': 'text-micro',
  '10.5px': 'text-meta', '11.5px': 'text-meta',
  '12.5px': 'text-label', '13.5px': 'text-reading',
  '15px': 'text-title', '17px': 'text-title',
}
const RADIUS_BATCH2: Record<string, string> = {
  '1px': 'shape-xs', '3px': 'shape-sm', '5px': 'shape-sm',
  '7px': 'shape-lg', '9px': 'shape-lg',
  '10px': 'shape-xl', '14px': 'shape-xl', '16px': 'shape-xl', '20px': 'shape-xl',
}
const HEIGHT_BATCH2: Record<string, string> = { '28px': 'control-sm', '40px': 'control-xl' }

/** CSS declarations map to the same tiers; the 16px iOS zoom guard stays literal. */
const CSS_FONT_MAP: Record<string, string> = {
  '8px': 'micro', '9px': 'micro', '10px': 'micro', '10.5px': 'meta', '11px': 'meta', '11.5px': 'meta',
  '12px': 'label', '12.5px': 'label', '13px': 'body', '13.5px': 'reading', '14px': 'reading',
  '15px': 'title', '17px': 'title', '20px': 'display',
}
const CSS_RADIUS_MAP: Record<string, string> = {
  '1px': 'xs', '2px': 'xs', '3px': 'sm', '4px': 'sm', '5px': 'sm', '6px': 'md',
  '7px': 'lg', '8px': 'lg', '9px': 'lg', '10px': 'xl', '12px': 'xl', '14px': 'xl',
  '16px': 'xl', '20px': 'xl', '999px': 'round', '9999px': 'round',
}

const ROOTS = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const EXCLUDED = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/

let filesTouched = 0
const counts = new Map<string, number>()

function isCommentLine(line: string) {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*')
}

for (const directory of ROOTS) {
  const glob = new Glob('**/*.{ts,tsx}')
  for (const path of glob.scanSync({ cwd: resolve(root, directory), absolute: true })) {
    const relativePath = relative(root, path).replaceAll('\\', '/')
    if (EXCLUDED.test(relativePath)) continue
    const original = readFileSync(path, 'utf8')
    let changed = false
    const next = original.split('\n').map(line => {
      if (isCommentLine(line)) return line
      return line
        .replace(/text-\[(\d+(?:\.\d+)?)px\]/g, (match, value: string) => {
          const replacement = FONT_MAP[`${value}px`] ?? (batch2 ? FONT_BATCH2[`${value}px`] : undefined)
          if (!replacement) return match
          counts.set(replacement, (counts.get(replacement) ?? 0) + 1)
          changed = true
          return replacement
        })
        .replace(/rounded(-[trblse]{1,2})?-\[(\d+(?:\.\d+)?)px\]/g, (match, side: string | undefined, value: string) => {
          const tier = RADIUS_MAP[`${value}px`] ?? (batch2 ? RADIUS_BATCH2[`${value}px`] : undefined)
          if (!tier) return match
          const replacement = `rounded${side ?? ''}-${tier}`
          const bucket = `rounded-${tier}`
          counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
          changed = true
          return replacement
        })
        .replace(/(?<![\w-])(h|size)-\[(\d+(?:\.\d+)?)px\]/g, (match, prefix: string, value: string) => {
          const tier = HEIGHT_MAP[`${value}px`] ?? (batch2 ? HEIGHT_BATCH2[`${value}px`] : undefined)
          if (!tier) return match
          const replacement = `${prefix}-${tier}`
          counts.set(replacement, (counts.get(replacement) ?? 0) + 1)
          changed = true
          return replacement
        })
    }).join('\n')
    if (!changed) continue
    filesTouched += 1
    if (apply) writeFileSync(path, next)
  }
}

// CSS pass: declarations cannot use Tailwind classes, so they consume the
// generated role tokens directly. Generated token files and the iOS 16px zoom
// guard are excluded.
const CSS_EXCLUDED = /styles\/(?:theme-tokens|role-tokens)\.css$|\.generated\.|(?:^|\/)playground(?:\/|$)/
for (const directory of ROOTS) {
  const glob = new Glob('**/*.css')
  for (const path of glob.scanSync({ cwd: resolve(root, directory), absolute: true })) {
    const relativePath = relative(root, path).replaceAll('\\', '/')
    if (CSS_EXCLUDED.test(relativePath)) continue
    const original = readFileSync(path, 'utf8')
    let changed = false
    const next = original
      .replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (match, value: string) => {
        const tier = CSS_FONT_MAP[`${value}px`]
        if (!tier) return match
        counts.set(`css font ${tier}`, (counts.get(`css font ${tier}`) ?? 0) + 1)
        changed = true
        return `font-size: var(--type-${tier}-size)`
      })
      .replace(/border-radius:\s*(\d+(?:\.\d+)?)px/g, (match, value: string) => {
        const tier = CSS_RADIUS_MAP[`${value}px`]
        if (!tier) return match
        counts.set(`css radius ${tier}`, (counts.get(`css radius ${tier}`) ?? 0) + 1)
        changed = true
        return `border-radius: var(--shape-${tier})`
      })
    if (!changed) continue
    filesTouched += 1
    if (apply) writeFileSync(path, next)
  }
}

console.log(`${apply ? 'Applied' : 'Dry run'}: ${filesTouched} files, ${[...counts.values()].reduce((a, b) => a + b, 0)} sites`)
for (const [name, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${name}: ${count}`)
if (!apply) console.log('Re-run with --apply to write.')
