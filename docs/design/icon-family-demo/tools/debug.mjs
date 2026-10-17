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
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
page.on('pageerror', (e) => console.log('PAGEERROR:\n' + (e.stack || e.message)))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR: ' + m.text()) })
await page.goto('file:///' + fileURLToPath(new URL('../index.html', import.meta.url)).replace(/\\/g, '/'))
await page.waitForTimeout(800)
const probe = await page.evaluate(() => {
  const ids = ['#hero-stats', '#family-cards', '#matrix-body', '#verify-grid', '#gallery-grid', '#app-frame', '#file-tree', '#type-body', '#spinner-compare', '#spinner-spec', '#recommend', '#plan-table', '#scope-grid', '#license-grid']
  const lines = ids.map((id) => {
    const el = document.querySelector(id)
    return `${id}: ${el ? el.innerHTML.length : 'MISSING'}`
  })
  const missing = [...document.querySelectorAll('.ic')].filter((el) => !el.querySelector('svg'))
  const titles = {}
  for (const el of missing) {
    const key = (el.getAttribute('title') || '(no title)')
    titles[key] = (titles[key] || 0) + 1
  }
  lines.push('--- missing icons (' + missing.length + ') ---')
  for (const [key, count] of Object.entries(titles).sort((a, b) => b[1] - a[1])) lines.push(`${count}  ${key}`)
  return lines
})
console.log(probe.join('\n'))
await browser.close()
