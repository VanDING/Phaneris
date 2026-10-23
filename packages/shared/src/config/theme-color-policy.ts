/** One color policy for generated Default CSS, browser compilation and contrast gates. */
export const THEME_COLOR_POLICY = {
  version: 2,
  textContrast: 4.5,
  graphicContrast: 3,
  statusWash: 0.20,
  roles: ['accent', 'info', 'success', 'destructive'],
  surfaces: ['background', 'paper', 'muted', 'card', 'input', 'popover-solid', 'secondary', 'user-message-bubble'],
} as const

export type SemanticRole = typeof THEME_COLOR_POLICY.roles[number]
/** sRGB channels in 0..255, optional alpha in 0..255. */
export type ThemeRGBA = readonly number[]
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
const gamma = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055

export function themeHexColor(value: string): ThemeRGBA {
  if (!/^#[a-f\d]{6}$/i.test(value)) throw new Error(`Default colors must use opaque six-digit hex: ${value}`)
  return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)).concat(255)
}
function opaque(top: ThemeRGBA, bottom: ThemeRGBA): number[] {
  const alpha = (top[3] ?? 255) / 255
  return [0, 1, 2].map(index => top[index]! * alpha + bottom[index]! * (1 - alpha)).concat(255)
}
export function themeContrast(first: ThemeRGBA, second: ThemeRGBA): number {
  const luminance = (rgb: ThemeRGBA) => [0, 1, 2].reduce((sum, index) => sum + linear(rgb[index]! / 255) * [.2126, .7152, .0722][index]!, 0)
  const a = luminance(opaque(first, second)), b = luminance(second)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
function lab(rgb: ThemeRGBA): number[] {
  const [r, g, b] = rgb.map(value => linear(value / 255)) as [number, number, number]
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s]
}
function mix(first: ThemeRGBA, second: ThemeRGBA, weight: number): number[] {
  if (weight === 1) return first.slice(0, 3).map(Math.round).concat(255)
  const a = lab(first), b = lab(second)
  const [L, A, B] = a.map((value, index) => value * weight + b[index]! * (1 - weight)) as [number, number, number]
  const l = (L + .3963377774 * A + .2158037573 * B) ** 3
  const m = (L - .1055613458 * A - .0638541728 * B) ** 3
  const s = (L - .0894841775 * A - 1.291485548 * B) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(value => Math.round(clamp(gamma(value)) * 255)).concat(255)
}
const hex = (rgb: ThemeRGBA) => '#' + rgb.slice(0, 3).map(value => Math.round(value).toString(16).padStart(2, '0')).join('')

export function deriveThemeSemanticColors(input: {
  foreground: ThemeRGBA
  background: ThemeRGBA
  surfaces: ThemeRGBA[]
  colors: Record<SemanticRole, ThemeRGBA>
}): { tokens: Record<string, string>; contrasts: Record<SemanticRole, number> } {
  const tokens: Record<string, string> = {}, contrasts = {} as Record<SemanticRole, number>
  const surfaces = input.surfaces.map(surface => opaque(surface, input.background))
  for (const role of THEME_COLOR_POLICY.roles) {
    const raw = input.colors[role], color = opaque(raw, input.background)
    // Chips use a translucent wash of the same status, over any shared surface.
    const targets = surfaces.flatMap(surface => [surface, opaque([...raw.slice(0, 3), (raw[3] ?? 255) * THEME_COLOR_POLICY.statusWash], surface)])
    const ratio = (candidate: ThemeRGBA) => Math.min(...targets.map(surface => themeContrast(candidate, surface)))
    let candidate = color, bestRatio = ratio(candidate)
    // Preserve a readable authored color verbatim. Search in 1% steps only
    // when necessary; quantize before testing the actual value we will publish.
    for (let weight = 99; bestRatio < THEME_COLOR_POLICY.textContrast && weight >= 0; weight--) {
      const next = mix(color, input.foreground, weight / 100), nextRatio = ratio(next)
      if (nextRatio > bestRatio) { candidate = next; bestRatio = nextRatio }
    }
    tokens[`--${role}-text`] = hex(candidate)
    contrasts[role] = bestRatio
    const black = [0, 0, 0, 255], white = [255, 255, 255, 255]
    tokens[`--on-${role}`] = themeContrast(black, color) > themeContrast(white, color) ? '#000000' : '#FFFFFF'
  }
  return { tokens, contrasts }
}
