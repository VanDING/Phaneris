/** Same actual interaction sequence in the two production adapters. */
const assert = require('node:assert/strict')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

async function wait(page, predicate, argument) {
  const until = Date.now() + 60000
  while (!await page.evaluate(predicate, argument)) {
    if (Date.now() >= until) throw new Error('Conversation condition did not become true in 60000ms')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

exports.changeLanguageAndReturn = async function changeLanguageAndReturn(page, label, sessionName) {
  await page.locator('.sidebar-settings-trigger').click()
  await page.locator('.settings-item').filter({ hasText: /Appearance|外观/ }).locator('button').first().click()
  await page.locator('[data-layout="settings-row"]').filter({ has: page.getByText(/^(Language|语言)$/) }).getByRole('button').click()
  try {
    await page.locator('[data-option="true"]').filter({ has: page.getByText(label, { exact: true }) }).click()
  } catch (error) {
    const buttons = await page.getByRole('button').allTextContents()
    throw new Error(`Language selection failed: ${JSON.stringify(buttons)}`, { cause: error })
  }
  const language = label === 'English' ? 'en' : 'zh-Hans'
  await wait(page, expected => window.localStorage.getItem('i18nextLng') === expected, language)
  await page.getByRole('button', { name: /All Sessions|所有会话/ }).first().click()
  await page.getByText(sessionName, { exact: true }).first().click()
  await page.getByRole('button', { name: language === 'en' ? 'Send message' : '发送消息', exact: true }).waitFor()
}

exports.verifyConversation = async function verifyConversation(page, fixture, output, host) {
  const checks = [], events = []
  await exports.changeLanguageAndReturn(page, 'English', fixture.name)
  await page.evaluate(id => {
    window.__conversationEvents = []
    window.__unsubscribeConversation = window.electronAPI.onSessionEvent(event => {
      if (event.sessionId === id) window.__conversationEvents.push(event.type)
    })
  }, fixture.session)
  const input = page.locator('[contenteditable="true"]').first()
  const send = async message => {
    await input.fill(message)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
  }
  const idle = () => wait(page, async id => !(await window.electronAPI.getSessionMessages(id)).isProcessing, fixture.session)
  try {
    await send('GOVERNANCE_PERMISSION: write the fixture file after approval.')
    await page.getByRole('button', { name: 'Allow', exact: true }).waitFor({ timeout: 60000 })
    assert(!existsSync(fixture.filePath), 'Permission wait must precede the actual file effect')
    checks.push(`${host} permission waits before real file effect`)
    await page.getByRole('button', { name: 'Allow', exact: true }).click()
    await page.getByText('GOVERNANCE_PERMISSION_DONE', { exact: true }).waitFor({ timeout: 60000 })
    await idle()
    assert.equal(readFileSync(fixture.filePath, 'utf8'), 'GOVERNANCE_WRITE_EVIDENCE\n')
    checks.push(`${host} permission approval completes real Pi write`)
    const closeFileViews = async () => {
      for (const name of ['Close Artifact', 'Close Preview']) {
        const close = page.getByRole('button', { name, exact: true })
        while (await close.count()) await close.first().click()
      }
      await page.getByTestId('artifact-workbench').waitFor({ state: 'hidden' })
    }
    const verifyFileView = async label => {
      await closeFileViews()
      await page.getByRole('link', { name: label, exact: true }).click()
      await page.getByTestId('artifact-workbench').getByText('GOVERNANCE_WRITE_EVIDENCE', { exact: true }).first().waitFor()
      assert.equal(await page.getByText('Failed to open file', { exact: true }).count(), 0, `${label} must not report an open failure`)
    }
    await verifyFileView('Preview governance file')
    await page.screenshot({ path: join(output, `${host}-file-preview.png`), fullPage: true })
    await page.keyboard.press('Escape')
    checks.push(`${host} preview reads the actual written file`)
    for (const label of ['Preview with slashes', 'Preview file URL', 'Preview encoded path', 'Preview relative file', 'Preview source location']) {
      await verifyFileView(label)
    }
    await closeFileViews()
    checks.push(`${host} answer links open Unicode spaced files through all six path forms`)
    await send('GOVERNANCE_PLAN_REQUEST: submit the prepared fixture plan.')
    await page.getByText('GOVERNANCE_PLAN_BODY', { exact: true }).first().waitFor({ timeout: 60000 })
    await idle()
    await page.getByRole('button', { name: 'Accept Plan', exact: true }).waitFor()
    await page.screenshot({ path: join(output, `${host}-plan.png`), fullPage: true })
    await page.getByRole('button', { name: 'Accept Plan', exact: true }).click()
    await page.getByRole('menuitem').filter({ has: page.getByText('Accept', { exact: true }) }).click()
    await page.getByText('GOVERNANCE_CONTINUATION_DONE', { exact: true }).first().waitFor({ timeout: 60000 })
    await idle()
    checks.push(`${host} real SubmitPlan card accepts and continues once`)
    await send('GOVERNANCE_CANCEL: keep streaming until stopped.')
    await page.getByText('GOVERNANCE_CANCEL_RUNNING', { exact: true }).waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: 'Stop response', exact: true }).click()
    await idle()
    checks.push(`${host} actual response cancellation returns the session to idle`)
    await send('GOVERNANCE_THINKING: show thinking before the answer.')
    await page.getByRole('button', { name: /GOVERNANCE_THINKING_CONTENT/ }).click({ timeout: 60000 })
    const thinking = page.locator('[data-activity-type="thinking"]').last()
    await thinking.waitFor({ timeout: 60000 })
    assert.equal(await page.getByText('GOVERNANCE_THINKING_DONE', { exact: true }).count(), 0)
    assert.match(await thinking.innerText(), /GOVERNANCE_THINKING_CONTENT/)
    await thinking.getByRole('button').click()
    await page.getByRole('dialog').waitFor()
    assert.match(await page.getByRole('dialog').innerText(), /GOVERNANCE_THINKING_CONTENT/)
    await page.screenshot({ path: join(output, `${host}-thinking-fullscreen.png`) })
    await page.keyboard.press('Escape')
    await page.getByText('GOVERNANCE_THINKING_DONE', { exact: true }).waitFor({ timeout: 60000 })
    await idle()
    checks.push(`${host} real Pi thinking arrives before text and opens the shared fullscreen preview`)
    await send('GOVERNANCE_THINKING_CANCEL: stop while thinking.')
    await page.getByRole('button', { name: /GOVERNANCE_THINKING_CONTENT/ }).last().click({ timeout: 60000 })
    await thinking.waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: 'Stop response', exact: true }).click()
    await idle()
    await wait(page, async id => (await window.electronAPI.getSessionMessages(id)).messages.filter(message =>
      message.role === 'assistant' && message.outputBlocks?.some(block => block.type === 'thinking' && block.content?.includes('GOVERNANCE_THINKING_CONTENT'))).length >= 2, fixture.session)
    checks.push(`${host} cancelled thinking is retained in the authoritative session snapshot`)
    await input.fill('Retained reconnect draft')
    await page.evaluate(() => window.electronAPI.reconnectTransport())
    await wait(page, async () => (await window.electronAPI.getTransportConnectionState()).status === 'connected')
    await wait(page, async id => (await window.electronAPI.getDraft(id))?.text === 'Retained reconnect draft', fixture.session)
    assert.equal(await input.textContent(), 'Retained reconnect draft')
    checks.push(`${host} reconnect preserves and persists the latest queued draft`)
    await page.getByText('Governance session', { exact: true }).first().click()
    await page.getByText(fixture.name, { exact: true }).first().click()
    await page.getByText('GOVERNANCE_PERMISSION_DONE', { exact: true }).waitFor()
    const history = await page.evaluate(id => window.electronAPI.getSessionMessages(id), fixture.session)
    assert.equal(history.messages.filter(message => message.role === 'user' && message.content.includes('GOVERNANCE_PERMISSION')).length, 1)
    assert.equal(history.messages.filter(message => message.role === 'plan').length, 1)
    checks.push(`${host} reconnect and history merge preserve single user and plan facts`)
    events.push(...await page.evaluate(() => window.__conversationEvents))
    assert(events.includes('permission_request'), 'Actual permission event is required')
    assert(events.includes('plan_submitted'), 'Actual plan event is required')
    writeFileSync(join(output, `${host}-conversation.json`), JSON.stringify({ checks, events, history }, null, 2))
    return checks
  } finally {
    await page.screenshot({ path: join(output, `${host}-conversation-final.png`), fullPage: true }).catch(() => {})
    await page.evaluate(() => window.__unsubscribeConversation?.()).catch(() => {})
    writeFileSync(join(output, `${host}-conversation-progress.json`), JSON.stringify({ checks, events: await page.evaluate(() => window.__conversationEvents).catch(() => []) }, null, 2))
  }
}
