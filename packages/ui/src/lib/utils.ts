/**
 * Utility functions for @phaneris/ui
 */

import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Contract font-size tiers (`DESIGN.md` → Typography) plus the two object-scale
 * glyph roles.
 *
 * tailwind-merge cannot know a custom `text-*` utility is a font size: with the
 * stock configuration it files every `text-<word>` under text-colour, so
 * `cn('text-meta text-foreground')` kept only `text-foreground` and the tier
 * silently disappeared. That is how a `Badge` rendered at the inherited 15px
 * instead of 11px, and how filled `size="sm"` buttons lost `text-background`
 * (invisible label). Registering the tiers here makes `cn` resolve
 * font-size-vs-font-size and font-size-vs-colour conflicts correctly.
 *
 * One instance, shared by every host: `apps/electron/src/renderer/lib/utils.ts`
 * and `apps/webui`/`apps/viewer` re-export this module rather than building a
 * second merger. Adding a tier starts in `scale-contract.ts`; add it here in the
 * same change or that tier will be eaten again.
 */
export const CONTRACT_FONT_SIZE_TIERS = [
  'micro',
  'meta',
  'label',
  'body',
  'reading',
  'title',
  'display',
  'glyph-watermark',
  'glyph-avatar',
] as const

export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...CONTRACT_FONT_SIZE_TIERS] }],
    },
  },
})

/**
 * Merge class names with Tailwind CSS conflict resolution.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
