import { z } from 'zod'
import type { StoredMessage } from '@phaneris/core/types'

export const SessionHistoryQuerySchema = z.object({
  messageId: z.string().min(1).max(200).optional(),
  offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(50).optional(),
  startCharacter: z.number().int().nonnegative().optional(), maxCharacters: z.number().int().min(1).max(32000).optional(),
  fromEnd: z.boolean().optional(),
  cursor: z.object({ snapshot: z.string().regex(/^[a-f0-9]{64}$/), count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(), character: z.number().int().nonnegative(), messageId: z.string().optional() }).strict().optional(),
}).strict().refine(query => !query.cursor || query.offset === undefined && query.startCharacter === undefined && query.fromEnd === undefined,
  'A snapshot cursor cannot be mixed with a new offset, character position or tail selection')

export type SessionHistoryQuery = z.infer<typeof SessionHistoryQuerySchema>
export interface SessionHistoryPage {
  sessionId: string; snapshot: string; total: number; offset: number; hasMore: boolean; nextOffset: number | null
  nextCursor: SessionHistoryQuery['cursor'] | null
  messages: Array<{
    id: string; historyOffset: number; role: StoredMessage['type']; timestamp?: number; content: string; contentHash: string
    inputSource?: StoredMessage['inputSource']; hidden?: boolean; isIntermediate?: boolean; directUser: boolean
    coverage: 'full' | 'partial' | 'unavailable'; startCharacter: number; endCharacter: number; characters: number; nextCharacter: number | null
    unavailable?: string; historical: true; toolName?: string
    attachments?: Array<{ id: string; name: string; mimeType: string; storedPath: string; size: number }>; attachmentCount: number
  }>
}
