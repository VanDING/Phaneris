/** Session-owned composer data. The config draft store is a migration/rollback adapter only. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionDraft } from '../config/persisted-types.ts'
import { getSessionDraft as getLegacyDraft, archiveLegacySessionDraft,
  isSessionDraft, isEmptyDraft, normalizeDraftAttachment } from '../config/drafts.ts'
import { atomicWriteFileSync } from '../utils/files.ts'
import { getSessionPath, getSessionFilePath } from './paths.ts'
import { validateSessionId } from './validation.ts'
import { listSessions } from './storage.ts'
import { makeSessionPathPortable, expandSessionPath } from './jsonl.ts'

function draftPath(workspaceRootPath: string, sessionId: string): string {
  validateSessionId(sessionId)
  if (!existsSync(getSessionFilePath(workspaceRootPath, sessionId))) throw new Error(`Session ${sessionId} not found`)
  return join(getSessionPath(workspaceRootPath, sessionId), 'draft.json')
}

export function getSessionDraft(workspaceRootPath: string, sessionId: string): SessionDraft | null {
  const path = draftPath(workspaceRootPath, sessionId)
  if (existsSync(path)) {
    const draft: unknown = JSON.parse(expandSessionPath(readFileSync(path, 'utf8'), getSessionPath(workspaceRootPath, sessionId)))
    if (!isSessionDraft(draft)) throw new Error(`Invalid Session draft: ${sessionId}`)
    archiveLegacySessionDraft(sessionId)
    return isEmptyDraft(draft) ? null : draft
  }
  const legacy = getLegacyDraft(sessionId)
  if (legacy) setSessionDraft(workspaceRootPath, sessionId, legacy)
  return legacy
}

export function setSessionDraft(workspaceRootPath: string, sessionId: string, draft: SessionDraft): void {
  const path = draftPath(workspaceRootPath, sessionId)
  if (!isSessionDraft(draft)) throw new Error('Invalid Session draft')
  const normalized: SessionDraft = { text: draft.text,
    ...(draft.attachments?.length ? { attachments: draft.attachments.map(normalizeDraftAttachment) } : {}) }
  atomicWriteFileSync(path, makeSessionPathPortable(JSON.stringify(normalized, null, 2), getSessionPath(workspaceRootPath, sessionId)), { mode: 0o600 })
  // Only retire the old entry after the Session-owned copy is durable.
  archiveLegacySessionDraft(sessionId)
}

export function deleteSessionDraft(workspaceRootPath: string, sessionId: string): void {
  setSessionDraft(workspaceRootPath, sessionId, { text: '' })
}

export function getAllSessionDrafts(workspaceRootPath: string): Record<string, SessionDraft> {
  const result: Record<string, SessionDraft> = {}
  for (const session of listSessions(workspaceRootPath)) {
    const draft = getSessionDraft(workspaceRootPath, session.id)
    if (draft) result[session.id] = draft
  }
  return result
}
