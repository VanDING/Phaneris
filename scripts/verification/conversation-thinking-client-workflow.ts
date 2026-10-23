/** Actual renderer event processor, turn projection, row and full-screen preview. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createServer } from 'vite'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser, gotoWithRetry } from './workflow-browser'

await verificationWorkflow('conversation-thinking-client', async evidence => {
  const root = resolve(import.meta.dir, '../..'), prefix = '/' + relative(root, evidence.directory).replaceAll('\\', '/')
  const fixture = '/scripts/verification/fixtures/conversation-thinking.tsx'
  writeFileSync(join(evidence.directory, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`)
  writeFileSync(join(evidence.directory, 'host.css'), `@import "${relative(evidence.directory, resolve('apps/electron/src/renderer/index.css')).replaceAll('\\', '/')}";\n@source "${resolve(fixture.slice(1)).replaceAll('\\', '/')}";\n`)
  const server = await createServer({ root, configFile: resolve('apps/electron/vite.config.ts'),
    optimizeDeps: { entries: [fixture.slice(1)], include: ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/.cache/**', '**/runtimes/**', '**/dist/**'] } } })
  const launched = await launchWorkflowBrowser(), checks: string[] = [], errors: string[] = []
  try {
    await server.listen()
    const page = await launched.browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', error => errors.push(error.message))
    await gotoWithRetry(page, `http://127.0.0.1:${(server.httpServer!.address() as any).port}${prefix}/index.html?css=${prefix}/host.css`)
    await page.waitForFunction(() => (window as any).thinkingFixture?.ready)
    const emit = (event: any) => page.evaluate(event => (window as any).thinkingFixture.emit(event), event)
    await emit({ type: 'thinking_delta', delta: 'THINKING_FIXTURE Inspect the supplied material first.', turnId: 'model-one', blockIndex: 0 })
    const row = page.locator('[data-activity-type="thinking"]')
    await row.waitFor({ timeout: 5000 }); assert.match(await row.innerText(), /THINKING_FIXTURE/)
    assert((await row.boundingBox())!.height < 36); checks.push('thinking arrives before text as a single activity line')
    await row.getByRole('button').click()
    await page.getByRole('dialog').waitFor(); assert.match(await page.getByRole('dialog').innerText(), /supplied material/)
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await row.count(), 1); checks.push('row click uses full-screen document, no inline expansion')
    await row.getByRole('button').focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape'); checks.push('thinking details keyboard activation and Escape close')
    await emit({ type: 'thinking_delta', delta: ' more detail'.repeat(10000), turnId: 'model-one', blockIndex: 0 })
    assert.equal(await row.count(), 1); assert((await row.boundingBox())!.height < 36)
    checks.push('large thinking increment remains one clipped row')
    await emit({ type: 'text_complete', text: '已完成检查。', isIntermediate: true, turnId: 'model-one', messageId: 'canonical-one',
      outputBlocks: [{ type: 'thinking', index: 0, content: 'THINKING_FIXTURE Final recorded thinking.' }, { type: 'text', index: 1, content: '已完成检查。' }] })
    assert.equal(await row.count(), 1)
    const snapshot = await page.evaluate(() => (window as any).thinkingFixture.snapshot())
    await page.evaluate(value => (window as any).thinkingFixture.restore(value), JSON.parse(JSON.stringify(snapshot)))
    assert.match(await row.innerText(), /Final recorded thinking/); checks.push('authoritative completion replaces deltas and survives snapshot restore')
    await emit({ type: 'tool_start', toolUseId: 'read-fixture', toolName: 'Read', toolInput: { file_path: 'fixture.txt' }, timestamp: Date.now() })
    await emit({ type: 'tool_result', toolUseId: 'read-fixture', result: 'FILE_READ_FIXTURE', isError: false })
    await emit({ type: 'thinking_delta', delta: 'SECOND_THINKING_FIXTURE Inspect the tool result.', turnId: 'model-two', blockIndex: 0 })
    await page.waitForFunction(() => document.querySelectorAll('[data-activity-type="thinking"]').length === 2)
    const order = await page.locator('main').innerText()
    assert(order.indexOf('Final recorded thinking') < order.indexOf('fixture.txt') && order.indexOf('fixture.txt') < order.indexOf('SECOND_THINKING_FIXTURE'))
    checks.push('thinking-tool-thinking retains actual chronological positions in one turn')
    await emit({ type: 'text_complete', text: '第二轮检查完成。', turnId: 'model-two', messageId: 'canonical-two',
      outputBlocks: [{ type: 'thinking', index: 0, content: 'SECOND_THINKING_FIXTURE Inspect the tool result.' }] })
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await page.screenshot({ path: join(evidence.directory, 'thinking-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' }); await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.setViewportSize({ width: 760, height: 760 }); await page.screenshot({ path: join(evidence.directory, 'thinking-dark-narrow.png') })
    await page.evaluate(() => (window as any).thinkingFixture.buffer())
    await page.getByText('中文短回复无需空格也能及时显示。', { exact: true }).waitFor({ timeout: 4000 })
    checks.push('short Chinese response flushes without another provider delta')
    assert.equal(errors.length, 0, errors.join('\n'))
    evidence.json('client.json', { checks, errors }); evidence.complete(checks, ['Packaged native client', 'Live provider inference'])
  } finally { await launched.close(); await server.close() }
})
