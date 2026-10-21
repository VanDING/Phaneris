/**
 * DW1 — frontend design wave 1 (focus, contrast, motion vocabulary).
 *
 * The 2026-10-20 design review found three properties that the static gates
 * could not prove because they depend on how the browser composes a colour:
 *
 *   - a composite search field whose only keyboard cue was a 1.01:1 background
 *     swap, produced by `focus-visible:ring-0` + `outline-none`;
 *   - 234 translucent text sites that composited to 2.40–4.24:1 on the canvas;
 *   - three `animate-*` utilities declared by motion.css with no consumer.
 *
 * This workflow renders the real `SessionSearchHeader` and the real stylesheet
 * and measures the *rendered* result: the outline that actually paints, the
 * colour that actually composites over the surface behind the text, and the
 * keyframes the document actually declares.
 *
 * Untested here (recorded in the manifest): native OS materials, scenic
 * backgrounds, physical touch, and the packaged installer.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('design-w1', async run => {
  const root = resolve(import.meta.dir, '../..')
  const fixture = join(root, 'scripts/verification/fixtures/design-w1.tsx')
  const checks: { id: string; passed: boolean; error?: string }[] = []
  const samples: unknown[] = []
  const errors: string[] = []
  const sources = [
    'apps/electron/src/renderer/components/app-shell/SessionSearchHeader.tsx',
    'packages/ui/src/styles/controls.css',
    'packages/ui/src/styles/motion.css',
    'packages/ui/src/styles/role-tokens.css',
    'packages/ui/src/styles/theme-tokens.css',
    'scripts/verification/fixtures/design-w1.tsx',
    'scripts/verification/design-w1-workflow.ts',
  ]
  run.json('source-hashes.json', Object.fromEntries(
    sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]),
  ))

  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="icon" href="data:,"></head><body><div id="root"></div>'
    + '<script type="module" src="/scripts/verification/fixtures/design-w1.tsx"></script></body></html>')
  writeFileSync(join(run.directory, 'host.css'),
    `@import "${relative(run.directory, join(root, 'apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";\n`
    + `@source "${fixture.replaceAll('\\', '/')}";\n`)

  const launched = await launchWorkflowBrowser()
  const server = await createServer({
    configFile: join(root, 'apps/electron/vite.config.ts'),
    root,
    optimizeDeps: {
      entries: [fixture],
      include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      exclude: ['pdfjs-dist/build/pdf.worker.min.mjs?url'],
    },
    // `.cache` and `dist` hold other workflows' artifacts (packaged app copies,
    // bundles). Watching them makes Vite reload the fixture mid-check, which
    // silently invalidates a measurement.
    server: {
      host: '127.0.0.1', port: 0, open: false,
      watch: { ignored: ['**/runtimes/**', '**/.cache/**', '**/dist/**', `${run.directory}/**`] },
    },
  })
  await server.listen()
  const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`
  const url = `${base}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/host.css`)}`

  const context = await launched.browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: 'light' })
  const page = await context.newPage()
  // Vite's dev server re-optimizes on the first request and asks the page to
  // reload ("504 Outdated Optimize Dep"). That is a build-server artifact, not a
  // page error; filtering it by name keeps the assertion strict for everything
  // else.
  const isDevServerNoise = (text: string) => /Outdated Optimize Dep|optimized dependencies changed/i.test(text)
  page.on('pageerror', error => { if (!isDevServerNoise(error.message)) errors.push(error.message) })
  page.on('console', message => {
    if (message.type() === 'error' && !isDevServerNoise(message.text())) errors.push(message.text())
  })

  async function check(id: string, execute: () => Promise<void>) {
    try { await execute(); checks.push({ id, passed: true }) } catch (error) { checks.push({ id, passed: false, error: String(error) }) }
  }
  const settle = () => page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

  /**
   * In-page measurement. Canvas normalisation is the only way to turn every
   * syntax the theme contract allows (`oklch()`, `color(srgb …)`, `rgb()`) into
   * comparable sRGB bytes, and the effective background has to be walked up the
   * tree because most surfaces are transparent.
   */
  const measure = () => page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r: r!, g: g!, b: b!, a: a! / 255 }
    }
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const scaled = value / 255
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const ratio = (a: string, b: string) => {
      const first = luminance(rgba(a)), second = luminance(rgba(b))
      const [light, dark] = first >= second ? [first, second] : [second, first]
      return (light + 0.05) / (dark + 0.05)
    }
    const effectiveBackground = (element: Element | null) => {
      let node: Element | null = element
      while (node) {
        const color = getComputedStyle(node).backgroundColor
        if (rgba(color).a > 0) return color
        node = node.parentElement
      }
      return getComputedStyle(document.body).backgroundColor
    }
    const probe = (name: string) => {
      const element = document.querySelector<HTMLElement>(`[data-probe="${name}"]`)
      if (!element) throw new Error(`missing probe ${name}`)
      const style = getComputedStyle(element)
      const background = effectiveBackground(element)
      return { color: style.color, background, alpha: rgba(style.color).a, ratio: ratio(style.color, background) }
    }
    const placeholderElement = document.querySelector<HTMLElement>('[data-probe="placeholder"]')!
    const placeholderStyle = getComputedStyle(placeholderElement, '::placeholder')
    const placeholderBackground = effectiveBackground(placeholderElement)
    const shell = document.querySelector<HTMLElement>('[data-probe="header"] .craft-field-shell')!
    const shellStyle = getComputedStyle(shell)
    const shellBackground = effectiveBackground(shell)
    const close = document.querySelector<HTMLElement>('[data-probe="header"] button')!
    const closeStyle = getComputedStyle(close)
    const closeBackground = effectiveBackground(close)
    // The `craft-focus` role removes the outline and composes a three-layer
    // box-shadow ring instead, so the contrast has to come from the shadow's own
    // colours rather than from outlineColor (which stays at its initial value).
    const ringRatio = (shadow: string, background: string) => {
      const colors = shadow.match(/rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)/g) ?? []
      return colors.reduce((best, color) => Math.max(best, ratio(color, background)), 0)
    }
    // Every element that carries a `text-*` class must paint an opaque colour:
    // an alpha text token recomposites against whatever is behind it. Disabled
    // copy is the single documented exemption (WCAG 1.4.3), so it opts out.
    const translucent = [...document.querySelectorAll<HTMLElement>('[class*="text-"]')]
      .filter(element => !element.closest('[data-exempt="disabled"]'))
      .filter(element => rgba(getComputedStyle(element).color).a < 0.999)
      .map(element => `${element.className}`)
    const rules: string[] = []
    for (const sheet of [...document.styleSheets]) {
      try { for (const rule of [...sheet.cssRules]) rules.push(rule.cssText) } catch { /* cross-origin */ }
    }
    const declares = (name: string) => rules.some(rule => rule.includes(name))
    return {
      canvas: { background: effectiveBackground(document.querySelector('[data-probe="canvas"]')) },
      text: {
        'secondary-on-canvas': probe('secondary-on-canvas'),
        'secondary-on-muted': probe('secondary-on-muted'),
        'micro-on-muted': probe('micro-on-muted'),
        'status-on-canvas': probe('status-on-canvas'),
        'disabled-on-canvas': probe('disabled-on-canvas'),
      },
      placeholder: {
        color: placeholderStyle.color,
        alpha: rgba(placeholderStyle.color).a,
        ratio: ratio(placeholderStyle.color, placeholderBackground),
      },
      shell: {
        outlineStyle: shellStyle.outlineStyle,
        outlineWidth: shellStyle.outlineWidth,
        outlineColor: shellStyle.outlineColor,
        outlineRatio: ratio(shellStyle.outlineColor, shellBackground),
        background: shellBackground,
      },
      close: {
        boxShadow: closeStyle.boxShadow,
        ringRatio: ringRatio(closeStyle.boxShadow, closeBackground),
        outlineStyle: closeStyle.outlineStyle,
        outlineWidth: closeStyle.outlineWidth,
        outlineColor: closeStyle.outlineColor,
        outlineRatio: ratio(closeStyle.outlineColor, closeBackground),
      },
      toggle: {
        on: probe('toggle-on-icon'),
        off: probe('toggle-off-icon'),
      },
      translucent,
      motion: {
        removedStillDeclared: ['animate-message-enter', 'animate-skeleton-sweep', 'animate-thinking-dot']
          .filter(name => declares(name)),
        decayDeclared: declares('animate-check-decay'),
        bubbleDeclared: declares('animate-bubble-enter'),
        declaredClasses: rules
          .flatMap(rule => [...rule.matchAll(/\.(animate-[a-z0-9-]+)/g)].map(match => match[1]!))
          .filter((name, index, all) => all.indexOf(name) === index)
          .sort(),
      },
      decayAnimation: getComputedStyle(document.querySelector('[data-probe="motion-decay"]')!).animationName,
    }
  })

  async function setMode(dark: boolean) {
    await page.evaluate(value => (window as unknown as { designW1: { setDark: (dark: boolean) => void } }).designW1.setDark(value), dark)
    await settle()
  }

  const searchInput = () => page.locator('[data-probe="header"] input')

  try {
    await gotoWithRetry(page, url)
    await page.locator('[data-probe="canvas"]').waitFor()
    await page.waitForFunction(() => (window as unknown as { designW1?: { ready?: boolean } }).designW1?.ready === true)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => document.documentElement.dataset.reduceMotion = 'false')

    for (const mode of ['light', 'dark'] as const) {
      await setMode(mode === 'dark')

      await check(`DW1-focus-ring-${mode}`, async () => {
        await searchInput().focus()
        await settle()
        const value = await measure()
        samples.push({ id: 'DW1-focus-ring', mode, ...value.shell })
        assert.equal(value.shell.outlineStyle, 'solid', `Expected a solid outline on the field shell, got ${value.shell.outlineStyle}`)
        assert.equal(value.shell.outlineWidth, '2px', `Expected a 2px outline, got ${value.shell.outlineWidth}`)
        assert(value.shell.outlineRatio >= 3, `Focus ring is only ${value.shell.outlineRatio.toFixed(2)}:1 against the field surface`)
        await page.screenshot({ path: join(run.directory, `design-w1-${mode}-focus.png`) })
      })

      await check(`DW1-close-button-keyboard-and-pointer-${mode}`, async () => {
        await searchInput().focus()
        await page.keyboard.press('Tab')
        await settle()
        const focused = await measure()
        samples.push({ id: 'DW1-close-button', mode, phase: 'keyboard', ...focused.close })
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BUTTON', 'Tab from the input must land on the close button')
        assert(focused.close.boxShadow !== 'none' || focused.close.outlineStyle !== 'none',
          'The close button shows no keyboard focus cue')
        const cue = focused.close.outlineStyle === 'none' ? focused.close.ringRatio : focused.close.outlineRatio
        assert(cue >= 3, `Close-button focus cue is ${cue.toFixed(2)}:1 against the surface behind it`)

        // Pointer focus must not paint the keyboard ring.
        await page.mouse.click(5, 880)
        await searchInput().focus()
        await page.locator('[data-probe="header"] button').click()
        await settle()
        const clicked = await measure()
        samples.push({ id: 'DW1-close-button', mode, phase: 'pointer', ...clicked.close })
        assert(clicked.close.boxShadow === 'none', `A pointer click must not paint the keyboard ring (got ${clicked.close.boxShadow})`)
      })

      await check(`DW1-text-contrast-${mode}`, async () => {
        const value = await measure()
        samples.push({ id: 'DW1-text-contrast', mode, ...value.text, placeholder: value.placeholder })
        for (const [name, sample] of Object.entries(value.text)) {
          // Disabled copy is the only pair allowed below the floor (WCAG 1.4.3).
          if (name === 'disabled-on-canvas') continue
          assert(sample.ratio >= 4.5, `${name} composites to ${sample.ratio.toFixed(2)}:1, below the 4.5:1 text floor`)
          assert.equal(sample.alpha, 1, `${name} is translucent (alpha ${sample.alpha}); text must be an opaque token`)
        }
        assert(value.placeholder.alpha === 1, `Placeholder text is translucent (alpha ${value.placeholder.alpha})`)
        assert(value.placeholder.ratio >= 4.5, `Placeholder composites to ${value.placeholder.ratio.toFixed(2)}:1`)
      })

      await check(`DW1-no-translucent-text-${mode}`, async () => {
        const value = await measure()
        samples.push({ id: 'DW1-no-translucent-text', mode, offenders: value.translucent })
        assert.deepEqual(value.translucent, [], 'Text colours with alpha are still shipping')
      })

      await check(`DW1-toggle-states-distinguishable-${mode}`, async () => {
        const value = await measure()
        samples.push({ id: 'DW1-toggle-states', mode, ...value.toggle })
        assert(value.toggle.off.ratio >= 4.5, `The "off" state is ${value.toggle.off.ratio.toFixed(2)}:1, below the text floor`)
        assert(value.toggle.on.ratio >= value.toggle.off.ratio + 1,
          `"on" (${value.toggle.on.ratio.toFixed(2)}:1) and "off" (${value.toggle.off.ratio.toFixed(2)}:1) are too close to read as states`)
      })

      await check(`DW1-motion-vocabulary-${mode}`, async () => {
        const value = await measure()
        samples.push({ id: 'DW1-motion-vocabulary', mode, ...value.motion, decayAnimation: value.decayAnimation })
        assert.deepEqual(value.motion.removedStillDeclared, [],
          `Retired animation utilities are still declared: ${value.motion.removedStillDeclared.join(', ')}`)
        assert(value.motion.decayDeclared, 'animate-check-decay must still be declared (it has a consumer)')
        assert.equal(value.decayAnimation, 'craft-check-decay', `Expected the decay entrance to run, got ${value.decayAnimation}`)
      })

      await page.screenshot({ path: join(run.directory, `design-w1-${mode}.png`), fullPage: false })
    }

    // Reduced motion: the surviving entrance collapses to no animation at all.
    const reduced = await launched.browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: 'reduce' })
    const reducedPage = await reduced.newPage()
    try {
      await gotoWithRetry(reducedPage, url)
      await reducedPage.locator('[data-probe="canvas"]').waitFor()
      await reducedPage.waitForFunction(() => (window as unknown as { designW1?: { ready?: boolean } }).designW1?.ready === true)
      await check('DW1-reduced-motion-collapses-entrance', async () => {
        const animation = await reducedPage.evaluate(() =>
          getComputedStyle(document.querySelector('[data-probe="motion-decay"]')!).animationName)
        samples.push({ id: 'DW1-reduced-motion', animation })
        assert.equal(animation, 'none', `Reduced motion must not run the entrance (got ${animation})`)
        await reducedPage.screenshot({ path: join(run.directory, 'design-w1-reduced-motion.png') })
      })
    } finally { await reduced.close() }

    await check('DW1-no-page-errors', async () => assert.deepEqual(errors, []))
  } finally {
    run.json('design-w1.json', {
      checks, samples, errors,
      browser: launched.browser.version(),
      scope: 'Real SessionSearchHeader + real host stylesheet; synthetic surrounding page, desktop Chromium, '
        + 'light and dark Default palettes, keyboard and pointer focus, reduced-motion media emulation.',
    })
    await context.close(); await server.close(); await launched.close()
  }

  run.complete(
    checks.filter(value => value.passed).map(value => value.id),
    ['Native OS materials and window chrome', 'Scenic (background-image) mode contrast', 'Physical touch devices',
      'Packaged/signed installer visual identity', 'Non-Default built-in palettes in a real browser (covered statically by check:contrast-floor)'],
  )
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})
