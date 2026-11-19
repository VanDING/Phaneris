/**
 * The real-model entry replay, in the shipped application.
 *
 * Two facts shape how this runs:
 *
 *  - The credential vault is sealed with an OS key (safeStorage/DPAPI) bound to
 *    the current user, not to a directory. A plain Node/Bun process cannot open
 *    it, so the replay runs inside the application; copying the vault to a
 *    throwaway config root works because DPAPI decrypts for this user.
 *  - The shipped app takes a single-instance lock, so it can only run while the
 *    user's own copy is closed. The workflow reports that as blocked rather
 *    than failing the suite.
 *
 * The workspace is new and throwaway: the user's own configuration is copied,
 * never edited, and the run leaves nothing behind.
 */
import { _electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { firstBusinessWindow } = require('./electron-windows.cjs')

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const env = { ...process.env, PHANERIS_CONFIG_DIR: fixture.config, PHANERIS_RPC_PORT: '0',
  PHANERIS_DISABLE_MESSAGING: '0', PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL

const scenes = [], errors = []
// No --user-data-dir here: with PHANERIS_CONFIG_DIR set the app pins userData to
// `<config>/user-data`, and overriding it would put safeStorage's `Local State`
// somewhere else than the vault expects.
const app = await _electron.launch({ ...(fixture.executable ? { executablePath: fixture.executable } : {}),
  args: [...(fixture.executable ? [] : [join(fixture.root, 'apps/electron')])],
  cwd: fixture.root, env, timeout: 120_000 })
try {
  const page = await firstBusinessWindow(app, { timeout: 120_000 })
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => document.documentElement.dataset.themeStatus === 'ready')

  // The renderer's own transport is the shipped path; the test borrows it
  // rather than opening a second socket the product does not know about.
  const sessionId = await page.evaluate(async workspaceId => {
    const assistant = await window.electronAPI.getResidentAssistantMetadata(workspaceId)
    return assistant.id
  }, fixture.workspaceId)

  /**
   * Send one user message and wait for the Host to finish the turn.
   *
   * The turn ends when the session stops processing and has produced output
   * after the message. A turn that dispatched work may keep the *worker* busy,
   * which is not this session processing, so the two are not conflated.
   */
  const send = async text => {
    const before = await page.evaluate(async id => (await window.electronAPI.getSessionMessages(id))?.messages.length ?? 0, sessionId)
    await page.evaluate(({ id, text }) => window.electronAPI.sendMessage(id, text), { id: sessionId, text })
    const deadline = Date.now() + 300_000
    for (;;) {
      const state = await page.evaluate(async ({ id, before }) => {
        const session = await window.electronAPI.getSessionMessages(id)
        if (!session) return { processing: true, grew: false, error: false }
        return {
          processing: session.isProcessing,
          grew: session.messages.length > before,
          error: session.messages.slice(-3).some(message => message.role === 'error'),
        }
      }, { id: sessionId, before })
      // A provider rejection is a result, not a hang: report it immediately.
      if (state.error) return
      if (!state.processing && state.grew) return
      if (Date.now() > deadline) throw new Error(`The model turn did not settle: ${text.slice(0, 40)}`)
      await new Promise(done => setTimeout(done, 500))
    }
  }
  const tasks = () => page.evaluate(id => window.electronAPI.getAssistantTasks(id, { limit: 50 }), fixture.workspaceId)
  const lastError = () => page.evaluate(async id => {
    const session = await window.electronAPI.getSessionMessages(id)
    return session?.messages.filter(message => message.role === 'error').map(message => message.content).slice(-2) ?? []
  }, sessionId)
  const transcript = () => page.evaluate(async id => {
    const session = await window.electronAPI.getSessionMessages(id)
    if (!session) return ''
    return session.messages.filter(message => message.role === 'assistant' && message.content?.trim())
      .map(message => message.content).join('\n---\n').slice(-4000)
  }, sessionId)

  // ── M01 · a greeting must not create work ───────────────────────────────
  const before = (await tasks()).total
  await send('你好')
  const greetingErrors = await lastError()
  if (greetingErrors.length) throw new Error(`The provider rejected the turn: ${greetingErrors.join(' | ').slice(0, 300)}`)
  const afterGreeting = (await tasks()).total
  if (afterGreeting !== before) throw new Error(`a greeting must not create a Task (${before} -> ${afterGreeting})`)
  const greetingText = await transcript()
  if (!greetingText.trim()) throw new Error('the greeting received no reply')
  writeFileSync(join(fixture.output, 'live-greeting.txt'), greetingText)
  await page.screenshot({ path: join(fixture.output, 'live-after-greeting.png') })
  scenes.push('LM01-real-model-greeting-creates-no-task')

  // ── M02 · one clear delegation becomes one versioned Task ───────────────
  await send('帮我做一个鹈鹕骑自行车的自包含 HTML 页面，文件名 pelican.html，要能直接用浏览器打开。')
  const delegationErrors = await lastError()
  if (delegationErrors.length) throw new Error(`The provider rejected the turn: ${delegationErrors.join(' | ').slice(0, 300)}`)
  const page1 = await tasks()
  if (page1.total <= afterGreeting) throw new Error(`a clear delegation must create a Task (stayed at ${page1.total})`)
  const created = page1.items.at(-1)
  if (!created.goal.title) throw new Error('the Goal was not recorded')
  if (!created.requirements.length) throw new Error('no requirement version was recorded')
  if (!created.changes.length) throw new Error('the Change was not recorded')
  writeFileSync(join(fixture.output, 'live-task.json'), JSON.stringify({ taskId: created.task.id, stage: created.stage,
    goal: created.goal.title, deliverable: created.task.deliverable, requirements: created.requirements,
    acceptance: created.task.acceptance, changes: created.changes }, null, 2))
  writeFileSync(join(fixture.output, 'live-delegation.txt'), await transcript())
  await page.screenshot({ path: join(fixture.output, 'live-after-delegation.png') })
  scenes.push('LM02-real-model-records-one-versioned-task')

  // ── M05 · a mixed request: a change and a question in one message ───────
  // The design allows two correct answers here: record a new requirement
  // version, or append the change to the run already in flight (a supplement).
  // Both leave a Host record. What must not happen is the change being only
  // discussed in prose, so both paths are observed.
  const controlDeadline = Date.now() + 180_000
  const controlCalls = []
  const beforeTools = await page.evaluate(async id => {
    const session = await window.electronAPI.getSessionMessages(id)
    return session?.messages.filter(message => message.type === 'tool').length ?? 0
  }, sessionId)
  await page.evaluate(({ id, text }) => window.electronAPI.sendMessage(id, text),
    { id: sessionId, text: '把刚才那个改成深色背景，另外现在一共有几项工作在跑？' })
  let afterMixed
  for (;;) {
    afterMixed = await tasks()
    const same = afterMixed.items.find(item => item.task.id === created.task.id)
    const amended = !!same && (same.changes.length > created.changes.length || same.requirements.length > created.requirements.length)
    if (amended || afterMixed.total > page1.total) break
    // A supplement is a worker-control call with a recorded result; read the
    // new tool receipts rather than inventing a field on the projection.
    const supplement = await page.evaluate(async ({ id, beforeTools }) => {
      const session = await window.electronAPI.getSessionMessages(id)
      const tools = session?.messages.filter(message => message.type === 'tool') ?? []
      return tools.slice(beforeTools).some(message => (message.toolName ?? '').includes('assistant_worker_control')
        && !message.isError && /applied|queued/.test(message.toolResult ?? ''))
    }, { id: sessionId, beforeTools })
    if (supplement) { controlCalls.push('supplement'); break }
    if (Date.now() > controlDeadline) break
    await new Promise(done => setTimeout(done, 1000))
  }
  const sameTask = afterMixed.items.find(item => item.task.id === created.task.id)
  const amended = !!sameTask && (sameTask.changes.length > created.changes.length || sameTask.requirements.length > created.requirements.length)
  const supplemented = controlCalls.includes('supplement')
  const addedNew = afterMixed.total > page1.total
  const transcriptAfter = await transcript()
  writeFileSync(join(fixture.output, 'live-mixed.json'), JSON.stringify({ amended, supplemented, addedNew,
    total: afterMixed.total, changes: sameTask?.changes.length, requirements: sameTask?.requirements.length }, null, 2))
  writeFileSync(join(fixture.output, 'live-mixed.txt'), transcriptAfter)
  await page.screenshot({ path: join(fixture.output, 'live-after-mixed.png') })
  if (!amended && !supplemented && !addedNew) {
    throw new Error(`the requested change was not recorded (amended=${amended} supplemented=${supplemented} addedNew=${addedNew})`)
  }
  // The question half must be answered with a figure from the Host record.
  if (!/[0-9]/.test(transcriptAfter)) throw new Error('a question about current work must be answered with a figure')
  scenes.push(`LM03-real-model-records-a-mixed-request-${supplemented && !amended ? 'as-a-supplement' : 'as-a-new-version'}`)

  if (errors.length) throw new Error(`Page errors: ${JSON.stringify(errors)}`)
  writeFileSync(join(fixture.output, 'live-evidence.json'), JSON.stringify({ scenes, errors, sessionId }, null, 2))
} catch (error) {
  writeFileSync(join(fixture.output, 'live-debug.json'), JSON.stringify({ message: String(error) }, null, 2))
  await app.evaluate(({ app }) => app.getVersion()).catch(() => {})
  throw error
} finally { await app.close().catch(() => {}) }
