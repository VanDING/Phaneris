/** Theme authoring contract. CSS target properties are also runtime validators. */
export const THEME_TOKEN_MANIFEST = {
  background: { css: '--background', property: 'color' },
  foreground: { css: '--foreground', property: 'color' },
  accent: { css: '--accent', property: 'color' },
  info: { css: '--info', property: 'color' },
  success: { css: '--success', property: 'color' },
  destructive: { css: '--destructive', property: 'color' },
  backgroundElevated: { css: '--background-elevated', property: 'color' },
  foregroundDimmed: { css: '--foreground-dimmed', property: 'color' },
  secondary: { css: '--secondary', property: 'color' },
  secondaryForeground: { css: '--secondary-foreground', property: 'color' },
  muted: { css: '--muted', property: 'color' },
  mutedForeground: { css: '--muted-foreground', property: 'color' },
  card: { css: '--card', property: 'color' },
  cardForeground: { css: '--card-foreground', property: 'color' },
  popoverForeground: { css: '--popover-foreground', property: 'color' },
  border: { css: '--border', property: 'color' },
  ring: { css: '--ring', property: 'color' },
  userMessageBubble: { css: '--user-message-bubble', property: 'color' },
  paper: { css: '--paper', property: 'color' },
  navigator: { css: '--navigator', property: 'color' },
  input: { css: '--input', property: 'color' },
  popover: { css: '--popover', property: 'color' },
  popoverSolid: { css: '--popover-solid', property: 'color', opaque: true },
  depth: { css: '--theme-depth', property: null },
  shadowColor: { css: '--theme-shadow-color', property: 'color' },
  shadowStrength: { css: '--theme-shadow-strength', property: null },
  glassBlur: { css: '--theme-backdrop-blur', property: 'margin-left', minimum: 0 },
  radius: { css: '--theme-radius', property: 'border-radius', minimum: 0 },
  borderWidth: { css: '--theme-border-width', property: 'border-width', minimum: 0 },
  borderStyle: { css: '--theme-border-style', property: 'border-style' },
  fontSans: { css: '--font-sans', property: 'font-family' },
  fontSerif: { css: '--font-serif', property: 'font-family' },
  fontMono: { css: '--font-mono', property: 'font-family' },
  fontSize: { css: '--font-size-base', property: 'font-size', positive: true },
  lineHeight: { css: '--line-height-base', property: 'line-height', positive: true },
  letterSpacing: { css: '--tracking-normal', property: 'letter-spacing' },
  iconStrokeWidth: { css: '--icon-stroke-width', property: 'stroke-width', positive: true },
  iconStrokeLinecap: { css: '--icon-stroke-linecap', property: 'stroke-linecap' },
  density: { css: '--theme-density', property: null },
} as const

export interface ThemeDiagnostic {
  path: string
  code: 'structure' | 'css' | 'reference' | 'range' | 'opaque' | 'image' | 'contrast' | 'load'
  severity: 'error' | 'warning'
  message: string
}
