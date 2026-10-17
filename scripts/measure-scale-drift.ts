/**
 * Scale drift audit.
 *
 * Counts arbitrary font-size, radius and control-height literals in shipped UI
 * sources. Report mode is safe to run in CI: it prints the current distribution
 * and never fails on counts. `--write-baseline`, `--write-allowlist` and
 * `--write-playground` publish the committed artifacts consumed by the
 * contract check and the design workbench.
 *
 * The measurement is value-based, not site-based: the ESLint rule bans values
 * that are neither contract tiers nor present in the frozen legacy snapshot.
 */
import { Glob } from 'bun'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { SCALE_CLASS_NAMES, SCALE_CONTRACT, type ScaleFamily } from '../packages/ui/src/lib/scale-contract'

const root = resolve(import.meta.dir, '..')

export const SCALE_ROOTS = [
  'apps/electron/src/renderer',
  'packages/ui/src',
  'apps/webui/src',
  'apps/viewer/src',
] as const

const EXCLUDED_PATH = /(?:^|\/)(?:__tests__|node_modules|dist|playground)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/

const PATTERNS: Record<ScaleFamily | 'width', RegExp> = {
  fontSize: /(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g,
  radius: /(?<![\w-])rounded(?:-[trblse]{1,2})?-\[(\d+(?:\.\d+)?)px\]/g,
  controlHeight: /(?<![\w-])(?:h|min-h|max-h|size)-\[(\d+(?:\.\d+)?)px\]/g,
  width: /(?<![\w-])w-\[(\d+(?:\.\d+)?)px\]/g,
}

export interface ScaleDriftReport {
  generatedAt: string
  filesScanned: number
  families: Record<ScaleFamily, { count: number; values: Record<string, number>; files: Record<string, number> }>
  /** Arbitrary widths are informational: they describe layout, not controls. */
  widths: { count: number; values: Record<string, number> }
  /** CSS declarations cannot use classes; they must consume role tokens. */
  css: { fontSize: Record<string, number>; radius: Record<string, number> }
  excluded: { playground: number }
}

function scanText(text: string, family: keyof typeof PATTERNS, values: Record<string, number>): number {
  let count = 0
  for (const match of text.matchAll(PATTERNS[family])) {
    const value = `${match[1]!}px`
    values[value] = (values[value] ?? 0) + 1
    count += 1
  }
  return count
}

export function measureScaleDrift(options: { fromGit?: boolean } = {}): ScaleDriftReport {
  const families = {
    fontSize: { count: 0, values: {} as Record<string, number>, files: {} as Record<string, number> },
    radius: { count: 0, values: {} as Record<string, number>, files: {} as Record<string, number> },
    controlHeight: { count: 0, values: {} as Record<string, number>, files: {} as Record<string, number> },
  }
  const widths = { count: 0, values: {} as Record<string, number> }
  const css = { fontSize: {} as Record<string, number>, radius: {} as Record<string, number> }
  let filesScanned = 0
  let playground = 0

  for (const directory of SCALE_ROOTS) {
    const glob = new Glob('**/*.{ts,tsx,css,html}')
    for (const path of glob.scanSync({ cwd: resolve(root, directory), absolute: true })) {
      const relativePath = relative(root, path).replaceAll('\\', '/')
      if (EXCLUDED_PATH.test(relativePath)) {
        if (relativePath.includes('/playground/')) playground += 1
        continue
      }
      const text = options.fromGit
        ? (() => {
            const result = Bun.spawnSync({ cmd: ['git', 'show', `HEAD:${relativePath}`], stdout: 'pipe', stderr: 'ignore' })
            return result.exitCode === 0 ? result.stdout.toString() : readFileSync(path, 'utf8')
          })()
        : readFileSync(path, 'utf8')
      filesScanned += 1
      for (const family of Object.keys(families) as ScaleFamily[]) {
        const found = scanText(text, family, families[family].values)
        if (found) {
          families[family].count += found
          families[family].files[relativePath] = found
        }
      }
      widths.count += scanText(text, 'width', widths.values)
      if (relativePath.endsWith('.css') && !/styles\/(?:theme-tokens|role-tokens)\.css$|\.generated\./.test(relativePath)) {
        for (const match of text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
          const value = `${match[1]!}px`
          css.fontSize[value] = (css.fontSize[value] ?? 0) + 1
        }
        for (const match of text.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)) {
          const value = `${match[1]!}px`
          css.radius[value] = (css.radius[value] ?? 0) + 1
        }
      }
    }
  }

  const sortValues = (values: Record<string, number>) => Object.fromEntries(
    Object.entries(values).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])),
  )
  for (const family of Object.keys(families) as ScaleFamily[]) families[family].values = sortValues(families[family].values)

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    filesScanned,
    families,
    widths: { count: widths.count, values: sortValues(widths.values) },
    css: { fontSize: sortValues(css.fontSize), radius: sortValues(css.radius) },
    excluded: { playground },
  }
}

export interface ScaleAllowlist {
  version: 1
  policy: string
  contract: Record<ScaleFamily, string[]>
  /** Tier → value/class, so the lint rule can name a replacement without a second source. */
  tiers: Record<ScaleFamily, Record<string, { value: string; className: string }>>
  /** Values still present in the tree that the contract does not cover. Only shrinks. */
  legacy: Record<ScaleFamily, string[]>
}

export function buildAllowlist(report: ScaleDriftReport): ScaleAllowlist {
  const families = Object.keys(SCALE_CONTRACT) as ScaleFamily[]
  const contract = Object.fromEntries(
    families.map(family => [
      family,
      Object.values(SCALE_CONTRACT[family]).map(value => `${value as number}px`),
    ]),
  ) as Record<ScaleFamily, string[]>
  const tiers = Object.fromEntries(
    families.map(family => [
      family,
      Object.fromEntries(Object.entries(SCALE_CONTRACT[family]).map(([tier, value]) => [
        tier,
        { value: `${value as number}px`, className: (SCALE_CLASS_NAMES[family] as Record<string, string>)[tier] },
      ])),
    ]),
  ) as ScaleAllowlist['tiers']
  const legacy = Object.fromEntries(
    families.map(family => [
      family,
      Object.keys(report.families[family].values).filter(value => !contract[family].includes(value)),
    ]),
  ) as Record<ScaleFamily, string[]>
  return {
    version: 1,
    policy: 'Contract tiers plus frozen legacy values. New values are rejected by theme-contracts/scale. Legacy entries retire when their last site migrates; stale entries fail check:scale-contract.',
    contract,
    tiers,
    legacy,
  }
}

function publish(path: string, content: string) {
  const target = resolve(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const report = measureScaleDrift({ fromGit: args.includes('--from-git') })

  if (args.includes('--write-baseline')) {
    const path = `docs/verification/scale-drift-baseline-${report.generatedAt}.json`
    publish(path, JSON.stringify(report, null, 2) + '\n')
    console.log(`Baseline written: ${path}`)
  }

  if (args.includes('--write-allowlist')) {
    publish('scripts/scale-allowlist.snapshot.json', JSON.stringify(buildAllowlist(report), null, 2) + '\n')
    console.log('Allowlist written: scripts/scale-allowlist.snapshot.json')
  }

  if (args.includes('--write-playground')) {
    // The workbench renders this module directly; no runtime file access.
    const body = JSON.stringify(report, null, 2)
    publish('apps/electron/src/renderer/playground/registry/scale-drift.generated.ts',
      `/* Generated by scripts/measure-scale-drift.ts --write-playground. Do not edit. */\n`
      + `export const SCALE_DRIFT_REPORT = ${body} as const\n`)
    console.log('Playground ledger written: scale-drift.generated.ts')
  }

  if (!args.includes('--json')) {
    for (const [family, summary] of Object.entries(report.families)) {
      console.log(`${family}: ${summary.count} sites / ${Object.keys(summary.values).length} values`)
      console.log('  ' + Object.entries(summary.values).map(([value, count]) => `${value}(${count})`).join(' '))
    }
    console.log(`width(informational): ${report.widths.count} sites`)
    console.log(`css font-size: ${Object.values(report.css.fontSize).reduce((a, b) => a + b, 0)} sites; css radius: ${Object.values(report.css.radius).reduce((a, b) => a + b, 0)} sites`)
    for (const [value, count] of Object.entries(report.css.fontSize)) console.log(`  font ${value}(${count})`)
    for (const [value, count] of Object.entries(report.css.radius)) console.log(`  radius ${value}(${count})`)
    console.log(`files scanned: ${report.filesScanned} (playground excluded: ${report.excluded.playground})`)
    console.log('Report mode: counts are informational and never fail CI.')
  } else {
    console.log(JSON.stringify(report, null, 2))
  }
}
