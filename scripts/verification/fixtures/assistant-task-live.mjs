/**
 * The real-model entry replay, using the installed configuration in place.
 *
 * The vault is encrypted with an OS-provided key, so it can only be opened by a
 * process that holds that key: the application's own main process, reading the
 * configuration the user actually installed. Copying the vault to a temp root
 * does not work — the copy is not what the credential was sealed against — so
 * this launches the shipped app with the real config root and a throwaway
 * *workspace*, and removes that workspace afterwards.
 *
 * Nothing in the user's own workspace is read or written.
 */
import { _electron } from 'playwright'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { firstBusinessWindow } = require('./electron-windows.cjs')

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const realRoot = join(homedir(), '.phaneris')
const workspaceId = 'live-model-probe'
const workspaceRoot = join(realRoot, 'workspaces', workspaceId)
const CONFIG_BACKUP = join(fixture.output, 'config.json.backup')
const CONFIG_FILE = join(realRoot, 'config.json')

// The workspace is created beside the user's own, then removed in the finally
// block. The config is backed up first so an interrupted run can be restored.
mkdirSync(workspaceRoot, { recursive: true })
writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ id: workspaceId, name: 'Live model probe',
  rootPath: workspaceRoot, createdAt: Date.now() / 1000, defaults: { permissionMode: 'guarded' } }))
const installed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
cpSync(CONFIG_FILE, CONFIG_BACKUP)

const env = { ...process.env, PHANERIS_RPC_PORT: '0', PHANERIS_DISABLE_MESSAGING: '0',
  PHANERIS_TELEMETRY_ENABLED: '0', NODE_ENV: 'production' }
delete env.PHANERIS_CONFIG_DIR
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL

const scenes = [], errors = []
let app
try {
  // Register the throwaway workspace before launch so the app boots into it.
  writeFileSync(CONFIG_FILE, JSON.stringify({
    ...installed,
    workspaces: [...installed.workspaces.filter(item => item.id !== workspaceId),
      { id: workspaceId, name: 'Live model probe', rootPath: workspaceRoot, createdAt: Math.floor(Date.now() / 1000) }],
    activeWorkspaceId: workspaceId,
  }))
  app = await _electron.launch({ args: [join(fixture.root, 'apps/electron'), `--user-data-dir=${join(realRoot, 'electron-live-probe')}`],
    cwd: fixture.root, env, timeout: 120_000 })
  const page = await firstBusinessWindow(app, { timeout: 120_000 })
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => document.documentElement.dataset.themeStatus === 'ready')

  const sessionId = await page.evaluate(async id => (await window.electronAPI.getResidentAssistantMetadata(id)).id, workspaceId)
  const send = async text => {
    const before = await page.evaluate(async id => (await window.electronAPI.getSessionMessages(id))?.messages.length ?? 0, sessionId)
    await page.evaluate(({ id, text }) => window.electronAPI.sendMessage(id, text), { id: sessionId, text })
    const deadline = Date.now() + 240_000
    for (;;) {
      const state = await page.evaluate(async ({ id, before }) => {
        const session = await window.electronAPI.getSessionMessages(id)
        if (!session) return { processing: true, grew: false }
        return { processing: session.isProcessing, grew: session.messages.length > before }
      }, { id: sessionId, before })
      if (!state.processing && state.grew) return
      if (Date.now() > deadline) throw new Error(`The model turn did not settle: ${text.slice(0, 40)}`)
      await new Promise(done => setTimeout(done, 500))
    }
  }
  const tasks = () => page.evaluate(id => window.electronAPI.getAssistantTasks(id, { limit: 50 }), workspaceId)
  const lastError = () => page.evaluate(async id => {
    const session = await window.electronAPI.getSessionMessages(id)
    return session?.messages.filter(message => message.role === 'error').map(message => message.content).slice(-2) ?? []
  }, sessionId)
  const transcript = () => page.evaluate(async id => {
    const session = await window.electronAPI.getSessionMessages(id)
    return session?.messages.filter(message => message.role === 'assistant' && message.content?.trim())
      .map(message => message.content).join('\n---\n').slice(-4000) ?? ''
  }, sessionId)

  const before = (await tasks()).total
  await send('你好')
  const afterGreeting = (await tasks()).total
  const greetingErrors = await lastError()
  if (greetingErrors.length) throw new Error(`The provider rejected the turn: ${greetingErrors.join(' | ').slice(0, 300)}`)
  if (afterGreeting !== before) throw new Error(`a greeting must not create a Task (${before} -> ${afterGreeting})`)
  const greetingText = await transcript()
  if (!greetingText.trim()) throw new Error('the greeting received no reply')
  writeFileSync(join(fixture.output, 'live-greeting.txt'), greetingText)
  await page.screenshot({ path: join(fixture.output, 'live-after-greeting.png') })
  scenes.push('LM01-real-model-greeting-creates-no-task')

  await send('帮我做一个鹈鹕骑自行车的自包含 HTML 页面，文件名 pelican.html，要能直接用浏览器打开。')
  const page1 = await tasks()
  const delegationErrors = await lastError()
  if (delegationErrors.length) throw new Error(`The provider rejected the turn: ${delegationErrors.join(' | ').slice(0, 300)}`)
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

  await send('把刚才那个改成深色背景，另外现在一共有几项工作在跑？')
  const afterMixed = await tasks()
  const sameTask = afterMixed.items.find(item => item.task.id === created.task.id)
  const amended = !!sameTask && (sameTask.changes.length > created.changes.length || sameTask.requirements.length > created.requirements.length)
  const addedNew = afterMixed.total > page1.total
  if (!amended && !addedNew) throw new Error('the requested change was not recorded')
  writeFileSync(join(fixture.output, 'live-mixed.json'), JSON.stringify({ amended, addedNew, total: afterMixed.total,
    changes: sameTask?.changes.length, requirements: sameTask?.requirements.length }, null, 2))
  writeFileSync(join(fixture.output, 'live-mixed.txt'), await transcript())
  await page.screenshot({ path: join(fixture.output, 'live-after-mixed.png') })
  scenes.push('LM03-real-model-records-a-mixed-request')

  if (errors.length) throw new Error(`Page errors: ${JSON.stringify(errors)}`)
  writeFileSync(join(fixture.output, 'live-evidence.json'), JSON.stringify({ scenes, errors, sessionId }, null, 2))
} finally {
  if (app) await app.close().catch(() => {})
  // Restore the user's configuration exactly as it was found.
  if (existsSync(CONFIG_BACKUP)) cpSync(CONFIG_BACKUP, CONFIG_FILE)
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(join(realRoot, 'electron-live-probe'), { recursive: true, force: true })
}
