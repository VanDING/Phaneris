#!/usr/bin/env bun
/** U01-U03: actual WebUI/business renderer, real authenticated server and persisted fixture. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { verificationWorkflow } from './verification-artifacts'
import { startProcess, testSecret } from './fixtures/governance-process-support'
import { seedConversationFixture, verifyConversationDurability } from './fixtures/conversation-model'
import { verifyConversation, changeLanguageAndReturn } from './fixtures/conversation-client.cjs'

await verificationWorkflow('client-platform', async run => {
  const config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace'), secondWorkspace = join(run.directory, 'second-workspace')
  mkdirSync(config, { recursive: true }); mkdirSync(workspace, { recursive: true }); mkdirSync(secondWorkspace, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = config
  const conversation = await seedConversationFixture(config, workspace)
  writeFileSync(join(config, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'fixture', name: 'Governance workspace', rootPath: workspace, createdAt: 1 },
      { id: 'second', name: 'Second workspace', rootPath: secondWorkspace, createdAt: 2 }],
    activeWorkspaceId: 'fixture', setupDeferred: true,
    llmConnections: [conversation.connection], defaultLlmConnection: 'fixture',
  }))
  const { createSession } = await import('../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: 'Governance session' })
  const other = await createSession(workspace, { name: 'Other governance session' })
  const second = await createSession(secondWorkspace, { name: 'Second workspace session' })
  const build = Bun.spawn([process.execPath, 'run', 'webui:build'], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' })
  const [buildOut, buildErr, buildCode] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
  writeFileSync(join(run.directory, 'production-web-build.log'), buildOut + buildErr)
  assert.equal(buildCode, 0, buildErr.slice(-2000))
  const child = await startProcess({ config, webui: resolve('apps/webui/dist') })
  const launched = await launchWorkflowBrowser()
  const errors: string[] = [], consoleTrace: { type: string; text: string; duringOffline: boolean }[] = [], traces: unknown[] = [], checks: string[] = []
  const errorStacks: string[] = []
  let networkOffline = false
  try {
    const base = child.url.replace(/^ws/, 'http')
    const page = await launched.browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    page.on('pageerror', error => { errors.push(error.message); errorStacks.push(error.stack ?? error.message) })
    page.on('console', message => consoleTrace.push({ type: message.type(), text: message.text().slice(0, 2000), duringOffline: networkOffline }))
    page.on('websocket', socket => {
      socket.on('framesent', frame => { try { const message = JSON.parse(String(frame.payload)); traces.push({ direction: 'send', type: message.type, channel: message.channel }) } catch {} })
      socket.on('framereceived', frame => { try { const message = JSON.parse(String(frame.payload)); traces.push({ direction: 'receive', type: message.type, channel: message.channel }) } catch {} })
    })
    const auth = await page.request.post(new URL('/api/auth', base).href, { data: { password: testSecret } })
    assert(auth.ok())
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/config', async route => { await delayed; await route.continue() })
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    assert.equal(await page.evaluate(() => document.documentElement.dataset.clientPlatform), undefined)
    checks.push('business renderer is absent while adapter configuration is delayed')
    release()
    await page.waitForFunction(() => document.documentElement.dataset.clientPlatform === 'web', null, { timeout: 60_000 })
    await waitForBrowserCondition(page, async () => (await window.electronAPI.getSessions()).length > 0)
    checks.push('authenticated transport is ready before business renderer mounts')
    const value = await page.evaluate(async () => ({ sessions: await window.electronAPI.getSessions(), state: await window.electronAPI.getTransportConnectionState() }))
    assert(value.sessions.some(item => item.id === session.id)); assert.equal(value.state.status, 'connected')
    await page.getByText('Governance session', { exact: true }).first().waitFor({ timeout: 60_000 })
    checks.push('production RPC facade reads persisted fixture sessions')
    await page.getByText('Governance session', { exact: true }).first().click()
    const composer = page.locator('[contenteditable="true"]').first()
    await composer.waitFor()
    await composer.fill('Draft remains with its session')
    await waitForBrowserCondition(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Draft remains with its session', session.id)
    await page.getByText('Other governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === '')
    await composer.fill('Other independent draft')
    await waitForBrowserCondition(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Other independent draft', other.id)
    await page.getByText('Governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Draft remains with its session')
    checks.push('session switching preserves separate persisted input drafts')
    const selectedRow = page.getByText('Other governance session', { exact: true }).first().locator('xpath=ancestor::*[@role="option"][1]')
    assert.equal(await selectedRow.count(), 1, 'Session row exposes its actual keyboard target')
    await selectedRow.focus()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.keyboard.press('Enter')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    run.json('keyboard-state.json', await page.evaluate(async ids => ({
      url: location.href, focused: document.activeElement?.outerHTML.slice(0, 2000),
      inputs: [...document.querySelectorAll('[contenteditable="true"]')].map(element => ({ text: element.textContent, visible: element.getClientRects().length > 0 })),
      rows: [...document.querySelectorAll('[role="option"]')].map(element => ({ text: element.textContent, selected: element.getAttribute('aria-selected') })),
      drafts: await Promise.all(ids.map(id => window.electronAPI.getDraft(id))),
    }), [session.id, other.id]))
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Other independent draft')
    await page.getByText('Governance session', { exact: true }).first().click()
    checks.push('session row keyboard activation preserves draft ownership')
    await changeLanguageAndReturn(page, '简体中文', 'Governance session')
    assert.equal(await page.evaluate(() => document.querySelector('[contenteditable="true"]')?.textContent), 'Draft remains with its session')
    checks.push('language change retains current input draft')
    await composer.fill('Draft remains with its session after a rapid workspace switch')
    await page.getByText('Governance workspace', { exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Second workspace' }).click()
    await page.getByText('Second workspace session', { exact: true }).first().waitFor()
    assert.equal(await page.evaluate(() => window.electronAPI.getWindowWorkspace()), 'second')
    const reconnectStates = await page.evaluate(async () => {
      const states: string[] = []
      const release = window.electronAPI.onTransportConnectionStateChanged(state => states.push(state.status))
      try { await window.electronAPI.reconnectTransport(); return states } finally { release() }
    })
    assert(reconnectStates.includes('reconnecting'), 'Closing the old socket must synchronously retire its connected status')
    checks.push('manual reconnect publishes reconnecting before old socket close')
    await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    assert((await page.evaluate(() => window.electronAPI.getSessions())).some(item => item.id === second.id))
    checks.push('workspace switching and reconnect keep the accepted client binding')
    await page.getByText('Second workspace', { exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Governance workspace' }).click()
    await page.getByText('Governance session', { exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent === 'Draft remains with its session after a rapid workspace switch')
    checks.push('returning to a workspace restores its session draft')
    assert.equal((await page.evaluate(id => window.electronAPI.getDraft(id), session.id))?.text, 'Draft remains with its session after a rapid workspace switch')
    checks.push('rapid workspace switching flushes pending composer and persistence timers')
    const unavailable = await page.evaluate(async () => {
      try { await window.electronAPI.showInFolder('/fixture'); return 'false success' }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    })
    assert.match(unavailable, /capability.*unavailable/i)
    checks.push('unsupported native file capability fails explicitly')
    await page.evaluate(async () => { await window.electronAPI.reconnectTransport() })
    await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    assert((await page.evaluate(() => window.electronAPI.getSessions())).some(item => item.id === session.id))
    checks.push('reconnect retains production session domain state')
    networkOffline = true
    await page.context().setOffline(true)
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status !== 'connected')
    await composer.fill('Draft edited while offline')
    // Hold the real browser network offline beyond the production debounce.
    await new Promise(resolve => setTimeout(resolve, 750))
    await page.getByText('Governance workspace', { exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Second workspace' }).click()
    await page.locator('[data-sonner-toast][data-type="error"]').first().waitFor()
    assert.equal(await page.evaluate(() => window.electronAPI.getWindowWorkspace()), 'fixture')
    assert.equal(await composer.textContent(), 'Draft edited while offline')
    checks.push('offline workspace switch reports failure and preserves binding and draft')
    await page.context().setOffline(false)
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await waitForBrowserCondition(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    networkOffline = false
    await waitForBrowserCondition(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Draft edited while offline', session.id)
    assert.equal(await composer.textContent(), 'Draft edited while offline')
    checks.push('real browser offline edits persist after reconnection without an unhandled rejection')
    checks.push(...await verifyConversation(page, conversation, run.directory, 'web'))
    await page.getByRole('button', { name: 'Files', exact: true }).last().click()
    const writtenFile = page.getByText(conversation.filePath.split('/').at(-1)!, { exact: true }).last()
    await writtenFile.waitFor()
    await writtenFile.click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem', { name: /Show in Finder|Show in.*manager/ }).count(), 0)
    await page.keyboard.press('Escape')
    await writtenFile.dblclick()
    await page.getByText('GOVERNANCE_WRITE_EVIDENCE', { exact: true }).first().waitFor()
    await page.keyboard.press('Escape')
    checks.push('web file double-click previews and native reveal controls are absent')
    await verifyConversationDurability(workspace, conversation.session, run.directory, 'web')
    const provider = conversation.report()
    assert.equal(provider.requests.filter(request => request.mode === 'permission' && !request.toolResult).length, 1)
    assert.equal(provider.requests.filter(request => request.mode === 'plan' && !request.toolResult).length, 1)
    assert.equal(provider.requests.filter(request => request.mode === 'cancel').length, 1)
    run.json('conversation-provider.json', provider)
    for (const width of [1280, 420]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: join(run.directory, `webui-${width}.png`), fullPage: true })
      checks.push(`${width}px renderer with reduced motion`)
    }
    assert.deepEqual(errors, [])
    const expectedNetworkErrors = consoleTrace.filter(message => message.type === 'error' && message.duringOffline
      && (message.text === 'WebSocket error during connection setup'
        || message.text.startsWith('Failed to persist session draft: Error: WebSocket error during connection setup\n')
        || (message.text.startsWith(`WebSocket connection to 'ws://127.0.0.1:${new URL(child.url).port}/' failed:`)
          && message.text.endsWith('net::ERR_INTERNET_DISCONNECTED'))))
    assert.deepEqual(consoleTrace.filter(message => message.type === 'error' && !expectedNetworkErrors.includes(message)), [])
    run.json('client-platform.json', { checks, errors, consoleTrace, expectedNetworkErrors, traces, server: child.url })
    run.complete(checks, ['live external provider and OAuth'])
  } finally {
    run.json('client-diagnostics.json', { checks, errors, errorStacks, consoleTrace, traces })
    await launched.close(); await child.stop(); conversation.stop()
    run.json('server-output.json', { stdout: child.stdout(), stderr: child.stderr() })
  }
})
