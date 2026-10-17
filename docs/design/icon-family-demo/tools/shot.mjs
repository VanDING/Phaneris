// Render the demo in Chromium and capture verification screenshots.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = new URL('../verification/', import.meta.url)
await mkdir(OUT, { recursive: true })
const URL_BASE = 'file:///' + fileURLToPath(new URL('../index.html', import.meta.url)).replace(/\\/g, '/')

/** Prefer a local bundled Chromium; fall back to the installed Edge. */
function launchOptions() {
  const local = process.env.LOCALAPPDATA || ''
  const candidates = [
    join(local, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
    join(local, 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return { executablePath: candidate }
  return { channel: 'msedge' }
}

const browser = await chromium.launch(launchOptions())
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })

const problems = []
const shots = []
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`) })
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

async function step(label, fn) {
  try {
    await fn()
  } catch (error) {
    problems.push(`step "${label}": ${String(error.message).split('\n')[0]}`)
  }
}

async function shot(name, options = {}) {
  const file = fileURLToPath(new URL(`${name}.png`, OUT))
  await page.screenshot({ path: file, ...options })
  shots.push(name)
}

/** Element box in viewport coordinates, after scrolling it to the top. */
async function clipOf(selector, maxHeight = 2400) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'start', inline: 'start' }))
  await page.waitForTimeout(120)
  const bounds = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, viewport: window.innerHeight }
  })
  const height = Math.max(40, Math.min(bounds.height, maxHeight, bounds.viewport - Math.max(0, bounds.y) - 8))
  return {
    x: Math.max(0, Math.floor(bounds.x - 6)),
    y: Math.max(0, Math.floor(bounds.y)),
    width: Math.ceil(bounds.width + 12),
    height: Math.ceil(height),
  }
}

await page.goto(URL_BASE, { waitUntil: 'load' })
await page.waitForTimeout(700)

const tabs = ['overview', 'gallery', 'workspace', 'files', 'thinking', 'plan']
for (const tab of tabs) {
  await step(`tab ${tab}`, async () => {
    await page.click(`.tab[data-panel="${tab}"]`)
    await page.waitForTimeout(250)
    await shot(`tab-${tab}`, { fullPage: true })
  })
}

await step('family cards', async () => {
  await page.click('.tab[data-panel="overview"]')
  await page.waitForTimeout(200)
  await shot('detail-family-cards', { clip: await clipOf('#family-cards') })
})

await step('matrix slice', async () => {
  const clip = await clipOf('.table-scroll', 900)
  await shot('detail-matrix', { clip })
})

await step('verify grid', async () => {
  await shot('detail-verify', { clip: await clipOf('#verify-grid') })
})

await step('app frame', async () => {
  await page.click('.tab[data-panel="workspace"]')
  await page.waitForTimeout(250)
  await shot('detail-app-frame', { clip: await clipOf('#app-frame') })
})

await step('workbench family A', async () => {
  await page.click('#workbench-family button[data-family="a"]')
  await page.waitForTimeout(250)
  await shot('detail-workbench-a', { clip: await clipOf('#app-frame') })
})

await step('workbench family C', async () => {
  await page.click('#workbench-family button[data-family="c"]')
  await page.waitForTimeout(250)
  await shot('detail-workbench-c', { clip: await clipOf('#app-frame') })
})

await step('workbench back to B', async () => {
  await page.click('#workbench-family button[data-family="b"]')
})

await step('file layout', async () => {
  await page.click('.tab[data-panel="files"]')
  await page.waitForTimeout(300)
  await shot('detail-file-current', { clip: await clipOf('.file-layout') })
})

for (const theme of ['vscode', 'material']) {
  await step(`file theme ${theme}`, async () => {
    await page.click(`#file-theme button[data-theme="${theme}"]`)
    await page.waitForTimeout(250)
    await shot(`detail-file-${theme}`, { clip: await clipOf('.file-layout') })
  })
}

await step('file theme back', async () => {
  await page.click('#file-theme button[data-theme="current"]')
})

await step('spinner compare', async () => {
  await page.click('.tab[data-panel="thinking"]')
  await page.waitForTimeout(300)
  await shot('detail-spinner-compare', { clip: await clipOf('#spinner-compare') })
  await shot('detail-spinner-context', { clip: await clipOf('#spinner-context') })
})

await step('gallery detail', async () => {
  await page.click('.tab[data-panel="gallery"]')
  await page.waitForTimeout(300)
  await shot('detail-gallery', { clip: await clipOf('#gallery-grid', 1200) })
  await page.click('#gallery-family button[data-family="b"]')
  await page.waitForTimeout(250)
  await shot('detail-gallery-b', { clip: await clipOf('#gallery-grid', 1200) })
})

await step('dark mode shots', async () => {
  await page.click('#theme-toggle')
  await page.waitForTimeout(300)
  await page.click('.tab[data-panel="overview"]')
  await shot('dark-overview', { fullPage: true })
  await page.click('.tab[data-panel="workspace"]')
  await page.waitForTimeout(250)
  await shot('dark-app-frame', { clip: await clipOf('#app-frame') })
  await page.click('.tab[data-panel="files"]')
  await page.waitForTimeout(250)
  await shot('dark-file-vscode', { clip: await clipOf('.file-layout') })
  await page.click('.tab[data-panel="thinking"]')
  await page.waitForTimeout(250)
  await shot('dark-spinner-compare', { clip: await clipOf('#spinner-compare') })
})

await step('mobile shot', async () => {
  await page.setViewportSize({ width: 430, height: 920 })
  await page.waitForTimeout(350)
  await page.click('.tab[data-panel="workspace"]')
  await shot('mobile-workspace', { fullPage: true })
  await page.click('.tab[data-panel="files"]')
  await page.waitForTimeout(250)
  await shot('mobile-files', { fullPage: true })
})

const summary = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.tab')].length,
  matrixRows: document.querySelectorAll('#matrix-body tr').length,
  galleryTiles: document.querySelectorAll('#gallery-grid .icon-tile').length,
  fileRows: document.querySelectorAll('#file-tree .tree-row').length,
  typeRows: document.querySelectorAll('#type-body tr').length,
  missingIcons: [...document.querySelectorAll('.ic')].filter((el) => !el.querySelector('svg')).length,
  animatedIcons: document.querySelectorAll('.ic svg animate').length,
}))

const report = { url: URL_BASE, generatedAt: new Date().toISOString(), shots, summary, problems }
await writeFile(new URL('verification.json', OUT), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
