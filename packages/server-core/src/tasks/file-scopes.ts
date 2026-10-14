import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { TaskSpec, TaskFileScopeSnapshot } from '@phaneris/shared/tasks'

function canonical(path: string): string {
  let cursor = resolve(path); const missing: string[] = []
  while (!existsSync(cursor)) { const parent = dirname(cursor); if (parent === cursor) break; missing.unshift(basename(cursor)); cursor = parent }
  const absolute = resolve(existsSync(cursor) ? realpathSync(cursor) : cursor, ...missing)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
export function snapshotFileScopes(spec: TaskSpec, cwd: string): TaskFileScopeSnapshot {
  return { cwd: canonical(cwd), nodes: Object.fromEntries(spec.nodes.map(node => [node.id, {
    declared: node.file_scope,
    read: (node.file_scope?.read ?? []).map(path => canonical(resolve(cwd, path))).sort(),
    write: (node.file_scope?.write ?? ['.']).map(path => canonical(resolve(cwd, path))).sort(),
  }])) }
}
type Scope = TaskFileScopeSnapshot['nodes'][string]
const occupied = new Map<object, Scope>(), listeners = new Set<() => void>()
const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(b.endsWith('/') || b.endsWith('\\') ? b : `${b}${process.platform === 'win32' ? '\\' : '/'}`) || b.startsWith(a.endsWith('/') || a.endsWith('\\') ? a : `${a}${process.platform === 'win32' ? '\\' : '/'}`)
function conflicts(a: Scope, b: Scope): boolean {
  return a.write.some(path => [...b.read, ...b.write].some(other => overlaps(path, other))) || b.write.some(path => a.read.some(other => overlaps(path, other)))
}
/** Process-local scheduling leases, shared across TaskRunner instances/workspaces. */
export function acquireFileScopes(owner: object, scope: Scope): boolean {
  if ([...occupied].some(([token, other]) => token !== owner && conflicts(scope, other))) return false
  occupied.set(owner, scope); return true
}
export function releaseFileScopes(owner: object): void {
  if (!occupied.delete(owner)) return
  queueMicrotask(() => { for (const listener of [...listeners]) listener() })
}
export function onFileScopesReleased(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
