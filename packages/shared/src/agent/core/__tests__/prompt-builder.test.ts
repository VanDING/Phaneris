/**
 * PromptBuilder placement contract for git developer context: repository identity
 * belongs to the cached stable prefix, while branch/worktree status must ride the
 * volatile per-turn tail (issue #862 — anything that changes per turn in the
 * system prefix kills prompt-cache reuse).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { PromptBuilder } from '../prompt-builder.ts'
import type { Workspace } from '../../../config/storage.ts'
import type { SessionConfig } from '../../../sessions/types.ts'

/**
 * Prompt assembly reads only `workspace.rootPath` and the session's
 * `id`/`workingDirectory`; the remaining fields of the full workspace/session
 * shape are irrelevant here, so the fixtures stay minimal and are cast at that
 * single boundary.
 */
function createBuilder(root: string, workingDirectory: string): PromptBuilder {
  return new PromptBuilder({
    workspace: { rootPath: root } as unknown as Workspace,
    session: { id: 'session-1', workingDirectory } as unknown as SessionConfig,
  })
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('PromptBuilder developer context split', () => {
  it('places git repo identity in stable context and status in volatile context', () => {
    const { root, packageDir } = createGitFixture()
    writeFileSync(join(packageDir, 'dirty.txt'), 'dirty')

    const builder = createBuilder(root, packageDir)

    const stable = builder.buildStableContextParts().join('\n')
    const volatile = builder.buildVolatileContextParts({ plansFolderPath: join(root, 'plans') }).join('\n')

    expect(stable).toContain('<developer_context kind="git_repository" scope="stable">')
    expect(stable).toContain(`repoRoot: ${root}`)
    expect(stable).toContain('create it as a sibling of repoRoot inside repoParent')
    expect(stable).not.toContain('changedFilesSample:')

    expect(volatile).toContain('<developer_context kind="git_repository" scope="volatile">')
    expect(volatile).toContain('worktreeState: dirty')
    expect(volatile).toContain('changedFilesSample:')
    expect(volatile).not.toContain('repoParent:')
  })

  it('reads stable repo identity once per working directory and recomputes status per turn', () => {
    const { root, packageDir } = createGitFixture()
    const builder = createBuilder(root, packageDir)

    const first = builder.buildStableContextParts().join('\n')
    // A new tracked file changes status but not identity.
    writeFileSync(join(packageDir, 'later.txt'), 'dirty')
    const second = builder.buildStableContextParts().join('\n')
    const volatile = builder.buildVolatileContextParts({ plansFolderPath: join(root, 'plans') }).join('\n')

    expect(second).toBe(first)
    expect(volatile).toContain('packages/shared/later.txt')
  })
})

function createGitFixture(): { root: string; packageDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'phaneris-prompt-builder-git-'))
  tempDirs.push(root)
  const packageDir = join(root, 'packages', 'shared')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(root, 'CLAUDE.md'), '# Root instructions\n')

  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' })
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`)
  }

  return { root: realpathSync.native(root), packageDir: realpathSync.native(packageDir) }
}
