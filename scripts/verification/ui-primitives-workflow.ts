/**
 * W0 · computed-style contract for the control primitives.
 *
 * The 2026-10-21 audit's root cause was a merge-layer mismatch: every class
 * string looked right in source, and the browser painted something else. A
 * static scan cannot catch that, so this workflow boots the real host stylesheet
 * and asserts the *computed* font size, colour and height of Button / Badge /
 * MetadataBadge across both modes and three shell widths.
 *
 * Asserted invariants (DESIGN.md → Typography, Layout, Interaction States):
 *   - every control paints its contract tier (10/11/12/13/16/20px), never the
 *     15px root that a dropped tier falls back to;
 *   - `height === min-height` for every Button size, and it equals the tier
 *     (18/22/26/30/34/38px) — xs/compact used to resolve to 34px;
 *   - a filled small button's label keeps ≥4.5:1 against its own fill; before
 *     the fix the label colour was eaten and inherited the fill colour (1:1).
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser } from './workflow-browser'

/** Contract pixel values at `--ui-scale: 1` and a 15px root. */
const TIER_PX = { micro: 10, meta: 11, label: 12, body: 13, reading: 14, title: 16, display: 20 } as const
const CONTROL_PX: Record<string, number> = { '22': 22, '26': 26, '30': 30, '34': 34, '38': 38 }
const VIEWPORTS = [1280, 1536, 1920] as const
const MODES = ['light', 'dark'] as const
const TEXT_FLOOR = 4.5
/** Sub-pixel tolerance: tiers are rem-derived (0.733333rem × 15px = 11.000px). */
const EPSILON = 0.6

interface Measurement {
  case: string
  tier: string | null
  control: string | null
  fontSize: number
  lineHeight: number
  color: string
  background: string
  height: number
  minHeight: number
  minWidth: number
  width: number
  /** WCAG ratio for a solid foreground/background pair, null when either is translucent. */
  contrast: number | null
  tag: string
}

await verificationWorkflow('ui-primitives', async run => {
  const root = resolve(import.meta.dir, '../..')
  const fixture = join(root, 'scripts/verification/fixtures/ui-primitives.tsx')
  const prefix = `/${relative(root, run.directory).replaceAll('\\', '/')}`

  writeFileSync(join(run.directory, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="icon" href="data:,"></head><body><div id="root"></div>'
    + '<script type="module" src="/scripts/verification/fixtures/ui-primitives.tsx"></script></body></html>')
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
    },
    server: {
      host: '127.0.0.1', port: 0, open: false,
      watch: { ignored: ['**/runtimes/**', '**/.cache/**', '**/dist/**', `${run.directory}/**`] },
    },
  })
  await server.listen()
  const port = (server.httpServer!.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}${prefix}/index.html?css=${encodeURIComponent(`${prefix}/host.css`)}&still=1`

  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
  const page = await context.newPage()
  const errors: string[] = []
  const isDevServerNoise = (text: string) => /Outdated Optimize Dep|optimized dependencies changed/i.test(text)
  page.on('pageerror', error => { if (!isDevServerNoise(error.message)) errors.push(error.message) })
  page.on('console', message => {
    if (message.type() === 'error' && !isDevServerNoise(message.text())) errors.push(message.text())
  })

  const scenes: string[] = []
  const measurements: Array<Measurement & { mode: string; viewport: number }> = []

  /** Read every `[data-case]` back as computed style, with canvas-normalised colours. */
  const measure = () => page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context2d = canvas.getContext('2d')!
    const rgba = (value: string): [number, number, number, number] | null => {
      if (!value || value === 'transparent') return null
      context2d.clearRect(0, 0, 1, 1)
      context2d.fillStyle = '#000'
      context2d.fillStyle = value
      context2d.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context2d.getImageData(0, 0, 1, 1).data
      return [r!, g!, b!, a! / 255]
    }
    const luminance = ([r, g, b]: [number, number, number, number]) => {
      const channel = (value: number) => {
        const c = value / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    return [...document.querySelectorAll<HTMLElement>('[data-case]')].map(element => {
      const style = getComputedStyle(element)
      const foreground = rgba(style.color)
      const background = rgba(style.backgroundColor)
      const solid = foreground && background && foreground[3] === 1 && background[3] === 1
      const ratio = solid
        ? (() => {
          const a = luminance(foreground!)
          const b = luminance(background!)
          const [light, dark] = a >= b ? [a, b] : [b, a]
          return (light + 0.05) / (dark + 0.05)
        })()
        : null
      return {
        case: element.dataset.case ?? '',
        tier: element.dataset.tier ?? null,
        control: element.dataset.control ?? null,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        color: style.color,
        background: style.backgroundColor,
        height: element.getBoundingClientRect().height,
        minHeight: Number.parseFloat(style.minHeight) || 0,
        minWidth: Number.parseFloat(style.minWidth),
        width: element.getBoundingClientRect().width,
        contrast: ratio,
        tag: element.tagName.toLowerCase(),
      }
    })
  })

  async function check(id: string, execute: () => Promise<void>) {
    try { await execute(); scenes.push(id) } catch (error) {
      throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    await gotoWithRetry(page, url)
    await page.waitForFunction(() => window.__uiPrimitives?.ready === true, undefined, { timeout: 60_000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    for (const mode of MODES) {
      for (const viewport of VIEWPORTS) {
        await check(`ui-primitives-${mode}-${viewport}`, async () => {
          await page.setViewportSize({ width: viewport, height: 900 })
          await page.evaluate(isDark => {
            document.documentElement.classList.toggle('dark', isDark)
            document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
          }, mode === 'dark')
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))

          const rows = await measure() as Measurement[]
          assert(rows.length >= 13, `expected the full primitive matrix, measured ${rows.length} cases`)
          for (const row of rows) measurements.push({ ...row, mode, viewport })

          for (const row of rows) {
            if (row.tier) {
              const expected = TIER_PX[row.tier as keyof typeof TIER_PX]
              assert(expected !== undefined, `${row.case}: unknown tier ${row.tier}`)
              assert(Math.abs(row.fontSize - expected) <= EPSILON,
                `${row.case}: paints ${row.fontSize}px, contract tier ${row.tier} is ${expected}px`)
            }
            if (row.control && row.control !== 'auto') {
              const expected = CONTROL_PX[row.control]
              assert(expected !== undefined, `${row.case}: unknown control tier ${row.control}`)
              assert(Math.abs(row.height - expected) <= EPSILON,
                `${row.case}: height ${row.height}px, contract control ${row.control} is ${expected}px`)
              if (row.tag === 'button' && row.minHeight > 0) {
                assert(Math.abs(row.minHeight - expected) <= EPSILON,
                  `${row.case}: min-height ${row.minHeight}px disagrees with its ${expected}px tier (a fallback min-height is overriding the variant)`)
              }
            }
          }

          for (const id of ['button-sm-filled', 'button-xs-destructive']) {
            const row = rows.find(candidate => candidate.case === id)!
            assert(row.contrast !== null, `${id}: label/background pair is not solid, cannot assert contrast`)
            assert(row.contrast! >= TEXT_FLOOR,
              `${id}: label contrast ${row.contrast!.toFixed(2)}:1 is below ${TEXT_FLOOR}:1 (${row.color} on ${row.background})`)
          }

          // The merge-layer probes: tier AND colour must both survive `cn()`.
          const metaProbe = rows.find(candidate => candidate.case === 'probe-meta-foreground')!
          const microProbe = rows.find(candidate => candidate.case === 'probe-micro-info')!
          assert(Math.abs(metaProbe.fontSize - TIER_PX.meta) <= EPSILON, 'probe-meta-foreground lost its tier')
          assert(Math.abs(microProbe.fontSize - TIER_PX.micro) <= EPSILON, 'probe-micro-info lost its tier')
          assert(microProbe.color !== metaProbe.color,
            `info-text probe did not resolve a distinct status colour (both ${microProbe.color})`)
        })
      }
    }

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await page.screenshot({ path: join(run.directory, 'ui-primitives-light.png'), fullPage: true })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await page.screenshot({ path: join(run.directory, 'ui-primitives-dark.png'), fullPage: true })

    run.json('ui-primitives.json', {
      generatedAt: new Date().toISOString(),
      tiers: TIER_PX,
      controls: CONTROL_PX,
      scenes,
      measurements,
    })
    assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`)
    run.complete(scenes)
  } finally {
    await context.close().catch(() => undefined)
    await launched.close()
    await server.close()
  }
})
