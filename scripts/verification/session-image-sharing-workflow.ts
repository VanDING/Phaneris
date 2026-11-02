/** Approved failure matrix: docs/verification/session-image-sharing.md. Real browser workflow. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchViaBrowserServer } from './workflow-browser'

await verificationWorkflow('session-image-sharing', async run => {
  const launched = await launchViaBrowserServer(undefined, 'Windows browser workflow')
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/session-image-sharing.tsx' })
  const page = await launched.browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const checks: { id: string; passed: boolean; error?: string }[] = []
  const timings: { kind: string; milliseconds: number; pages: number; bytes: number }[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error('browser:', message.text()) })
  await page.context().tracing.start({ screenshots: true, snapshots: true })
  page.setDefaultTimeout(25_000)
  const preview = () => page.locator('[data-share-preview-index]')
  async function check(id: string, work: () => Promise<void>) {
    try { await work(); checks.push({ id, passed: true }) }
    catch (error) {
      checks.push({ id, passed: false, error: String(error) }); console.error(id, String(error))
      run.json(id + '-failure.json', await page.evaluate(() => ({ alert: document.querySelector('[role="alert"]')?.textContent,
        text: document.body.innerText.slice(-2000), resources: [...document.querySelectorAll('[data-share-resource-state]')].map(node => node.getAttribute('data-share-resource-state')) })))
      throw error
    }
  }
  async function open(kind: 'rich' | 'long' | 'table' | 'giant' | 'history' | 'broken', id?: string) {
    await page.evaluate(({ kind, id }) => window.shareFixture.open(kind, id), { kind, id })
    await page.getByRole('heading', { name: '选择分享内容', exact: true }).waitFor()
  }
  async function generate() {
    await page.getByRole('button', { name: '图片预览', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-share-preview-index]') || document.querySelector('[role="alert"]'))
    assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allInnerTexts().then(text => text.join('\n')))
    await preview().first().waitFor()
    await page.getByRole('button', { name: '保存图片', exact: true }).waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('button:disabled')?.textContent?.includes('保存图片'))
  }
  async function save(kind: string) {
    const start = Date.now()
    const before = await page.evaluate(() => window.shareFixture.records.saves.length)
    await page.getByRole('button', { name: '保存图片', exact: true }).click()
    await page.waitForFunction(before => window.shareFixture.records.saves.length > before || !!document.querySelector('[role="alert"]'), before, { timeout: 30_000 })
    assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allInnerTexts().then(text => text.join('\n')))
    const request = await page.evaluate(() => window.shareFixture.records.saves.at(-1)!)
    let bytes = 0
    request.images.forEach((base64, index) => {
      const png = Buffer.from(base64, 'base64'); bytes += png.length
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(png.readUInt32BE(16), 1440)
      assert(png.readUInt32BE(20) <= 24000)
      writeFileSync(join(run.directory, kind + '-' + (index + 1) + '.png'), png)
    })
    timings.push({ kind, milliseconds: Date.now() - start, pages: request.images.length, bytes })
    return request
  }
  try {
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => window.shareFixture?.ready)
    await check('SI01-inline-title', async () => {
      await page.getByRole('button', { name: 'Market and Portfolio Strategy', exact: true }).click()
      const input = page.getByRole('textbox', { name: '重命名会话', exact: true })
      await input.fill('  中文标题  '); await input.press('Enter')
      await page.getByRole('button', { name: '中文标题', exact: true }).click()
      await input.fill('不保存'); await input.press('Escape')
      await page.getByRole('button', { name: '中文标题', exact: true }).click()
      await input.fill('   '); await input.press('Enter')
      await page.getByRole('button', { name: '中文标题', exact: true }).click()
      await input.fill('中文输入法')
      await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
      assert.equal(await input.count(), 1)
      await page.getByRole('button', { name: '更多选项', exact: true }).click()
      await page.getByRole('button', { name: '中文输入法', exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
      await page.screenshot({ path: join(run.directory, 'conversation-light.png') })
    })
    await check('SI02-completed-only', async () => {
      const collected = await page.evaluate(() => window.shareFixture.collect())
      assert.deepEqual(collected.map(message => message.id), ['question', 'final', 'next'])
    })
    await check('SI03-answer-entry-selection', async () => {
      await page.getByRole('button', { name: '分支选项', exact: true }).click()
      await page.getByRole('menuitem').first().waitFor()
      await page.keyboard.press('Escape')
      await page.locator('[data-testid="draft"]').fill('草稿始终保留')
      const controls = page.getByRole('button', { name: '分享为图片', exact: true })
      assert.equal(await controls.count(), 2)
      await controls.last().click()
      assert.equal(await page.locator('input[type=checkbox]:checked').count(), 1)
      assert.equal(await page.locator('[data-share-select-id="a1"] input').isChecked(), true)
      assert.equal(await page.locator('[data-share-select-id="q1"] input').isChecked(), false)
      await page.screenshot({ path: join(run.directory, 'selection-light.png') })
      await generate(); await save('rich')
      assert.equal(await preview().count(), 1)
      assert(await preview().innerText().then(text => text.includes('RICH-END')))
      assert.equal(await preview().locator('.katex').count() > 0, true)
      assert.equal(await preview().locator('[data-share-resource-state="ready"] svg').count() > 0, true)
      assert.equal(await preview().locator('img').count(), 1)
      await page.screenshot({ path: join(run.directory, 'preview-light.png') })
      const before = await page.evaluate(() => window.shareFixture.records.copies.length)
      await page.getByRole('button', { name: '复制当前图片', exact: true }).click()
      await page.waitForFunction(before => window.shareFixture.records.copies.length > before, before)
      const identical = await page.evaluate(() => window.shareFixture.records.copies.at(-1) === window.shareFixture.records.saves.at(-1)!.images[0])
      assert(identical, 'Copy and save reuse the same PNG')
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(await page.getByTestId('draft').inputValue(), '草稿始终保留')
    })
    await check('SI04-header-entry-and-omissions', async () => {
      await page.getByRole('button', { name: '分享为图片', exact: true }).first().click()
      assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0)
      assert.equal(await page.getByRole('button', { name: '图片预览', exact: true }).isDisabled(), true)
      await page.locator('[data-share-select-id="q1"] input').check()
      await page.locator('[data-share-select-id="a2"] input').check()
      await generate()
      assert.equal(await preview().locator('[data-share-gap]').count(), 1)
      assert.equal(await preview().locator('.share-question').count(), 1)
    })
    await check('SI05-offscreen-history', async () => {
      await open('history')
      assert.equal(await page.locator('[data-share-select-id]').count(), 30)
      await page.getByRole('button', { name: '全选', exact: true }).click()
      await generate()
      const text = await preview().allInnerTexts()
      for (let i = 0; i < 66; i++) assert(text.join('\n').includes('历史消息 ' + i))
    })
    await check('SI06-long-auto-and-limit', async () => {
      await open('long', 'long'); await generate()
      assert(await preview().count() > 1)
      const text = (await preview().allInnerTexts()).join('\n')
      for (let i = 1; i <= 95; i++) assert(text.includes('段落编号 ' + i + '。'))
      assert(text.includes('LONG-END'))
      const saved = await save('long')
      await page.locator('.share-preview-stage').evaluate(stage => {
        const first = stage.querySelector('[data-share-preview-index]')!
        stage.scrollTop = first.getBoundingClientRect().height * .65
      })
      const before = await page.evaluate(() => window.shareFixture.records.copies.length)
      await page.getByRole('button', { name: '复制当前图片', exact: true }).click()
      await page.waitForFunction(before => window.shareFixture.records.copies.length > before, before)
      assert.equal(await page.evaluate(() => window.shareFixture.records.copies.at(-1)), saved.images[0], 'Copy the visible long page, not the next page below the viewport')
      await page.getByRole('radio').last().check()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByRole('button', { name: '保存图片', exact: true }).isDisabled(), true)
    })
    await check('SI07-wide-and-long-table', async () => {
      await open('table', 'table'); await generate()
      const text = (await preview().allInnerTexts()).join('\n')
      assert(text.includes('end-159'))
      for (let i = 0; i < 160; i++) assert(text.includes('row-' + i))
      for (const table of await preview().locator('table').all()) {
        assert.equal(await table.locator('thead').count(), 1)
        assert.equal(await table.locator('tr').first().locator('th').count(), 5)
      }
      await save('table')
    })
    await check('SI08-giant-code', async () => {
      await open('giant', 'giant'); await generate()
      assert(await preview().count() > 1)
      assert((await preview().allInnerTexts()).join('\n').includes('GIANT-END'))
      const code = (await preview().locator('pre code').allTextContents()).join('\n').match(/CODE-LINE-\d+/g)!
      assert.equal(code.length, 600); assert.equal(new Set(code).size, 600)
      await save('giant')
    })
    await check('SI09-dark-desktop-pane', async () => {
      await page.setViewportSize({ width: 1100, height: 900 })
      await page.evaluate(() => window.shareFixture.setMode('dark'))
      await open('rich', 'a1'); await generate()
      const colors = await preview().locator('.share-page').evaluate(element => ({ bg: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
      assert.equal(colors.bg, 'rgb(255, 255, 255)')
      await page.screenshot({ path: join(run.directory, 'preview-dark-pane.png') })
      await save('rich-dark')
    })
    await check('SI10-resource-failure', async () => {
      await open('broken', 'broken')
      await page.getByRole('button', { name: '图片预览', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByRole('button', { name: '保存图片', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.getByRole('button', { name: '取消', exact: true }).click()
    })
    assert.deepEqual(errors, [])
    run.complete(checks.filter(check => check.passed).map(check => check.id), ['Full persisted ChatPage/production host boot', 'macOS/Linux native execution', 'Signed installer'])
    assert(checks.every(check => check.passed), JSON.stringify(checks.filter(check => !check.passed)))
  } finally {
    run.json('results.json', { checks, timings, errors, browser: launched.browser.version() })
    await page.context().tracing.stop({ path: join(run.directory, 'trace.zip') })
    await launched.close(); await fixture.close()
    console.log(JSON.stringify({ output: run.directory, passed: checks.filter(check => check.passed).length, total: checks.length }))
  }
})
