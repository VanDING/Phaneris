// Render self-check: section sizes, missing icons, draft behaviour.
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const local = process.env.LOCALAPPDATA || ''
const exe = [
  join(local, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  join(local, 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe'),
].find((p) => existsSync(p))
const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGEERROR:\n' + (e.stack || e.message)))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR: ' + m.text()) })
await page.goto('file:///' + fileURLToPath(new URL('../index.html', import.meta.url)).replace(/\\/g, '/'))
await page.waitForTimeout(800)

const probe = await page.evaluate(() => {
  const ids = ['#hero-stats', '#audit-stats', '#audit-conflicts', '#audit-alias', '#plan-body', '#app-current', '#app-next', '#file-tree', '#type-body', '#spinner-compare', '#spinner-spec', '#spinner-code', '#ship-stats', '#ship-scope', '#license-grid']
  const lines = ids.map((id) => {
    const el = document.querySelector(id)
    return `${id}: ${el ? el.innerHTML.length : 'MISSING'}`
  })
  const missing = [...document.querySelectorAll('.ic')].filter((el) => !el.querySelector('svg'))
  const titles = {}
  for (const el of missing) {
    const key = el.getAttribute('title') || '(no title)'
    const section = el.closest('.panel')?.id || '(no panel)'
    const context = (el.parentElement?.textContent || '').trim().slice(0, 60)
    titles[`${key}  @${section}  ctx="${context}"`] = (titles[`${key}  @${section}  ctx="${context}"`] || 0) + 1
  }
  lines.push('--- missing icons (' + missing.length + ') ---')
  for (const [key, count] of Object.entries(titles)) lines.push(`${count}  ${key}`)
  return lines
})
console.log(probe.join('\n'))

// Exercise the picker.
await page.click('.tab[data-panel="plan"]')
await page.waitForTimeout(300)
await page.click('button[data-pick="kanban"]')
await page.waitForTimeout(300)
console.log('picker open:', await page.evaluate(() => Boolean(document.querySelector('.picker'))))
await page.fill('.picker-search', 'columns')
await page.waitForTimeout(250)
const tiles = await page.$$('button[data-pick-icon]')
console.log('picker tiles after search:', tiles.length)
if (tiles.length) {
  await tiles[0].click()
  await page.waitForTimeout(300)
}
console.log('after pick:', await page.evaluate(() => ({
  draftVisible: !document.querySelector('#draft-bar').hidden,
  draftItems: document.querySelectorAll('.draft-item').length,
  firstRowRecommended: document.querySelector('#plan-body tr[data-purpose] .cell-icon .name')?.textContent,
})))
await browser.close()
