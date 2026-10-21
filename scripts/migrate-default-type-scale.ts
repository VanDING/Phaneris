/**
 * Retire Tailwind's default rem type scale from product code.
 *
 * The 2026-10-20 design review found two live type systems: the contract tiers
 * (`text-micro` … `text-display`) and Tailwind's defaults (`text-xs` … `text-3xl`),
 * which resolve in rem and therefore land *between* tiers at the 15px root —
 * `text-xs` = 11.25px (meta is 11), `text-sm` = 13.125px (body is 13),
 * `text-lg` = 16.875px (title is 16), `text-2xl` = 22.5px (display is 20).
 * The Scale-Is-Spoken Rule says every size comes from a tier.
 *
 * `theme-adapter.css` now aliases the two, so this pass is a rename, not a
 * repaint: each default resolves to exactly the tier it is renamed to. Largest
 * delta is `/3xl` (30px → 20px, six pairing-code sites) and `/base` (15px →
 * 14px), both listed in the review's migration report.
 *
 * Usage:
 *   bun run scripts/migrate-default-type-scale.ts           # dry run
 *   bun run scripts/migrate-default-type-scale.ts --apply   # write
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const apply = process.argv.includes('--apply')

const ROOTS = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const EXCLUDED = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.generated\./

/** Left-hand name → contract tier. Order matters: longest names first. */
const MAPPING: [string, string][] = [
  ['3xl', 'display'],
  ['2xl', 'display'],
  ['xl', 'display'],
  ['lg', 'title'],
  ['base', 'reading'],
  ['sm', 'body'],
  ['xs', 'meta'],
]

const counts = new Map<string, number>()
let filesTouched = 0

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
      let result = line
      for (const [name, tier] of MAPPING) {
        const pattern = new RegExp(`(?<![\\w-])text-${name}(?![\\w-])`, 'g')
        result = result.replace(pattern, () => {
          const replacement = `text-${tier}`
          counts.set(`${name} → ${tier}`, (counts.get(`${name} → ${tier}`) ?? 0) + 1)
          changed = true
          return replacement
        })
      }
      return result
    }).join('\n')
    if (!changed) continue
    filesTouched += 1
    if (apply) writeFileSync(path, next)
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0)
console.log(`${apply ? 'Applied' : 'Dry run'}: ${filesTouched} files, ${total} sites`)
for (const [name, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${name}: ${count}`)
if (!apply) console.log('Re-run with --apply to write.')
