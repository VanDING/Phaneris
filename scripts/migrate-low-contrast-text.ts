/**
 * Mechanical migration of sub-AA translucent text to semantic text tokens.
 *
 * `text-foreground/40` and friends compile to `color-mix(…, transparent)`, so the
 * colour that actually paints is whatever sits *behind* the element. On the
 * canvas that composites to 2.40:1 at `/40`, 3.15:1 at `/50` and 4.24:1 at
 * `/60` — all below the WCAG AA 4.5:1 floor that DESIGN.md now states for text
 * (see "Contrast" in DESIGN.md). Opaque role tokens cannot drift like that.
 *
 * Mapping (documented in DESIGN.md → Contrast → "Two text tones"):
 *
 *   text-foreground/25…79          → text-text-secondary   (`--text-secondary`)
 *   text-muted-foreground/25…79    → text-text-secondary   (already tokens in spirit)
 *   text-{destructive,accent,info,success}/NN
 *                                  → text-<role>-text       (the AA-safe 50% mix
 *                                                            toward the foreground)
 *
 * `/80` and above are left alone: they are the deliberately "softened primary"
 * tone (8.4:1 on the Default canvas) and the drift baseline pins them. Icons
 * that only decorate a surface and genuinely disabled controls (`--text-disabled`,
 * which WCAG exempts) are never touched.
 *
 * The replacement targets a class that already existed in the tree, so this is
 * a colour change only: no markup, no geometry, no type tier.
 *
 * Usage:
 *   bun run scripts/migrate-low-contrast-text.ts            # dry run
 *   bun run scripts/migrate-low-contrast-text.ts --apply    # write
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const apply = process.argv.includes('--apply')

const ROOTS = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const EXCLUDED = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.generated\./

/** Low-opacity text shades that composite below AA on the canvas. */
const LOW_TEXT = /(?<![\w-])text-(?:foreground|muted-foreground)\/(?:2[5-9]|3\d|4\d|5\d|6\d|7[0-9])\b/g
/** Status text at low opacity; each `--*-text` token is the AA-safe 50% mix. */
const LOW_STATUS = /(?<![\w-])text-(destructive|accent|info|success)\/(?:\d{1,3})\b/g

const REPLACEMENTS: [RegExp, (match: string, role: string) => string][] = [
  [LOW_TEXT, () => 'text-text-secondary'],
  [LOW_STATUS, (_match, role) => `text-${role}-text`],
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
      for (const [pattern, replacement] of REPLACEMENTS) {
        result = result.replace(pattern, (match, role: string) => {
          const next = replacement(match, role)
          counts.set(next, (counts.get(next) ?? 0) + 1)
          changed = true
          return next
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
