/**
 * Contrast floor for the built-in themes.
 *
 * The frontend design review (2026-10-20) found the contrast policy living only
 * in prose: `DESIGN.md` asked for 4.5:1 while 234 translucent text sites
 * composited to 2.4–4.24:1. This gate makes the prose executable for the palettes
 * we ship, using WCAG 2.x relative luminance on the *resolved* colours (the same
 * values `themeToCSS` writes at runtime, including the `*-text` mixes).
 *
 * Scope and honest limits:
 *   - Built-in palettes only. A user theme is the author's responsibility; the
 *     contract document says so, and this gate cannot know their canvas.
 *   - Opaque pairs only. Translucent text is rejected structurally instead, by
 *     `check:design-drift` counting `text-<role>/NN`, because a composite ratio
 *     depends on the element behind it and is not knowable here.
 *   - Scenic mode (background image) is out of scope; `DESIGN.md` carries the
 *     authoring checklist for it.
 *
 * Thresholds are WCAG 2.1: 4.5:1 for text (1.4.3), 3:1 for UI component
 * boundaries and graphics that carry meaning (1.4.11).
 *
 * Usage:
 *   bun run check:contrast-floor
 *   bun run check:contrast-floor --json
 */
import assert from 'node:assert/strict'
import { BUILTIN_THEMES, DEFAULT_THEME, resolveTheme, resolveThemeMode, type ThemeOverrides } from '../packages/shared/src/config/theme'
import { defaultSemanticColors } from '../packages/shared/src/config/theme'
import { THEME_COLOR_POLICY } from '../packages/shared/src/config/theme-color-policy'

const TEXT_FLOOR = 4.5
const GRAPHIC_FLOOR = 3

type RGB = { r: number; g: number; b: number }

const NAMED: Record<string, RGB> = {
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0, g: 0, b: 0 },
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** `#rgb`, `#rrggbb`, `rgb()/rgba()`, `oklch()`, `oklab()` — the syntaxes the
 *  theme contract accepts for a colour. Anything else fails loudly: a gate that
 *  silently skips what it cannot parse is worse than no gate. */
export function parseColor(input: string): RGB {
  const value = input.trim().toLowerCase()
  if (NAMED[value]) return NAMED[value]!
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map(char => char + char).join('') : hex[1]!
    const int = Number.parseInt(digits, 16)
    return { r: ((int >> 16) & 0xff) / 255, g: ((int >> 8) & 0xff) / 255, b: (int & 0xff) / 255 }
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
    assert.equal(parts.length >= 3, true, `Unparsable rgb(): ${input}`)
    return { r: clamp(parts[0]! / 255), g: clamp(parts[1]! / 255), b: clamp(parts[2]! / 255) }
  }
  const oklch = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (oklch) {
    const lightness = Number(oklch[1]) / (oklch[2] ? 100 : 1)
    const chroma = Number(oklch[3])
    const hue = (Number(oklch[4]) * Math.PI) / 180
    return oklabToRGB(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue))
  }
  const oklab = value.match(/^oklab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/)
  if (oklab) {
    const lightness = Number(oklab[1]) / (oklab[2] ? 100 : 1)
    return oklabToRGB(lightness, Number(oklab[3]), Number(oklab[4]))
  }
  throw new Error(`Unparsable colour in a built-in theme: ${input}`)
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
const toGamma = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055)

export function relativeLuminance(color: RGB): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b)
}

export function contrastRatio(foreground: string | RGB, background: string | RGB): number {
  const a = relativeLuminance(typeof foreground === 'string' ? parseColor(foreground) : foreground)
  const b = relativeLuminance(typeof background === 'string' ? parseColor(background) : background)
  const [light, dark] = a >= b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

function oklabToRGB(lightness: number, aAxis: number, bAxis: number): RGB {
  const l = (lightness + 0.3963377774 * aAxis + 0.2158037573 * bAxis) ** 3
  const m = (lightness - 0.1055613458 * aAxis - 0.0638541728 * bAxis) ** 3
  const s = (lightness - 0.0894841775 * aAxis - 1.291485548 * bAxis) ** 3
  const linear = {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
  return { r: clamp(toGamma(linear.r)), g: clamp(toGamma(linear.g)), b: clamp(toGamma(linear.b)) }
}

interface EffectivePalette {
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  secondary: string
  accent: string
  userMessageBubble: string
  card: string
  paper: string
  info: string
  success: string
  destructive: string
}

function effectiveTheme(theme: ThemeOverrides, dark: boolean): EffectivePalette {
  const merged = resolveTheme(theme)
  const colors = dark && merged.dark ? { ...merged, ...merged.dark } : merged
  const pick = (key: keyof EffectivePalette) => colors[key] ?? DEFAULT_THEME[key] ?? merged[key]!
  return {
    background: pick('background'),
    foreground: pick('foreground'),
    muted: pick('muted'),
    mutedForeground: pick('mutedForeground'),
    secondary: pick('secondary'),
    accent: pick('accent'),
    userMessageBubble: pick('userMessageBubble'),
    card: pick('card'),
    paper: pick('paper'),
    info: pick('info'),
    success: pick('success'),
    destructive: pick('destructive'),
  }
}

interface Sample {
  theme: string
  mode: 'light' | 'dark'
  pair: string
  foreground: string
  background: string
  ratio: number
  floor: number
}

/**
 * The pairs the product actually paints. Text pairs carry the 4.5:1 floor;
 * `focus-ring` is a non-text graphic (WCAG 1.4.11), so 3:1.
 */
function samplesFor(theme: string, mode: 'light' | 'dark', palette: EffectivePalette): Sample[] {
  const text = (pair: string, foreground: string, background: string): Sample => ({
    theme, mode, pair, foreground, background, ratio: contrastRatio(foreground, background), floor: TEXT_FLOOR,
  })
  const graphic = (pair: string, foreground: string, background: string): Sample => ({
    theme, mode, pair, foreground, background, ratio: contrastRatio(foreground, background), floor: GRAPHIC_FLOOR,
  })
  const semantic = defaultSemanticColors(mode === 'dark')
  return [
    text('foreground / background', palette.foreground, palette.background),
    text('foreground / muted', palette.foreground, palette.muted),
    text('foreground / card', palette.foreground, palette.card),
    text('foreground / user bubble', palette.foreground, palette.userMessageBubble),
    // --text-secondary and --text-tertiary both resolve to mutedForeground.
    text('text-secondary / background', palette.mutedForeground, palette.background),
    text('text-secondary / muted', palette.mutedForeground, palette.muted),
    text('text-secondary / secondary', palette.mutedForeground, palette.secondary),
    ...THEME_COLOR_POLICY.roles.flatMap(role => [
      text(`${role}-text / background`, semantic.tokens[`--${role}-text`]!, palette.background),
      text(`foreground on ${role}`, semantic.tokens[`--on-${role}`]!, palette[role]),
      { ...text(`${role}-text / worst surface and 20% wash`, semantic.tokens[`--${role}-text`]!, palette.background), background: 'shared surfaces', ratio: semantic.contrasts[role] },
      graphic(`${role} icon / background`, palette[role], palette.background),
      graphic(`${role} icon / muted`, palette[role], palette.muted),
    ]),
    // Status chips paint `bg-info/10` (and friends) under `text-info-text`; the
    // 10% wash moves the surface by well under a point, so the canvas pair is
    // the conservative bound.
    graphic('focus ring / background', palette.accent, palette.background),
    graphic('focus ring / muted', palette.accent, palette.muted),
  ]
}

const results: Sample[] = []
for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
  // A theme with one supported mode always renders in that mode, whatever the
  // user picks — Geek and Cyberpunk 2077 are dark-only, so `--on-accent` is
  // black there. Sampling them as "light" would report a pair the product never
  // paints, and hiding that behind a mode assumption is how a real failure gets
  // missed. `resolveThemeMode` is the runtime rule; use it here too.
  const seen = new Set<'light' | 'dark'>()
  for (const requested of ['light', 'dark'] as const) {
    const mode = resolveThemeMode(theme, requested)
    if (seen.has(mode)) continue
    seen.add(mode)
    results.push(...samplesFor(id, mode, effectiveTheme(theme, mode === 'dark')))
  }
}

const failures = results.filter(sample => sample.ratio + 1e-9 < sample.floor)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ passed: failures.length === 0, samples: results, failures }, null, 2))
} else {
  const worst = [...results].sort((a, b) => a.ratio - b.ratio).slice(0, 5)
  console.log(`${results.length} colour pairs across ${new Set(results.map(sample => sample.theme)).size} built-in themes.`)
  for (const sample of worst) {
    console.log(`  tightest: ${sample.theme} ${sample.mode} ${sample.pair} = ${sample.ratio.toFixed(2)}:1 (floor ${sample.floor})`)
  }
  for (const failure of failures) {
    console.log(`  FAIL: ${failure.theme} ${failure.mode} ${failure.pair} = ${failure.ratio.toFixed(2)}:1 < ${failure.floor}:1`)
  }
  console.log(`Contrast floor OK: no built-in pair below its WCAG threshold.`)
}
assert.equal(failures.length, 0, `${failures.length} built-in theme pair(s) below the contrast floor. `
  + 'Fix the palette (or the mix that derives the text variant); do not lower the floor.')
