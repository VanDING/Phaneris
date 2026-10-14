#!/usr/bin/env bun
/** Real settings deletion → desktop/compact picker → persisted session → Pi → loopback provider.
 * Written before the fix. Failure cases: deleted-provider warning hides choices;
 * a sole replacement is locked; sending uses an implicit fallback; switching
 * loses the draft/history; the old runtime survives; or persistence reverts.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from 'playwright'
import { routes } from '../../apps/electron/src/shared/routes'
import type { Session } from '../../apps/electron/src/shared/types'
import { verificationWorkflow } from './verification-artifacts'
import { launchWorkflowBrowser, waitForBrowserCondition } from './workflow-browser'
import { startProcess, testSecret, type RunningProcess } from './fixtures/governance-process-support'

await verificationWorkflow('deleted-provider-recovery', async run => {
  const config = join(run.directory, 'config'), workspace = join(run.directory, 'workspace')
  mkdirSync(config); mkdirSync(workspace)
  process.env.PHANERIS_CONFIG_DIR = config
  const requests: { connection: string; messages: unknown[]; tools: number }[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ object: 'list', data: [{ id: 'recovery-fixture', object: 'model', owned_by: 'fixture' }] })
    const body = await request.json() as { messages: { role: string; content: unknown }[]; tools?: unknown[] }
    const connection = new URL(request.url).pathname.split('/')[1]!
    requests.push({ connection, messages: body.messages, tools: body.tools?.length ?? 0 })
    const lastUser = body.messages.findLast(message => message.role === 'user')
    const content = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content)
    const marker = content?.match(/(?:HISTORY|CONTINUE)_[a-z_]+/)?.[0] ?? 'utility'
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({
      id: `recovery-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'recovery-fixture',
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(finish ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}),
    })}\n\n`
    return new Response(chunk({ role: 'assistant', content: `REPLY_${connection}_${marker}` }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const connection = (slug: string, name: string) => ({ slug, name, providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
    baseUrl: new URL(`${slug}/v1`, api.url).href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'pi/recovery-fixture',
    models: [{ id: 'recovery-fixture', name: 'Recovery model', shortName: 'Recovery model', description: 'Local verification model',
      provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'fixture', name: 'Recovery workspace', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'fixture', setupDeferred: true, defaultLlmConnection: 'removed',
    llmConnections: [connection('removed', 'Removed provider'), connection('retained', 'Retained provider'), connection('extra', 'Extra provider')] }))
  const { getCredentialManager } = await import('../../packages/shared/src/credentials/manager')
  for (const slug of ['removed', 'retained', 'extra']) await getCredentialManager().setLlmApiKey(slug, 'recovery-fixture-only-key')
  const { createSession, loadSession } = await import('../../packages/shared/src/sessions/storage')
  const scenes: { id: string; session: string }[] = []
  for (const id of ['desktop_multi', 'compact_multi', 'desktop_single', 'compact_single']) {
    const session = await createSession(workspace, { name: id, workingDirectory: workspace, permissionMode: 'ask',
      model: 'pi/recovery-fixture', llmConnection: 'removed' })
    scenes.push({ id, session: session.id })
  }
  const build = Bun.spawn([process.execPath, 'run', 'webui:build'], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
  writeFileSync(join(run.directory, 'web-build.log'), stdout + stderr)
  assert.equal(code, 0, stderr.slice(-3000))
  let child: RunningProcess | undefined
  let launched: Awaited<ReturnType<typeof launchWorkflowBrowser>> | undefined
  let page: Page | undefined
  const checks: string[] = [], errors: string[] = []
  const histories: Record<string, Session | null> = {}
  try {
    const start = async () => {
      // The full server imports can take more than the shared helper's 20s on Windows.
      child = await startProcess({ config, webui: resolve('apps/webui/dist'), ready: false })
      const deadline = Date.now() + 60_000
      while (!child.url) {
        assert(child.process.exitCode === null && Date.now() < deadline, `Server failed to start: ${child.stderr()}`)
        await Bun.sleep(100)
      }
    }
    await start()
    if (process.platform === 'win32') process.env.PHANERIS_TEST_BROWSER_CHANNEL ??= 'msedge'
    launched = await launchWorkflowBrowser()
    page = await launched.browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push(error.stack ?? error.message))
    const open = async () => {
      const base = child!.url.replace(/^ws/, 'http')
      assert((await page!.request.post(new URL('/api/auth', base).href, { data: { password: testSecret } })).ok())
      await page!.goto(base, { waitUntil: 'domcontentloaded' })
      await page!.waitForFunction(() => document.documentElement.dataset.clientPlatform === 'web', null, { timeout: 60_000 })
      await waitForBrowserCondition(page!, async () => (await window.electronAPI.getSessions()).length === 4)
      await page!.getByText('desktop_multi', { exact: true }).first().waitFor({ timeout: 60_000 })
    }
    const navigate = (route: string) => page!.evaluate(route => window.dispatchEvent(new CustomEvent('phaneris-navigate', { detail: { route } })), route)
    const select = async (id: string) => {
      await navigate(routes.view.allSessions(id))
      // Wait for the actual chat header, not an input left over from the previous session.
      await page!.getByRole('button', { name: scenes.find(scene => scene.session === id)!.id, exact: true }).waitFor()
      await page!.locator('[contenteditable="true"]').first().waitFor()
    }
    const idle = (id: string) => waitForBrowserCondition(page!, async id => !(await window.electronAPI.getSessionMessages(id))?.isProcessing, id, 60_000)
    const send = async (message: string, slug: string, id: string) => {
      await page!.locator('[contenteditable="true"]').first().fill(message)
      await page!.getByRole('button', { name: 'Send message', exact: true }).click()
      await page!.getByText(`REPLY_${slug}_${message}`, { exact: true }).waitFor({ timeout: 60_000 })
      await idle(id)
    }
    const removeInSettings = async (slug: string) => {
      await page!.setViewportSize({ width: 1280, height: 900 })
      await navigate(routes.view.settings('ai'))
      await page!.locator(`[data-connection-slug="${slug}"]`).getByRole('button').click()
      await page!.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      await page!.locator(`[data-connection-slug="${slug}"]`).waitFor({ state: 'detached' })
      await waitForBrowserCondition(page!, async slug => !(await window.electronAPI.listLlmConnections()).some(connection => connection.slug === slug), slug)
    }
    await open()
    for (const scene of scenes) {
      await select(scene.session)
      await send(`HISTORY_${scene.id}`, 'removed', scene.session)
      const original: Session | null = await page.evaluate(id => window.electronAPI.getSessionMessages(id), scene.session)
      assert(original!.messages.some(message => message.role === 'user' && message.content === `HISTORY_${scene.id}`), 'History must belong to the selected session')
    }
    checks.push('existing sessions used the removed provider through real Pi runtimes')
    console.log('PASS original conversations on the removed provider')
    await removeInSettings('removed')
    checks.push('provider deleted through the actual AI settings UI')
    for (const scene of scenes) {
      if (scene.id === 'desktop_single') await removeInSettings('extra')
      await page.setViewportSize({ width: scene.id.startsWith('compact') ? 420 : 1280, height: 900 })
      await select(scene.session)
      await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
      await page.locator('[contenteditable="true"]').first().fill(`CONTINUE_${scene.id}`)
      assert(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), 'Sending must wait for explicit replacement selection')
      const before: Session | null = await page.evaluate(id => window.electronAPI.getSessionMessages(id), scene.session)
      assert.equal(before!.llmConnection, 'removed', 'Deleting must not silently choose another account')
      assert(before!.messages.some(message => message.role === 'user' && message.content === `HISTORY_${scene.id}`))
      const trigger = page.getByRole('button', { name: 'Unavailable', exact: true })
      // The desktop trigger exposes its visible label; the compact trigger has an aria-label.
      await trigger.click()
      const providerRow = page.getByRole(scene.id.startsWith('compact') ? 'button' : 'menuitem').filter({ hasText: 'Retained provider' })
      await providerRow.waitFor()
      await page.screenshot({ path: join(run.directory, `${scene.id}-choices.png`), fullPage: true })
      if (scene.id.startsWith('compact')) {
        await providerRow.click()
        await page.getByRole('button').filter({ hasText: 'Recovery model' }).last().click()
      } else {
        await providerRow.focus()
        await page.keyboard.press('ArrowRight')
        await page.getByRole('menuitem').filter({ hasText: 'Recovery model' }).click()
      }
      await waitForBrowserCondition(page, async id => (await window.electronAPI.getSessionMessages(id))?.llmConnection === 'retained', scene.session)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await waitForBrowserCondition(page, () => !document.querySelector('button[aria-label="Send message"]')?.hasAttribute('disabled'))
      assert.equal(await page.locator('[contenteditable="true"]').first().textContent(), `CONTINUE_${scene.id}`, 'Switching must retain the draft')
      const switched: Session | null = await page.evaluate(id => window.electronAPI.getSessionMessages(id), scene.session)
      assert.deepEqual(switched!.messages.map(({ id, content }) => ({ id, content })), before!.messages.map(({ id, content }) => ({ id, content })))
      await send(`CONTINUE_${scene.id}`, 'retained', scene.session)
      const continuation = requests.find(request => request.connection === 'retained' && request.tools > 0 && JSON.stringify(request.messages).includes(`CONTINUE_${scene.id}`))
      assert(continuation && JSON.stringify(continuation.messages).includes(`HISTORY_${scene.id}`), 'Replacement provider must receive the original conversation context')
      histories[scene.id] = await page.evaluate(id => window.electronAPI.getSessionMessages(id), scene.session)
      checks.push(`${scene.id}: explicit switch retains draft/history, rebuilds runtime and continues on the replacement`)
      console.log(`PASS ${scene.id}`)
      await page.screenshot({ path: join(run.directory, `${scene.id}-continued.png`), fullPage: true })
    }
    // SIGTERM terminates a child immediately on Windows. Wait for the normal
    // persistence queue before testing a cold restart, rather than accidentally
    // testing an abrupt kill during the last response's pending disk write.
    for (const scene of scenes) {
      const expected = histories[scene.id]!.messages.map(({ id, role, content, timestamp }) => ({ id, role, content, timestamp }))
      const deadline = Date.now() + 10_000
      while (true) {
        const stored = loadSession(workspace, scene.session)
        const actual = stored?.messages.map(({ id, type, content, timestamp }) => ({ id, role: type, content, timestamp }))
        if (JSON.stringify(actual) === JSON.stringify(expected)) break
        assert(Date.now() < deadline, `Conversation ${scene.id} did not finish saving before restart`)
        await Bun.sleep(50)
      }
    }
    assert(child)
    await child.stop(); run.json('server-before-restart.json', { stdout: child.stdout(), stderr: child.stderr() })
    await start()
    await open()
    for (const scene of scenes) {
      const restored: Session | null = await page.evaluate(id => window.electronAPI.getSessionMessages(id), scene.session)
      assert.equal(restored!.llmConnection, 'retained')
      assert.equal(restored!.model, 'recovery-fixture')
      // Reception/SDK observation metadata is re-projected on restore. The
      // user's full transcript, message identities and timestamps must survive.
      assert.deepEqual(restored!.messages.map(({ id, role, content, timestamp }) => ({ id, role, content, timestamp })),
        histories[scene.id]!.messages.map(({ id, role, content, timestamp }) => ({ id, role, content, timestamp })))
    }
    checks.push('provider/model and full conversation survive a real server restart')
    assert.deepEqual(errors, [])
    run.complete(checks, ['external provider APIs and OAuth', 'native Electron host; tested its shared desktop and compact business components through WebUI'])
  } finally {
    if (page) {
      await page.screenshot({ path: join(run.directory, 'final.png'), fullPage: true }).catch(() => {})
      run.json('ui-state.json', await page.evaluate(() => ({ url: location.href,
        buttons: [...document.querySelectorAll('button')].map(button => ({ text: button.textContent, label: button.getAttribute('aria-label') })),
        headings: [...document.querySelectorAll('h1')].map(heading => heading.textContent),
      })).catch(() => null))
    }
    run.json('recovery.json', { checks, errors, requests, histories })
    await launched?.close()
    if (child) { await child.stop(); run.json('server-final.json', { stdout: child.stdout(), stderr: child.stderr() }) }
    api.stop(true)
  }
})
