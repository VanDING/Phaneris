/**
 * Four-way scale contract check.
 *
 * DESIGN.md frontmatter ↔ scale-contract.ts ↔ allowlist snapshot ↔ role tokens
 * must agree, and the snapshot must describe the tree exactly: no used value
 * outside contract ∪ legacy, no stale legacy value, no legacy/contract overlap.
 * Run with `bun run check:scale-contract`; wired into `lint`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { SCALE_CLASS_NAMES, SCALE_CONTRACT, type ScaleFamily } from '../packages/ui/src/lib/scale-contract'
import { VISUAL_ROLE_TOKENS } from '../packages/ui/src/lib/visual-roles'
import { measureScaleDrift, type ScaleAllowlist } from './measure-scale-drift'

const root = resolve(import.meta.dir, '..')
const families = Object.keys(SCALE_CONTRACT) as ScaleFamily[]
const failures: string[] = []
function expect(condition: unknown, message: string) {
  if (!condition) failures.push(message)
}

const design = readFileSync(resolve(root, 'DESIGN.md'), 'utf8')
const frontmatter = design.match(/^---\r?\n([\s\S]*?)\r?\n---/)
assert(frontmatter, 'DESIGN.md must start with YAML frontmatter')
const meta = parseYaml(frontmatter[1]!) as {
  typography: Record<string, { fontSize?: string }>
  rounded: Record<string, string>
  components: Record<string, { height?: string }>
}

const allowlist = JSON.parse(readFileSync(resolve(root, 'scripts/scale-allowlist.snapshot.json'), 'utf8')) as ScaleAllowlist
const roles = VISUAL_ROLE_TOKENS as Record<string, string>

for (const family of families) {
  const contract = Object.entries(SCALE_CONTRACT[family]) as [string, number][]
  for (const [tier, px] of contract) {
    const value = `${px}px`

    if (family === 'fontSize') {
      expect(meta.typography?.[tier]?.fontSize === value, `DESIGN.md typography.${tier} must be ${value}`)
      const token = roles[`--type-${tier}-size`]
      expect(token, `role token --type-${tier}-size is missing`)
      const rem = parseFloat(token ?? '')
      expect(Math.abs(rem * 15 - px) < 0.001, `role token --type-${tier}-size must resolve to ${value} (got ${token})`)
    } else if (family === 'radius') {
      expect(meta.rounded?.[tier] === value, `DESIGN.md rounded.${tier} must be ${value}`)
      expect(roles[`--shape-${tier}`] === value, `role token --shape-${tier} must be ${value}`)
    } else {
      expect(meta.components?.[`control-${tier}`]?.height === value, `DESIGN.md components.control-${tier}.height must be ${value}`)
      expect(roles[`--control-height-${tier}`] === value, `role token --control-height-${tier} must be ${value}`)
    }

    expect(allowlist.contract[family]?.includes(value), `allowlist contract.${family} is missing ${value}`)
    expect(allowlist.tiers?.[family]?.[tier]?.value === value, `allowlist tiers.${family}.${tier} must be ${value}`)
    expect(allowlist.tiers?.[family]?.[tier]?.className === (SCALE_CLASS_NAMES[family] as Record<string, string>)[tier],
      `allowlist tiers.${family}.${tier}.className drifted from scale-contract.ts`)
  }
  expect(
    JSON.stringify([...allowlist.contract[family]].sort()) === JSON.stringify(contract.map(([, px]) => `${px}px`).sort()),
    `allowlist contract.${family} must equal scale-contract.ts`,
  )
}

for (const rule of ['Scale-Is-Spoken', 'Single-Border', 'Quiet-Stream']) {
  expect(design.includes(rule), `DESIGN.md must state the ${rule} rule`)
}

const report = measureScaleDrift()
for (const family of families) {
  const used = new Set(Object.keys(report.families[family].values))
  const contract = new Set(allowlist.contract[family])
  const legacy = new Set(allowlist.legacy[family])
  for (const value of used) {
    if (!contract.has(value) && !legacy.has(value)) {
      failures.push(`${family}: ${value} is used but is neither a contract tier nor in the legacy snapshot. Migrate it or add it to the contract (DESIGN.md + scale-contract.ts).`)
    }
  }
  for (const value of legacy) {
    if (contract.has(value)) failures.push(`${family}: legacy snapshot must not contain contract tier ${value}`)
    if (!used.has(value)) failures.push(`${family}: legacy snapshot contains stale ${value}; run bun run scale:generate to retire it`)
  }
}

// CSS declarations must consume the generated role tokens. The single allowed
// literal is the 16px iOS focus-zoom guard on settings controls.
for (const value of Object.keys(report.css.radius)) {
  failures.push(`CSS border-radius ${value} must use var(--shape-*)`)
}
for (const [value, count] of Object.entries(report.css.fontSize)) {
  if (value !== '16px') failures.push(`CSS font-size ${value} must use var(--type-*-size)`)
  else if (count > 1) failures.push(`CSS font-size 16px is reserved for the single iOS zoom guard; found ${count} sites`)
}

assert.equal(failures.length, 0, `Scale contract violations:\n${failures.join('\n')}`)
console.log(`Scale contract OK: ${families.map(family => `${family} ${Object.keys(SCALE_CONTRACT[family]).length} tiers`).join(', ')}; DESIGN.md, tokens, allowlist and tree agree.`)
