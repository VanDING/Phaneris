const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { chromium } = require('playwright')
const sharp = require('sharp')
const { serveRendererFixture } = require('./serve-renderer-fixture.cjs')

const root = resolve(__dirname, '../../..')
const output = join(root, '.cache', 'verification', 'resource-icons', new Date().toISOString().replaceAll(':', '-'))
const config = join(output, 'config')
mkdirSync(config, { recursive: true })
const fixture = join(__dirname, 'resource-icons.tsx')

async function main() {
  const backend = spawn('bun', [join(__dirname, 'resource-icons-server.ts')], {
    cwd: root,
    env: { ...process.env, PHANERIS_CONFIG_DIR: config },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let browser
  let vite
  try {
    const port = await new Promise((resolve, reject) => {
      let log = ''
      const timeout = setTimeout(() => reject(new Error('Fixture RPC startup timed out: ' + log)), 30000)
      backend.stderr.on('data', chunk => { log += chunk.toString() })
      backend.once('error', error => { clearTimeout(timeout); reject(error) })
      backend.once('exit', code => { clearTimeout(timeout); reject(new Error('Fixture RPC exited: ' + code + ' ' + log)) })
      backend.stdout.on('data', chunk => {
        log += chunk.toString()
        const match = log.match(/RESOURCE_ICONS_PORT=(\d+)/)
        if (match) { clearTimeout(timeout); resolve(match[1]) }
      })
    })
    const request = (channel, args) => fetch('http://127.0.0.1:' + port, { method: 'POST', body: JSON.stringify({ channel, args }) })
    await assert.rejects(async () => {
      const response = await request('resources:setIcon', ['resource-icons-fixture', '../outside', { kind: 'preset', name: 'book-open' }])
      if (!response.ok) throw Error((await response.json()).error)
    }, /Invalid RPC arguments/)
    vite = await serveRendererFixture(root, output, fixture)
    browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL })
    const page = await browser.newPage({ viewport: { width: 1050, height: 720 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/_resource_icons', async route => {
      const response = await fetch('http://127.0.0.1:' + port, { method: 'POST', body: route.request().postData() })
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    })
    const { url } = vite
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    const nav = page.getByRole('region', { name: 'Navigator' })
    const detail = page.getByRole('region', { name: 'Details' })
    const picker = page.getByRole('dialog', { name: 'Change icon' })
    const glyph = area => area.locator('.resource-icon-list:not(.invisible) svg, .resource-icon-detail svg').first()
    async function size(locator, expected) {
      await locator.waitFor()
      const { width, height } = await locator.boundingBox()
      assert.ok(Math.abs(width - expected) < 0.1 && Math.abs(height - expected) < 0.1, JSON.stringify({ width, height, expected }))
    }
    async function open(area) {
      await area.getByRole('button', { name: 'Change icon', exact: true }).click()
      await picker.getByRole('button', { name: 'Apply', exact: true }).waitFor()
    }
    const checks = []
    for (const group of ['Sources', 'Plugins', 'Skills']) {
      await page.getByRole('button', { name: group, exact: true }).click()
      if (group === 'Plugins') await nav.locator('.resource-icon-list circle').waitFor()
      await size(glyph(nav), 16)
      await size(glyph(detail), 48)
      await open(group === 'Skills' ? nav : detail)
      await picker.getByRole('button', { name: 'Reading', exact: true }).click()
      await size(picker.locator('.resource-icon-list svg'), 16)
      await size(picker.locator('.resource-icon-detail svg'), 48)
      assert.equal(await detail.locator('.lucide-book-open').count(), 0)
      if (group === 'Skills') await page.screenshot({ path: join(output, 'icon-picker.png') })
      await picker.getByRole('button', { name: 'Apply', exact: true }).click()
      await picker.waitFor({ state: 'hidden' })
      await size(nav.locator('.resource-icon-list .lucide-book-open'), 16)
      await size(detail.locator('.resource-icon-detail .lucide-book-open'), 48)
      checks.push(group + ' list and details use independent sizes and update together')
    }
    await open(detail)
    await picker.getByRole('button', { name: 'Analysis', exact: true }).click()
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await size(detail.locator('.lucide-book-open'), 48)
    await page.reload({ waitUntil: 'networkidle' })
    await size(detail.locator('.lucide-book-open'), 48)
    await open(detail)
    await picker.getByRole('button', { name: 'Upload image', exact: true }).click()
    const file = picker.locator('input[type=file]')
    await file.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('bad') })
    await picker.getByRole('alert').waitFor()
    const buffer = await sharp({ create: { width: 220, height: 80, channels: 4, background: '#7851a9' } }).png().toBuffer()
    await file.setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer })
    await size(picker.locator('.resource-icon-detail img'), 48)
    await picker.getByRole('button', { name: 'Apply', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
    await size(nav.locator('.resource-icon-list img'), 16)
    await size(detail.locator('.resource-icon-detail img'), 48)
    await detail.locator('img').evaluate(node => node.decode())
    const image = await detail.locator('img').evaluate(node => ({ fit: getComputedStyle(node).objectFit, width: node.naturalWidth, height: node.naturalHeight }))
    assert.deepEqual(image, { fit: 'contain', width: 128, height: 47 })
    checks.push('Upload validation, raster resizing, and aspect-preserving previews')
    await page.screenshot({ path: join(output, 'image-icon.png') })
    await page.reload({ waitUntil: 'networkidle' })
    await size(detail.locator('.resource-icon-detail img'), 48)
    await open(detail)
    await picker.getByRole('button', { name: 'Restore default', exact: true }).click()
    await picker.getByRole('button', { name: 'Apply', exact: true }).click()
    await size(detail.locator('.lucide-zap'), 48)
    await size(nav.locator('.lucide-zap'), 16)
    const saved = JSON.parse(readFileSync(join(config, 'workspace', 'resource-icons.json'), 'utf8'))
    assert.deepEqual(Object.keys(saved).sort(), ['plugin:Document tools', 'source:test'])
    assert.deepEqual(errors, [])
    checks.push('Cancel, reopen persistence, and restore default leave other resources intact')
    writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, image, pageErrors: errors }, null, 2))
    console.log(JSON.stringify({ output, checks }))
  } finally {
    await browser?.close()
    await vite?.close()
    if (backend.exitCode === null) {
      const exited = once(backend, 'exit')
      backend.kill()
      await exited
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
