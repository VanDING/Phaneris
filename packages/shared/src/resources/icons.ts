import { z } from 'zod'

export const RESOURCE_ICON_PRESETS = [
  'file-text', 'book-open', 'chart-pie', 'pen-line', 'scan-line', 'compass',
  'database', 'globe', 'folder', 'layers', 'code-xml', 'zap',
] as const

export const RESOURCE_ICON_IMAGE_SIZE = 128

export const resourceIconKeySchema = z.string().max(4096).regex(/^(?:source|plugin|skill:(?:workspace|global|project)):.+$/)
export const resourceIconSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), name: z.enum(RESOURCE_ICON_PRESETS) }),
  z.object({
    kind: z.literal('image'),
    // Canvas produces a small PNG data URL. It is always rendered as an image.
    src: z.string().max(96 * 1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  }),
])

export type ResourceIcon = z.infer<typeof resourceIconSchema>
export type ResourceIcons = Record<string, ResourceIcon>
