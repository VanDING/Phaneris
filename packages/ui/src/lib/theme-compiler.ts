/** Browser compiler. It validates without changing the active document theme. */
import { PresetThemeSchema } from '@phaneris/shared/config/schemas'
import { THEME_TOKEN_MANIFEST, type ThemeDiagnostic } from '@phaneris/shared/config/theme-manifest'
import { resolveTheme, themeDerivedCSS, themeToCSS, type ThemeFile } from '@phaneris/shared/config/theme'
import { ThemeCompilationError, themeCSSDeclarations, type CompiledTheme } from '@phaneris/shared/config/theme-runtime'

type VisualMode = 'light' | 'dark'

/** Native CSS parses values; this resolver only makes var dependencies explicit.
 * Nested fallbacks are respected and cycles never fall back to registered initials. */
function resolveReferences(value: string, variables: Record<string, string>, chain: string[] = []): string {
  const nextReference = (text: string) => {
    let quote = ''
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!
      if (char === '\\') { index++; continue }
      if (quote) { if (char === quote) quote = ''; continue }
      if (char === '"' || char === "'") quote = char
      else if (text.slice(index, index + 4).toLowerCase() === 'var(') return index
    }
    return -1
  }
  let result = value
  for (let start = nextReference(result); start !== -1; start = nextReference(result)) {
    let depth = 1, end = start + 4, comma = -1, quote = ''
    for (; end < result.length && depth; end++) {
      const char = result[end]!
      if (quote) { if (char === quote && result[end - 1] !== '\\') quote = ''; continue }
      if (char === '"' || char === "'") quote = char
      else if (char === '(') depth++
      else if (char === ')') depth--
      else if (char === ',' && depth === 1 && comma === -1) comma = end
    }
    if (depth) throw new Error('Unclosed var() reference')
    const identifier = result.slice(start + 4, comma === -1 ? end - 1 : comma).trim()
    if (!CSS.supports('color', `var(${identifier}, black)`)) throw new Error(`Invalid variable name ${identifier}`)
    const name = identifier.replace(/\\([\da-f]{1,6}\s?|.)/gi, (_match, escape: string) => /^[\da-f]+\s?$/i.test(escape)
      ? String.fromCodePoint(parseInt(escape.trim(), 16)) : escape)
    if (chain.includes(name)) throw new Error(`Cyclic variable reference: ${[...chain, name].join(' → ')}`)
    const source = variables[name] ?? (comma === -1 ? undefined : result.slice(comma + 1, end - 1))
    if (source === undefined) throw new Error(`Unresolved variable ${name}; supply a fallback`)
    result = result.slice(0, start) + resolveReferences(source, variables, variables[name] === undefined ? chain : [...chain, name]) + result.slice(end)
    if (result.length > 256 * 1024) throw new Error('Expanded variable value exceeds 256 KiB')
  }
  return result
}
function luminance(rgb: readonly number[]) {
  return rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0)
}
function contrast(a: readonly number[], b: readonly number[]) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}

async function decodeScenicImage(source: string, signal?: AbortSignal): Promise<void> {
  if (!/^(?:https?:|data:image\/(?:png|jpeg|webp|gif|avif);base64,)/i.test(source)) throw new Error('Scenic image was not resolved to a supported image URL')
  if (source.length > 28 * 1024 * 1024) throw new Error('Scenic image exceeds the 20 MiB decoded file limit')
  await new Promise<void>((resolve, reject) => {
    const image = new Image()
    const finish = (error?: Error) => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); image.onload = image.onerror = null
      if (error) { image.src = ''; reject(error) } else resolve()
    }
    const cancel = () => finish(new DOMException('Theme load cancelled', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('Scenic image did not load within 8 seconds')), 8000)
    image.onload = () => { if (image.naturalWidth > 0 && image.naturalHeight > 0) finish(); else finish(new Error('Scenic image has no decoded pixels')) }
    image.onerror = () => finish(new Error('Scenic image could not be decoded'))
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    image.src = source
  })
}

export async function compileThemeInBrowser(theme: ThemeFile, signal?: AbortSignal, assetRevision = ''): Promise<CompiledTheme> {
  // Storage has already bounded/rewritten local images; runtime data URLs may be
  // longer than the authoring path limit. Validate every other field unchanged.
  const parsed = PresetThemeSchema.safeParse({ ...theme, backgroundImage: theme.backgroundImage ? 'resolved-image' : undefined })
  if (!parsed.success) throw new ThemeCompilationError(parsed.error.issues.map(issue => ({ path: issue.path.join('.'),
    code: 'structure', severity: 'error', message: issue.message })))
  const diagnostics: ThemeDiagnostic[] = []
  const resolved = resolveTheme(theme)
  const css = {} as Record<VisualMode, string>, tokens = {} as Record<VisualMode, Readonly<Record<string, string>>>
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:256px;height:256px;font-size:15px;visibility:hidden;contain:strict'
  // Reduced-motion CSS gives every element a 1ms transition duration. A value
  // probe must measure the final value rather than an inherited animated color.
  probe.style.setProperty('transition', 'none', 'important')
  probe.style.setProperty('animation', 'none', 'important')
  probe.style.setProperty('forced-color-adjust', 'none', 'important')
  document.body.append(probe)
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')!
  const rgba = (value: string) => {
    probe.style.color = value
    const color = getComputedStyle(probe).color
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  }
  const alpha = (value: string) => {
    // Computed rgba() and 8-bit canvas alpha may round .999 to 1. Extract
    // alpha into an opaque floating-point color channel before reading it.
    const extraction = `color(from ${value} srgb alpha 0 0 / 1)`
    probe.style.color = CSS.supports('color', extraction) ? extraction : value
    const color = getComputedStyle(probe).color
    const extracted = color.match(/^color\(srgb\s+([.\de+-]+)\s+0\s+0\)$/i)
    if (extracted) return Number(extracted[1])
    const modern = color.match(/\/\s*([.\de+-]+)(%)?\s*\)$/i), legacy = color.match(/^rgba\(.*,[ \t]*([.\de+-]+)\)$/i)
    return modern ? Number(modern[1]) / (modern[2] ? 100 : 1) : legacy ? Number(legacy[1]) : 1
  }
  try {
    for (const mode of ['light', 'dark'] as const) {
      const effective = mode === 'dark' ? { ...resolved, ...resolved.dark } : resolved
      const authored = themeCSSDeclarations(themeDerivedCSS(mode === 'dark') + '\n' + themeToCSS(resolved, mode === 'dark'))
      // Typography's shared CJK aliases are the only external authoring input.
      authored['--font-cjk'] = getComputedStyle(document.documentElement).getPropertyValue('--font-cjk').trim()
      const values: Record<string, string> = {}
      for (const [key, descriptor] of Object.entries(THEME_TOKEN_MANIFEST)) {
        const raw = effective[key as keyof typeof effective]
        if (raw === undefined || descriptor.property === null) continue
        const path = `${mode}.${key}`
        let value: string
        try { value = resolveReferences(String(raw), authored) }
        catch (error) { diagnostics.push({ path, code: 'reference', severity: 'error', message: String(error) }); continue }
        if (!CSS.supports(descriptor.property, value)) {
          diagnostics.push({ path, code: 'css', severity: 'error', message: `Unsupported ${descriptor.property} value: ${value}` }); continue
        }
        probe.style.setProperty(descriptor.property, value)
        const computed = getComputedStyle(probe).getPropertyValue(descriptor.property)
        if ('minimum' in descriptor) {
          // Margin allows negative values, so calc(-6px) cannot be silently
          // clamped by border-radius/border-width's non-negative grammar.
          probe.style.marginLeft = value
          const amount = parseFloat(getComputedStyle(probe).marginLeft)
          if (!Number.isFinite(amount) || amount < descriptor.minimum) diagnostics.push({ path, code: 'range', severity: 'error', message: 'Computed length must be non-negative' })
          probe.style.marginLeft = '0px'
        }
        if ('positive' in descriptor && computed !== 'normal' && !(parseFloat(computed) > 0)) diagnostics.push({ path, code: 'range', severity: 'error', message: 'Computed value must be positive' })
        if ('opaque' in descriptor && alpha(value) !== 1) diagnostics.push({ path, code: 'opaque', severity: 'error', message: 'popoverSolid must be fully opaque' })
        values[descriptor.css] = value
        probe.style.removeProperty(descriptor.property)
      }
      // Text/solid/on-solid duties are separate. Keep authors' raw colors;
      // move text toward their foreground only as far as contrast requires.
      if (!diagnostics.some(value => value.severity === 'error')) {
        const background = rgba(values['--background']!), foreground = values['--foreground']!
        const surfaces = ['--background', '--paper', '--muted', '--card', '--input', '--popover-solid'].map(name => rgba(values[name] ?? values['--background']!))
        for (const key of ['accent', 'info', 'success', 'destructive']) {
          let candidate = ''
          for (let mix = 50; mix >= 0; mix -= 5) {
            candidate = `color-mix(in oklab, ${values[`--${key}`]} ${mix}%, ${foreground})`
            if (surfaces.every(surface => contrast(rgba(candidate), surface) >= 4.5)) break
          }
          authored[`--${key}-text`] = candidate
        }
        const accent = rgba(values['--accent']!), accentOpaque = accent.slice(0, 3).map((value, i) => value * accent[3]! / 255 + background[i]! * (1 - accent[3]! / 255))
        authored['--on-accent'] = contrast([0, 0, 0], accentOpaque) > contrast([255, 255, 255], accentOpaque) ? '#000000' : '#FFFFFF'
        // Non-blocking author feedback: the derived `--*-text` tokens are moved
        // until they pass, but the *authored* dim-ink tokens are the author's
        // choice. A user theme that ships 3:1 secondary text looks fine to the
        // person who wrote it and unreadable to everyone else, so name the pair
        // and the ratio instead of silently accepting it.
        const dimPairs: [string, string | undefined, string][] = [
          ['foreground', foreground, '--background'],
          ['foreground', foreground, '--muted'],
          ['mutedForeground', values['--muted-foreground'], '--background'],
          ['mutedForeground', values['--muted-foreground'], '--muted'],
          ['mutedForeground', values['--muted-foreground'], '--card'],
          ['foregroundDimmed', values['--foreground-dimmed'], '--background'],
        ]
        for (const [label, foregroundValue, surfaceName] of dimPairs) {
          const surface = values[surfaceName]
          if (!foregroundValue || !surface) continue
          const pairRatio = contrast(rgba(foregroundValue), rgba(surface))
          if (pairRatio >= 4.5) continue
          const path = `${mode}.${label} on ${surfaceName.replace(/^--/, '')}`
          if (diagnostics.some(value => value.path === path)) continue
          diagnostics.push({ path, code: 'contrast', severity: 'warning', message: `Contrast ${pairRatio.toFixed(2)}:1 is below 4.5:1` })
        }
      }
      delete authored['--font-cjk']
      // Preserve the authored color space while guaranteeing alpha=1 even if a
      // browser serializes an extremely near-opaque alpha as a rounded integer.
      if (values['--popover-solid']) authored['--popover-solid'] = `oklch(from ${values['--popover-solid']} l c h / 1)`
      css[mode] = Object.entries(authored).map(([name, value]) => `${name.replaceAll('.', '\\.')} : ${value};`).join('\n  ')
      tokens[mode] = Object.freeze({ ...authored })
    }
  } finally { probe.remove() }
  if (diagnostics.some(value => value.severity === 'error')) throw new ThemeCompilationError(Object.freeze(diagnostics))
  if (theme.mode === 'scenic') {
    try { await decodeScenicImage(theme.backgroundImage!, signal) }
    catch (error) {
      if (signal?.aborted) throw error
      throw new ThemeCompilationError([{ path: 'backgroundImage', code: 'image', severity: 'error', message: String(error) }])
    }
  }
  const revisionInput = assetRevision && theme.backgroundImage?.startsWith('data:')
    ? { ...theme, backgroundImage: `asset:${assetRevision}` } : theme
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([revisionInput, assetRevision])))
  const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return Object.freeze({ revision, css: Object.freeze(css), tokens: Object.freeze(tokens), diagnostics: Object.freeze(diagnostics.map(value => Object.freeze(value))) })
}
