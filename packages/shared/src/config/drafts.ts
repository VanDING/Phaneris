/** Legacy draft compatibility and migration backups. Product drafts belong to sessions/drafts.ts. */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'node:crypto';

import { join } from 'path';

import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';

import { CONFIG_DIR } from './paths.ts';

import { type DraftAttachmentContent, type DraftAttachmentRef, type DraftsData, type SessionDraft } from './persisted-types.ts';

import { ensureConfigDir } from './repository.ts';

// ============================================
// Session Input Drafts
// Persists composer state (text + attachments) per session across app restarts.
// Two shapes for attachments:
//  - Track P: { path, name } — absolute path captured via webUtils.getPathForFile
//    (file-picker / OS drag). Re-read on hydrate via file:readUserAttachment RPC.
//  - Track C: { path, name, content } — inline content for paste / web-drag Files
//    that never existed on disk. Hydrate reconstructs directly from the stored bytes.
// ============================================

const DRAFTS_FILE = join(CONFIG_DIR, 'drafts.json');

const ATTACHMENT_CONTENT_TYPES = new Set(['image', 'pdf', 'text', 'office', 'audio', 'unknown']);

function isAbsoluteDraftPath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

function isDraftAttachmentContent(value: unknown): value is DraftAttachmentContent {
  if (!value || typeof value !== 'object') return false;
  const c = value as DraftAttachmentContent;
  if (!ATTACHMENT_CONTENT_TYPES.has(c.type as string)) return false;
  if (typeof c.mimeType !== 'string') return false;
  if (typeof c.size !== 'number') return false;
  if (c.base64 !== undefined && typeof c.base64 !== 'string') return false;
  if (c.text !== undefined && typeof c.text !== 'string') return false;
  if (c.thumbnailBase64 !== undefined && typeof c.thumbnailBase64 !== 'string') return false;
  return true;
}

function isDraftAttachmentRef(value: unknown): value is DraftAttachmentRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as DraftAttachmentRef;
  if (typeof ref.path !== 'string' || typeof ref.name !== 'string') return false;
  if (ref.content !== undefined && !isDraftAttachmentContent(ref.content)) return false;
  // Post-migration guard: refs without content MUST have an absolute path. This rejects
  // the broken 0.8.11 shape (synthetic path === filename, no content) on first load —
  // user sees empty drafts once instead of attachments silently disappearing forever.
  if (ref.content === undefined && !isAbsoluteDraftPath(ref.path)) return false;
  return true;
}

export function isSessionDraft(value: unknown): value is SessionDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SessionDraft;
  if (typeof candidate.text !== 'string') return false;
  if (candidate.attachments !== undefined) {
    if (!Array.isArray(candidate.attachments)) return false;
    if (!candidate.attachments.every(isDraftAttachmentRef)) return false;
  }
  return true;
}

export function isEmptyDraft(draft: SessionDraft): boolean {
  return !draft.text && (!draft.attachments || draft.attachments.length === 0);
}

/**
 * Load all drafts from disk. Entries that don't parse as SessionDraft
 * (e.g. pre-upgrade string drafts) are discarded silently.
 */
function loadDraftsData(): DraftsData {
  try {
    if (!existsSync(DRAFTS_FILE)) {
      return { drafts: {}, updatedAt: 0 };
    }
    const raw = readJsonFileSync<{ drafts?: Record<string, unknown>; updatedAt?: number }>(DRAFTS_FILE);
    const drafts: Record<string, SessionDraft> = {};
    for (const [sessionId, value] of Object.entries(raw.drafts ?? {})) {
      if (isSessionDraft(value)) {
        drafts[sessionId] = value;
      }
    }
    return { drafts, updatedAt: raw.updatedAt ?? 0 };
  } catch {
    return { drafts: {}, updatedAt: 0 };
  }
}

function saveDraftsData(data: DraftsData): void {
  ensureConfigDir();
  data.updatedAt = Date.now();
  atomicWriteFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Get the persisted draft for a session (text + attachment refs).
 */
export function getSessionDraft(sessionId: string): SessionDraft | null {
  const data = loadDraftsData();
  return data.drafts[sessionId] ?? null;
}

/**
 * Set the draft for a session. Empty drafts (no text and no attachments)
 * are removed from disk.
 */
export function setSessionDraft(sessionId: string, draft: SessionDraft): void {
  const data = loadDraftsData();
  if (isEmptyDraft(draft)) {
    delete data.drafts[sessionId];
  } else {
    data.drafts[sessionId] = {
      text: draft.text,
      ...(draft.attachments && draft.attachments.length > 0
        ? { attachments: draft.attachments.map(normalizeDraftAttachment) }
        : {}),
    };
  }
  saveDraftsData(data);
}

export function normalizeDraftAttachment(ref: DraftAttachmentRef): DraftAttachmentRef {
  const base: DraftAttachmentRef = { path: ref.path, name: ref.name };
  if (ref.content && isDraftAttachmentContent(ref.content)) {
    const c = ref.content;
    base.content = {
      type: c.type,
      mimeType: c.mimeType,
      size: c.size,
      ...(c.base64 !== undefined ? { base64: c.base64 } : {}),
      ...(c.text !== undefined ? { text: c.text } : {}),
      ...(c.thumbnailBase64 !== undefined ? { thumbnailBase64: c.thumbnailBase64 } : {}),
    };
  }
  return base;
}

export function deleteSessionDraft(sessionId: string): void {
  const data = loadDraftsData();
  delete data.drafts[sessionId];
  saveDraftsData(data);
}

/**
 * Get all drafts as a record keyed by sessionId.
 */
export function getAllSessionDrafts(): Record<string, SessionDraft> {
  const data = loadDraftsData();
  return data.drafts;
}

/** Preserve exact legacy bytes before removing a successfully migrated/deleted entry. */
export function archiveLegacySessionDraft(sessionId: string): void {
  if (!getSessionDraft(sessionId)) return;
  const raw = readFileSync(DRAFTS_FILE, 'utf8');
  const directory = join(CONFIG_DIR, 'drafts-backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const backup = join(directory, `${createHash('sha256').update(raw).digest('hex')}.json`);
  if (!existsSync(backup)) atomicWriteFileSync(backup, raw, { mode: 0o600 });
  deleteSessionDraft(sessionId);
}
