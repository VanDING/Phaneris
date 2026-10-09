/** Real browser visual checks. Run with a renderer dev server; writes JSON + PNGs. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = process.argv[2] ?? 'http://localhost:5199'
const out = resolve(root, 'docs/verification/results/ui-refinement')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_VERIFY_BROWSER_CHANNEL ?? 'msedge' })
const report = { date: new Date().toISOString(), browser: browser.version(), checks: [], screenshots: [] }
const themes = ['default', 'geek', 'cyberpunk-2077', 'ink']
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  localStorage.setItem('playground-selected-component', 'gantt-view')
  localStorage.setItem('playground-preview-size', JSON.stringify(
    window.innerWidth < 1200 ? { width: 920, height: 660 } : { width: 1400, height: 850 }
  ))
  localStorage.setItem('playground-variants-sidebar-open', 'false')
  localStorage.setItem('i18nextLng', 'en')
})

async function check(name, run) {
  const record = { name, status: 'pass' }
  try { record.observation = await run() } catch (error) { record.status = 'fail'; record.detail = error.message }
  report.checks.push(record)
  console.log(`${record.status.toUpperCase()} ${name}${record.detail ? `: ${record.detail}` : ''}`)
}
try {
  await page.goto(`${base}/playground.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('.phaneris-gantt .pg-bar').first().waitFor({ timeout: 120_000 })
  await check('four built-in themes are available through the renderer API', async () => {
    const names = await page.evaluate(async () => (await window.electronAPI.loadPresetThemes()).map(t => t.name))
    assert.deepEqual(names, ['Default', 'Geek', 'Cyberpunk 2077', 'Ink'])
    return names
  })
  for (const id of themes) {
    for (const mode of (id === 'geek' || id === 'cyberpunk-2077' ? ['dark'] : ['light', 'dark'])) {
      await check(`${id}/${mode}: quiet grid and visible progress`, async () => {
        // Switch using the actual control and ThemeProvider, including partial
        // theme inheritance, supported-mode resolution and the IPC loader.
        await page.locator('header [role="combobox"]').click()
        const name = { default: 'Default', geek: 'Geek', 'cyberpunk-2077': 'Cyberpunk 2077', ink: 'Ink' }[id]
        await page.getByRole('option', { name, exact: true }).click()
        await page.getByRole('button', { name: mode === 'dark' ? 'Dark' : 'Light', exact: true }).click()
        await page.waitForFunction(({ id, mode }) => document.documentElement.dataset.themeStatus === 'ready'
          && (document.documentElement.dataset.theme ?? 'default') === id
          && document.documentElement.classList.contains(mode), { id, mode })
        const observation = await page.evaluate(async () => {
          const dark = document.documentElement.classList.contains('dark')
          // The library rasterizes the timeline grid into a repeating data image.
          const grid = [...document.querySelectorAll('.phaneris-gantt .wx-area div')].find(el => getComputedStyle(el).backgroundImage.includes('data:image/'))
          if (!grid) throw new Error('Rendered timeline grid not found')
          const css = getComputedStyle(grid).backgroundImage
          const url = css.slice(5, -2)
          const image = new Image(); image.src = url; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
          const pixels = ctx.getImageData(0, Math.min(5, image.height - 1), image.width, 1).data
          const alpha = []
          for (let x = 3; x < pixels.length; x += 4) if (pixels[x]) alpha.push(pixels[x])
          const bar = document.querySelector('.pg-bar:not(.pg-bar--milestone)')
          const label = bar?.querySelector('.pg-bar-label')
          return {
            dark, gridSize: [image.width, image.height], gridMaxAlpha: Math.max(0, ...alpha),
            title: label?.textContent, labelColor: label && getComputedStyle(label).color,
            rowHeight: document.querySelector('.wx-table .wx-row')?.getBoundingClientRect().height,
            summaryProgress: document.querySelector('.pg-summary-progress')?.textContent,
            headerColor: getComputedStyle(document.querySelector('.wx-scale')).backgroundColor,
          }
        })
        assert.ok(observation.gridMaxAlpha > 0 && observation.gridMaxAlpha <= 64, `Grid must be subtle, observed alpha ${observation.gridMaxAlpha}/255`)
        assert.ok(observation.title && observation.labelColor)
        assert.match(observation.summaryProgress ?? '', /\d+%/)
        assert.ok(observation.rowHeight === 48, `Row geometry changed: ${observation.rowHeight}`)
        await page.screenshot({ path: resolve(out, `gantt-${id}-${mode}.png`), fullPage: true })
        report.screenshots.push(`gantt-${id}-${mode}.png`)
        return observation
      })
    }
  }
  await check('narrow Gantt keeps its task navigation and timeline visible', async () => {
    await page.setViewportSize({ width: 1100, height: 850 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.pg-bar').first().waitFor()
    const sizes = await page.evaluate(() => ({
      host: document.querySelector('.phaneris-gantt').getBoundingClientRect().width,
      table: document.querySelector('.phaneris-gantt .wx-table').getBoundingClientRect().width,
      chart: document.querySelector('.phaneris-gantt .wx-chart').getBoundingClientRect().width,
    }))
    assert.ok(sizes.table >= 280 && sizes.chart >= 200, JSON.stringify(sizes))
    await page.screenshot({ path: resolve(out, 'gantt-narrow.png'), fullPage: true })
    report.screenshots.push('gantt-narrow.png')
    return sizes
  })
} finally {
  await writeFile(resolve(out, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
}
process.exitCode = report.checks.some(c => c.status === 'fail') ? 1 : 0
