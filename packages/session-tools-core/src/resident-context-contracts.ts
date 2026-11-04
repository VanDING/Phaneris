import { z } from 'zod'
import type { RequestContextSnapshot } from '@phaneris/core/types'

export const ResidentSourceSchema = z.object({ sessionId: z.string().min(1).max(200), messageId: z.string().min(1).max(200),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
export const ResidentContextSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('topics'), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal('resume'), topicId: z.string().min(1).max(200), anchors: z.array(ResidentSourceSchema).max(32).optional() }).strict(),
  z.object({ action: z.literal('anchors'), anchors: z.array(ResidentSourceSchema).max(32) }).strict(),
  z.object({ action: z.literal('focus'), label: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional(),
    anchors: z.array(ResidentSourceSchema).max(32) }).strict(),
])
export type ResidentContextCommand = z.infer<typeof ResidentContextSchema>
export type ResidentSource = z.infer<typeof ResidentSourceSchema>
export interface ResidentDependencies {
  sources: Array<{ sessionId: string; messageId: string; contentHash: string; ranges?: Array<{ offset: number; end: number }> }>
  memories: import('@phaneris/core/types').MemoryMaterialReference[]
}
export interface ResidentSegment {
  id: string
  topicId?: string
  runOperationId: string
  inputMessageId: string
  createdAt: number
  cursor: number
  generationFloor: number
  memoryVersion: number
  dependencies: ResidentDependencies
  selectedInputs: string[]
  omittedItems: number
  eventIds: string[]
  requests: Array<{ providerRequestId: string; requestHash: string; dependencies: ResidentDependencies; snapshot?: RequestContextSnapshot; disposition: 'entered' | 'committed' | 'stale' }>
}
export interface ResidentContextState {
  workspaceId: string
  sessionId: string
  revision: number
  focus: { label: string; topicId?: string; projectId?: string; afterMessageId?: string; anchors: ResidentSource[] }
  activeSegment?: ResidentSegment
  topics?: { items: Array<Omit<ResidentTopic, 'anchors' | 'originalInputIds'> & { anchorCount: number; originalInputCount: number }>; nextOffset: number | null }
}
export interface ResidentTopic {
  id: string; label: string; projectId?: string; anchors: ResidentSource[]; originalInputIds: string[]; createdAt: number; updatedAt: number
}

export const ResidentEventsQuerySchema = z.object({ after: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() }).strict()
export interface ResidentInboxEvent {
  eventId: string; sequence: number; workspaceId: string; delegationId: string; assistantSessionId: string; originMessageId: string
  kind: string; sessionId?: string; inputMessageId?: string; result?: { sessionId: string; messageId: string }
  request?: { sessionId: string; requestId: string; kind: 'permission' | 'ask_user' }
  createdAt: number
  phase: 'pending' | 'prepared' | 'entered' | 'handled' | 'attention' | 'delivered'
  enteredRunId?: string; delivery?: { sessionId: string; messageId: string }
}
export interface ResidentEventsPage { items: ResidentInboxEvent[]; nextAfter: number | null }
