import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getWorkspaces } from '../config/workspace-selection'
import { CREDENTIALS_FILE } from '../config/paths'
import { resolveCanonicalPath as canonical, expandPath } from '../utils/paths'
export const resolveFileToolPath = (cwd: string, requested: string) => resolve(cwd, expandPath(requested))
function contains(parent: string, child: string): boolean {
  const part = relative(parent, child)
  return !part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** A product file-tool boundary. It is not an operating-system sandbox. */
export class AssistantPrivatePaths {
  private readonly roots: string[]
  private readonly sessionRoots: string[]
  private readonly projectRoots: string[]
  private readonly ownData: string[]
  private readonly credentialRoot = canonical(dirname(CREDENTIALS_FILE))
  constructor(workspaceRoot: string, principal?: { kind: 'resident_assistant'; sessionId: string }) {
    const workspaces = [...new Set([workspaceRoot, ...getWorkspaces().map(workspace => workspace.rootPath)])]
    this.sessionRoots = workspaces.map(root => canonical(join(root, 'sessions')))
    this.projectRoots = workspaces.map(root => canonical(join(root, 'projects')))
    this.roots = workspaces
      .flatMap(root => [canonical(join(root, 'assistant')), canonical(join(root, 'memory')), canonical(join(root, 'runtime'))])
    // Only the Host-attributed assistant may inspect its own downloaded/source files.
    // Never turn a junction from a data folder into a grant over internal state.
    this.ownData = principal ? ['downloads', 'attachments', 'data', 'long_responses', 'plans'].map(name => join(canonical(workspaceRoot), 'assistant', 'sessions', principal.sessionId, name))
      .filter(path => relative(path, canonical(path)) === '') : []
  }
  isPrivate(path: string): boolean {
    const target = canonical(path)
    if (dirname(target) === this.credentialRoot && basename(target).toLowerCase().startsWith(basename(CREDENTIALS_FILE).toLowerCase())) return true
    const control = this.sessionRoots.some(root => {
      if (!contains(root, target)) return false
      const parts = relative(root, target).split(sep), entry = parts[1]?.toLowerCase()
      return !!entry && (entry.startsWith('session.jsonl') || ['meta', '.pi-sessions', 'logs', 'api-logs'].includes(entry))
    })
    return control || !this.ownData.some(root => contains(root, target)) && this.roots.some(root => contains(root, target))
  }
  assertPublic(path: string): void {
    if (this.isPrivate(path)) throw new Error('Assistant private state is protected. The assistant uses its scoped memory interfaces; task sessions receive selected material only.')
  }
  assertWritable(path: string): void {
    this.assertPublic(path)
    const target = canonical(path)
    if (this.projectRoots.some(root => {
      if (!contains(root, target)) return false
      const parts = relative(root, target).split(sep)
      return parts.length === 2 && parts[1]?.toLowerCase() === 'memory.md'
    })) throw new Error('Project MEMORY.md has a controlled append owner. Use project_memory_append with source evidence and the current version.')
  }
  /** Partition a broad search before invoking native IO; private subtrees are never searched. */
  searchRoots(path: string): string[] {
    this.assertPublic(path)
    const visited = new Set<string>()
    const walk = (current: string): string[] => {
      const target = canonical(current)
      if (visited.has(target) || this.isPrivate(current)) return []
      visited.add(target)
      const controlsBelow = contains(target, this.credentialRoot) || this.sessionRoots.some(root => contains(target, root) || contains(root, target) && relative(root, target).split(sep).filter(Boolean).length <= 1)
      if (!controlsBelow && !this.roots.some(root => contains(target, root))) return [current]
      if (!existsSync(current) || !lstatSync(current).isDirectory()) return []
      return readdirSync(current).flatMap(entry => walk(join(current, entry)))
    }
    return walk(resolve(path))
  }
}
