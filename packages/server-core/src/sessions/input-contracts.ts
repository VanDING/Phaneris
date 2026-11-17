import type { Message, StoredAttachment } from '@phaneris/core/types'
import type { SendMessageOptions, FileAttachment } from '@phaneris/shared/protocol'

/** A trusted Host caller supplies provenance separately from client options. */
export type InputOrigin = NonNullable<Message['inputSource']> & { callerClientId?: string }
export interface SessionInputIntent {
  text: string
  attachments?: FileAttachment[]
  storedAttachments?: StoredAttachment[]
  options?: SendMessageOptions
  /** Stable identity for an idempotent internal delivery. */
  messageId?: string
  /** Resume an already stored input without attributing it to a new actor. */
  replay?: { messageId: string; authRetry?: boolean }
}
export interface InputTurn {
  accepted: Promise<{ accepted: true; messageId: string }>
  finished: Promise<void>
}

/** Legacy local originals remain evidence; all newly attributed actors are explicit. */
export function isDirectUserSource(source: Message['inputSource']): boolean {
  return source === undefined || source.kind === 'direct_user'
}

/** A missing historical marker cannot mint a new management authorization. */
export function hasDirectUserAuthority(source: Message['inputSource']): boolean {
  return source?.kind === 'direct_user'
}
