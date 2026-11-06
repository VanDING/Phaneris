import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '../utils/files'
import { sanitizeSessionId } from './validation'

/** Host-owned identity mapping. Session names and caller-selected paths confer no role. */
export function readAssistantSessionId(workspaceRootPath: string): string | undefined {
  const file = join(workspaceRootPath, 'assistant', 'session-location.json')
  if (!existsSync(file)) return undefined
  const value = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; sessionId?: unknown }
  if (value.version !== 1 || typeof value.sessionId !== 'string' || !value.sessionId || sanitizeSessionId(value.sessionId) !== value.sessionId)
    throw new Error('Invalid assistant Session location manifest')
  return value.sessionId
}

export function registerAssistantSessionLocation(workspaceRootPath: string, sessionId: string): void {
  if (!sessionId || sanitizeSessionId(sessionId) !== sessionId) throw new Error('Invalid assistant Session identity')
  const existing = readAssistantSessionId(workspaceRootPath)
  if (existing && existing !== sessionId) throw new Error('Workspace already owns another assistant Session identity')
  if (existsSync(join(workspaceRootPath, 'sessions', sessionId))) throw new Error('Migrate the legacy assistant Session before changing its writable location')
  if (existing) return
  mkdirSync(join(workspaceRootPath, 'assistant'), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(join(workspaceRootPath, 'assistant', 'session-location.json'), JSON.stringify({ version: 1, sessionId }) + '\n', { mode: 0o600 })
}

export function sessionDirectoryEntries(workspaceRootPath: string): Array<{ id: string; path: string }> {
  const ordinary = join(workspaceRootPath, 'sessions')
  const entries = existsSync(ordinary) ? readdirSync(ordinary, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ id: entry.name, path: join(ordinary, entry.name) })) : []
  const assistantId = readAssistantSessionId(workspaceRootPath)
  if (assistantId) {
    if (entries.some(entry => entry.id === assistantId)) throw new Error('Assistant Session has conflicting writable locations')
    const path = join(workspaceRootPath, 'assistant', 'sessions', assistantId)
    if (existsSync(path)) entries.push({ id: assistantId, path })
  }
  return entries
}
