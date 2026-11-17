import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { gotoWithRetry, launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { startProcess, testSecret } from './fixtures/governance-process-support'

// Production caller acceptance for the private SessionItem/SessionList index
// cleanup and the removed constant mention-search state. Expected behavior was
// fixed in component-interface-review.md before those changes.
await verificationWorkflow('component-callers', async run => {
  const config = join(run.directory, 'config'); mkdirSync(config)
  const child = await startProcess({ config, entry: join(import.meta.dir, 'fixtures/planning-performance-server.ts'), extra: { PHANERIS_C02_SIZE: '4' } })
  const launched = await launchWorkflowBrowser(), context = await launched.browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage(), base = child.url.replace(/^ws/, 'http'), checks: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await context.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    assert((await context.request.post(base + '/api/auth', { data: { password: testSecret } })).ok())
    await gotoWithRetry(page, base + '/?route=allSessions/session/planning-00000')
    await page.getByTestId('app-splash').waitFor({ state: 'hidden', timeout: 30_000 })
    await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    const rows = page.locator('[data-session-id] [role="option"]')
    await rows.first().waitFor()
    const ids = await page.locator('[data-session-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-session-id')!))
    assert(ids.length >= 4)
    const row = (index: number) => page.locator(`[data-session-id="${ids[index]}"]`).getByRole('option')
    const selection = () => page.locator('[data-session-id]').evaluateAll(nodes => nodes.filter(node => node.querySelector('[aria-selected="true"]')).map(node => node.getAttribute('data-session-id')))
    await row(0).click(); await row(2).click({ modifiers: ['Shift'] })
    assert.deepEqual(await selection(), ids.slice(0, 3)); checks.push('shift-selection-uses-the-visible-flat-order')
    await row(1).click({ modifiers: ['Control'] })
    assert.deepEqual(await selection(), [ids[0], ids[2]]); checks.push('control-click-toggles-one-row-without-navigation')
    await page.keyboard.press('Escape')
    assert.deepEqual(await selection(), [ids[2]]); checks.push('escape-clears-range-and-retains-the-active-range-endpoint')
    const keyboardIds = await page.locator('[data-session-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-session-id')!))
    const keyboardStart = keyboardIds.indexOf(ids[2]!), keyboardNext = keyboardIds[keyboardStart + 1]
    assert(keyboardStart >= 0 && keyboardNext)
    await page.locator(`[data-session-id="${ids[2]}"]`).getByRole('option').focus()
    await page.waitForFunction(id => document.querySelector(`[data-session-id="${id}"] [role="option"]`)?.getAttribute('tabindex') === '0', ids[2])
    await page.keyboard.press('ArrowDown')
    await page.waitForURL(url => decodeURIComponent(url.search).includes(keyboardNext))
    assert.equal(await page.locator(`[data-session-id="${keyboardNext}"]`).getByRole('option').getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)
    checks.push('arrow-navigation-and-enter-focus-the-selected-session-composer')
    const composer = page.locator('[contenteditable="true"]').first()
    await composer.fill('@')
    const menu = page.locator('[data-inline-menu]'); await menu.waitFor({ state: 'visible' })
    const selected = menu.locator('[role="option"][aria-selected="true"]'), first = await selected.innerText()
    assert(await menu.getByRole('option').count() > 1)
    await page.keyboard.press('ArrowDown'); assert.notEqual(await selected.innerText(), first)
    await page.keyboard.press('Enter'); await menu.waitFor({ state: 'hidden' })
    assert.equal(await composer.locator('[data-mention="true"]').count(), 1)
    checks.push('chat-mention-keyboard-selection-inserts-the-real-badge')
    await composer.fill('@zzzz-no-such-entity-architecture')
    await page.waitForTimeout(500)
    assert.equal(await menu.getByRole('option').count(), 0)
    await menu.getByText('No results', { exact: true }).waitFor()
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' })
    assert.equal(await composer.innerText(), '@zzzz-no-such-entity-architecture')
    checks.push('mention-without-results-preserves-empty-feedback-and-escape-without-insertion')
    await composer.fill('Retained draft after mention checks')
    await waitForBrowserCondition(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Retained draft after mention checks', keyboardNext)
    checks.push('composer-draft-retains-the-keyboard-selected-session-owner')
    run.json('scenarios.json', { checks, errors, ids, selected: await selection(), url: page.url() }); assert.deepEqual(errors, [])
    run.complete(checks, ['Uses the production WebUI build generated by navigation-startup; no live model execution.', 'Native new-window actions, OS clipboard image formats and installed Electron remain separate platform checks.'])
  } finally {
    run.json('last-state.json', { checks, errors, url: page.url(), text: await page.locator('body').innerText().catch(() => '') })
    await page.screenshot({ path: join(run.directory, 'components-in-app.png'), fullPage: true }).catch(() => {})
    await context.close(); await launched.close(); writeFileSync(join(run.directory, 'server.log'), child.stdout() + child.stderr()); await child.stop()
  }
})
