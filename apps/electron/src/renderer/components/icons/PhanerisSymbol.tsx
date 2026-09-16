import * as React from 'react'

/** The glyph's five planes, in the artwork's own order. */
const POLYGONS = [
  '180,270 500,90 500,270 330,365', // 1 top-left
  '180,270 330,365 330,790 180,875', // 2 left stem
  '500,90 760,235 610,320 500,270', // 3 top-right
  '610,320 760,235 760,510 610,595', // 4 right side
  '380,555 610,425 610,595 380,725', // 5 inner face
] as const

/**
 * Per-face lighting for `tone="accent"`, one entry per polygon.
 *
 * `dark` / `lift` are percentages of black / white mixed into the theme accent at
 * the two ends of the gradient, and the x/y pairs point each gradient's axis at
 * the artwork's light source. The front face (index 4) deliberately carries the
 * deepest mix: in the brand lockup it is the plane that gives the block its
 * weight, and without a real dark there the glyph reads as a washed-out outline.
 */
const ACCENT_FACES = [
  { id: 'topL', x1: 0, y1: 1, x2: 1, y2: 0, dark: 62, lift: 20 },
  { id: 'stem', x1: 0, y1: 0, x2: 0.8, y2: 1, dark: 50, lift: 32 },
  { id: 'topR', x1: 0, y1: 0, x2: 1, y2: 1, dark: 25, lift: 58 },
  { id: 'right', x1: 0, y1: 0, x2: 0.4, y2: 1, dark: 38, lift: 36 },
  { id: 'inner', x1: 0, y1: 0.2, x2: 1, y2: 0.8, dark: 55, lift: 40 },
] as const

/** Which gradient each polygon draws with, matched by polygon order. */
const BRAND_FILL_BY_POINTS: Record<string, string> = {
  [POLYGONS[0]]: 'topL',
  [POLYGONS[1]]: 'stem',
  [POLYGONS[2]]: 'topR',
  [POLYGONS[3]]: 'right',
  [POLYGONS[4]]: 'inner',
}

interface PhanerisSymbolProps {
  className?: string
  /** For callers that drive the shared `.logo-mark` entrance timing. */
  style?: React.CSSProperties
  /**
   * How the mark is painted.
   *
   * - `flat`   — one `currentColor` silhouette. Chrome-sized marks (sidebar, menus,
   *              buttons); apply `text-accent` to follow the theme.
   * - `accent` — the five-face lighting model built from `currentColor` at
   *              stepped alphas. Depth without leaving the theme: the mark is
   *              shaded, but it is still the theme's colour.
   * - `brand`  — the fixed full-colour lockup from `icon-app.svg`. Brand artwork;
   *              it does NOT follow the theme, so reserve it for surfaces where
   *              the theme is irrelevant (marketing, packaging, app icon).
   */
  tone?: 'flat' | 'accent' | 'brand'
}

/**
 * Phaneris mark — the isometric glyph from `apps/electron/resources/icon.svg`,
 * the single source of truth for the brand mark.
 *
 * The five polygons are the glyph's **actual planes**, not decoration:
 *   1 top-left · 2 left stem · 3 top-right · 4 right side · 5 inner face.
 * `tone="accent"` shades them with alphas derived from a light source at the
 * upper left, so the widest planes (2 and 5 — the ones sharing the x=330/380
 * edge) stay furthest apart in value and the glyph reads as a solid block at any
 * size. `tone="brand"` instead copies the per-face gradient stops verbatim from
 * `icon-app.svg`; if the artwork is ever redrawn, both the polygons *and* those
 * stops change with it.
 *
 * The viewBox is the glyph's **tight bounding box**, not the artwork's
 * 1000×1000 canvas. This matters: the drawing only occupies x 180–760 /
 * y 90–875 of that canvas, so using the full canvas would render the mark at
 * roughly 58% of whatever size the caller asked for — an `h-4` logo would paint
 * a ~9px glyph. Any component that draws this mark copies these five polygons,
 * so if the artwork is ever redrawn, update the viewBox with it.
 */
export function PhanerisSymbol({ className, style, tone = 'flat' }: PhanerisSymbolProps) {
  // Instance-scoped gradient ids. Several marks can be mounted at once (splash
  // over landing, sidebar, menus), and duplicated ids make every instance adopt
  // whichever definition the browser resolved first.
  const gid = React.useId()

  return (
    <svg
      viewBox="180 90 580 785"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {tone === 'brand' ? (
        <defs>
          <linearGradient id={`${gid}-topL`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#2A0E92" />
            <stop offset="55%" stopColor="#5420F3" />
            <stop offset="100%" stopColor="#8F63FF" />
          </linearGradient>
          <linearGradient id={`${gid}-stem`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#1E0B68" />
            <stop offset="100%" stopColor="#6C2DFF" />
          </linearGradient>
          <linearGradient id={`${gid}-topR`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8E57FF" />
            <stop offset="100%" stopColor="#D4BCFF" />
          </linearGradient>
          <linearGradient id={`${gid}-right`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#5A22EE" />
            <stop offset="100%" stopColor="#9D6BFF" />
          </linearGradient>
          <linearGradient id={`${gid}-inner`} x1="0" y1="0.2" x2="1" y2="0.8">
            <stop offset="0%" stopColor="#4B16E8" />
            <stop offset="100%" stopColor="#B58BFF" />
          </linearGradient>
        </defs>
      ) : (
        /* Themed lighting model. Each face is a gradient of the theme accent
           mixed toward black (shadow) or white (light) — NOT currentColor at
           reduced opacity. Alpha can only fade a colour toward the background,
           which is what made the mark look washed out and weightless; the brand
           lockup gets its solidity from *darkening* its shadowed planes, so this
           mirrors that with the theme's own colour. Directions follow the
           artwork's light source (upper left); the offsets give each plane a
           little open-edge lift instead of a flat tint. */
        <defs>
          {ACCENT_FACES.map((face) => (
            <linearGradient
              key={face.id}
              id={`${gid}-${face.id}`}
              x1={face.x1}
              y1={face.y1}
              x2={face.x2}
              y2={face.y2}
            >
              <stop
                offset="0%"
                stopColor={`color-mix(in srgb, currentColor ${100 - face.dark}%, #000)`}
              />
              <stop
                offset="100%"
                stopColor={`color-mix(in srgb, currentColor ${100 - face.lift}%, #fff)`}
              />
            </linearGradient>
          ))}
        </defs>
      )}
      {POLYGONS.map((points) => {
        // brand and accent share the same per-face gradient ids; only the stop
        // colours differ (fixed artwork vs. mixes of the theme accent).
        return (
          <polygon
            key={points}
            points={points}
            fill={tone === 'flat' ? 'currentColor' : `url(#${gid}-${BRAND_FILL_BY_POINTS[points]})`}
          />
        )
      })}
    </svg>
  )
}
