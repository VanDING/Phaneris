#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { verificationWorkflow } from './verification-artifacts'

// Before implementation: all three public entrances must decode identically,
// retain legacy timestamps/extensions and empty sessions, reject bad message
// identity/role/content/attachments without a root crash, and recover afterwards.
await verificationWorkflow('viewer-input', async run => {
  const build = join(run.directory, 'build')
  const child = Bun.spawn([process.execPath, 'run', 'viewer:build', '--outDir', build], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  run.json('production-build.json', { code, stdout, stderr }); assert.equal(code, 0, stderr)
  const good = { id: 'sample', name: 'Valid legacy fixture', createdAt: 1, lastUsedAt: 1, extension: { retained: true },
    messages: [{ id: 'user', type: 'user', content: 'A valid recoverable transcript', extension: true }] }
  const datasets: Record<string, string> = {
    legacy: JSON.stringify(good), empty: JSON.stringify({ ...good, name: 'Empty fixture', messages: [] }),
    'null-message': JSON.stringify({ ...good, messages: [null] }),
    'wrong-role': JSON.stringify({ ...good, messages: [{ id: 'user', type: 'unsupported', content: 'Invalid' }] }),
    'wrong-content': JSON.stringify({ ...good, messages: [{ id: 'user', type: 'user', content: { invalid: true } }] }),
    'bad-attachment': JSON.stringify({ ...good, messages: [{ id: 'user', type: 'user', content: 'Invalid', attachments: [null] }] }),
    'broken-json': '{"id":"sample","messages":[',
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/s/api/')) {
      const dataset = datasets[path.slice('/s/api/'.length)]
      return dataset ? new Response(dataset, { headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 404 })
    }
    const asset = path.startsWith('/s/assets/') ? path.slice(3) : 'index.html'
    const file = Bun.file(join(build, asset))
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 })
  } })
  const browser = await chromium.launch()
  const base = `http://127.0.0.1:${server.port}`
  const checks: string[] = [], failures: Array<{ id: string; error: string; browserErrors: string[] }> = []
  const paste = (page: Page, text: string) => page.evaluate(value => {
    const data = new DataTransfer(); data.setData('text', value)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }))
  }, text)
  const upload = (page: Page, text: string, name = 'fixture.json') => page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
  const scene = async (id: string, verify: (page: Page) => Promise<void>) => {
    const page = await browser.newPage(), browserErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    try { await verify(page); assert.deepEqual(browserErrors, []); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error), browserErrors }) }
    finally { await page.close() }
  }
  try {
    for (const entry of ['http', 'upload', 'paste'] as const) for (const [name, data] of Object.entries(datasets)) {
      await scene(`${entry}-${name}`, async page => {
        const valid = name === 'legacy' || name === 'empty'
        const outcome = valid ? null : Promise.race([
          page.waitForEvent('pageerror', { timeout: 8000 }),
          page.getByText(/Invalid session format|Failed to parse JSON file|Failed to load session/i).first().waitFor({ timeout: 8000 }),
        ])
        await page.goto(base + (entry === 'http' ? `/s/${name}` : '/s/'))
        if (entry !== 'http') {
          await page.locator('input[type=file]').waitFor({ state: 'attached' })
          if (entry === 'upload') await upload(page, data)
          else await paste(page, data)
        }
        if (valid) await page.getByText(name === 'empty' ? 'Empty fixture' : 'A valid recoverable transcript', { exact: true }).first().waitFor({ timeout: 8000 })
        else {
          await outcome
          assert((await page.locator('#root').innerText()).trim().length > 0, 'Invalid input blanked the root')
          if (entry === 'http') await page.getByRole('button', { name: 'Go back', exact: true }).click()
          if (entry === 'paste') await paste(page, datasets.legacy!)
          else await upload(page, datasets.legacy!, 'recovered.json')
          await page.getByText('A valid recoverable transcript', { exact: true }).first().waitFor({ timeout: 8000 })
          if (name === 'null-message') await page.screenshot({ path: join(run.directory, `${entry}-recovered.png`) })
        }
      })
    }
    await scene('unrelated-clipboard-remains-ignored', async page => {
      await page.goto(base + '/s/')
      await page.locator('input[type=file]').waitFor({ state: 'attached' })
      for (const text of ['ordinary text', '{unrelated broken text', JSON.stringify({ unrelated: true }), 'null', '[]']) await paste(page, text)
      assert.equal(await page.getByText(/Invalid session format|Failed to parse JSON file/).count(), 0)
      assert.equal(await page.locator('input[type=file]').count(), 1)
    })
    await scene('http-404-retains-recovery', async page => {
      await page.goto(base + '/s/not-found')
      await page.getByRole('button', { name: 'Go back', exact: true }).click()
      await upload(page, datasets.legacy!)
      await page.getByText('A valid recoverable transcript', { exact: true }).first().waitFor({ timeout: 8000 })
    })
    run.json('scenarios.json', { checks, failures })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['Chromium production build; other browser engines not exercised'])
  } finally { await browser.close(); await server.stop(true) }
})
