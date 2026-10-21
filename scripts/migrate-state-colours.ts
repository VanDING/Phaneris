/**
 * Replace Tailwind palette hues with the semantic status tokens.
 *
 * The product's status language had drifted into raw palette classes —
 * `text-amber-600 dark:text-amber-300` for "running", `text-emerald-600
 * dark:text-emerald-300` for "done", and a hand-picked light/dark pair at every
 * site. That is what made Ink, Geek and Cyberpunk 2077 unable to govern state:
 * the theme owns `--info`, `--success`, `--destructive` and `--accent`, and the
 * components bypassed all four.
 *
 * Mapping (one hue per meaning, derived from the theme):
 *
 *   red / rose                      → destructive   (failure, deletion)
 *   amber / orange / yellow         → info          (pending, running, review)
 *   emerald / green / teal / lime   → success       (done, accepted, addition)
 *   sky / blue / cyan / indigo / violet / purple / fuchsia / pink
 *                                   → accent        (identity, "informational")
 *   slate / gray / zinc / neutral / stone
 *                                   → muted         (neutral, injected, skipped)
 *
 * `bg-*` keeps the surface role, `text-*` becomes the `-text` variant (the 50%
 * foreground mix that clears AA), and a `dark:` twin is dropped: the role
 * already resolves per mode, so keeping the pair would re-pin one theme's hues.
 *
 * Brand marks are excluded — a vendor logo keeps its identity colour.
 *
 * Usage:
 *   bun run scripts/migrate-state-colours.ts           # dry run
 *   bun run scripts/migrate-state-colours.ts --apply   # write
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const apply = process.argv.includes('--apply')

const ROOTS = ['apps/electron/src/renderer', 'packages/ui/src', 'apps/webui/src', 'apps/viewer/src']
const EXCLUDED = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.generated\./
/** Brand identity: a vendor mark keeps its own hue on every theme. */
const BRAND_FILES = /components\/icons\/ConnectionIcon\.tsx$/

const FAMILIES: Record<string, { role: string; text: string }> = {
  red: { role: 'destructive', text: 'destructive-text' },
  rose: { role: 'destructive', text: 'destructive-text' },
  amber: { role: 'info', text: 'info-text' },
  orange: { role: 'info', text: 'info-text' },
  yellow: { role: 'info', text: 'info-text' },
  emerald: { role: 'success', text: 'success-text' },
  green: { role: 'success', text: 'success-text' },
  teal: { role: 'success', text: 'success-text' },
  lime: { role: 'success', text: 'success-text' },
  sky: { role: 'accent', text: 'accent-text' },
  blue: { role: 'accent', text: 'accent-text' },
  cyan: { role: 'accent', text: 'accent-text' },
  indigo: { role: 'accent', text: 'accent-text' },
  violet: { role: 'accent', text: 'accent-text' },
  purple: { role: 'accent', text: 'accent-text' },
  fuchsia: { role: 'accent', text: 'accent-text' },
  pink: { role: 'accent', text: 'accent-text' },
  slate: { role: 'muted', text: 'secondary' },
  gray: { role: 'muted', text: 'secondary' },
  zinc: { role: 'muted', text: 'secondary' },
  neutral: { role: 'muted', text: 'secondary' },
  stone: { role: 'muted', text: 'secondary' },
}

const PALETTE = Object.keys(FAMILIES).join('|')
const isMuted = (role: string) => role === 'muted'

/** `text-info-text`, `bg-info/10`, `border-success`, … for one palette class. */
function replacement(utility: string, palette: string, alpha: string | undefined): string {
  const family = FAMILIES[palette]!
  const suffix = alpha ? `/${alpha}` : ''
  if (family.role === 'muted') {
    // The neutral family maps to existing text/surface roles, which have no
    // `-text` mix: `text-muted-foreground` is already the AA-safe dim ink.
    if (utility === 'text') return `text-text-secondary${suffix}`
    if (utility === 'bg' || utility === 'fill' || utility === 'stroke') return `bg-muted${suffix}`
    if (utility === 'border') return `border-border${suffix}`
    if (utility === 'ring') return `ring-ring${suffix}`
    return `${utility}-muted${suffix}`
  }
  if (utility === 'text') return `text-${family.text}${suffix}`
  return `${utility}-${family.role}${suffix}`
}

/** Variant prefixes (`hover:`, `group-hover:`, `sm:`) are preserved: the
 *  lookbehind only excludes word/hyphen characters, not a colon. */
const PALETTE_CLASS = new RegExp(String.raw`(?<![\w-])(bg|text|border|ring|fill|stroke|from|to|via)-(${PALETTE})-(\d{2,3})(?:\/(\d{1,3}))?(?![\w-])`, 'g')
/** A `dark:` twin is redundant once the role resolves per mode. */
const DARK_TWIN = new RegExp(String.raw`\s+dark:[a-z-]+-(?:${PALETTE})-\d{2,3}(?:\/\d{1,3})?`, 'g')

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
    if (EXCLUDED.test(relativePath) || BRAND_FILES.test(relativePath)) continue
    const original = readFileSync(path, 'utf8')
    let changed = false
    const next = original.split('\n').map(line => {
      if (isCommentLine(line)) return line
      let result = line.replace(DARK_TWIN, () => {
        counts.set('dark twin dropped', (counts.get('dark twin dropped') ?? 0) + 1)
        changed = true
        return ''
      })
      result = result.replace(PALETTE_CLASS, (match, utility: string, palette: string, _shade: string, alpha?: string) => {
        const next = replacement(utility, palette, alpha)
        counts.set(next.replace(/\/.*$/, ''), (counts.get(next.replace(/\/.*$/, '')) ?? 0) + 1)
        changed = true
        return next
      })
      return result
    }).join('\n')
    if (!changed) continue
    filesTouched += 1
    if (apply) writeFileSync(path, next)
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0)
console.log(`${apply ? 'Applied' : 'Dry run'}: ${filesTouched} files, ${total} sites`)
for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${count}`)
if (!apply) console.log('Re-run with --apply to write.')
