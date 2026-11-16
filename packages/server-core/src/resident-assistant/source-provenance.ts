import { isDirectUserSource } from '../sessions/input-contracts'
import type { StoredMessage } from '@phaneris/core/types'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getSessionPath } from '@phaneris/shared/sessions/paths'

/** A historical role=user is insufficient for either a user assertion or authorization. */
export function isDirectUserMessage(message: StoredMessage): boolean {
  return message.type === 'user' && !message.hidden && isDirectUserSource(message.inputSource)
    && !/^(?:assistant-work:|agent-message:)/.test(message.id)
    && !/^\s*\[Message from session\b/i.test(message.content)
}

/** Tool input/result fields own the evidence even when the display text is empty.
 * Search and exact reads must hash and expose the same deterministic source view. */
export function historySourceContent(message: StoredMessage): string {
  if (message.type !== 'tool') return message.content
  return JSON.stringify({ content: message.content, toolName: message.toolName, toolUseId: message.toolUseId,
    toolInput: message.toolInput, toolResult: message.toolResult, toolStatus: message.toolStatus, isError: message.isError })
}

const digest = (content: string) => createHash('sha256').update(content).digest('hex')
function sessionAliases(workspaceRootPath: string, sessionId: string): string[] {
  const roots = [getSessionPath(workspaceRootPath, sessionId), join(workspaceRootPath, 'sessions', sessionId), join(workspaceRootPath, 'assistant', 'sessions', sessionId)]
  return [...new Set(roots.flatMap(root => {
    const forms = [root.replaceAll('\\', '/'), root]
    for (let level = 0, escaped = root; level < 4; level++) { escaped = escaped.replaceAll('\\', '\\\\'); forms.push(escaped) }
    return forms
  }))].sort((a, b) => b.length - a.length)
}
/** Logical identity survives a Host-owned Session relocation; file bytes remain separately attributable. */
export function sourceContentIdentity(workspaceRootPath: string, sessionId: string, content: string): string {
  for (const alias of sessionAliases(workspaceRootPath, sessionId)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    content = content.replace(new RegExp(`${escaped}(?=$|[\\\\/"'\\s])`, 'g'), '{{SESSION_PATH}}')
  }
  return content
}
export function sourceContentHash(workspaceRootPath: string, sessionId: string, content: string): string {
  return digest(sourceContentIdentity(workspaceRootPath, sessionId, content))
}
export function sourceContentMatches(workspaceRootPath: string, sessionId: string, content: string, expectedHash: string): boolean {
  const identity = sourceContentIdentity(workspaceRootPath, sessionId, content)
  if (digest(identity) === expectedHash || digest(content) === expectedHash) return true
  // Legacy hashes used expanded paths. Only the same body under known Host roots is eligible.
  return sessionAliases(workspaceRootPath, sessionId).some(alias => digest(identity.replaceAll('{{SESSION_PATH}}', alias)) === expectedHash)
}
