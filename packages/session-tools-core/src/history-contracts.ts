import { z } from 'zod'
import type { StoredMessage } from '@phaneris/core/types'

const id = z.string().min(1).max(200)
export const HistoryQuerySchema = z.object({
  query: z.string().max(500).optional(), projectId: id.optional(), sessionId: id.optional(),
  scope: z.enum(['current', 'workspace']).optional(), includeWorkspace: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.object({ version: z.number().int().nonnegative(), memoryVersion: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict().refine(input => input.scope !== 'workspace' || input.projectId === undefined, 'Workspace-wide history cannot also specify a project filter')
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>
export interface HistoryMatch {
  sessionId: string
  messageId: string
  projectId?: string
  role: StoredMessage['type']
  directUser: boolean
  inputSource?: StoredMessage['inputSource']
  timestamp?: number
  contentHash: string
  snippet: string
  range: { offset: number; end: number; fullChars: number }
  attachmentCount: number
  attachmentContentIndexed: false
}
export interface HistoryPage {
  scope: { projectId?: string; includesWorkspace: boolean; workspaceWide: boolean }
  items: HistoryMatch[]
  version: number
  memoryVersion: number
  nextCursor: HistoryQuery['cursor'] | null
  extraction: import('./memory-maintenance-contracts').MemoryExtractionCoverage
  coverage: {
    discoveredSessions: number
    indexedSessions: number
    pendingSessions: number
    unreadableSessions: number
    excludedAssistantSessions: number
    indexedMessages: number
    refreshedSessions: number
  }
}
