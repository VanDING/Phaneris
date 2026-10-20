#!/usr/bin/env bun
/**
 * Records the frozen upgrade baseline/after-state for the 2026-10-18 batch.
 *
 * This is evidence collection, not a test: it reads the working tree, the
 * frozen target file and the installed tree, then writes a single JSON
 * snapshot so B0 and B5 can be compared without re-deriving anything by hand.
 *
 * Usage: bun run scripts/verification/upgrade-0153-baseline.ts --out=<file.json>
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '../..')
const arg = (name: string) => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const out = resolve(repository, arg('out') ?? '.cache/upgrade-20261018/baseline/snapshot.json')

const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
const installed = (name: string): string | null => {
  const manifest = join(repository, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(manifest)) return null
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? null
}
const tool = (command: string, args: string[]): string | null => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const targets = JSON.parse(readFileSync(join(repository, 'docs/dependencies/upgrade-2026-10-18/targets.json'), 'utf8')) as {
  date: string; baseCommit: string; npm: Record<string, { version: string; batch: string }>
  python: Record<string, { version: string; batch: string; new?: boolean }>
  addedNpm: Record<string, { version: string; batch: string; developmentOnly?: boolean }>
  runtimes: Record<string, string>
}

const npm: Record<string, { target: string; batch: string; installed: string | null; ok: boolean }> = {}
for (const [name, entry] of Object.entries({ ...targets.npm, ...targets.addedNpm })) {
  const current = installed(name)
  npm[name] = { target: entry.version, batch: entry.batch, installed: current, ok: current === entry.version }
}
const missing = Object.entries(npm).filter(([, entry]) => !entry.ok).map(([name, entry]) => `${name}@${entry.installed ?? 'absent'}!=${entry.target}`)

const declared = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { packageManager: string }
const lockfile = join(repository, 'bun.lock')
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

const snapshot = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  targetDate: targets.date,
  baseCommit: targets.baseCommit,
  head: git('rev-parse', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  statusPorcelain: git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean),
  lockfile: existsSync(lockfile) ? { path: 'bun.lock', sha256: sha256(lockfile) } : null,
  environment: {
    bun: Bun.version,
    declaredPackageManager: declared.packageManager,
    node: tool('node', ['--version']),
    git: tool('git', ['--version']),
    uv: tool('uv', ['--version']),
    python: tool('python', ['--version']),
    platform: process.platform,
    architecture: arch(),
    osRelease: release(),
  },
  npm,
  npmMissing: missing,
  npmSatisfied: Object.keys(npm).length - missing.length,
  npmTotal: Object.keys(npm).length,
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n')
console.log(JSON.stringify({
  output: out, head: snapshot.head, branch: snapshot.branch,
  npmSatisfied: `${snapshot.npmSatisfied}/${snapshot.npmTotal}`,
  missing, bun: snapshot.environment.bun, node: snapshot.environment.node,
}, null, 2))
