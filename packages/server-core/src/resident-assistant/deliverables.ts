import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Message } from '@phaneris/core/types'
import { listArtifacts, registerCurrentArtifact } from '@phaneris/shared/artifacts'
import { getSessionPath } from '@phaneris/shared/sessions'

/** Register observed writes at completion through the existing Artifact owner. Never scans a directory. */
export async function registerDelegatedDeliverables(workspace: { id: string; rootPath: string }, sessionId: string,
  messages: readonly Message[], inputIds: readonly string[] = []): Promise<void> {
  const start = messages.findIndex(message => inputIds.includes(message.id))
  if (start < 0) return
  const assignment = messages.slice(0, start + 1).findLast(message => message.delegationInput)
  const sessionRoot = getSessionPath(workspace.rootPath, sessionId)
  const directory = assignment?.delegationInput?.effectiveConfig.workingDirectory
  const contentRoot = directory && directory !== 'none' ? directory : sessionRoot
  const roots = [sessionRoot, contentRoot].filter(path => statSync(path, { throwIfNoEntry: false })?.isDirectory()).map(path => realpathSync(path))
  const produced = messages.slice(start + 1)
  const paths = new Set<string>()
  for (const message of produced) {
    if (message.role !== 'tool' || message.isError || message.toolStatus !== 'completed') continue
    const name = message.toolName?.replace(/^.*__/, '').toLowerCase()
    if (!['write', 'edit', 'write_file', 'edit_file'].includes(name ?? '')) continue
    const path = message.toolInput?.file_path ?? message.toolInput?.path
    if (typeof path === 'string') paths.add(resolve(contentRoot, path))
  }
  if (produced.some(message => message.role === 'tool' && message.toolStatus === 'completed' && /^(bash|powershell)$/i.test(message.toolName ?? ''))) {
    const final = produced.findLast(message => message.role === 'assistant' && !message.isIntermediate)?.content ?? ''
    for (const match of final.matchAll(/`([^`\n]+)`/g)) if (isAbsolute(match[1]!)) paths.add(resolve(match[1]!))
  }
  const existing = listArtifacts({ workspaceRootPath: workspace.rootPath }, { sessionId })
  const candidates = [...paths].slice(0, 32).filter(path => {
    const stat = statSync(path, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.mtimeMs + 1000 < messages[start]!.timestamp) return false
    const canonical = realpathSync(path)
    if (!roots.some(root => { const part = relative(root, canonical); return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) })) return false
    const current = existing.find(({ artifact }) => resolve(artifact.sourcePath) === resolve(canonical))?.artifact
    if (!current) return true
    return current.status === 'current' && current.currentRevision !== createHash('sha256').update(readFileSync(canonical)).digest('hex')
  })
  const results = await Promise.allSettled(candidates.map(async path => registerCurrentArtifact({ workspaceId: workspace.id,
    workspaceRootPath: workspace.rootPath, contentRootPath: contentRoot, allowedRoots: roots }, { sessionId, sourcePath: path })))
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Some delegated deliverables could not be registered')
}
