/** Focused regression against production Run components and synthetic evidence.
 * Start Vite, then: node scripts/test-execution-map-browser.mjs http://127.0.0.1:5191/playground.html
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:5191/playground.html'
const output = process.argv[3] ?? '.cache/map-audit'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
const checks = []
const check = (value, label) => { assert(value, label); checks.push(label) }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('playground-selected-component', 'execution-map')
    localStorage.setItem('playground-preview-size', JSON.stringify({ width: 1100, height: 800 }))
    localStorage.setItem('playground-variants-sidebar-open', 'false')
    localStorage.setItem('craft.trajectory.view', 'map')
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const sample = page.getByTestId('execution-map-sample')
  const map = sample.getByRole('tabpanel', { name: 'Map', exact: true })
  await map.locator('[data-kind="behavior"]').first().waitFor({ timeout: 60_000 })
  check(await map.locator('[data-kind="behavior"]').count() === 6, 'Overview groups behavior across turns')
  check(await map.locator('[data-kind="turn"]').count() === 0, 'Turns do not form the layout spine')
  check(await map.locator('[data-kind="tool"]').count() === 0, 'Overview starts aggregated')
  const delegate = map.locator('[data-kind="behavior"]').filter({ hasText: 'Delegate & background' })
  check((await delegate.innerText()).includes('Errors: 1'), 'Folded branch retains failure evidence')
  await map.getByRole('combobox').nth(1).selectOption('tokens')
  check((await map.locator('[data-kind="session"]').first().innerText()).includes('3,500'), 'Model tokens count once, including cached input')
  await map.getByRole('combobox').nth(1).selectOption('duration')
  await sample.screenshot({ path: `${output}/behavior-overview.png` })
  await delegate.locator(':scope > button').first().click()
  const inspector = map.locator('aside')
  await inspector.getByRole('button', { name: /^Task/ }).click()
  await inspector.getByRole('button', { name: /^Test/ }).click()
  check(await map.locator('[data-kind="tool"]').count() >= 2, 'Inspector navigation reveals the actual nested tool subtree')
  const canvas = map.locator('[data-animated][data-compact]')
  const transform = await canvas.evaluate(element => element.style.transform)
  await inspector.getByRole('button', { name: 'View in Trajectory', exact: true }).click()
  await sample.getByRole('tab', { name: 'Trajectory', exact: true }).waitFor()
  check(await sample.getByRole('tab', { name: 'Trajectory', exact: true }).getAttribute('aria-selected') === 'true', 'Evidence action switches to Trajectory')
  const selected = sample.locator('tr[aria-selected="true"]')
  await selected.waitFor()
  check((await selected.innerText()).includes('Test'), 'Correct tool record is revealed and selected in the ledger')
  await sample.getByRole('tab', { name: 'Map', exact: true }).click()
  await canvas.waitFor()
  check(await canvas.evaluate(element => element.style.transform) === transform, 'Returning from Trajectory preserves the map camera')
  check(await map.locator('[data-kind="tool"]').count() >= 2, 'Returning preserves expanded subtrees')
  await page.keyboard.press('Escape')
  await inspector.waitFor({ state: 'hidden' })
  await map.getByLabel('Filter by turn', { exact: true }).selectOption('1')
  check(await map.locator('[data-kind="behavior"]').count() === 2, 'Turn filter limits evidence without restoring a chronological layout')
  await map.getByLabel('Filter by turn', { exact: true }).selectOption('all')
  await map.getByRole('button', { name: 'Fit map', exact: true }).click()
  await sample.screenshot({ path: `${output}/behavior-expanded.png` })
  await sample.evaluate(element => { element.style.width = '430px'; element.style.height = '650px' })
  await map.getByRole('button', { name: 'Execution details', exact: true }).click()
  await inspector.waitFor()
  const bounds = await inspector.boundingBox(), mapBounds = await map.boundingBox()
  check(bounds.width <= mapBounds.width && bounds.x >= mapBounds.x - 1, 'Narrow inspector stays within the map panel')
  check(await map.locator('[inert]').count() === 1, 'Covered canvas is inert in narrow inspection mode')
  await sample.screenshot({ path: `${output}/behavior-narrow.png` })
  await page.keyboard.press('Escape')
  await inspector.waitFor({ state: 'hidden' })
  check(await map.locator('[inert]').count() === 0, 'Closing restores canvas interaction')
  check(await map.locator('button button').count() === 0, 'Controls contain no nested buttons')
  check(errors.length === 0, `No browser runtime errors: ${errors.join('; ')}`)
  await writeFile(`${output}/browser-checks.json`, JSON.stringify({ browser: browser.version(), checks }, null, 2))
  console.log(`${checks.length} browser checks passed`)
} finally {
  await browser.close()
}
