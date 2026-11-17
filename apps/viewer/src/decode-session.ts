import { z } from 'zod'
import type { StoredSession } from '@phaneris/core'

const text = z.string(), number = z.number().finite(), flag = z.boolean()
const attachment = z.object({
  id: text, type: z.enum(['image', 'text', 'pdf', 'office', 'audio', 'unknown']), name: text,
  mimeType: text, size: number.nonnegative(), storedPath: text, thumbnailPath: text.optional(),
  thumbnailBase64: text.optional(), markdownPath: text.optional(), originalSize: number.optional(),
  wasResized: flag.optional(), resizedBase64: text.optional(),
}).passthrough()
const badge = z.object({
  type: z.enum(['source', 'skill', 'context', 'command', 'file', 'folder']), label: text, rawText: text,
  start: number, end: number, iconDataUrl: text.optional(), collapsedLabel: text.optional(), filePath: text.optional(),
}).passthrough()
const annotation = z.object({
  id: text, schemaVersion: z.literal(1), createdAt: number, updatedAt: number.optional(), deletedAt: number.optional(),
  body: z.array(z.object({ type: text, text: text.optional(), value: text.optional(), format: text.optional() }).passthrough()),
  target: z.object({ source: z.object({ sessionId: text, messageId: text }).passthrough(),
    selectors: z.array(z.object({ type: text, exact: text.optional(), prefix: text.optional(), suffix: text.optional(),
      start: number.optional(), end: number.optional(), path: text.optional(), blockId: text.optional(), blockType: text.optional(),
      x: number.optional(), y: number.optional(), w: number.optional(), h: number.optional(), page: number.optional(),
      unit: text.optional(), columnKey: text.optional(), rowKey: z.union([text, number]).optional(),
    }).passthrough()),
  }).passthrough(),
  createdBy: z.object({ id: text, name: text.optional(), type: text.optional() }).passthrough().optional(),
  style: z.object({ color: text.optional(), opacity: number.optional() }).passthrough().optional(),
  intent: text.optional(), status: text.optional(),
}).passthrough()
const message = z.object({
  id: text.min(1), type: z.enum(['user', 'assistant', 'tool', 'error', 'status', 'info', 'warning', 'plan', 'auth-request']), content: text,
  // Missing timestamps retain storedToMessage's existing legacy fallback.
  timestamp: number.optional(), toolName: text.optional(), toolUseId: text.optional(),
  toolInput: z.record(text, z.unknown()).optional(), toolResult: text.optional(),
  toolStatus: z.enum(['pending', 'executing', 'completed', 'error', 'backgrounded', 'unknown']).optional(),
  toolDuration: number.optional(), toolIntent: text.optional(), toolDisplayName: text.optional(),
  toolDisplayMeta: z.object({ displayName: text, iconDataUrl: text.optional(), description: text.optional(), category: text.optional() }).passthrough().optional(),
  parentToolUseId: text.optional(), taskId: text.optional(), shellId: text.optional(), elapsedSeconds: number.optional(),
  isBackground: flag.optional(), isError: flag.optional(), isIntermediate: flag.optional(), hidden: flag.optional(),
  isQueued: flag.optional(), turnId: text.optional(), promptSnapshot: text.optional(),
  attachments: z.array(attachment).optional(), badges: z.array(badge).optional(), annotations: z.array(annotation).optional(),
  skillSlugs: z.array(text).optional(), errorDetails: z.array(text).optional(),
  errorCode: text.optional(), errorTitle: text.optional(), errorOriginal: text.optional(), errorCanRetry: flag.optional(),
  errorActions: z.array(z.object({ key: text, label: text, action: text.optional(), url: text.optional(), sourceSlug: text.optional() }).passthrough()).optional(),
  planPath: text.optional(), statusType: text.optional(), infoLevel: text.optional(),
  inputReception: z.object({ disposition: z.enum(['saved', 'started', 'queued', 'handled', 'rejected', 'unknown']), reason: text.optional() }).passthrough().optional(),
  authRequestId: text.optional(), authRequestType: text.optional(), authSourceSlug: text.optional(), authSourceName: text.optional(),
  authStatus: text.optional(), authCredentialMode: text.optional(), authHeaderName: text.optional(), authHeaderNames: z.array(text).optional(),
  authLabels: z.object({ credential: text.optional(), username: text.optional(), password: text.optional() }).passthrough().optional(),
  authDescription: text.optional(), authHint: text.optional(), authSourceUrl: text.optional(), authPasswordRequired: flag.optional(),
  authError: text.optional(), authEmail: text.optional(), authWorkspace: text.optional(),
  outputBlocks: z.array(z.object({ type: text, text: text.optional(), content: text.optional() }).passthrough()).optional(),
}).passthrough()
const session = z.object({
  id: text.min(1), name: text.optional(), workspaceId: text.default(''), createdAt: number.default(0), lastUsedAt: number.default(0),
  messages: z.array(message), tokenUsage: z.object({ inputTokens: number.default(0), outputTokens: number.default(0),
    totalTokens: number.default(0), contextTokens: number.default(0), costUsd: number.default(0),
  }).passthrough().default({ inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 }),
}).passthrough()

/** Viewer owns unknown public JSON. Shared renderers receive decoded data. */
export function decodePublicSession(value: unknown): StoredSession | null {
  const parsed = session.safeParse(value)
  return parsed.success ? parsed.data as StoredSession : null
}

/** Clipboard intent detection is separate from format validation. */
export function looksLikePublicSession(value: unknown): boolean {
  return value !== null && typeof value === 'object' && ('messages' in value || ('id' in value && 'createdAt' in value))
}
