#!/usr/bin/env bun
/**
 * Chat Starters on the real new-chat landing (CS-06 / CS-07 interaction surface).
 *
 * The chips themselves are covered by `upgrade-0153-chat-starters-browser-workflow.ts`.
 * This workflow mounts the surface that CONSUMES them — the real `ChatDisplay`
 * landing — and asserts what a click does there: resolve the starter's mentions,
 * enable the mentioned sources through the production session-command path,
 * wait for that enable to be applied, and only then send the prompt through the
 * normal composer send path. The host is a recording stub whose `setSources`
 * resolves after a measured delay, so "enabled before send" is a measurable
 * ordering fact rather than a claim.
 *
 * The page is built once by a Node child (`fixture-bundle-host.mjs`) and served
 * as plain files: a Vite dev server driven from the same process as Playwright
 * deadlocks here, and this page's dependency graph is large.
 *
 * Usage: bun run scripts/verification/upgrade-0153-chat-starters-landing-workflow.ts
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import { buildFixturePage } from './fixture-bundle'
import { launchWorkflowBrowser } from './workflow-browser'

await verificationWorkflow('upgrade-0153-chat-starters-landing', async run => {
  const launched = await launchWorkflowBrowser()
  console.log('[landing] browser', launched.browser.version())
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const fixture = await buildFixturePage({ runDirectory: run.directory, entry: 'scripts/verification/fixtures/chat-starters-landing.tsx' })
  const base = fixture.url
  console.log('[landing] fixture page', base)
  const errors: string[] = [], consoleErrors: string[] = [], consoleLog: string[] = []
  const checks: { id: string; passed: boolean; error?: string }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    const text = message.text()
    if (message.type() === 'error') consoleErrors.push(text)
    if (consoleLog.length < 200) consoleLog.push(`${message.type()}: ${text.slice(0, 300)}`)
  })

  const chips = page.locator('#chat [data-testid="chat-starter"]')
  const state = () => page.evaluate(() => ({
    ipc: window.chatStartersLanding.ipc, sends: window.chatStartersLanding.sends,
    unknownApi: [...window.chatStartersLanding.unknownApi],
  }))
  const reset = () => page.evaluate(() => {
    window.chatStartersLanding.ipc.length = 0
    window.chatStartersLanding.sends.length = 0
  })
  /** Wait until the previous scene's enable-then-send has fully settled. */
  const waitForIdleStarter = () => page.waitForFunction(() => {
    const entries = window.chatStartersLanding.ipc.filter(entry => entry.method === 'onSourcesChange')
    const last = entries[entries.length - 1]
    return !last || Boolean(last.resolvedAt)
  }, undefined, { timeout: 15_000 })
  async function check(id: string, fn: () => Promise<void>) {
    try { await fn(); checks.push({ id, passed: true }) }
    catch (error) { checks.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }) }
  }

  try {
    let booted = false
    for (let attempt = 1; attempt <= 2 && !booted; attempt += 1) {
      console.log(`[landing] boot attempt ${attempt}`)
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(error => {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
        errors.push(`goto attempt ${attempt}: ${message}`)
        console.log(`[landing] goto failed: ${message}`)
      })
      booted = await page.waitForFunction(() => window.chatStartersLanding?.ready === true, undefined, { timeout: 90_000 })
        .then(() => true).catch(() => false)
      console.log(`[landing] attempt ${attempt} ready=${booted}`)
      if (!booted) await Bun.sleep(1_000)
    }
    const boot = await page.evaluate(() => ({
      ready: window.chatStartersLanding?.ready ?? false,
      renders: window.chatStartersLanding?.renders?.() ?? -1,
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      bodyText: document.body.innerText.slice(0, 600),
    }))
    run.json('boot.json', { base, boot, consoleLog, errors, consoleErrors })
    assert(booted && boot.ready, `fixture page never became ready (${JSON.stringify({ boot, errors, consoleErrors })})`)
    await page.evaluate(() => document.fonts.ready)

    await check('CSL-01-landing-chips', async () => {
      await chips.first().waitFor()
      assert.equal(await chips.count(), 3, 'the landing renders the configured starters')
      assert.equal(await page.locator('#chat [data-testid="chat-starters"]').getAttribute('data-chat-starter-count'), '3')
      assert.match(boot.bodyText, /Review pull requests/, 'the chips are visible above the composer')
      await page.screenshot({ path: join(run.directory, 'landing.png') })
    })

    // A starter with a source mention: the source is enabled BEFORE the send.
    await check('CSL-02-source-enabled-before-send', async () => {
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(400))
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.sends.length === 1, undefined, { timeout: 30_000 })
      const { ipc, sends } = await state()
      const setSources = ipc.filter(entry => entry.method === 'sessionCommand:setSources').at(-1)
      const enable = ipc.filter(entry => entry.method === 'onSourcesChange').at(-1)
      assert(setSources, `the click must enable the mentioned source (saw ${JSON.stringify(ipc)})`)
      assert.deepEqual(setSources!.args[1], ['github'], 'only the mentioned source is enabled')
      assert(enable, 'the enable must go through the shell callback')
      assert((enable!.resolvedAt ?? 0) >= enable!.at + 380, `the enable must actually be awaited (${JSON.stringify(enable)})`)
      assert.equal(sends.length, 1, 'exactly one message is sent')
      assert.equal(sends[0]!.text, 'Review the open pull requests [source:github] [skill:review-prs]', 'the prompt is sent verbatim')
      assert.deepEqual(sends[0]!.skills, ['review-prs'], 'the mentioned skill rides on the send')
      assert(sends[0]!.at >= enable!.resolvedAt!, `the send must happen after the enable resolved (${JSON.stringify({ enable, send: sends[0] })})`)
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(0))
    })

    await check('CSL-03-second-starter', async () => {
      await reset()
      await chips.nth(1).click()
      await page.waitForFunction(() => window.chatStartersLanding.sends.length === 1, undefined, { timeout: 30_000 })
      const { ipc, sends } = await state()
      assert.deepEqual(ipc.filter(entry => entry.method === 'sessionCommand:setSources').at(-1)!.args[1], ['github', 'gmail'],
        'the previously enabled source is kept and the newly mentioned one is added')
      assert.equal(sends[0]!.skills, undefined, 'a starter without a skill mention sends no skill list')
    })

    await check('CSL-04-no-mention-sends-nothing-extra', async () => {
      await reset()
      await chips.nth(2).click()
      await page.waitForFunction(() => window.chatStartersLanding.sends.length === 1, undefined, { timeout: 30_000 })
      const { ipc, sends } = await state()
      assert.equal(ipc.filter(entry => entry.method.startsWith('sessionCommand')).length, 0, 'no source is enabled for a mention-free starter')
      assert.equal(sends[0]!.text, 'Plain question with no mentions')
    })

    // The chip must not become a privileged shortcut: only the normal send path.
    await check('CSL-05-safe-mode-no-bypass', async () => {
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setPermissionMode('safe'))
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.sends.length === 1, undefined, { timeout: 30_000 })
      const { ipc, sends } = await state()
      assert.equal(sends.length, 1, 'the message goes through the normal send path in safe mode too')
      const methods = ipc.map(entry => entry.method)
      assert(methods.every(method => method === 'onSourcesChange' || method === 'sessionCommand:setSources'),
        `a starter may only enable sources; it must not touch files, sessions or permissions (saw ${JSON.stringify(methods)})`)
      await page.evaluate(() => window.chatStartersLanding.setPermissionMode('ask'))
    })

    // A composer that cannot send leaves the chips inert, and re-enabling works.
    await check('CSL-06-disabled-is-inert', async () => {
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setDisabled(true))
      await page.waitForFunction(() => (document.querySelector('#chat [data-testid="chat-starter"]') as HTMLButtonElement | null)?.disabled === true)
      await chips.nth(0).click({ force: true })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      const disabledState = await state()
      assert.equal(disabledState.sends.length, 0, 'a disabled chip never sends')
      assert.equal(disabledState.ipc.length, 0, 'a disabled chip performs no source change')
      // A disabled button does not reach the click handler at all, so this is
      // silent by construction — the inertness above is the assertion. The
      // "cannot send" toast belongs to the enabled-but-unavailable case, which
      // this harness does not fake.
      await page.evaluate(() => window.chatStartersLanding.setDisabled(false))
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.sends.length === 1, undefined, { timeout: 30_000 })
      await page.screenshot({ path: join(run.directory, 'landing-after-send.png') })
    })

    // A failed enable must stop the send and say why.
    await check('CSL-07-source-failure-does-not-send', async () => {
      await waitForIdleStarter()
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setEnabledSources([]))
      await page.waitForFunction(() => window.chatStartersLanding.enabledSources().length === 0, undefined, { timeout: 5_000 })
      await page.evaluate(() => window.chatStartersLanding.failNextSourceEnable('setSources rejected by the host'))
      await chips.nth(0).click()
      await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length > 0, undefined, { timeout: 15_000 })
        .catch(() => {})
      await page.waitForTimeout(500)
      const { sends, ipc } = await state()
      assert.equal(sends.length, 0, 'a starter whose source could not be enabled must not send its message')
      assert(ipc.some(entry => entry.method === 'onSourcesChange'), 'the enable was attempted')
      const toasts = await page.locator('[data-sonner-toast]').allInnerTexts()
      assert(toasts.some(text => /enable source|无法启用来源/i.test(text)), `the failure must be visible (saw ${JSON.stringify(toasts)})`)
      assert(toasts.some(text => /setSources rejected by the host/.test(text)), 'the host message must be shown')
      await page.screenshot({ path: join(run.directory, 'landing-source-failure.png') })
    })

    // A click that is invalidated while the enable is in flight must not send.
    await check('CSL-08-disabled-during-wait-does-not-send', async () => {
      await waitForIdleStarter()
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setEnabledSources([]))
      await page.waitForFunction(() => window.chatStartersLanding.enabledSources().length === 0, undefined, { timeout: 5_000 })
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(700))
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.ipc.some(entry => entry.method === 'onSourcesChange'), undefined, { timeout: 10_000 })
      await page.evaluate(() => window.chatStartersLanding.setDisabled(true))
      await page.waitForTimeout(1_200)
      assert.equal((await state()).sends.length, 0, 'a click that was disabled while waiting must not send')
      await page.evaluate(() => { window.chatStartersLanding.setDisabled(false); window.chatStartersLanding.setSourceDelay(0) })
    })

    await check('CSL-09-session-switch-during-wait-does-not-send', async () => {
      await waitForIdleStarter()
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setEnabledSources([]))
      await page.waitForFunction(() => window.chatStartersLanding.enabledSources().length === 0, undefined, { timeout: 5_000 })
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(700))
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.ipc.some(entry => entry.method === 'onSourcesChange'), undefined, { timeout: 10_000 })
      await page.evaluate(() => window.chatStartersLanding.setSession('session-other', 'ws-fixture'))
      await page.waitForTimeout(1_200)
      assert.equal((await state()).sends.length, 0, 'a click that outlived its session must not send')
      await page.evaluate(() => { window.chatStartersLanding.setSession('session-fixture', 'ws-fixture'); window.chatStartersLanding.setSourceDelay(0) })
    })

    await check('CSL-10-workspace-switch-during-wait-does-not-send', async () => {
      await waitForIdleStarter()
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setEnabledSources([]))
      await page.waitForFunction(() => window.chatStartersLanding.enabledSources().length === 0, undefined, { timeout: 5_000 })
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(700))
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.ipc.some(entry => entry.method === 'onSourcesChange'), undefined, { timeout: 10_000 })
      await page.evaluate(() => window.chatStartersLanding.setSession('session-fixture', 'ws-other'))
      await page.waitForTimeout(1_200)
      assert.equal((await state()).sends.length, 0, 'a click that outlived its workspace must not send')
      await page.evaluate(() => window.chatStartersLanding.setSession('session-fixture', 'ws-fixture'))
    })

    await check('CSL-11-double-click-sends-once', async () => {
      await waitForIdleStarter()
      await reset()
      await page.evaluate(() => window.chatStartersLanding.setEnabledSources([]))
      await page.waitForFunction(() => window.chatStartersLanding.enabledSources().length === 0, undefined, { timeout: 5_000 })
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(2_000))
      await chips.nth(0).click()
      await chips.nth(0).click()
      await chips.nth(0).click()
      await page.waitForFunction(() => window.chatStartersLanding.sends.length > 0, undefined, { timeout: 15_000 })
      await page.waitForTimeout(1_000)
      assert.equal((await state()).sends.length, 1, 'repeated clicks during an in-flight enable must send exactly once')
      await page.evaluate(() => window.chatStartersLanding.setSourceDelay(0))
    })

    const finalState = await state()
    run.json('chat-starters-landing.json', {
      base, checks, consoleLog, ipc: finalState.ipc, sends: finalState.sends,
      unknownHostApiTouched: finalState.unknownApi, pageErrors: errors, consoleErrors,
      browser: launched.browser.version(),
    })
    run.complete(checks.filter(item => item.passed).map(item => item.id), [
      'a live model turn triggered by a starter (the send path is covered by the Pi workflows)',
      'workspace switch / restart in a real shell',
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
