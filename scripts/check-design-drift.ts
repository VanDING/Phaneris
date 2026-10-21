/**
 * Design drift gate.
 *
 * `lint` runs this after the scale contract: the five drift classes the
 * frontend design review (2026-10-20) found have no gate can only shrink.
 * `scripts/design-drift-baseline.json` is the frozen count; growth fails, a
 * decrease prints a "tighten the baseline" hint so the ratchet keeps moving.
 *
 * The motion half is zero-tolerance instead of a count: an `animate-*` utility
 * with no consumer is not debt to schedule, it is a false statement about the
 * product's motion vocabulary.
 *
 * Usage:
 *   bun run check:design-drift
 *   bun run check:design-drift --json
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { measureDesignDrift, type DesignDriftBaseline } from './measure-design-drift'

const root = resolve(import.meta.dir, '..')
const baseline = JSON.parse(readFileSync(resolve(root, 'scripts/design-drift-baseline.json'), 'utf8')) as DesignDriftBaseline
assert.equal(baseline.version, 1, 'design-drift-baseline.json has an unknown version')

const report = measureDesignDrift()
const failures: string[] = []
const stale: string[] = []

for (const [name, counter] of Object.entries(report.counters)) {
  const frozen = baseline.counters[name as keyof DesignDriftBaseline['counters']]
  assert(frozen, `design-drift-baseline.json is missing the ${name} counter`)
  if (counter.count > frozen.count) {
    const grew = Object.entries(counter.files)
      .filter(([file, count]) => count > (frozen.files[file] ?? 0))
      .map(([file, count]) => `${file} ${frozen.files[file] ?? 0}→${count}`)
    failures.push(`${name}: ${frozen.count} → ${counter.count} (grew in ${grew.join(', ')})`)
  }
  if (counter.count < frozen.count) stale.push(`${name}: ${frozen.count} → ${counter.count}`)
}

const reserved = new Set(baseline.motion.reserved ?? [])
const unexpected = report.motion.orphaned.filter(name => !reserved.has(name))
const retired = [...reserved].filter(name => !report.motion.orphaned.includes(name))
if (unexpected.length) {
  failures.push(
    `motion: ${unexpected.join(', ')} declared in motion.css with no consumer. `
    + 'Delete the utility and its keyframes, or give it a consumer. Reserving one requires a baseline entry with a reason.',
  )
}
if (retired.length) stale.push(`motion reserved entries no longer orphaned: ${retired.join(', ')}`)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ passed: failures.length === 0, failures, stale, counters: report.counters, motion: report.motion }, null, 2))
} else {
  for (const entry of stale) console.log(`  tightenable: ${entry}`)
  console.log(
    `Design drift OK: ${Object.keys(report.counters).length} counters at or below baseline; `
    + `${report.motion.declared.length} motion utilities all consumed.`,
  )
}
assert.equal(failures.length, 0, `Design drift grew:\n${failures.join('\n')}\n\n`
  + 'Migrate the new site to a contract token (see DESIGN.md) instead of raising the baseline.')
