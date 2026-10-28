/**
 * Session Bundle — Serialization Format for Session Export/Import
 *
 * A SessionBundle is the portable representation of a session directory,
 * used for transferring sessions between workspaces (same-server or cross-server).
 *
 * This is the foundation for session dispatch (move/fork), backup, and sharing.
 */

import { existsSync, readFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'fs'
import { cp } from 'fs/promises'
import { join } from 'path'
import type { SessionHeader, StoredMessage } from './types.ts'
import type { StoredSession } from './types.ts'
import { readSessionJsonl, writeSessionJsonl, makeSessionPathPortable, expandSessionPath } from './jsonl.ts'
import { getSessionPath, getSessionFilePath } from './paths.ts'
import { pickSessionFields } from './utils.ts'
import { validateSessionId } from './validation.ts'
import { expandPath } from '../utils/paths.ts'
import { debug } from '../utils/debug.ts'
import {
  type BundleFile,
  MAX_BUNDLE_SIZE_BYTES,
  collectDirectoryFiles,
  validateBundleFile,
  restoreFiles,
} from '../utils/bundle-files.ts'

// Re-export BundleFile and MAX_BUNDLE_SIZE_BYTES for backward compatibility
export { type BundleFile, MAX_BUNDLE_SIZE_BYTES } from '../utils/bundle-files.ts'

/**
 * Directories to skip when collecting session files for export.
 * tmp/ is regenerable; hidden SDK journals are part of a portable conversation.
 */
const SKIP_DIRS = new Set(['tmp'])

/**
 * Files to skip when collecting session files for export.
 * session.jsonl is in the bundle as structured data.
 */
const SKIP_SESSION_FILES = new Set(['session.jsonl', 'session.jsonl.tmp'])

/**
 * Dispatch mode determines how the imported session relates to the original.
 */
export type DispatchMode = 'move' | 'fork'

/**
 * Branch info for fork operations.
 * Enables SDK-level conversation branching on the target server,
 * so the forked session has full context from the original.
 */
export interface BundleBranchInfo {
  /** SDK session ID to branch from */
  sdkSessionId: string
  /** SDK turn ID (branch point) */
  sdkTurnId: string
  /** Working directory for SDK session storage */
  sdkCwd: string
}

/**
 * Serialized representation of a session directory.
 * JSON envelope format — sessions are typically small (text + a few attachments).
 */
export interface SessionBundle {
  /** Bundle format version */
  version: 1
  /** Session data (header metadata + full message history) */
  session: {
    /** Session metadata (id, name, timestamps, config) */
    header: SessionHeader
    /** Full message history */
    messages: StoredMessage[]
  }
  /** All files from the session directory (attachments, plans, data, downloads, etc.) */
  files: BundleFile[]
  /** Branch info for fork operations (populated by the exporter when forking) */
  branchInfo?: BundleBranchInfo
}

/**
 * Serialize a session directory into a SessionBundle.
 *
 * Reads the session JSONL and all associated files (attachments, plans, data, downloads).
 * Skips tmp/ and includes hidden SDK journals. Validates total size against MAX_BUNDLE_SIZE_BYTES.
 *
 * @param workspaceRootPath - Root path of the workspace containing the session
 * @param sessionId - ID of the session to serialize
 * @returns SessionBundle or null if session doesn't exist or exceeds size limit
 */
export function serializeSession(
  workspaceRootPath: string,
  sessionId: string,
): SessionBundle | null {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId)
  const sessionFile = getSessionFilePath(workspaceRootPath, sessionId)

  if (!existsSync(sessionFile)) {
    debug('[bundle] Session file not found:', sessionFile)
    return null
  }

  // Read and parse session JSONL
  const stored = readSessionJsonl(sessionFile)
  if (!stored) {
    debug('[bundle] Failed to parse session JSONL:', sessionFile)
    return null
  }

  // Collect all files from session directory (except session.jsonl and tmp/)
  const files = collectDirectoryFiles(sessionDir, {
    skipDirs: SKIP_DIRS,
    skipFiles: SKIP_SESSION_FILES,
    includeHidden: new Set(['.pi-sessions']),
    strict: true,
  })

  // Validate total bundle size
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  if (totalSize > MAX_BUNDLE_SIZE_BYTES) {
    debug(`[bundle] Session exceeds max bundle size: ${totalSize} bytes > ${MAX_BUNDLE_SIZE_BYTES} bytes`)
    return null
  }

  // Build header from stored session (re-use the header creation from JSONL)
  // We read the raw header from the JSONL to preserve pre-computed fields
  const rawContent = readFileSync(sessionFile, 'utf-8')
  const firstLine = rawContent.split('\n')[0]
  if (!firstLine) return null

  // Strip server-internal fields that shouldn't travel with the bundle
  const header: SessionHeader = {
    ...JSON.parse(firstLine) as SessionHeader,
    // workspaceRootPath will be set by the importing server
  }

  return {
    version: 1,
    session: {
      header,
      messages: JSON.parse(makeSessionPathPortable(JSON.stringify(stored.messages), sessionDir)) as StoredMessage[],
    },
    files,
  }
}

/** Copy product-owned content for a branch; execution journals are forked by the SDK. */
export async function copySessionContent(sourceDir: string, targetDir: string): Promise<void> {
  for (const entry of ['attachments', 'plans', 'data', 'downloads', 'long_responses', 'notes.md', 'artifacts']) {
    const source = join(sourceDir, entry)
    if (existsSync(source)) await cp(source, join(targetDir, entry), { recursive: true })
  }
}

/** One import field policy: product fields travel; workspace relationships and execution intents do not. */
export function sessionFromBundle(bundle: SessionBundle, workspaceRootPath: string, sessionId: string): StoredSession {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId)
  const sourceDir = bundle.session.header.workspaceRootPath
    ? getSessionPath(expandPath(bundle.session.header.workspaceRootPath), bundle.session.header.id) : undefined
  const json = JSON.stringify(bundle.session)
  const data = JSON.parse(expandSessionPath(sourceDir ? makeSessionPathPortable(json, sourceDir) : json, sessionDir)) as SessionBundle['session']
  const session: StoredSession = {
    ...pickSessionFields(data.header), id: sessionId, workspaceRootPath, sdkCwd: sessionDir, createdAt: data.header.createdAt,
    lastUsedAt: Date.now(), messages: data.messages.map(message => ({ ...message,
      durableOperationId: undefined, durableSeq: undefined,
    })),
    tokenUsage: data.header.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  }
  // These IDs address source-workspace objects, not portable product content.
  for (const field of ['projectId', 'parentSessionId', 'dependencySessionIds', 'triggeredBy',
    'taskSlug', 'taskRunId', 'taskNodeId', 'taskNodeDispatchId', 'taskNodeCount',
    'contextPolicy', 'handoffRootSessionId', 'handoffFromSessionId', 'handoffSequence', 'contextHandoff',
    'pendingPlanExecution', 'branchFromSessionId', 'branchFromMessageId', 'branchFromSdkSessionId',
    'branchFromSessionPath', 'branchFromSdkCwd', 'branchFromSdkTurnId', 'sharedUrl', 'sharedId'] as const) delete session[field]
  return session
}

/** Publish the whole directory only after validation and restoration succeed. */
export function restoreSessionBundle(session: StoredSession, files: BundleFile[], prepare?: (directory: string) => void): void {
  let total = 0
  const paths = new Set<string>()
  for (const file of files) {
    const error = validateBundleFile(file)
    if (error) throw new Error(`Invalid bundle file: ${error}`)
    const key = file.relativePath.toLowerCase()
    if (SKIP_SESSION_FILES.has(key) || paths.has(key)) throw new Error(`Reserved or duplicate bundle path: ${file.relativePath}`)
    paths.add(key)
    total += file.size
    if (total > MAX_BUNDLE_SIZE_BYTES) throw new Error('Session bundle exceeds maximum size')
  }
  const target = getSessionPath(session.workspaceRootPath, session.id)
  if (existsSync(target)) throw new Error(`Session ${session.id} already exists in target workspace`)
  const parent = join(session.workspaceRootPath, 'sessions')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const staging = mkdtempSync(join(parent, '.import-'))
  try {
    for (const entry of ['attachments', 'plans', 'data', 'downloads', 'long_responses']) {
      mkdirSync(join(staging, entry), { recursive: true, mode: 0o700 })
    }
    restoreFiles(staging, files)
    prepare?.(staging)
    // The staged file will be expanded relative to the final Session directory.
    const portable = JSON.parse(makeSessionPathPortable(JSON.stringify(session), target)) as StoredSession
    writeSessionJsonl(join(staging, 'session.jsonl'), portable)
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * Validate a SessionBundle structure.
 * Checks version, required fields, and basic integrity.
 */
export function validateBundle(bundle: unknown): bundle is SessionBundle {
  if (!bundle || typeof bundle !== 'object') return false
  const b = bundle as Record<string, unknown>

  if (b.version !== 1) return false
  if (!b.session || typeof b.session !== 'object') return false

  const session = b.session as Record<string, unknown>
  if (!session.header || typeof session.header !== 'object') return false
  if (!Array.isArray(session.messages)) return false

  const header = session.header as Record<string, unknown>
  if (typeof header.id !== 'string') return false
  try { validateSessionId(header.id) } catch { return false }
  if (header.workspaceRootPath !== undefined && typeof header.workspaceRootPath !== 'string') return false
  if (typeof header.createdAt !== 'number') return false

  if (!Array.isArray(b.files)) return false

  return true
}
