/** Desktop-only image export contract. PNGs are transient until Save is invoked. */

export type ShareLayout = 'auto' | 'long'
export type ShareRatio = 'a4' | '3:4' | '9:16' | '1:1'
export type ShareOrientation = 'portrait' | 'landscape'
export type ShareOutputMode = 'split' | 'single'

export interface ShareInclude {
  time: boolean
  date: boolean
  page: boolean
  model: boolean
}

export interface ShareOptions {
  layout: ShareLayout
  ratio: ShareRatio
  orientation: ShareOrientation
  include: ShareInclude
}

export interface SharePageSpec {
  /** CSS layout width. The PNG is rasterized at 2×. */
  width: number
  /** Fixed CSS page height for split mode; 0 means auto height (single image). */
  height: number
  /** Final PNG width (width × scale). */
  outputWidth: number
  /** Final PNG height for split mode; 0 means it is measured from content. */
  outputHeight: number
  mode: ShareOutputMode
}

export const SHARE_RATIOS = {
  a4: 1.4142,
  '3:4': 4 / 3,
  '9:16': 16 / 9,
  '1:1': 1,
} as const

export const SHARE_IMAGE = {
  /** Short edge of the layout. Also the width of a single long image. */
  cssWidth: 720,
  /** Short edge of the PNG at 2×. */
  outputWidth: 1440,
  scale: 2,
  /** Hard cap for one paginated page, in output pixels. */
  pageBudget: 4_800,
  /** Hard cap for a single long image, in output pixels. */
  maxHeight: 24_000,
  maxPages: 32,
  maxPngBytes: 12 * 1024 * 1024,
  maxBatchBytes: 64 * 1024 * 1024,
} as const

/**
 * Page geometry is defined by a 720 CSS px short edge.
 * A4 portrait is therefore 720×1018 CSS → 1440×2036 PNG; landscape swaps
 * width and height, so the PNG long edge is 2× the selected ratio edge.
 */
export function resolveSharePage(options: Pick<ShareOptions, 'layout' | 'ratio' | 'orientation'>): SharePageSpec {
  if (options.layout === 'long') {
    return {
      width: SHARE_IMAGE.cssWidth,
      height: 0,
      outputWidth: SHARE_IMAGE.outputWidth,
      outputHeight: 0,
      mode: 'single',
    }
  }
  const longEdge = Math.round(SHARE_IMAGE.cssWidth * SHARE_RATIOS[options.ratio])
  const portrait = options.orientation === 'portrait'
  const width = portrait ? SHARE_IMAGE.cssWidth : longEdge
  const height = portrait ? longEdge : SHARE_IMAGE.cssWidth
  return {
    width,
    height,
    outputWidth: width * SHARE_IMAGE.scale,
    outputHeight: height * SHARE_IMAGE.scale,
    mode: 'split',
  }
}

export interface ShareImageSaveRequest {
  sessionId: string
  /** PNG payloads in reading order, without a data URL prefix. */
  images: string[]
}

export interface ShareImageSaveResult {
  directory: string
  paths: string[]
}
