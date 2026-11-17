/** BF01–BF07/BF12, written before implementation. Real HTTP, events, files and RPC handler. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'
import type { AutomationMatcher, PendingPrompt, WebhookAction } from '../../packages/shared/src/automations/types'
import type { RpcServer } from '../../packages/server-core/src/transport'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

const evidence = new VerificationRun('upstream-bugfix-core')
const root = resolve(import.meta.dir, '../..')
const checks: Array<{ id: string; passed: boolean; error?: string }> = []
let failure: unknown
const check = async (id: string, action: () => unknown | Promise<unknown>) => {
  try { await action(); checks.push({ id, passed: true }) }
  catch (error) { checks.push({ id, passed: false, error: String(error) }) }
  evidence.json('checks.json', checks)
}
try {
  evidence.checkArguments()
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config')
  mkdirSync(process.env.PHANERIS_CONFIG_DIR)
  process.env.NODE_ENV = 'test'
  writeFileSync(join(evidence.directory, 'bunfig.toml'), 'preload = []\n')
  for (const rich of ['true', 'false']) await check(`BF01 strict schemas rich=${rich}`, async () => {
    const child = Bun.spawn([process.execPath, `--config=${join(evidence.directory, 'bunfig.toml')}`,
      join(import.meta.dir, 'fixtures/upstream-bugfix-interceptor.ts'), evidence.directory, rich], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    evidence.json(`interceptor-${rich}.json`, { exitCode, stdout, stderr })
    assert.equal(exitCode, 0, stderr)
  })

  const { AutomationSystem } = await import('../../packages/shared/src/automations/automation-system')
  const { validateAutomationsConfig } = await import('../../packages/shared/src/automations/validation')
  const { buildWebhookEnv, buildScriptEnv, expandEnvVars } = await import('../../packages/shared/src/automations/utils')
  const { expandWebhookAction, executeWithRetry } = await import('../../packages/shared/src/automations/webhook-utils')
  const prompts: PendingPrompt[] = []
  let fixtureNumber = 0
  const systems: InstanceType<typeof AutomationSystem>[] = []
  const createAutomation = (automations: Record<string, unknown[]>) => {
    const workspace = join(evidence.directory, `automation-${++fixtureNumber}`)
    mkdirSync(workspace)
    const file = join(workspace, 'automations.json')
    writeFileSync(file, JSON.stringify({ version: 1, automations }))
    const system = new AutomationSystem({ workspaceRootPath: workspace, workspaceId: 'fixture',
      enableScheduler: true, onPromptsReady: values => prompts.push(...values) })
    systems.push(system)
    return { workspace, file, system }
  }
  const good = (id = 'good'): AutomationMatcher => ({ id, matcher: 'review', actions: [{ type: 'prompt', prompt: id }] })
  const payload = { workspaceId: 'fixture', sessionId: 'fixture', sessionName: 'Fix "login" \\ $literal\nnext', label: 'review', timestamp: 1 }
  const secretKeys = ['UPSTREAM_FIX_SECRET', 'PHANERIS_FIX_SECRET', 'PHANERIS_WH_FIX_SECRET']
  const savedSecrets = secretKeys.map(key => process.env[key])
  try {
    secretKeys.forEach(key => { process.env[key] = 'SYNTHETIC_SECRET' })
    await check('BF02 prompt labels topic only receive raw event context', async () => {
      const text = '${PHANERIS_SESSION_NAME}|$UPSTREAM_FIX_SECRET|$PHANERIS_FIX_SECRET|$PHANERIS_WH_FIX_SECRET'
      const { system } = createAutomation({ LabelAdd: [{ ...good(), telegramTopic: text, labels: [text], actions: [{ type: 'prompt', prompt: text }] }] })
      await system.eventBus.emit('LabelAdd', payload)
      const delivered = prompts.at(-1)!
      evidence.json('prompt.json', delivered)
      const expected = `${payload.sessionName}|||`
      assert.equal(delivered.prompt, expected)
      assert.deepEqual(delivered.labels, [expected])
      assert.equal(delivered.telegramTopic, expected.trim())
    })
    await check('BF03 inserted variables are literal for both syntaxes', () => {
      const env = { PHANERIS_SESSION_NAME: '$PHANERIS_WH_FIX_SECRET', PHANERIS_WH_FIX_SECRET: 'SYNTHETIC_SECRET' }
      assert.equal(expandEnvVars('${PHANERIS_SESSION_NAME}/$PHANERIS_SESSION_NAME', env), '$PHANERIS_WH_FIX_SECRET/$PHANERIS_WH_FIX_SECRET')
    })
    await check('BF12 webhook and script environment contracts stay separate', () => {
      const webhook = buildWebhookEnv('LabelAdd', payload)
      assert.equal(webhook.PHANERIS_WH_FIX_SECRET, 'SYNTHETIC_SECRET')
      assert.equal(webhook.UPSTREAM_FIX_SECRET, undefined)
      const script = buildScriptEnv('LabelAdd', payload, { workspaceRootPath: evidence.directory })
      assert.equal(script.PHANERIS_FIX_SECRET, 'SYNTHETIC_SECRET')
      assert.equal(script.UPSTREAM_FIX_SECRET, undefined)
    })
  } finally { secretKeys.forEach((key, index) => { if (savedSecrets[index] === undefined) delete process.env[key]; else process.env[key] = savedSecrets[index] }) }

  const webhookRequests: Array<{ path: string; text: string }> = []
  const http = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    webhookRequests.push({ path, text: await request.text() })
    return new Response('fixture', { status: path === '/retry' && webhookRequests.filter(row => row.path === path).length === 1 ? 503 : 200 })
  } })
  try {
    await check('BF03 JSON values survive HTTP and frozen retry snapshots', async () => {
      const text = 'Fix "login"\nC:\\fixture\\file $PHANERIS_WH_FIX_SECRET'
      const env = { PHANERIS_SESSION_NAME: text, PHANERIS_WH_FIX_SECRET: 'SYNTHETIC_SECRET' }
      const body = JSON.parse('{"text":"${PHANERIS_SESSION_NAME}","nested":["$PHANERIS_SESSION_NAME",1,true,null],"__proto__":"${PHANERIS_SESSION_NAME}"}')
      const action: WebhookAction = { type: 'webhook', url: new URL('retry', http.url).href, method: 'POST', body }
      const result = await executeWithRetry(action, { env, retry: { maxAttempts: 1, initialDelayMs: 5 } })
      assert.equal(result.success, true); assert.equal(result.attempts, 2)
      const frozen = expandWebhookAction(action, env)
      const replayed = await executeWithRetry({ ...frozen, url: new URL('frozen', http.url).href })
      assert.equal(replayed.success, true)
      for (const request of webhookRequests) {
        const parsed = JSON.parse(request.text)
        assert.equal(parsed.text, text); assert.deepEqual(parsed.nested, [text, 1, true, null])
        assert.equal(Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value, text)
      }
      evidence.json('webhook.json', { result, replayed, frozen, requests: webhookRequests })
    })
  } finally { await http.stop(true) }

  try {
    await check('BF04 initial load isolates invalid matcher kinds and keeps strict writes', async () => {
      const invalid = [{ ...good('bad-regex'), matcher: '(' }, { ...good('bad-cron'), cron: 'not-a-cron' },
        { id: 'bad-action', actions: [{ type: 'command', command: 'never' }] },
        { id: 'bad-script', actions: [{ type: 'script', script: '../escape.ts', runtime: 'bun' }] },
        { ...good('bad-condition'), conditions: [{ condition: 'or', conditions: [] }] }]
      const config = { LabelAdd: [good(), ...invalid] }
      assert.equal(validateAutomationsConfig({ automations: config }).valid, false)
      const { system, file } = createAutomation(config)
      const before = readFileSync(file, 'utf8'), start = prompts.length
      await system.eventBus.emit('LabelAdd', payload)
      assert.deepEqual(prompts.slice(start).map(prompt => prompt.prompt), ['good'])
      assert.equal(readFileSync(file, 'utf8'), before)
      evidence.json('automation-initial.json', { matchers: system.getMatchersForEvent('LabelAdd'), prompts: prompts.slice(start) })
    })
    await check('BF04 reload applies valid subset and preserves last state on broken JSON', async () => {
      const { system, file } = createAutomation({ LabelAdd: [good('old')] })
      writeFileSync(file, JSON.stringify({ automations: { LabelAdd: [good('new'), { ...good('bad'), matcher: '(' }] } }))
      const partial = system.reloadConfig()
      assert.equal(partial.success, false); assert(partial.errors.length > 0)
      let start = prompts.length
      await system.eventBus.emit('LabelAdd', payload)
      assert.deepEqual(prompts.slice(start).map(prompt => prompt.prompt), ['new'])
      writeFileSync(file, '{')
      const invalidJson = system.reloadConfig()
      assert.equal(invalidJson.success, false)
      start = prompts.length; await system.eventBus.emit('LabelAdd', payload)
      assert.deepEqual(prompts.slice(start).map(prompt => prompt.prompt), ['new'])
      writeFileSync(file, '{"automations":[]}')
      const invalidShape = system.reloadConfig()
      assert.equal(invalidShape.success, false)
      assert.equal(system.getMatchersForEvent('LabelAdd')[0]!.id, 'new')
      evidence.json('automation-reload.json', { partial, invalidJson, invalidShape })
    })
    await check('BF04 scheduler follows valid subset and agent events stay inert', async () => {
      const { system, file } = createAutomation({ SchedulerTick: [{ id: 'schedule', cron: '* * * * *', actions: [{ type: 'prompt', prompt: 'scheduled' }] },
        { id: 'bad', cron: 'invalid', actions: [{ type: 'prompt', prompt: 'never' }] }], Stop: [good('inert')] })
      assert.equal(system.isSchedulerRunning(), true)
      const start = prompts.length
      await system.eventBus.emit('Stop', { workspaceId: 'fixture', sessionId: 'fixture', timestamp: 1, data: {} })
      assert.equal(prompts.length, start)
      writeFileSync(file, JSON.stringify({ automations: { SchedulerTick: [{ id: 'bad', cron: 'invalid', actions: [{ type: 'prompt', prompt: 'never' }] }] } }))
      system.reloadConfig(); assert.equal(system.isSchedulerRunning(), false)
      evidence.json('automation-scheduler.json', { stopped: !system.isSchedulerRunning(), agentEventInert: true })
    })
  } finally { await Promise.all(systems.map(system => system.dispose())) }

  const promptsModule = await import('../../packages/shared/src/prompts/system')
  const repository = join(evidence.directory, 'context repo & args')
  mkdirSync(repository)
  execFileSync('git', ['init', '--quiet', repository], { windowsHide: true })
  const contextFile = (path: string, name = 'AGENTS.md') => { mkdirSync(path, { recursive: true }); writeFileSync(join(path, name), 'fixture') }
  contextFile(repository)
  for (let index = 0; index < 30; index++) contextFile(join(repository, `a${index.toString().padStart(2, '0')}`))
  const selected = join(repository, 'z-target')
  contextFile(selected, 'Agents.md'); contextFile(join(selected, 'child'), 'CLAUDE.md')
  await check('BF05 selected subtree wins over unrelated capped siblings', () => {
    const prompt = promptsModule.getProjectContextFilesPrompt(selected)
    evidence.json('context.json', { prompt })
    assert(prompt.includes('AGENTS.md (root)'))
    assert(prompt.includes('z-target/Agents.md'))
    // A soft production budget may truncate descendants under CPU pressure.
    // Verify discovery separately with a controlled budget, keeping root/CWD mandatory.
    assert(promptsModule.scanContextFiles(selected, { budgetMs: 10000 }).files.includes('child/CLAUDE.md'))
    assert(!prompt.includes('a00/'))
    const other = promptsModule.getProjectContextFilesPrompt(join(repository, 'a00'))
    assert(other.includes('a00/AGENTS.md')); assert(!other.includes('z-target/'))
  })
  await check('BF05 cache invalidation and empty folder do not fall back to siblings', () => {
    contextFile(selected, 'CLAUDE.md')
    promptsModule.invalidateContextFileCache(selected)
    assert(promptsModule.getProjectContextFilesPrompt(selected).includes('z-target/CLAUDE.md'))
    const empty = join(evidence.directory, 'empty'); mkdirSync(empty)
    execFileSync('git', ['init', '--quiet', empty], { windowsHide: true })
    assert.equal(promptsModule.getProjectContextFilesPrompt(empty), '')
  })
  await check('BF06 scanner budgets and excluded folders keep found files', () => {
    const scan = promptsModule.scanContextFiles
    assert.equal(typeof scan, 'function')
    for (const name of ['node_modules', '.hidden', 'dist']) contextFile(join(selected, name))
    const cycle = join(selected, 'cycle')
    symlinkSync(selected, cycle, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const shallow = scan(selected, { maxDepth: 0 }), limited = scan(selected, { maxDirs: 1 })
      let now = 0
      const timed = scan(selected, { budgetMs: 2, now: () => now++ })
      const complete = scan(selected)
      assert(shallow.files.includes('Agents.md')); assert(!shallow.files.some(path => path.includes('/')))
      assert.equal(limited.dirsRead, 1); assert.equal(limited.truncated, true)
      assert(timed.truncated); assert(timed.files.includes('Agents.md'))
      assert(!complete.files.some(path => /node_modules|hidden|dist|cycle/.test(path)))
      evidence.json('scanner.json', { shallow, limited, timed, complete })
    } finally { unlinkSync(cycle) }
  })

  const { registerSystemCoreHandlers } = await import('../../packages/server-core/src/handlers/rpc/system')
  const { RPC_CHANNELS } = await import('../../packages/shared/src/protocol')
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>()
  registerSystemCoreHandlers({ handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as RpcServer,
    { platform: { isPackaged: false } } as HandlerDeps)
  const getBranch = (directory: string) => handlers.get(RPC_CHANNELS.git.GET_BRANCH)!({}, directory)
  await check('BF07 registered RPC handles branches detached HEAD and non-repos', async () => {
    execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture'], { windowsHide: true })
    execFileSync('git', ['-C', repository, 'checkout', '--quiet', '-b', 'fixture-branch'], { windowsHide: true })
    assert.equal(await getBranch(repository), 'fixture-branch')
    execFileSync('git', ['-C', repository, 'checkout', '--quiet', '--detach'], { windowsHide: true })
    assert.equal(await getBranch(repository), null)
    const outside = mkdtempSync(join(tmpdir(), 'phaneris-git-nonrepo-'))
    assert.equal(await getBranch(outside), null)
  })
  await check('BF07 slow git leaves event loop responsive and has a deadline', async () => {
    const node = Bun.which('node'); assert(node, 'Node runtime required for controlled git process')
    const bin = join(evidence.directory, 'git-bin'); mkdirSync(bin)
    if (process.platform === 'win32') {
      const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
      assert(existsSync(compiler), 'Windows framework compiler required for controlled git executable')
      const source = join(bin, 'controlled.cs')
      writeFileSync(source, 'class Program { static void Main() { System.Threading.Thread.Sleep(int.Parse(System.Environment.GetEnvironmentVariable("PHANERIS_FIX_GIT_DELAY"))); System.Console.WriteLine("fixture"); } }')
      execFileSync(compiler, ['/nologo', `/out:${join(bin, 'git.exe')}`, source], { windowsHide: true })
    } else {
      const executable = join(bin, 'git')
      writeFileSync(executable, `#!${node}\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(process.env.PHANERIS_FIX_GIT_DELAY)); console.log('fixture')\n`)
      chmodSync(executable, 0o755)
    }
    const savedPath = process.env.PATH
    process.env.PATH = `${bin}${process.platform === 'win32' ? ';' : ':'}${savedPath ?? ''}`
    try {
      process.env.PHANERIS_FIX_GIT_DELAY = '350'
      let tick = false
      const start = performance.now(), pending = getBranch(repository), synchronousMs = performance.now() - start
      const timer = setTimeout(() => { tick = true }, 10)
      const result = await pending; clearTimeout(timer)
      // A timer must execute while the controlled git process is still running.
      // Unlike a cold-spawn millisecond threshold, this fails for synchronous git
      // without confusing Windows process-start cost with a blocked wait.
      assert.equal(result, 'fixture'); assert(tick, 'Event loop did not advance while git was running')
      process.env.PHANERIS_FIX_GIT_DELAY = '15000'
      const deadlineStart = performance.now()
      assert.equal(await getBranch(repository), null)
      const deadlineMs = performance.now() - deadlineStart
      assert(deadlineMs < 8000)
      evidence.json('git.json', { synchronousMs, deadlineMs, responsive: tick })
    } finally {
      if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath
      delete process.env.PHANERIS_FIX_GIT_DELAY
    }
  })
  assert(checks.every(result => result.passed), JSON.stringify(checks.filter(result => !result.passed)))
  evidence.complete(checks.map(result => result.id), ['live provider accounts', 'macOS/Linux execution', 'signed installer'])
} catch (error) { failure = error }
evidence.finish(failure)
console.log(JSON.stringify({ passed: checks.length, directory: evidence.directory }))
