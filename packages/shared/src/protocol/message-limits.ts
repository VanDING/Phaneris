// Browser-safe attachment preflight for the existing shared transport limit.
import { MAX_MESSAGE_PAYLOAD_BYTES } from './limits'

export const MAX_SENT_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Raw attachment bytes one message can carry. Sending uploads each file
 * (`storeAttachment`), then sends all of them again as base64 (4/3 of the raw
 * size) in one `sendMessage` call, which also carries thumbnails, text and
 * metadata: 70% of the message limit keeps that call under it.
 */
export function maxAttachmentBytes(maxMessageBytes: number): number {
  return Math.floor(maxMessageBytes * 0.7)
}

export interface AttachmentSizeInput {
  name: string
  size: number
  type?: string
}

export type AttachmentSizeProblem =
  | { kind: 'file'; name: string; size: number; limit: number }
  | { kind: 'total'; size: number; limit: number }

/**
 * Whether these attachments can be sent in one message to a server with this
 * limit. Every file must fit on its own (it is uploaded in one call), and
 * together they must fit (they are sent in one call); images count at most
 * their resized size.
 */
export function checkAttachmentSizes(
  attachments: readonly AttachmentSizeInput[],
  maxMessageBytes = MAX_MESSAGE_PAYLOAD_BYTES,
): AttachmentSizeProblem | null {
  const limit = maxAttachmentBytes(maxMessageBytes)
  const tooBig = attachments.find(attachment => attachment.size > limit)
  if (tooBig) return { kind: 'file', name: tooBig.name, size: tooBig.size, limit }
  const total = attachments.reduce(
    (sum, attachment) => sum + (attachment.type === 'image' ? Math.min(attachment.size, MAX_SENT_IMAGE_BYTES) : attachment.size),
    0,
  )
  return total > limit ? { kind: 'total', size: total, limit } : null
}

/** "59.7 MB" style size for messages about attachment limits (1 MB = 1,000,000 bytes, as in Finder). */
export function formatAttachmentBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

/** Check the actual JSON contribution too: text, thumbnails and base64 can coexist. */
export function checkAttachmentPayload(
  attachments: readonly AttachmentSizeInput[],
  message: string,
  maxMessageBytes = MAX_MESSAGE_PAYLOAD_BYTES,
): AttachmentSizeProblem | null {
  const limit = Math.floor(maxMessageBytes * 0.95)
  const size = new TextEncoder().encode(JSON.stringify({ attachments, message })).byteLength
  return size > limit ? { kind: 'total', size, limit } : null
}
