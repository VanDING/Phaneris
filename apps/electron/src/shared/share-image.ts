/** Desktop-only image export contract. PNGs are transient until Save is invoked. */
export const SHARE_IMAGE = {
  cssWidth: 720,
  outputWidth: 1440,
  scale: 2,
  autoHeight: 12_000,
  pageHeight: 4_800,
  maxHeight: 24_000,
  maxPages: 32,
  maxPngBytes: 12 * 1024 * 1024,
  maxBatchBytes: 64 * 1024 * 1024,
} as const

export interface ShareImageSaveRequest {
  sessionId: string
  /** PNG payloads in reading order, without a data URL prefix. */
  images: string[]
}

export interface ShareImageSaveResult {
  directory: string
  paths: string[]
}
