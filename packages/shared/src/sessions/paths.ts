/** Session filesystem layout. No persistence queue, config or agent imports. */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceSessionsPath } from '../workspaces/storage.ts';
import { sanitizeSessionId } from './validation.ts';
// ============================================================
// Directory Utilities
// ============================================================

/**
 * Ensure sessions directory exists for a workspace
 */
export function ensureSessionsDir(workspaceRootPath: string): string {
  const dir = getWorkspaceSessionsPath(workspaceRootPath);
  if (!existsSync(dir)) {
    // M-23: session storage dir is private app state — owner rwx only.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * Get path to a session's directory
 *
 * SECURITY: Uses sanitizeSessionId() as defense-in-depth to prevent path traversal.
 * Callers should still validate sessionId before calling this function.
 */
export function getSessionPath(workspaceRootPath: string, sessionId: string): string {
  // Defense-in-depth: strip any path components from sessionId
  const safeSessionId = sanitizeSessionId(sessionId);
  return join(getWorkspaceSessionsPath(workspaceRootPath), safeSessionId);
}

/**
 * Get path to a session's JSONL file (inside session folder)
 */
export function getSessionFilePath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'session.jsonl');
}

/**
 * Ensure session directory exists with all subdirectories
 */
export function ensureSessionDir(workspaceRootPath: string, sessionId: string): string {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  if (!existsSync(sessionDir)) {
    // M-23: session dirs contain transcripts/attachments — owner rwx only.
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  // Also create plans, attachments, long_responses, and downloads directories
  const plansDir = join(sessionDir, 'plans');
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true, mode: 0o700 });
  }
  const attachmentsDir = join(sessionDir, 'attachments');
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true, mode: 0o700 });
  }
  const longResponsesDir = join(sessionDir, 'long_responses');
  if (!existsSync(longResponsesDir)) {
    mkdirSync(longResponsesDir, { recursive: true, mode: 0o700 });
  }
  // Data directory for transform_data tool output (JSON files for datatable/spreadsheet)
  const dataDir = join(sessionDir, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }
  // Downloads directory for binary files from API responses (PDFs, images, etc.)
  const downloadsDir = join(sessionDir, 'downloads');
  if (!existsSync(downloadsDir)) {
    mkdirSync(downloadsDir, { recursive: true, mode: 0o700 });
  }
  return sessionDir;
}

/**
 * Get the attachments directory for a session
 */
export function getSessionAttachmentsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'attachments');
}

/**
 * Get the plans directory for a session
 */
export function getSessionPlansPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'plans');
}

/**
 * Get the data directory for a session (transform_data tool output)
 */
export function getSessionDataPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'data');
}

/**
 * Get the downloads directory for a session (binary files from API responses)
 */
export function getSessionDownloadsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'downloads');
}
