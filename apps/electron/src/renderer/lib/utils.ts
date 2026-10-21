/**
 * The renderer's `cn` is the shared `@phaneris/ui` implementation.
 *
 * It must stay a re-export: a second `extendTailwindMerge` instance here would
 * diverge the moment a contract tier is added, and the divergence is invisible
 * (a `text-meta` silently lost inside `cva` output). `audit:ui-merge` proves the
 * merge layer keeps every tier.
 */
export { cn, twMerge, CONTRACT_FONT_SIZE_TIERS } from '@phaneris/ui/utils'
