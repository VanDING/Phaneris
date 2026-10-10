import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Reproducible source identity for an uncommitted implementation, without reading credentials. */
export function runtimeBoundaryEvidence(command: string, fixture: string) {
  const root = resolve(import.meta.dir, '../..'), files: string[] = []
  for (const directory of ['packages/server-core/src/durable-runtime', 'packages/server-core/src/runtime-adapters', 'packages/pi-agent-server/src']) {
    const walk = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && entry.name !== '__tests__') walk(path)
      else if (entry.isFile() && entry.name.endsWith('.ts') && !/\.(test|isolated)\.ts$|fixture\.ts$/.test(entry.name)) files.push(path)
    } }
    walk(join(root, directory))
  }
  for (const path of ['packages/server-core/src/sessions/SessionManager.ts', 'packages/server-core/src/tasks/runtime-facts.ts',
    'packages/server-core/src/tasks/runtime-reconciliation.ts', 'packages/server-core/src/tasks/TaskRunner.ts',
    'packages/server-core/src/decisions/accounting.ts', 'packages/server-core/src/services/auxiliary-model-effect.ts',
    'packages/server-core/src/bootstrap/headless-start.ts', 'packages/shared/src/agent/pi-agent.ts',
    'scripts/check-runtime-boundary.ts', 'scripts/verification/durable-runtime-boundary-workflow.ts',
    'scripts/verification/durable-runtime-crash-workflow.ts', 'scripts/verification/durable-runtime-pi-workflow.ts',
    'scripts/verification/runtime-boundary-evidence.ts']) files.push(join(root, path))
  const sourceManifest = files.sort().map(path => ({ path: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }))
  return { command, fixture, baselineSha: 'dbd32f60b5d90e20b1bc2b231035baf6b171ddc2',
    headSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    runtime: { bun: Bun.version, executable: process.execPath, platform: process.platform, architecture: process.arch,
      piSdk: JSON.parse(readFileSync(join(root, 'packages/pi-agent-server/package.json'), 'utf8')).dependencies['@earendil-works/pi-coding-agent'] },
    sourceFingerprint: createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex'), sourceManifest }
}
