import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'

interface FrontendP2Options {
  browser: Browser
  url: string
  directory: string
  check: (id: string, execute: () => Promise<void>) => Promise<void>
  samples: unknown[]
}

/** Browser behavior checks, authored before the three production fixes. */
export async function verifyFrontendP2({ browser, url, directory, check, samples }: FrontendP2Options) {
  const errors: string[] = []
  const ready = async (page: Page) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator('[data-p2-ready][data-status="ready"]').waitFor()
  }
  const choose = async (page: Page, mode: 'light' | 'dark', borderWidth: number) => {
    const id = `p2-${mode}-${borderWidth}`
    await page.evaluate(({ id, mode, borderWidth }) => window.themeContract.choose(id, mode,
      { name: id, accent: '#5438bb', borderWidth: `${borderWidth}px` }), { id, mode, borderWidth })
    await page.waitForFunction(id => document.documentElement.dataset.theme === id && document.documentElement.dataset.themeStatus === 'ready', id)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  for (const dpr of [1, 2, 3]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1100, height: 700 },
      permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'no-preference' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await context.tracing.start({ screenshots: true, snapshots: true })
    try {
      await ready(page)
      for (const mode of ['light', 'dark'] as const) for (const borderWidth of [1, 2]) {
        await check(`P2-hairline-${dpr}x-${mode}-${borderWidth}px`, async () => {
          await choose(page, mode, borderWidth)
          const actual = await page.getByTestId('p2-hairline').evaluate(element => ({
            width: parseFloat(getComputedStyle(element).marginLeft), shadow: getComputedStyle(element).boxShadow,
            runtime: document.getElementById('craft-theme-overrides')?.textContent,
          }))
          samples.push({ id: 'P2-hairline', dpr, mode, borderWidth, ...actual })
          assert(actual.runtime?.includes('--edge-hairline'), 'ThemeProvider must apply the runtime declarations')
          assert(Math.abs(actual.width - borderWidth / dpr) < 0.0001, JSON.stringify(actual))
        })
      }
      if (dpr !== 1) continue
      await choose(page, 'light', 1)
      const copy = page.getByTestId('p2-copy').getByRole('button')
      for (const reduced of ['normal', 'os', 'app'] as const) {
        await check(`P2-copy-${reduced}`, async () => {
          await page.emulateMedia({ reducedMotion: reduced === 'os' ? 'reduce' : 'no-preference' })
          await page.evaluate(forced => { document.documentElement.dataset.reduceMotion = String(forced) }, reduced === 'app')
          await copy.click()
          await copy.locator('.lucide-check').waitFor()
          await page.waitForTimeout(80)
          const appearance = await copy.locator('svg').evaluate(element => ({ opacity: getComputedStyle(element).opacity, animation: getComputedStyle(element).animationName }))
          samples.push({ id: 'P2-copy', reduced, ...appearance })
          assert.equal(appearance.opacity, '1')
          if (reduced !== 'normal') assert.equal(appearance.animation, 'none')
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'P2 clipboard regression')
          await copy.locator('.lucide-copy').waitFor({ timeout: 4_000 })
        })
      }
      await check('P2-copy-toggle-and-repeat', async () => {
        await page.evaluate(() => { document.documentElement.dataset.reduceMotion = 'false' })
        await copy.click()
        await page.evaluate(() => { document.documentElement.dataset.reduceMotion = 'true' })
        await page.waitForTimeout(1_400)
        assert.equal(await copy.locator('.lucide-check').evaluate(element => getComputedStyle(element).opacity), '1')
        await copy.click()
        await page.waitForTimeout(1_400)
        assert.equal(await copy.locator('.lucide-check').evaluate(element => getComputedStyle(element).opacity), '1')
        await copy.locator('.lucide-copy').waitFor({ timeout: 2_000 })
      })
      const targets = [
        ['settings', '[data-testid="p2-settings"] [data-radix-scroll-area-viewport]', 28, 28],
        ['list', '[data-testid="p2-list"] [data-radix-scroll-area-viewport]', 16, 0],
        ['sidebar', '[data-testid="p2-sidebar"]', 0, 28],
      ] as const
      for (const reduced of [false, true]) {
        await page.evaluate(value => { document.documentElement.dataset.reduceMotion = String(value) }, reduced)
        for (const [id, selector, top, bottom] of targets) {
          await check(`P2-scroll-${id}-${reduced ? 'reduced' : 'normal'}`, async () => {
            const viewport = page.locator(selector)
            const sample = async (position: string) => {
              await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
              const value = await viewport.evaluate(element => {
                const css = getComputedStyle(element)
                return { top: parseFloat(css.getPropertyValue('--scroll-fade-top')), bottom: parseFloat(css.getPropertyValue('--scroll-fade-bottom')),
                  mask: css.maskImage, scrollTop: element.scrollTop, range: element.scrollHeight - element.clientHeight }
              })
              samples.push({ id: 'P2-scroll', target: id, reduced, position, ...value })
              assert.notEqual(value.mask, 'none', 'Mask must be on the actual scroller')
              return value
            }
            await viewport.evaluate(element => { element.scrollTop = 0 })
            const start = await sample('start'); assert.equal(start.top, 0); assert.equal(start.bottom, bottom)
            await viewport.hover(); await page.mouse.wheel(0, 100)
            await page.waitForFunction(selector => document.querySelector(selector)!.scrollTop >= 40, selector)
            const middle = await sample('middle'); assert.equal(middle.top, top); assert.equal(middle.bottom, bottom)
            await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
            const end = await sample('end'); assert.equal(end.top, top); assert.equal(end.bottom, 0)
          })
        }
        await page.getByTestId('p2-content').click()
        for (const [id, selector] of targets) {
          await check(`P2-short-${id}-${reduced ? 'reduced' : 'normal'}`, async () => {
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
            const value = await page.locator(selector).evaluate(element => ({ range: element.scrollHeight - element.clientHeight,
              top: getComputedStyle(element).getPropertyValue('--scroll-fade-top'), bottom: getComputedStyle(element).getPropertyValue('--scroll-fade-bottom') }))
            samples.push({ id: 'P2-short', target: id, reduced, ...value })
            assert.equal(value.range, 0); assert.equal(parseFloat(value.top), 0); assert.equal(parseFloat(value.bottom), 0)
          })
        }
        await page.getByTestId('p2-content').click()
      }
      await page.screenshot({ path: join(directory, 'p2-reduced-light.png') })
      await choose(page, 'dark', 1)
      await page.setViewportSize({ width: 390, height: 820 })
      await page.screenshot({ path: join(directory, 'p2-reduced-dark-390.png'), fullPage: true })
    } finally {
      await context.tracing.stop({ path: join(directory, `p2-${dpr}x-trace.zip`) })
      await context.close()
    }
  }
  await check('P2-page-errors', async () => assert.deepEqual(errors, []))
}
