/** Real renderer reducer and message bubble in a browser; complements the SDK JSONL workflow. */
import { strict as assert } from 'node:assert'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const root = resolve(import.meta.dir, '../..'), output = resolve(root, '.cache/capability-integration')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'reception.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/scripts/verification/fixtures/input-reception.tsx"></script></body></html>')
const server = await createServer({ configFile: resolve(root, 'apps/electron/vite.config.ts'), root, server: { host: '127.0.0.1', port: 5199, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) })
const page = await browser.newPage(), records: any[] = [], errors: string[] = []
page.on('pageerror', error => errors.push(error.message))
async function check(id: string, action: () => Promise<void>) { try { await action(); records.push({ id, pass: true }) } catch (error) { records.push({ id, pass: false, error: String(error) }) } }
const message = (id: string, disposition: string) => ({ id, role: 'user', content: 'same text', timestamp: 100, inputReception: { disposition } })
const send = async (event: any) => { await page.evaluate(event => (window as any).receiptEvent(event), event); await page.waitForTimeout(30) }
try {
  // A cold Vite dependency build is setup, separate from production UI budgets.
  await page.goto('http://127.0.0.1:5199/.cache/capability-integration/reception.html', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => typeof (window as any).receiptEvent === 'function', undefined, { timeout: 90000 })
  await check('Identical messages bind canonical receipts to their own optimistic identity', async () => {
    await page.evaluate(() => (window as any).receiptSeed({ session: { id: 'receipt', isProcessing: false, lastMessageAt: 0,
      messages: ['optimistic-a', 'optimistic-b'].map(id => ({ id, role: 'user', content: 'same text', timestamp: 100, isPending: true })) }, streaming: null }))
    await send({ type: 'user_message', sessionId: 'receipt', message: message('a', 'saved'), optimisticMessageId: 'optimistic-a', status: 'accepted' })
    await send({ type: 'user_message', sessionId: 'receipt', message: message('b', 'saved'), optimisticMessageId: 'optimistic-b', status: 'accepted' })
    await send({ type: 'user_message', sessionId: 'receipt', message: message('b', 'handled'), status: 'accepted', receptionOnly: true })
    const state = await page.evaluate(() => (window as any).receiptState())
    assert.equal(state.session.messages.length, 2)
    assert.equal(state.session.messages[0].inputReception.disposition, 'saved')
    assert.equal(state.session.messages[1].inputReception.disposition, 'handled')
    await page.locator('[data-message-id="optimistic-b"] [data-input-reception="handled"]').waitFor()
  })
  await check('Late SDK receipts update status without restarting an idle session or changing order', async () => {
    await page.evaluate(() => { const state = (window as any).receiptState(); (window as any).receiptSeed({ ...state, session: { ...state.session, isProcessing: false, lastMessageAt: 7 } }) })
    await send({ type: 'user_message', sessionId: 'receipt', message: message('b', 'unknown'), status: 'queued', receptionOnly: true })
    const state = await page.evaluate(() => (window as any).receiptState())
    assert.equal(state.session.isProcessing, false); assert.equal(state.session.lastMessageAt, 7)
    assert.equal(state.session.messages[1].isQueued, false)
    assert.equal(state.session.messages[1].inputReception.disposition, 'unknown')
  })
  await check('All reception states are localized and remain distinct from host queue status', async () => {
    for (const disposition of ['saved', 'started', 'queued', 'handled', 'rejected', 'unknown']) {
      await send({ type: 'user_message', sessionId: 'receipt', message: message('b', disposition), status: 'accepted', receptionOnly: true })
      const badge = page.locator(`[data-message-id="optimistic-b"] [data-input-reception="${disposition}"]`)
      await badge.waitFor(); assert(!(await badge.innerText()).includes('chat.'))
    }
  })
  await page.screenshot({ path: resolve(output, 'input-reception.png') })
} catch (error) {
  records.push({ id: 'Browser fixture bootstrap and screenshot', pass: false, error: String(error) })
} finally { await browser.close(); await server.close(); writeFileSync(resolve(output, 'input-reception.json'), JSON.stringify({ records, errors }, null, 2)) }
console.log(JSON.stringify({ records, errors })); process.exit(records.every(record => record.pass) && !errors.length ? 0 : 1)
