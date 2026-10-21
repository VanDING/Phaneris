/**
 * Remove per-call numeric icon stroke widths.
 *
 * `theme-adapter.css` already does `.lucide { stroke-width: var(--icon-stroke-width) }`,
 * and a CSS declaration beats SVG's presentation attribute — so every
 * `strokeWidth={2}` on a Lucide icon was **already dead**. What remained live
 * were the hand-written `<svg>` elements (7 sites), which painted 1.5/2 in a
 * theme whose icons are 1.65/1.4, plus the optical intent the review read as
 * "three competing weights".
 *
 * This pass deletes the dead numbers and moves the hand-written glyphs onto the
 * `.icon-stroke` role, so the theme owns the weight everywhere. A value ≥ 4 is
 * left alone: that is a brand glyph authored in viewBox units (the MCP mark is
 * 12 units in a 150×170 box), not a pixel weight.
 *
 * Usage:
 *   bun run scripts/migrate-icon-stroke.ts           # dry run
 *   bun run scripts/migrate-icon-stroke.ts --apply   # write
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const apply = process.argv.includes('--apply')

const ROOTS = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const EXCLUDED = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.generated\./

/** `strokeWidth` with a numeric value — attribute or JSX expression. */
const STROKE = /\s+strokeWidth=(?:"(\d+(?:\.\d+)?)"|\{(\d+(?:\.\d+)?)\})/g
/** A value at or above this is authored in viewBox units, not a pixel weight. */
const VIEWBOX_UNIT_THRESHOLD = 4

const counts = new Map<string, number>()
const manual: string[] = []
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
    const next = original.split('\n').map((line, index) => {
      if (isCommentLine(line)) return line
      return line.replace(STROKE, (match, quoted: string | undefined, expression: string | undefined) => {
        const value = Number(quoted ?? expression)
        if (Number.isNaN(value) || value >= VIEWBOX_UNIT_THRESHOLD) return match
        changed = true
        counts.set(`${value}`, (counts.get(`${value}`) ?? 0) + 1)
        // A hand-written <svg> was actually painting this value; it needs the
        // role to keep a weight at all.
        if (/<svg\b/.test(line)) manual.push(`${relativePath}:${index + 1}`)
        return ''
      })
    }).join('\n')
    if (!changed) continue
    filesTouched += 1
    if (apply) writeFileSync(path, next)
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0)
console.log(`${apply ? 'Applied' : 'Dry run'}: ${filesTouched} files, ${total} sites`)
for (const [value, count] of [...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) console.log(`  ${value}: ${count}`)
if (manual.length) {
  console.log('Hand-written <svg> lines that need the .icon-stroke role:')
  for (const entry of manual) console.log(`  ${entry}`)
}
if (!apply) console.log('Re-run with --apply to write.')
