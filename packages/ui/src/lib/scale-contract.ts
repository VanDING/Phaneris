/**
 * Scale contract: the single source of truth for font-size, radius and control
 * height tiers.
 *
 * DESIGN.md frontmatter, the ESLint allowlist snapshot and the generated role
 * tokens all derive from (or are validated against) these numbers. Adding a
 * tier is a deliberate contract change: update this file, DESIGN.md and run
 * `bun run theme:generate` in the same change.
 *
 * Values are authored in px at the default 15px root; `visual-roles.ts` turns
 * font sizes into rem so user font scaling keeps working. Radius and control
 * heights stay in px because they describe physical object geometry.
 */

export const FONT_SIZE_TIERS = {
  micro: 10,
  meta: 11,
  label: 12,
  body: 13,
  reading: 14,
  title: 16,
  display: 20,
} as const

export const RADIUS_TIERS = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
} as const

export const CONTROL_HEIGHT_TIERS = {
  '2xs': 18,
  xs: 22,
  sm: 26,
  md: 30,
  lg: 34,
  xl: 38,
} as const

export const SCALE_CONTRACT = {
  fontSize: FONT_SIZE_TIERS,
  radius: RADIUS_TIERS,
  controlHeight: CONTROL_HEIGHT_TIERS,
} as const

export type ScaleFamily = keyof typeof SCALE_CONTRACT
export type FontSizeTier = keyof typeof FONT_SIZE_TIERS
export type RadiusTier = keyof typeof RADIUS_TIERS
export type ControlHeightTier = keyof typeof CONTROL_HEIGHT_TIERS

/** Class names the contract exports; consumed by the ESLint hint and docs. */
export const SCALE_CLASS_NAMES = {
  fontSize: {
    micro: 'text-micro',
    meta: 'text-meta',
    label: 'text-label',
    body: 'text-body',
    reading: 'text-reading',
    title: 'text-title',
    display: 'text-display',
  },
  radius: {
    xs: 'rounded-shape-xs',
    sm: 'rounded-shape-sm',
    md: 'rounded-shape-md',
    lg: 'rounded-shape-lg',
    xl: 'rounded-shape-xl',
  },
  controlHeight: {
    '2xs': 'h-control-2xs',
    xs: 'h-control-xs',
    sm: 'h-control-sm',
    md: 'h-control-md',
    lg: 'h-control-lg',
    xl: 'h-control-xl',
  },
} as const

export function contractValues(family: ScaleFamily): string[] {
  return Object.values(SCALE_CONTRACT[family]).map(value => `${value as number}px`)
}

/** Nearest tier for a stray value; used to make lint messages actionable. */
export function nearestTier(family: ScaleFamily, value: number): { tier: string; px: number } {
  const entries = Object.entries(SCALE_CONTRACT[family]) as [string, number][]
  let best = entries[0]!
  for (const entry of entries) {
    if (Math.abs(entry[1] - value) < Math.abs(best[1] - value)) best = entry
  }
  return { tier: best[0], px: best[1] }
}
