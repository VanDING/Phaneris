const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { chromium } = require('playwright')
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
    const listIcon = nav.locator('.resource-icon-list:not(.invisible) svg').first()
    const detailIcon = detail.locator('.resource-icon-detail svg').first()
    async function size(locator, expected) {
      await locator.waitFor()
      const { width, height } = await locator.boundingBox()
      assert.ok(Math.abs(width - expected) < 0.1 && Math.abs(height - expected) < 0.1, JSON.stringify({ width, height, expected }))
    }
    const checks = []
    for (const group of ['Sources', 'Plugins', 'Skills']) {
      await page.getByRole('button', { name: group, exact: true }).click()
      await size(listIcon, 16)
      await size(detailIcon, 48)
      assert.equal(await page.getByRole('button', { name: 'Change icon', exact: true }).count(), 0)
      assert.equal(await page.locator('input[type=file]').count(), 0)
      for (const shape of ['circle', 'rect']) {
        await page.evaluate(([type, shape]) => window.writeFixtureIcon(type, shape), [group.toLowerCase(), shape])
        await listIcon.locator(shape).waitFor()
        await detailIcon.locator(shape).waitFor()
        await size(listIcon, 16)
        await size(detailIcon, 48)
      }
      await page.screenshot({ path: join(output, group.toLowerCase() + '-configured-icon.png') })
      checks.push(group + ' has no manual editor, discovers the configured file, and refreshes a same-name replacement at 16px / 48px')
    }
    await page.reload({ waitUntil: 'networkidle' })
    await listIcon.locator('rect').waitFor()
    await detailIcon.locator('rect').waitFor()
    checks.push('The configured Skill image is read from disk after reloading')
    assert.deepEqual(errors, [])
    writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, pageErrors: errors }, null, 2))
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
