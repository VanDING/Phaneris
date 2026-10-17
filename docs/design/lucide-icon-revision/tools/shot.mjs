// Render the revision demo in Chromium, exercise the picker, capture screenshots.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = new URL('../verification/', import.meta.url)
await mkdir(OUT, { recursive: true })
const URL_BASE = 'file:///' + fileURLToPath(new URL('../index.html', import.meta.url)).replace(/\\/g, '/')

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
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })

const problems = []
const shots = []
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`) })
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

async function step(label, fn) {
  try { await fn() } catch (error) { problems.push(`step "${label}": ${String(error.message).split('\n')[0]}`) }
}

async function shot(name, options = {}) {
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)), ...options })
  shots.push(name)
}

async function clipOf(selector, maxHeight = 2200) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'start', inline: 'start' }))
  await page.waitForTimeout(120)
  const bounds = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, viewport: window.innerHeight }
  })
  const height = Math.max(40, Math.min(bounds.height, maxHeight, bounds.viewport - Math.max(0, bounds.y) - 8))
  return { x: Math.max(0, Math.floor(bounds.x - 6)), y: Math.max(0, Math.floor(bounds.y)), width: Math.ceil(bounds.width + 12), height: Math.ceil(height) }
}

await page.goto(URL_BASE, { waitUntil: 'load' })
await page.waitForTimeout(700)

for (const tab of ['audit', 'plan', 'workspace', 'files', 'thinking', 'ship']) {
  await step(`tab ${tab}`, async () => {
    await page.click(`.tab[data-panel="${tab}"]`)
    await page.waitForTimeout(250)
    await shot(`tab-${tab}`, { fullPage: true })
  })
}

await step('audit details', async () => {
  await page.click('.tab[data-panel="audit"]')
  await page.waitForTimeout(200)
  await shot('detail-audit-stats', { clip: await clipOf('#audit-stats') })
  await shot('detail-audit-verdicts', { clip: await clipOf('#audit-verdicts', 1200) })
  await shot('detail-audit-alias', { clip: await clipOf('#audit-alias', 800) })
})

await step('plan head', async () => {
  await page.click('.tab[data-panel="plan"]')
  await page.waitForTimeout(250)
  await shot('detail-plan-head', { clip: await clipOf('.plan-matrix', 1100) })
})

await step('plan filter redundant', async () => {
  await page.selectOption('#plan-verdict', 'redundant')
  await page.waitForTimeout(250)
  await shot('detail-plan-redundant', { clip: await clipOf('.plan-matrix', 900) })
  await page.selectOption('#plan-verdict', 'all')
})

await step('plan filter change', async () => {
  await page.selectOption('#plan-action', 'change')
  await page.waitForTimeout(250)
  await shot('detail-plan-changed', { clip: await clipOf('.plan-matrix', 1100) })
  await page.selectOption('#plan-action', 'all')
})

await step('picker open', async () => {
  await page.click('button[data-pick="kanban"]')
  await page.waitForTimeout(250)
  await shot('detail-picker', { clip: await clipOf('.picker') })
})

await step('picker pick', async () => {
  await page.fill('.picker-search', 'columns')
  await page.waitForTimeout(200)
  await page.click('button[data-pick-icon="columns-3"]')
  await page.waitForTimeout(250)
  await shot('detail-picker-after', { clip: await clipOf('#draft-bar') })
})

await step('workspace compare', async () => {
  await page.click('.tab[data-panel="workspace"]')
  await page.waitForTimeout(300)
  await shot('detail-compare-apps', { clip: await clipOf('.compare-apps') })
})

await step('workspace compare 18px', async () => {
  await page.selectOption('#workbench-size', '18')
  await page.waitForTimeout(300)
  await shot('detail-compare-18', { clip: await clipOf('.compare-apps') })
  await page.selectOption('#workbench-size', '16')
})

await step('file themes', async () => {
  await page.click('.tab[data-panel="files"]')
  await page.waitForTimeout(300)
  await shot('detail-file-current', { clip: await clipOf('.file-layout') })
  await page.click('#file-theme button[data-theme="vscode"]')
  await page.waitForTimeout(300)
  await shot('detail-file-vscode', { clip: await clipOf('.file-layout') })
})

await step('thinking', async () => {
  await page.click('.tab[data-panel="thinking"]')
  await page.waitForTimeout(300)
  await shot('detail-spinner-compare', { clip: await clipOf('#spinner-compare') })
  await shot('detail-spinner-context', { clip: await clipOf('#spinner-context') })
})

await step('ship', async () => {
  await page.click('.tab[data-panel="ship"]')
  await page.waitForTimeout(300)
  await shot('detail-ship-stats', { clip: await clipOf('#ship-stats') })
  await shot('detail-ship-code', { clip: await clipOf('#ship-code', 900) })
})

await step('dark mode', async () => {
  await page.click('#theme-toggle')
  await page.waitForTimeout(300)
  await page.click('.tab[data-panel="plan"]')
  await page.waitForTimeout(250)
  await shot('dark-plan', { clip: await clipOf('.plan-matrix', 1100) })
  await page.click('.tab[data-panel="workspace"]')
  await page.waitForTimeout(250)
  await shot('dark-compare-apps', { clip: await clipOf('.compare-apps') })
})

await step('mobile', async () => {
  await page.setViewportSize({ width: 430, height: 920 })
  await page.waitForTimeout(350)
  await page.click('.tab[data-panel="audit"]')
  await shot('mobile-audit', { fullPage: true })
})

const summary = await page.evaluate(() => ({
  tabs: document.querySelectorAll('.tab').length,
  auditVerdictRows: document.querySelectorAll('#audit-verdicts tr').length,
  aliasRows: document.querySelectorAll('#audit-alias tr').length,
  planRows: document.querySelectorAll('#plan-body tr[data-purpose]').length,
  planIcons: document.querySelectorAll('#plan-body .glyph-chip').length,
  typeRows: document.querySelectorAll('#type-body tr').length,
  fileRows: document.querySelectorAll('#file-tree .tree-row').length,
  missingIcons: [...document.querySelectorAll('.ic')].filter((el) => !el.querySelector('svg')).length,
  animatedIcons: document.querySelectorAll('.ic svg animate').length,
  draftVisible: !document.querySelector('#draft-bar').hidden,
  draftItems: document.querySelectorAll('.draft-item').length,
  docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}))

const report = { url: URL_BASE, generatedAt: new Date().toISOString(), shots, summary, problems }
await writeFile(new URL('verification.json', OUT), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
