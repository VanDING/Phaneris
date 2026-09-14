/** Bounded pull transport for a complete, compact session snapshot. */
export const SESSION_READ_CHUNK_BYTES = 512 * 1024
export const SESSION_READ_MAX_BYTES = 512 * 1024 * 1024
export interface SessionReadCursor { readId: string; offset: number }
export interface SessionReadChunk {
  format: 'session-jsonl-v1'
  readId: string
  offset: number
  nextOffset: number
  totalBytes: number
  data: Uint8Array
  done: boolean
}
