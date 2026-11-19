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
  // The design allows several correct answers: record a new requirement version,
  // append the change to a run in flight, or ask which object was meant when the
  // reference is ambiguous. All three are legitimate, so the observation is the
  // model's handling plus the Host record, and the failure is the change being
  // silently dropped.
  //
  // The wait is generous on purpose: this turn reads work state, may ask a
  // question, then records. Closing the app under it produces
  // "Durable Runtime admission is closed", which looks like a product failure
  // but is this harness being impatient.
  const controlDeadline = Date.now() + 420_000
  const beforeTools = await page.evaluate(async id => {
    const session = await window.electronAPI.getSessionMessages(id)
    return session?.messages.filter(message => message.type === 'tool').length ?? 0
  }, sessionId)
  await page.evaluate(({ id, text }) => window.electronAPI.sendMessage(id, text),
    { id: sessionId, text: '把刚才那个改成深色背景，另外现在一共有几项工作在跑？' })
  let afterMixed, supplemented = false, askedBack = false, controlPhases = []
  for (;;) {
    afterMixed = await tasks()
    const same = afterMixed.items.find(item => item.task.id === created.task.id)
    const amended = !!same && (same.changes.length > created.changes.length || same.requirements.length > created.requirements.length)
    if (amended || afterMixed.total > page1.total) break
    const handling = await page.evaluate(async ({ id, beforeTools }) => {
      const session = await window.electronAPI.getSessionMessages(id)
      const tools = (session?.messages ?? []).filter(message => message.type === 'tool').slice(beforeTools)
      /**
       * The Host wraps a tool result as `{ content: [{ text }] }` where `text`
       * is the JSON the tool returned. Unwrap by index, not by regex: the
       * pattern has to survive serialization into this page context.
       */
      const payload = message => {
        if (message.isError) return undefined
        try {
          const outer = JSON.parse(message.toolResult ?? '')
          const text = outer?.content?.[0]?.text
          return typeof text === 'string' ? JSON.parse(text) : outer
        } catch { return undefined }
      }
      /** A Host command receipt, whatever the control action was called. */
      const command = message => {
        const body = payload(message)
        const receipt = body?.command ?? body?.receipt ?? body
        return receipt && typeof receipt.phase === 'string' ? receipt : undefined
      }
      const controls = tools.filter(message => (message.toolName ?? '').includes('assistant_worker_control'))
      return {
        // A supplement to the running Worker, recorded by the Host as a command.
        supplemented: controls.some(message => ['applied', 'queued', 'staged', 'delivered', 'consumed'].includes(command(message)?.phase)),
        // The model asked which object the reference meant, which is a correct
        // answer to an ambiguous pronoun rather than a dropped change.
        askedBack: tools.some(message => (message.toolName ?? '').includes('ask_user') && !message.isError),
        // Reported so a failure says which controls were attempted and why.
        controlPhases: controls.map(message => ({ error: message.isError === true, phase: command(message)?.phase ?? null })),
      }
    }, { id: sessionId, beforeTools })
    if (handling.supplemented) { supplemented = true; break }
    if (handling.askedBack) { askedBack = true; break }
    controlPhases = handling.controlPhases
    if (Date.now() > controlDeadline) break
    await new Promise(done => setTimeout(done, 1000))
  }
  const sameTask = afterMixed.items.find(item => item.task.id === created.task.id)
  const amended = !!sameTask && (sameTask.changes.length > created.changes.length || sameTask.requirements.length > created.requirements.length)
  const addedNew = afterMixed.total > page1.total
  const transcriptAfter = await transcript()
  writeFileSync(join(fixture.output, 'live-mixed.json'), JSON.stringify({ amended, supplemented, askedBack, controlPhases, addedNew,
    total: afterMixed.total, changes: sameTask?.changes.length, requirements: sameTask?.requirements.length }, null, 2))
  writeFileSync(join(fixture.output, 'live-mixed.txt'), transcriptAfter)
  await page.screenshot({ path: join(fixture.output, 'live-after-mixed.png') })
  // The question half must be answered with a figure from the Host record.
  if (!/[0-9]/.test(transcriptAfter)) throw new Error('a question about current work must be answered with a figure')
  if (!amended && !supplemented && !addedNew && !askedBack) {
    throw new Error(`the requested change was dropped (amended=${amended} supplemented=${supplemented} addedNew=${addedNew})`)
  }
  scenes.push(`LM03-real-model-handles-a-mixed-request-${askedBack ? 'by-asking-which-object' : supplemented ? 'as-a-supplement' : 'as-a-new-version'}`)

  if (errors.length) throw new Error(`Page errors: ${JSON.stringify(errors)}`)
  writeFileSync(join(fixture.output, 'live-evidence.json'), JSON.stringify({ scenes, errors, sessionId }, null, 2))
} catch (error) {
  writeFileSync(join(fixture.output, 'live-debug.json'), JSON.stringify({ message: String(error) }, null, 2))
  await app.evaluate(({ app }) => app.getVersion()).catch(() => {})
  throw error
} finally { await app.close().catch(() => {}) }
