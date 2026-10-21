import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { arch, release } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '../..')
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
interface Artifact { path: string; sha256: string; bytes: number }
export interface VerificationManifest {
  schemaVersion: 1; workflow: string; sceneIds: string[]; passed: number; exitCode: number
  artifacts: Artifact[]; untested: string[]
  command: string[]; source: { headSha: string; lockfileSha256: string; dirty: boolean; dirtyPaths: string[] }
  runtime: { bun: string; node: string | null; uv: string | null; platform: string; architecture: string }
}

function version(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

/** An explicit output is exclusive too: never overwrite an earlier run, even on failure. */
export class VerificationRun {
  readonly directory: string
  readonly startedAt = new Date().toISOString()
  private sceneIds: string[] = []
  private untested: string[] = ['Windows/Linux native execution', 'live provider APIs', 'signed installer/release']
  private readonly source = {
    headSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    dirtyPaths: execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repository, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    lockfileSha256: sha256(join(repository, 'bun.lock')),
    changedFiles: [...new Set([
      ...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: repository }).toString().split('\0'),
      ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repository }).toString().split('\0'),
    ].filter(Boolean))].sort().map(path => ({ path, sha256: existsSync(join(repository, path)) ? sha256(join(repository, path)) : null })),
  }
  constructor(readonly workflow: string, readonly args = process.argv.slice(2)) {
    const position = args.indexOf('--output-dir')
    const explicit = args.find(arg => arg.startsWith('--output-dir='))?.slice('--output-dir='.length)
      ?? (position >= 0 ? args[position + 1] : undefined)
    const parent = join(repository, '.cache/verification')
    mkdirSync(parent, { recursive: true })
    if (explicit) {
      this.directory = resolve(explicit)
      mkdirSync(dirname(this.directory), { recursive: true })
      // EEXIST is intentional: mkdir must claim the run atomically, so two runs
      // cannot write into one directory. `--replace` is the explicit opt-in for
      // re-running into a canonical evidence path (docs/verification/results/...)
      // after the previous run's contents have been read.
      if (args.includes('--replace') && existsSync(this.directory)) rmSync(this.directory, { recursive: true, force: true })
      mkdirSync(this.directory)
    } else this.directory = mkdtempSync(join(parent, `${workflow}-`))
  }
  checkArguments(allowed: string[] = []) {
    const args = [...this.args]
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]!
      if (argument === '--replace') continue
      if (argument === '--output-dir') {
        assert(args[++index] && !args[index]!.startsWith('--'), '--output-dir requires a directory')
      } else if (argument.startsWith('--output-dir=')) assert(argument.slice('--output-dir='.length), '--output-dir requires a directory')
      else assert(allowed.includes(argument), `Unknown verification argument: ${argument}`)
    }
  }
  json(name: string, value: unknown) { writeFileSync(join(this.directory, name), JSON.stringify(value, null, 2) + '\n') }
  complete(sceneIds: string[], untested = this.untested) {
    assert(sceneIds.length > 0 && new Set(sceneIds).size === sceneIds.length, 'Verification must execute nonzero, distinct scenes')
    this.sceneIds = sceneIds
    this.untested = untested
  }
  finish(error?: unknown) {
    if (!error && !this.sceneIds.length) error = new Error('Workflow returned without completing any scenes')
    if (error) this.json('failure.json', { message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined })
    const files = readdirSync(this.directory, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && join(entry.parentPath, entry.name) !== join(this.directory, 'manifest.json'))
      .map(entry => join(entry.parentPath, entry.name)).sort()
    this.json('manifest.json', { schemaVersion: 1, workflow: this.workflow, startedAt: this.startedAt, finishedAt: new Date().toISOString(),
      command: process.argv, source: { ...this.source, dirty: this.source.dirtyPaths.length > 0 },
      runtime: { bun: Bun.version, node: version('node', ['--version']), uv: version('uv', ['--version']),
        platform: process.platform, architecture: arch(), osRelease: release(), executable: process.execPath },
      sceneIds: this.sceneIds, passed: this.sceneIds.length, exitCode: error ? 1 : 0,
      artifacts: files.map(file => ({ path: relative(this.directory, file).replaceAll('\\', '/'), sha256: sha256(file), bytes: readFileSync(file).byteLength })),
      untested: this.untested,
    })
    if (error) throw error
  }
}

export async function verificationWorkflow(workflow: string, execute: (run: VerificationRun) => Promise<void>) {
  const run = new VerificationRun(workflow)
  let failure: unknown
  try { run.checkArguments(); await execute(run) } catch (error) { failure = error }
  run.finish(failure)
}

export function verifyVerificationDirectory(directory: string, expected?: { workflow: string; minimum: number; required?: readonly string[] }) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as VerificationManifest
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.exitCode, 0, 'Verification run failed')
  assert(/^[a-f0-9]{40}$/.test(manifest.source.headSha), 'Missing source HEAD')
  assert(/^[a-f0-9]{64}$/.test(manifest.source.lockfileSha256), 'Missing lockfile identity')
  assert(typeof manifest.source.dirty === 'boolean' && Array.isArray(manifest.source.dirtyPaths))
  assert(manifest.command.length > 0 && manifest.runtime.bun && manifest.runtime.platform && manifest.runtime.architecture)
  assert(Array.isArray(manifest.untested), 'Unverified scope must be recorded')
  assert(Array.isArray(manifest.sceneIds) && manifest.sceneIds.length > 0, 'No verified scenes')
  assert.equal(new Set(manifest.sceneIds).size, manifest.sceneIds.length, 'Duplicate scene IDs')
  assert.equal(manifest.passed, manifest.sceneIds.length)
  if (expected) {
    assert.equal(manifest.workflow, expected.workflow)
    assert(manifest.passed >= expected.minimum, `Expected at least ${expected.minimum} verified scenes`)
    for (const required of expected.required ?? []) assert(manifest.artifacts.some(artifact => artifact.path === required), `Unregistered required artifact: ${required}`)
  }
  assert(manifest.artifacts.length > 0, 'No verification artifacts')
  assert.equal(new Set(manifest.artifacts.map(artifact => artifact.path)).size, manifest.artifacts.length)
  for (const artifact of manifest.artifacts) {
    assert(!isAbsolute(artifact.path) && !artifact.path.split(/[\\/]/).includes('..'), 'Artifact escapes its run directory')
    const file = join(directory, artifact.path)
    assert(existsSync(file), `Missing artifact: ${artifact.path}`)
    assert.equal(sha256(file), artifact.sha256, `Artifact SHA-256 mismatch: ${artifact.path}`)
    assert.equal(readFileSync(file).byteLength, artifact.bytes)
  }
  return manifest
}

if (import.meta.main) {
  const directory = process.argv.slice(2).find(arg => arg.startsWith('--verify='))?.slice('--verify='.length)
  assert(directory, 'Usage: bun run scripts/verification/verification-artifacts.ts --verify=<directory>')
  const result = verifyVerificationDirectory(resolve(directory))
  console.log(JSON.stringify({ passed: result.passed, workflow: result.workflow, output: resolve(directory) }))
}
