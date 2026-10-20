#!/usr/bin/env bun
/**
 * Chat Starters browser acceptance (CS-04 / CS-07 interaction surface, CS-08 i18n).
 *
 * Runs the real starter chips and the real workspace-settings editor in a real
 * Chromium against the real renderer bundle, with a recording host stub. Covers
 * what the RPC-level workflow (`upgrade-0153-chat-starters-workflow.ts`) cannot:
 * pointer, keyboard, focus, the disabled/cancelled composer state, truncation of
 * a long label, the settings editor's add/limit/remove/rejection behaviour and a
 * live language switch.
 *
 * The new-chat landing that consumes these chips (`ChatDisplay`) lives in its own
 * workflow: importing it pulls in the whole transcript/markdown/editor graph, and
 * Vite's dependency crawl of that graph must not gate this page.
 *
 * Usage: bun run scripts/verification/upgrade-0153-chat-starters-browser-workflow.ts
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('upgrade-0153-chat-starters-browser', async run => {
  // Order matters and was measured: launch the browser BEFORE any dev-server work
  // in this process. With Vite listening here, Chromium startup degrades from
  // ~0.2 s to 50-200 s and later CDP calls time out. The page itself is built
  // once by a Node child (`fixture-bundle-host.mjs`) and served as plain files,
  // so no Vite work ever shares this event loop with the browser driver.
  const launched = await launchWorkflowBrowser()
  console.log('[cs-browser] browser', launched.browser.version())
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/chat-starters.tsx' })
  const base = fixture.url
  console.log('[cs-browser] fixture page', base, 'from', fixture.outDir)
  const errors: string[] = [], consoleErrors: string[] = [], consoleLog: string[] = [], failedRequests: string[] = []
  const checks: { id: string; passed: boolean; error?: string }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    const text = message.text()
    if (message.type() === 'error') consoleErrors.push(text)
    if (consoleLog.length < 200) consoleLog.push(`${message.type()}: ${text.slice(0, 300)}`)
  })
  page.on('requestfailed', request => { if (failedRequests.length < 50) failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`) })

  const chips = page.locator('#chips [data-testid="chat-starter"]')
  const settings = page.locator('#settings [data-testid="chat-starters-settings"]')
  const state = () => page.evaluate(() => ({
    ipc: window.chatStartersFixture.ipc, selections: window.chatStartersFixture.selections,
    settingsWrites: window.chatStartersFixture.settingsWrites, unknownApi: [...window.chatStartersFixture.unknownApi],
  }))
  const reset = () => page.evaluate(() => {
    window.chatStartersFixture.ipc.length = 0
    window.chatStartersFixture.selections.length = 0
    window.chatStartersFixture.settingsWrites.length = 0
  })
  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }

  try {
    // Boot: the page is a static build, so a load either works or reports a real
    // error. `networkidle` is avoided on principle (it is satisfied by a stalled
    // request too); ready is the fixture's own signal.
    let booted = false
    for (let attempt = 1; attempt <= 2 && !booted; attempt += 1) {
      console.log(`[cs-browser] boot attempt ${attempt}`)
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(error => {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
        errors.push(`goto attempt ${attempt}: ${message}`)
        console.log(`[cs-browser] goto failed: ${message}`)
      })
      booted = await page.waitForFunction(() => window.chatStartersFixture?.ready === true, undefined, { timeout: 60_000 })
        .then(() => true).catch(() => false)
      console.log(`[cs-browser] attempt ${attempt} ready=${booted}`)
      if (!booted) await Bun.sleep(1_000)
    }
    const boot = await page.evaluate(() => ({
      ready: window.chatStartersFixture?.ready ?? false,
      renders: window.chatStartersFixture?.renders?.() ?? -1,
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      bodyText: document.body.innerText.slice(0, 400),
    }))
    run.json('boot.json', { base, boot, consoleLog, errors, consoleErrors, failedRequests })
    assert(booted && boot.ready, `fixture page never became ready (${JSON.stringify({ boot, errors, consoleErrors, failedRequests })})`)
    await page.evaluate(() => document.fonts.ready)

    // --- CS-07: the chips render once, with readable labels and tooltips -----
    await check('CSB-01-chips-rendered', async () => {
      await chips.first().waitFor()
      assert.equal(await chips.count(), 3, 'exactly the configured starters are rendered')
      assert.equal(await page.locator('#chips [data-testid="chat-starters"]').getAttribute('data-chat-starter-count'), '3')
      assert.deepEqual((await chips.allInnerTexts()).map(text => text.trim()), [
        'Review pull requests', 'Summarize inbox', 'A very long starter label that must truncate inside the chip',
      ])
      const titles = await chips.evaluateAll(nodes => nodes.map(node => node.getAttribute('title')))
      assert.match(titles[0]!, /\[source:github\] \[skill:review-prs\]$/, 'the chip tooltip is the prompt that will be sent')
      assert.equal(await chips.first().getAttribute('type'), 'button', 'a chip is a real button, not a div with a click handler')
      await page.screenshot({ path: join(run.directory, 'chips.png') })
    })

    // --- CS-07: pointer click hands over the exact starter --------------------
    await check('CSB-02-pointer-selects', async () => {
      await reset()
      await chips.nth(1).click()
      const { selections, ipc } = await state()
      assert.equal(selections.length, 1, 'one click selects exactly one starter')
      assert.deepEqual(selections[0], { label: 'Summarize inbox', prompt: 'Summarize my unread mail [source:gmail]' },
        'the chip hands over its stored label and prompt, unmodified')
      assert.equal(ipc.length, 0, 'the chip itself talks to no host surface; sending is the caller\'s job')
    })

    // --- CS-07: keyboard operation and a visible focus ring ------------------
    await check('CSB-03-keyboard-and-focus', async () => {
      await reset()
      // Real keyboard focus only: a programmatic .focus() does not match
      // :focus-visible, so it would measure a chip with no ring at all.
      await page.locator('#chips').click({ position: { x: 2, y: 2 } })
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        if (!element) return null
        const style = getComputedStyle(element)
        return {
          index: element.getAttribute('data-chat-starter-index'), focusVisible: element.matches(':focus-visible'),
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, shadow: style.boxShadow,
        }
      })
      assert(focused, 'a chip must receive keyboard focus')
      assert.equal(focused!.index, '0', 'Tab reaches the first chip')
      assert.equal(focused!.focusVisible, true, 'the focused chip matches :focus-visible')
      const resting = await chips.nth(2).evaluate(element => {
        const style = getComputedStyle(element)
        return { outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, shadow: style.boxShadow }
      })
      assert(focused!.shadow !== resting.shadow || focused!.outline !== resting.outline,
        `keyboard focus must be visible (${JSON.stringify({ focused, resting })})`)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-chat-starter-index')), '1',
        'Tab moves focus to the next chip in order')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press(' ')
      const { selections } = await state()
      assert.deepEqual(selections.map(starter => starter.label), ['Summarize inbox', 'Review pull requests'],
        'Enter and Space both activate the focused chip')
      await page.screenshot({ path: join(run.directory, 'chips-focus.png') })
    })

    // --- CS-07: a composer that cannot send leaves the chips inert -----------
    await check('CSB-04-disabled-is-inert', async () => {
      await reset()
      await page.evaluate(() => window.chatStartersFixture.setDisabled(true))
      await page.waitForFunction(() => (document.querySelector('#chips [data-testid="chat-starter"]') as HTMLButtonElement | null)?.disabled === true)
      await chips.first().click({ force: true })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
      assert.equal((await state()).selections.length, 0, 'a disabled chip selects nothing')
      await page.screenshot({ path: join(run.directory, 'chips-disabled.png') })
      await page.evaluate(() => window.chatStartersFixture.setDisabled(false))
      await chips.first().click()
      assert.equal((await state()).selections.length, 1, 're-enabling restores the chip')
    })

    // --- CS-02: a long label truncates instead of stretching the row --------
    await check('CSB-05-long-label-truncates', async () => {
      const overflow = await chips.nth(2).evaluate(node => {
        const label = node.querySelector('span')
        return { chipWidth: node.getBoundingClientRect().width, labelScroll: label?.scrollWidth ?? 0, labelClient: label?.clientWidth ?? 0 }
      })
      assert(overflow.chipWidth <= 256 + 2, `the chip must stay within its max width (${JSON.stringify(overflow)})`)
      assert(overflow.labelScroll > overflow.labelClient,
        `the long label must be truncated, not wrapped (${JSON.stringify(overflow)})`)
    })

    // --- CS-04: the settings editor writes immediately and reads back -------
    await check('CSB-06-settings-add', async () => {
      await reset()
      await settings.locator('[data-testid="chat-starters-empty"]').waitFor()
      await settings.locator('[data-testid="chat-starter-label-input"]').fill('Daily digest')
      await settings.locator('[data-testid="chat-starter-prompt-input"]').fill('Summarize today [source:gmail]')
      await settings.locator('[data-testid="chat-starter-add"]').click()
      await settings.locator('[data-testid="chat-starter-row"]').first().waitFor()
      const { settingsWrites } = await state()
      assert.deepEqual(settingsWrites.at(-1), { key: 'chatStarters', value: [{ label: 'Daily digest', prompt: 'Summarize today [source:gmail]' }] })
      assert.equal(await settings.locator('[data-testid="chat-starter-row"]').count(), 1, 'the new starter appears without a reload')
      assert.equal(await settings.locator('[data-testid="chat-starter-label-input"]').inputValue(), '', 'a successful add clears the draft')
      await page.screenshot({ path: join(run.directory, 'settings-one.png') })
    })

    await check('CSB-07-settings-limit-and-remove', async () => {
      for (const [label, prompt] of [['Second', 'Prompt two'], ['Third', 'Prompt three']]) {
        const before = await settings.locator('[data-testid="chat-starter-row"]').count()
        await settings.locator('[data-testid="chat-starter-label-input"]').fill(label)
        await settings.locator('[data-testid="chat-starter-prompt-input"]').fill(prompt)
        // Saving is asynchronous: wait for the button to accept a click again
        // before pressing it, or the click lands on a disabled control.
        await page.waitForFunction(() => (document.querySelector('#settings [data-testid="chat-starter-add"]') as HTMLButtonElement | null)?.disabled === false)
        await settings.locator('[data-testid="chat-starter-add"]').click()
        await page.waitForFunction(count => document.querySelectorAll('#settings [data-testid="chat-starter-row"]').length === count, before + 1, { timeout: 30_000 })
      }
      assert.equal(await settings.locator('[data-testid="chat-starter-row"]').count(), 3)
      assert.equal(await settings.locator('[data-testid="chat-starter-add"]').isDisabled(), true, 'the add button is disabled at the cap')
      assert.equal(await settings.locator('[data-testid="chat-starter-label-input"]').isDisabled(), true, 'the inputs stop accepting a fourth starter')
      assert.match(await settings.innerText(), /3 of 3 used/, 'the cap is explained in the UI')
      await reset()
      await settings.locator('[data-testid="chat-starter-row"]').first().getByRole('button').click()
      await page.waitForFunction(() => document.querySelectorAll('#settings [data-testid="chat-starter-row"]').length === 2)
      const { settingsWrites } = await state()
      assert.deepEqual(settingsWrites.at(-1)!.value, [{ label: 'Second', prompt: 'Prompt two' }, { label: 'Third', prompt: 'Prompt three' }],
        'removal writes the remaining starters in order')
      await page.screenshot({ path: join(run.directory, 'settings-two.png') })
    })

    await check('CSB-08-settings-rejections-keep-the-draft', async () => {
      await reset()
      await settings.locator('[data-testid="chat-starter-label-input"]').fill('   ')
      await settings.locator('[data-testid="chat-starter-prompt-input"]').fill('   ')
      await settings.locator('[data-testid="chat-starter-add"]').click()
      await settings.locator('[data-testid="chat-starters-error"]').waitFor()
      assert.match(await settings.locator('[data-testid="chat-starters-error"]').innerText(), /label and a prompt are both required/)
      assert.equal((await state()).settingsWrites.length, 0, 'a locally invalid starter never reaches the server')
      await settings.locator('[data-testid="chat-starter-label-input"]').fill('Server rejects this')
      await settings.locator('[data-testid="chat-starter-prompt-input"]').fill('because the workspace is full')
      await page.evaluate(() => window.chatStartersFixture.failNextSettingsWrite('At most 3 chat starters are allowed'))
      await settings.locator('[data-testid="chat-starter-add"]').click()
      await page.waitForFunction(() => document.querySelector('#settings [data-testid="chat-starters-error"]')?.textContent?.includes('At most 3') === true)
      assert.equal(await settings.locator('[data-testid="chat-starter-label-input"]').inputValue(), 'Server rejects this', 'a rejected add keeps the draft')
      assert.equal(await settings.locator('[data-testid="chat-starter-prompt-input"]').inputValue(), 'because the workspace is full')
      assert.equal(await settings.locator('[data-testid="chat-starter-row"]').count(), 2, 'a rejected add changes nothing on screen')
      await page.screenshot({ path: join(run.directory, 'settings-rejected.png') })
    })

    // --- CS-08: both languages render the whole surface ----------------------
    await check('CSB-09-bilingual', async () => {
      await page.evaluate(() => window.chatStartersFixture.setLanguage('zh-Hans'))
      await page.waitForFunction(() => document.querySelector('#settings [data-testid="chat-starter-add"]')?.textContent?.includes('添加提示') === true)
      assert.match(await settings.innerText(), /添加提示/)
      assert.match(await settings.locator('[data-testid="chat-starter-label-input"]').getAttribute('placeholder') ?? '', /按钮文字/)
      assert.match(await chips.first().getAttribute('title') ?? '', /\[source:github\]/, 'the prompt itself is never translated')
      await page.screenshot({ path: join(run.directory, 'settings-zh.png') })
      await page.evaluate(() => window.chatStartersFixture.setLanguage('en'))
      await page.waitForFunction(() => document.querySelector('#settings [data-testid="chat-starter-add"]')?.textContent?.includes('Add starter') === true)
    })

    const finalState = await state()
    run.json('chat-starters-browser.json', {
      base, checks, consoleLog, ipc: finalState.ipc, selections: finalState.selections,
      settingsWrites: finalState.settingsWrites, unknownHostApiTouched: finalState.unknownApi,
      pageErrors: errors, consoleErrors, failedRequests, browser: launched.browser.version(),
    })
    run.complete(checks.filter(item => item.passed).map(item => item.id), [
      'the new-chat landing that consumes the chips (own workflow: upgrade-0153-chat-starters-landing)',
      'workspace switch / restart in a real shell (covered by the RPC-level chat-starters workflow)',
      'a live model turn triggered by a starter (the send path is covered by the Pi workflows)',
      'macOS/Linux execution and native Electron packaging',
    ])
    assert.equal(errors.length, 0, errors.join('\n'))
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'))
    assert(checks.every(item => item.passed), JSON.stringify(checks.filter(item => !item.passed)))
  } finally {
    await launched.close()
    await fixture.close()
    console.log(JSON.stringify({ passed: checks.filter(item => item.passed).length, total: checks.length, output: run.directory }))
  }
})
