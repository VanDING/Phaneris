/**
 * DW2 — frontend design wave 2 (metric convergence, status tokens, icon weight).
 *
 * Wave 2 replaced three parallel systems with one each. A static gate cannot
 * see any of them, because they are all resolved by the cascade:
 *
 *   - Tailwind's rem type scale now aliases the contract tiers, so a leftover
 *     `text-sm` must paint exactly what `text-body` paints;
 *   - control geometry is `tier × --ui-scale`, so raising the scale must move
 *     buttons, inputs and type together and leave the reading column alone;
 *   - icon stroke comes from `--icon-stroke-width` for Lucide *and* for
 *     hand-written `stroke="currentColor"` glyphs;
 *   - status colours resolve from the theme, not from palette hues.
 *
 * Untested here: non-Default palettes in a browser (covered by
 * `check:contrast-floor`), native materials, scenic mode, physical touch.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('design-w2', async run => {
  const root = resolve(import.meta.dir, '../..')
  const fixture = join(root, 'scripts/verification/fixtures/design-w2.tsx')
  const checks: { id: string; passed: boolean; error?: string }[] = []
  const samples: unknown[] = []
  const errors: string[] = []
  const sources = [
    'packages/ui/src/styles/theme-adapter.css',
    'packages/ui/src/styles/roles.css',
    'packages/ui/src/styles/theme-tokens.css',
    'apps/electron/src/renderer/components/ui/button.tsx',
    'apps/electron/src/renderer/components/ui/input.tsx',
    'packages/ui/src/components/icons/FileKindIcon.tsx',
    'scripts/verification/fixtures/design-w2.tsx',
    'scripts/verification/design-w2-workflow.ts',
  ]
  run.json('source-hashes.json', Object.fromEntries(
    sources.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]),
  ))

  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`
  writeFileSync(join(run.directory, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="icon" href="data:,"></head><body><div id="root"></div>'
    + '<script type="module" src="/scripts/verification/fixtures/design-w2.tsx"></script></body></html>')
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
  // page error, and filtering it by name keeps the strict assertion honest: any
  // other console error still fails the scene.
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

  const measure = () => page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1)
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
    type Rgba = { r: number; g: number; b: number; a: number }
    const ratio = (a: Rgba, b: Rgba) => {
      const first = luminance(a), second = luminance(b)
      const [light, dark] = first >= second ? [first, second] : [second, first]
      return (light + 0.05) / (dark + 0.05)
    }
    /**
     * Composite every translucent layer down to the first opaque one. A chip
     * painted `bg-success/10` is not "10% success as a surface"; it is 10%
     * success over the canvas, and only the composite has a contrast ratio.
     */
    const effectiveBackground = (element: Element | null): Rgba => {
      const layers: Rgba[] = []
      let node: Element | null = element
      while (node) {
        const color = rgba(getComputedStyle(node).backgroundColor)
        if (color.a > 0) {
          layers.push(color)
          if (color.a >= 0.999) break
        }
        node = node.parentElement
      }
      let base: Rgba = layers.length && layers[layers.length - 1]!.a >= 0.999
        ? layers.pop()!
        : { r: 255, g: 255, b: 255, a: 1 }
      for (const layer of layers.reverse()) {
        base = {
          r: layer.r * layer.a + base.r * (1 - layer.a),
          g: layer.g * layer.a + base.g * (1 - layer.a),
          b: layer.b * layer.a + base.b * (1 - layer.a),
          a: 1,
        }
      }
      return base
    }
    const probe = (name: string) => document.querySelector<HTMLElement>(`[data-probe="${name}"]`)!
    const fontSize = (name: string) => parseFloat(getComputedStyle(probe(name)).fontSize)
    const box = (name: string) => {
      const { width, height } = probe(name).getBoundingClientRect()
      return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 }
    }
    const chip = (name: string) => {
      const element = probe(name)
      const style = getComputedStyle(element)
      const background = effectiveBackground(element)
      const color = rgba(style.color)
      return {
        color: style.color,
        background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
        ratio: ratio({ ...color, a: 1 }, background),
      }
    }
    const root = getComputedStyle(document.documentElement)
    return {
      uiScale: root.getPropertyValue('--ui-scale').trim(),
      iconStrokeToken: root.getPropertyValue('--icon-stroke-width').trim(),
      type: {
        meta: fontSize('type-meta'),
        body: fontSize('type-body'),
        defaultSm: fontSize('type-default-sm'),
        reading: fontSize('type-reading'),
      },
      geometry: { button: box('button'), input: box('input'), iconButton: box('icon-button') },
      iconStroke: {
        lucide: parseFloat(getComputedStyle(probe('icon-lucide')).strokeWidth),
        inline: parseFloat(getComputedStyle(probe('icon-inline')).strokeWidth),
      },
      chips: { success: chip('chip-success'), info: chip('chip-info'), danger: chip('chip-danger') },
      solidAccent: chip('solid-accent'),
    }
  })

  async function setScale(scale: number) {
    await page.evaluate(value => window.designW2.setUiScale(value), scale)
    await settle()
  }

  try {
    await gotoWithRetry(page, url)
    await page.locator('[data-probe="canvas"]').waitFor()
    await page.waitForFunction(() => window.designW2?.ready === true)
    await page.evaluate(() => document.fonts.ready)

    await check('DW2-type-scale-aliases-contract-tiers', async () => {
      const value = await measure()
      samples.push({ id: 'DW2-type-scale', scale: value.uiScale, ...value.type })
      assert.equal(value.type.meta, 11, `text-meta must paint 11px, got ${value.type.meta}`)
      assert.equal(value.type.body, 13, `text-body must paint 13px, got ${value.type.body}`)
      assert.equal(value.type.defaultSm, value.type.body,
        `A leftover text-sm must alias text-body; got ${value.type.defaultSm}px vs ${value.type.body}px. The adapter mapping is not applied.`)
      assert(Math.abs(value.type.reading - 14) < 0.2, `text-reading must paint 14px, got ${value.type.reading}`)
    })

    await check('DW2-control-geometry-uses-tiers', async () => {
      const value = await measure()
      samples.push({ id: 'DW2-geometry', scale: value.uiScale, ...value.geometry })
      // Button default = h-control-lg (34), Input = h-control-lg (34).
      assert.equal(value.geometry.button.height, 34, `Button must be 34px tall, got ${value.geometry.button.height}`)
      assert.equal(value.geometry.input.height, 34, `Input must be 34px tall, got ${value.geometry.input.height}`)
      assert.equal(value.geometry.iconButton.width, 34, `Icon button must be 34px wide, got ${value.geometry.iconButton.width}`)
    })

    await check('DW2-icon-stroke-from-one-token', async () => {
      const value = await measure()
      samples.push({ id: 'DW2-icon-stroke', ...value.iconStroke, token: value.iconStrokeToken })
      const token = Number.parseFloat(value.iconStrokeToken)
      assert.equal(value.iconStroke.lucide, token,
        `Lucide stroke ${value.iconStroke.lucide} must equal --icon-stroke-width ${value.iconStrokeToken}`)
      assert.equal(value.iconStroke.inline, token,
        `A hand-written stroke="currentColor" glyph paints ${value.iconStroke.inline}, not the token ${value.iconStrokeToken}`)
    })

    await check('DW2-status-tokens-clear-aa', async () => {
      const value = await measure()
      samples.push({ id: 'DW2-status', ...value.chips, solidAccent: value.solidAccent })
      for (const [name, chip] of Object.entries(value.chips)) {
        assert(chip.ratio >= 4.5, `The ${name} chip text is ${chip.ratio.toFixed(2)}:1 on its own surface`)
      }
      assert(value.solidAccent.ratio >= 4.5, `text-on-accent on bg-accent is ${value.solidAccent.ratio.toFixed(2)}:1`)
    })

    await page.screenshot({ path: join(run.directory, 'design-w2-scale-100.png') })

    for (const scale of [1.1, 1.25]) {
      await check(`DW2-ui-scale-${Math.round(scale * 100)}-moves-controls-and-type`, async () => {
        await setScale(scale)
        const value = await measure()
        samples.push({ id: 'DW2-ui-scale', scale, ...value.geometry, type: value.type })
        assert.equal(Number(value.uiScale), scale, `--ui-scale did not take effect (${value.uiScale})`)
        assert(Math.abs(value.geometry.button.height - 34 * scale) < 0.6,
          `Button height ${value.geometry.button.height} should follow 34 × ${scale} = ${34 * scale}`)
        assert(Math.abs(value.geometry.input.height - 34 * scale) < 0.6,
          `Input height ${value.geometry.input.height} should follow 34 × ${scale}`)
        assert(Math.abs(value.type.meta - 11 * scale) < 0.2,
          `text-meta ${value.type.meta} should follow 11 × ${scale} = ${(11 * scale).toFixed(2)}`)
        assert(Math.abs(value.type.reading - 14) < 0.2,
          `The reading tier must not follow --ui-scale (got ${value.type.reading}px at scale ${scale})`)
      })
      await page.screenshot({ path: join(run.directory, `design-w2-scale-${Math.round(scale * 100)}.png`) })
    }

    await check('DW2-no-page-errors', async () => assert.deepEqual(errors, []))
  } finally {
    run.json('design-w2.json', {
      checks, samples, errors,
      browser: launched.browser.version(),
      scope: 'Real Button/Input + real host stylesheet; Default palette, light mode, interface scale 100/110/125%, '
        + 'synthetic surrounding page, desktop Chromium.',
    })
    await context.close(); await server.close(); await launched.close()
  }

  run.complete(
    checks.filter(value => value.passed).map(value => value.id),
    ['Non-Default palettes in a browser (covered statically by check:contrast-floor)', 'Native OS materials and window chrome',
      'Scenic (background-image) mode', 'Physical touch devices', 'Persisted preference round-trip across an app restart'],
  )
  assert(checks.every(value => value.passed), JSON.stringify(checks.filter(value => !value.passed), null, 2))
})
