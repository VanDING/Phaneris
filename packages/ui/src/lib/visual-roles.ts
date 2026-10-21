/** Product roles are independent from the 39 optional theme-authoring fields. */
import { CONTROL_HEIGHT_TIERS, FONT_SIZE_TIERS, RADIUS_TIERS } from './scale-contract'

const rem = (px: number) => `${(px / 15).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}rem`

export const VISUAL_ROLE_TOKENS = {
  '--surface-canvas': 'var(--background)', '--surface-navigator': 'var(--navigator)',
  '--surface-paper': 'var(--paper)', '--surface-raised': 'var(--card)',
  '--surface-sunken': 'var(--muted)', '--surface-floating': 'var(--popover-solid)',
  '--text-primary': 'var(--foreground)', '--text-secondary': 'var(--muted-foreground)',
  '--text-tertiary': 'var(--muted-foreground)', '--text-disabled': 'color-mix(in srgb, var(--foreground) 40%, transparent)',
  '--action-hover': 'color-mix(in srgb, var(--foreground) 3%, transparent)',
  '--action-selected': 'var(--secondary)', '--action-pressed': 'color-mix(in srgb, var(--foreground) 6%, transparent)',
  '--action-focus': 'var(--ring)', '--action-invalid': 'var(--destructive)',
  '--shape-window': 'var(--theme-panel-radius)', '--shape-panel': 'var(--theme-panel-radius)',
  '--shape-inner': 'var(--theme-panel-radius)', '--shape-card': 'calc(var(--theme-radius) * 1.333333)',
  '--shape-control': 'calc(var(--theme-radius) * .75)', '--shape-chip': 'var(--theme-radius)', '--shape-round': '9999px',
  // Contract tiers (fixed geometry). Role shapes above stay theme-derived.
  ...Object.fromEntries(Object.entries(RADIUS_TIERS).map(([tier, px]) => [`--shape-${tier}`, `${px}px`])),
  '--shape-bubble': '16px', '--shape-composer': 'calc(var(--theme-radius) * 1.5)',
  // Control heights are physical object geometry; the tier table is the contract.
  ...Object.fromEntries(Object.entries(CONTROL_HEIGHT_TIERS).map(([tier, px]) => [`--control-height-${tier}`, `${px}px`])),
  // Semantic type scale. Values are rem so the user font-size setting scales them.
  ...Object.fromEntries(Object.entries(FONT_SIZE_TIERS).map(([tier, px]) => [`--type-${tier}-size`, rem(px)])),
  // Object-scale glyphs: a monogram watermark and avatar initials are sized by
  // the object they sit in, not by the reading hierarchy, so they are not type
  // tiers. Kept here so a component never needs an arbitrary literal.
  '--glyph-watermark-size': '2.25rem', '--glyph-avatar-size': '3rem',
  '--ui-scale': '1', '--reading-scale': '1',
  '--ui-caption-size': '.75rem', '--ui-label-size': '.866667rem', '--ui-body-size': '.875rem',
  '--ui-title-size': '1rem', '--ui-heading-size': '1.2rem', '--ui-line-height': '1.5',
  '--reading-size': '.93334rem', '--reading-line-height': '1.7', '--code-size': '.866667rem',
  '--reading-width': '840px', '--reading-gutter': '1.25rem', '--reading-gutter-compact': '.75rem',
  '--panel-gutter': '1rem', '--row-inset': '.75rem', '--card-padding': '1rem',
  '--panel-header-height': 'max(36px, calc(2rem * var(--ui-scale) + 6px))',
  '--sidebar-row-height': 'max(28px, calc(28px * var(--theme-density-scale)), calc(var(--ui-label-size) * var(--ui-scale) * var(--ui-line-height) + 6px))',
  '--sidebar-inline-inset': '8px', '--sidebar-item-inset': '8px', '--sidebar-icon-size': '16px',
  '--sidebar-rail-control-size': '28px', '--sidebar-rail-item-inset': '6px',
  '--sidebar-rail-gap': '2px', '--sidebar-rail-inline-offset': '2px',
  '--touch-target': '44px',
  '--z-component-behind': '-1', '--z-component-content': '0', '--z-component-overlay': '1',
  '--z-component-header': '2', '--z-component-controls': '3',
  '--z-component-background': '-2', '--z-component-recess': '-10', '--z-component-floating': '4', '--z-component-sticky': '5',
  '--z-component-chrome': '10', '--z-component-scrim': '20', '--z-component-panel': '30',
  '--z-component-backdrop': '40', '--z-component-handles': '50', '--z-component-calendar': '60',
} as const
