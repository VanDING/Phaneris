/**
 * Repeatable host integration verification for the first v0.14.0 absorption.
 * Failure scenarios were recorded before this script and before product edits in
 * docs/process/upstream-0.14.0-absorption.md. Shell examples are never executed.
 * Runs real permission/host/storage/source code with isolated transport callbacks
 * and a loopback API. This is not a packaged GUI or live-model E2E.
 * Usage: bun scripts/verification/upstream-0140.ts [--baseline]
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dir, '../..')
const fixtures = mkdtempSync(join(tmpdir(), 'phaneris-upstream-0140-'))
const configRoot = join(fixtures, 'config')
const workspaceRoot = join(fixtures, 'workspace')
mkdirSync(join(configRoot, 'permissions'), { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })
copyFileSync(join(root, 'apps/electron/resources/permissions/default.json'), join(configRoot, 'permissions/default.json'))
process.env.PHANERIS_CONFIG_DIR = configRoot
process.env.NODE_ENV = 'test'

const mode = await import('../../packages/shared/src/agent/mode-manager.ts')
const pretool = await import('../../packages/shared/src/agent/core/pre-tool-use.ts')
const { PermissionManager } = await import('../../packages/shared/src/agent/core/permission-manager.ts')
const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
const host = await import('../../packages/server-core/src/sessions/SessionManager.ts')
const storage = await import('../../packages/shared/src/sessions/storage.ts')
const labels = await import('../../packages/shared/src/labels/crud.ts')
const { isValidLabelIdFormat } = await import('../../packages/shared/src/labels/storage.ts')
const { handleSourceTest } = await import('../../packages/session-tools-core/src/handlers/source-test.ts')
const rtk = await import('../../packages/shared/src/agent/core/rtk-detector.ts')
const { rewriteBashWithRtk } = await import('../../packages/shared/src/agent/core/rtk-rewrite.ts')
const context = { workspaceRootPath: workspaceRoot, activeSourceSlugs: ['demo', 'budget'] }
const records: Array<{ id: string; pass: boolean; observation?: unknown; error?: string }> = []
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
async function check(id: string, action: () => unknown | Promise<unknown>) {
  try {
    const observation = await action()
    records.push({ id, pass: true, observation })
  } catch (error) {
    records.push({ id, pass: false, error: error instanceof Error ? error.message : String(error) })
  }
}

for (const [command, expected] of [
  ['gh api /repos/example/project -X DELETE', false],
  ['gh api /repos/example/project -f title=x', false],
  ['gh api /repos/example/project --input body.json', false],
  ['gh api /repos/example/project -iXDELETE', false],
  ['gh api graphql -f "query=mutation { deleteIssue }"', false],
  ['gh api graphql -F query=@query.graphql', false],
  ["sed -n -i '1p' fixture.txt", false],
  ["sed -n 'w output.txt' fixture.txt", false],
  ["sed -n 's/a/b/e' fixture.txt", false],
  ['sed -n -f script.sed fixture.txt', false],
  ['sort -o output.txt fixture.txt', false],
  ['sort --output=output.txt fixture.txt', false],
  ['sort --compress-program=other fixture.txt', false],
  ['find . -delete', false],
  ['gh api /repos/example/project -X GET', true],
  ['gh api /repos/example/project', true],
  ["sed -n '1p' fixture.txt", true],
  ['sort fixture.txt', true],
] as const) await check(`P02 ${command}`, () => {
  const decision = mode.shouldAllowToolInMode('Bash', { command }, 'safe', { permissionsContext: context })
  assert(decision.allowed === expected, `expected allowed=${expected}, got ${decision.allowed}`)
  return decision
})

for (const [tool, expected] of [
  ['mcp__demo__delete_account', false], ['mcp__demo__send_thread_reply', false],
  ['mcp__demo__update_spreadsheet', false], ['mcp__budget__create_issue', false],
  ['mcp__demo__get_or_create_issue', false], ['mcp__demo__searchAndReplace', false],
  ['mcp__demo__list_items', true], ['mcp__demo__getCommit', true],
] as const) await check(`P01 ${tool}`, () => {
  const decision = mode.shouldAllowToolInMode(tool, {}, 'safe', { permissionsContext: context })
  assert(decision.allowed === expected, `expected allowed=${expected}, got ${decision.allowed}`)
  return decision
})

const pm = new PermissionManager({ sessionId: 'permission-verification' })
mode.setPermissionMode('permission-verification', 'ask', { changedBy: 'restore' })
const prompt = (tool: string, input: Record<string, unknown>) => pretool.shouldPromptInAskMode(tool, input, pm, context)
await check('P03 Ask MCP read shares Explore rules', () => {
  assert(prompt('mcp__demo__list_items', {}) === null, 'read tool prompted')
})
await check('P01 custom regex remains explicit', async () => {
  writeFileSync(join(workspaceRoot, 'permissions.json'), JSON.stringify({ allowedMcpPatterns: ['^mcp__demo__explicit_write$'] }))
  const { permissionsConfigCache } = await import('../../packages/shared/src/agent/permissions-config.ts')
  permissionsConfigCache.invalidateWorkspace(workspaceRoot)
  assert(mode.shouldAllowToolInMode('mcp__demo__explicit_write', {}, 'safe', { permissionsContext: context }).allowed, 'custom regex no longer applies')
})

function permissionAgent(options: { active?: boolean; answer?: boolean; remember?: boolean; handler?: boolean; activation?: 'ok' | 'fail' | 'unchanged'; throws?: boolean } = {}) {
  const id = `pi-${records.length}-${Math.random().toString(36).slice(2)}`
  mode.setPermissionMode(id, 'ask', { changedBy: 'restore' })
  const agent = Object.create(PiAgent.prototype) as any
  const active = new Set(options.active ? ['demo'] : [])
  const responses: any[] = [], requests: any[] = [], trace: string[] = []
  Object.assign(agent, {
    config: { workspace: { rootPath: workspaceRoot, id: 'fixture' }, session: { id, workingDirectory: workspaceRoot } },
    _sessionId: id, workingDirectory: workspaceRoot, debug: () => {},
    emitAutomationEvent: async () => {},
    sourceManager: { getActiveSlugs: () => active, getAllSources: () => [{ config: { slug: 'demo' } }] },
    permissionManager: new PermissionManager({ sessionId: id }),
    prerequisiteManager: { checkPrerequisites: () => ({ allowed: true }), trackBashSkillRead: () => false },
    onSourceActivationRequest: async () => {
      trace.push('activation')
      if (options.activation === 'fail') return false
      if (options.activation !== 'unchanged') active.add('demo')
      return true
    },
    getCurrentTurnUserMessage: () => 'verification request',
    eventQueue: { enqueue: () => {} }, pendingPermissions: new Map(),
    send: (response: any) => { responses.push(response); trace.push(response.action) },
  })
  agent.onPermissionRequest = options.handler === false ? null : (request: any) => {
    requests.push(request); trace.push('prompt')
    if (options.throws) throw new Error('fixture permission callback failed')
    agent.respondToPermission(request.requestId, options.answer ?? true, options.remember ?? false)
    trace.push(options.answer === false ? 'deny' : 'answer')
  }
  return { agent, responses, requests, trace }
}

for (const answer of [true, false]) await check(`P06 activation→prompt→${answer ? 'allow' : 'deny'}`, async () => {
  const fixture = permissionAgent({ answer })
  await fixture.agent.handlePreToolUseRequest({ requestId: 'activation', toolCallId: 'durable-identity', toolName: 'mcp__demo__create_issue', input: {} })
  assert(fixture.requests.length === 1, 'activation skipped approval')
  assert(fixture.responses.at(-1)?.action === (answer ? 'allow' : 'block'), 'wrong permission response')
  return fixture.trace
})
for (const activation of ['fail', 'unchanged'] as const) await check(`P06 activation ${activation}`, async () => {
  const fixture = permissionAgent({ activation })
  await fixture.agent.handlePreToolUseRequest({ requestId: activation, toolName: 'mcp__demo__create_issue', input: {} })
  assert(fixture.responses.at(-1)?.action === 'block', 'unavailable source allowed')
  return fixture.trace
})
await check('P07 absent permission handler blocks', async () => {
  const fixture = permissionAgent({ active: true, handler: false })
  await fixture.agent.handlePreToolUseRequest({ requestId: 'unattended', toolName: 'Bash', input: { command: 'touch fixture.txt' } })
  assert(fixture.responses.at(-1)?.action === 'block', 'unattended permission allowed')
  return fixture.responses
})
await check('P07 failing permission handler blocks and drains pending', async () => {
  const fixture = permissionAgent({ active: true, throws: true })
  await fixture.agent.handlePreToolUseRequest({ requestId: 'throw', toolName: 'Bash', input: { command: 'touch fixture.txt' } })
  assert(fixture.responses.at(-1)?.action === 'block', 'callback error did not block')
  assert(fixture.agent.pendingPermissions.size === 0, 'callback error leaked a pending request')
})
await check('P06 Stop during source activation cannot prompt or allow later', async () => {
  const fixture = permissionAgent()
  let finishActivation!: (value: boolean) => void
  const activate = fixture.agent.onSourceActivationRequest
  fixture.agent.onSourceActivationRequest = async () => {
    await new Promise(resolve => { finishActivation = resolve })
    return activate('demo')
  }
  fixture.agent.cancelPendingCompactions = () => {}
  fixture.agent.eventQueue.complete = () => {}
  fixture.agent.preToolMetadataByCallId = new Map()
  fixture.agent.bufferedDurableToolStarts = new Map()
  const pending = fixture.agent.handlePreToolUseRequest({ requestId: 'cancel-activation', toolName: 'mcp__demo__create_issue', input: {} })
  await new Promise(resolve => setTimeout(resolve, 0))
  await fixture.agent.abort()
  finishActivation(true)
  await pending
  assert(fixture.requests.length === 0, 'cancelled activation prompted later')
  assert(fixture.responses.at(-1)?.action === 'block', 'cancelled activation was allowed')
})
for (const answer of [true, false]) await check(`P04 real Pi remember, allowed=${answer}`, async () => {
  const fixture = permissionAgent({ active: true, answer, remember: true })
  const req = { requestId: 'remember', toolName: 'Bash', input: { command: 'python Safe.py' } }
  await fixture.agent.handlePreToolUseRequest(req)
  await fixture.agent.handlePreToolUseRequest({ ...req, requestId: 'repeat' })
  assert(fixture.requests.length === (answer ? 1 : 2), 'remember/deny changed the wrong scope')
  await fixture.agent.handlePreToolUseRequest({ ...req, requestId: 'other-case', input: { command: 'python safe.py' } })
  assert(fixture.requests.length === (answer ? 2 : 3), 'exact argv lost case')
  return fixture.requests.map(request => ({ command: request.command, canRemember: request.canRemember }))
})
await check('P04 dangerous commands and chains cannot be remembered', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  for (const command of ['git push --force', 'git -C repo push', 'git commit -m fixture && rm -rf never-executed', 'sudo touch fixture', 'gh api /repos/x -X DELETE']) {
    await fixture.agent.handlePreToolUseRequest({ requestId: command, toolName: 'Bash', input: { command } })
  }
  assert(fixture.requests.every(request => request.canRemember === false), 'unsafe Remember button remains available')
  return fixture.requests.map(request => ({ command: request.command, canRemember: request.canRemember }))
})
await check('P04 write permission belongs to its directory', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  for (const file of ['one/a.txt', 'one/b.txt', 'two/a.txt']) {
    await fixture.agent.handlePreToolUseRequest({ requestId: file, toolName: 'Write', input: { file_path: join(workspaceRoot, file), content: 'fixture' } })
  }
  assert(fixture.requests.length === 2, 'write approval leaked or was not remembered')
})
await check('P04 network permission checks every host and shell shape', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  for (const command of ['curl https://api.example.test/a', 'curl https://api.example.test/b', 'curl https://api.example.test/a https://other.example.test/b', 'curl https://api.example.test/a && touch fixture']) {
    await fixture.agent.handlePreToolUseRequest({ requestId: command, toolName: 'Bash', input: { command } })
  }
  assert(fixture.requests.length === 3, 'network approval leaked across host or shell chain')
})
await check('P04 opaque network routing cannot reuse domain permission', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  await fixture.agent.handlePreToolUseRequest({ requestId: 'network-first', toolName: 'Bash', input: { command: 'curl https://api.example.test/a' } })
  for (const command of ['curl -Khidden.conf https://api.example.test/a', 'curl --connect-to api.example.test:443:other.test:443 https://api.example.test/a', 'curl --proxy other.test:3128 https://api.example.test/a', 'wget -ihidden.txt https://api.example.test/a']) {
    await fixture.agent.handlePreToolUseRequest({ requestId: command, toolName: 'Bash', input: { command } })
  }
  assert(fixture.requests.length === 5, 'opaque target reused saved host permission')
  assert(fixture.requests.slice(1).every(request => request.canRemember === false), 'opaque target offered Always Allow')
})
await check('P04 combined short options cannot hide network configuration', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  await fixture.agent.handlePreToolUseRequest({ requestId: 'network-first', toolName: 'Bash', input: { command: 'curl https://api.example.test/a' } })
  const commands = ['curl -sKhidden.conf https://api.example.test/a', 'curl -sxhidden.test:3128 https://api.example.test/a', 'wget -qi hidden.txt https://api.example.test/a', 'wget -qe input=hidden.txt https://api.example.test/a']
  for (const command of commands) {
    await fixture.agent.handlePreToolUseRequest({ requestId: command, toolName: 'Bash', input: { command } })
  }
  assert(fixture.requests.length === commands.length + 1, 'a combined option reused saved domain permission')
  assert(fixture.requests.slice(1).every(request => request.canRemember === false), 'a hidden network target offered Always Allow')
  await fixture.agent.handlePreToolUseRequest({ requestId: 'ordinary-header', toolName: 'Bash', input: { command: 'curl -sHx-header:value https://api.example.test/a' } })
  assert(fixture.requests.length === commands.length + 1, 'a header value was mistaken for a proxy flag')
  return fixture.requests.map(request => ({ command: request.command, canRemember: request.canRemember }))
})
await check('P04 network option values never become approved hosts', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  for (const command of ['curl -X PATCH --header header.fixture.test https://api.example.test/a', 'curl https://patch/a', 'curl https://header.fixture.test/a']) {
    await fixture.agent.handlePreToolUseRequest({ requestId: command, toolName: 'Bash', input: { command } })
  }
  assert(fixture.requests.length === 3, 'an option value became a domain approval')
  const limited = permissionAgent({ active: true, remember: true })
  for (const command of ['curl -o output.fixture.test https://api.example.test/a', 'curl -L https://api.example.test/a', 'curl --unknown-option value https://api.example.test/a']) {
    await limited.agent.handlePreToolUseRequest({ requestId: command, toolName: 'Bash', input: { command } })
  }
  assert(limited.requests.every(request => request.canRemember === false), 'unknown destinations or file-output scope offered Always Allow')
  return fixture.requests.map(request => ({ command: request.command, canRemember: request.canRemember }))
})
await check('P04 API permission remains source scoped', async () => {
  const fixture = permissionAgent({ active: true, remember: true })
  for (const toolName of ['api_demo', 'api_demo', 'api_other']) {
    await fixture.agent.handlePreToolUseRequest({ requestId: `${toolName}-${fixture.requests.length}`, toolName, input: { method: 'POST', path: '/items' } })
  }
  assert(fixture.requests.length === 2, 'API approval leaked across sources')
})
await check('P05 child mode never exceeds parent mode', () => {
  const clamp = (mode as any).clampPermissionMode
  assert(typeof clamp === 'function', 'clampPermissionMode missing')
  const modes = ['safe', 'ask', 'allow-all']
  for (let parent = 0; parent < modes.length; parent++) for (let child = 0; child < modes.length; child++) {
    assert(clamp(modes[child], modes[parent]) === modes[Math.min(parent, child)], 'child raised permission')
  }
  assert(clamp(undefined, 'ask') === 'ask', 'child did not inherit')
  assert(clamp('unknown', 'ask') === 'ask', 'invalid mode did not inherit')
})

await check('R01 no pending plan does not rewrite session', async () => {
  const session = await storage.createSession(workspaceRoot, { name: 'no plan' })
  const file = storage.getSessionFilePath(workspaceRoot, session.id)
  const before = statSync(file, { bigint: true }).mtimeNs
  await new Promise(resolve => setTimeout(resolve, 30))
  await storage.clearPendingPlanExecution(workspaceRoot, session.id)
  assert(statSync(file, { bigint: true }).mtimeNs === before, 'no-op rewrote session')
  await storage.clearPendingPlanExecution(workspaceRoot, 'missing-session')
})
await check('R01 pending plan is actually removed', async () => {
  const session = await storage.createSession(workspaceRoot, { name: 'plan pending' })
  await storage.setPendingPlanExecution(workspaceRoot, session.id, join(workspaceRoot, 'plan.md'))
  await storage.clearPendingPlanExecution(workspaceRoot, session.id)
  assert(!storage.loadSession(workspaceRoot, session.id)?.pendingPlanExecution, 'pending plan survived')
})
await check('R02 completion event uses subscription snapshot', () => {
  const manager = Object.create(host.SessionManager.prototype) as any
  let original = 0, next = 0, independent = 0
  const resubscribed = () => { next++ }
  const first = () => { original++; manager.sessionCompletionListeners.delete(first); manager.sessionCompletionListeners.add(resubscribed) }
  manager.sessionCompletionListeners = new Set([first, () => { independent++ }])
  manager.emitSessionComplete({ sessionId: 'fixture', reason: 'complete' })
  assert(original === 1 && next === 0 && independent === 1, 'live Set delivered same event to new subscriber')
  manager.emitSessionComplete({ sessionId: 'fixture', reason: 'complete' })
  assert(next === 1, 'next subscriber missed next event')
})

const workspace = { id: 'ws-verification', name: 'Verification', rootPath: workspaceRoot, createdAt: Date.now() }
await check('R03 self, legacy, chain limit and metadata round trip', async () => {
  const manager = new host.SessionManager() as any
  const managed = host.createManagedSession({ id: 'automation-origin', triggeredBy: { automationName: 'before-rename', automationId: 'a', depth: 1 } } as any, workspace as any, { messagesLoaded: true })
  manager.sessions.set(managed.id, managed)
  const pending = { matcherId: 'a', automationName: 'after-rename', eventPayload: { sessionId: managed.id } }
  assert(!manager.automationLoopGuard(pending).run, 'self recursion after rename')
  managed.triggeredBy = { automationName: 'legacy', depth: 1 }
  assert(!manager.automationLoopGuard({ ...pending, automationName: 'legacy' }).run, 'legacy self recursion')
  managed.triggeredBy = { automationId: 'other', depth: 3 }
  assert(!manager.automationLoopGuard(pending).run, 'chain limit ignored')
  managed.triggeredBy = { automationId: 'other', depth: 1 }
  assert(manager.automationLoopGuard(pending).depth === 2, 'chain depth not propagated')
  const session = await storage.createSession(workspaceRoot, { name: 'automation metadata' })
  const stored = storage.loadSession(workspaceRoot, session.id)!
  stored.triggeredBy = managed.triggeredBy
  await storage.saveSession(stored)
  const reloaded = storage.loadSession(workspaceRoot, session.id)
  assert((reloaded as any)?.triggeredBy?.automationId === 'other' && (reloaded as any)?.triggeredBy?.depth === 1, 'origin metadata lost on disk')
})
await check('R03 skipped prompt is recorded without executing', async () => {
  const manager = new host.SessionManager() as any
  const managed = host.createManagedSession({ id: 'loop-origin', triggeredBy: { automationId: 'loop', depth: 1 } } as any, workspace as any, { messagesLoaded: true })
  manager.sessions.set(managed.id, managed)
  let executed = 0
  manager.executePromptAutomation = async () => { executed++; return { sessionId: 'must-not-run' } }
  await manager.runPromptAutomations(workspace.id, workspaceRoot, [{ matcherId: 'loop', automationName: 'loop', prompt: 'never executed', eventPayload: { sessionId: managed.id } }])
  assert(executed === 0, 'loop executed')
  const history = readFileSync(join(workspaceRoot, 'automations-history.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert(history.some(entry => entry.id === 'loop' && typeof entry.skipped === 'string'), 'skip history missing')
  return history
})

const apiRequests: Array<{ authenticated: boolean }> = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const authenticated = request.headers.get('Authorization') === 'Bearer fixture-token'
  apiRequests.push({ authenticated })
  return new Response(authenticated ? 'fixture ok' : 'missing fixture credential', { status: authenticated ? 200 : 401 })
} })
function sourceContext(slug: string, refreshed: string | null, throws = false) {
  const folder = join(workspaceRoot, 'sources', slug)
  mkdirSync(folder, { recursive: true })
  const source = { id: slug, slug, name: slug, enabled: true, provider: 'custom', type: 'api', isAuthenticated: true,
    api: { baseUrl: `http://127.0.0.1:${api.port}`, authType: 'bearer' } }
  writeFileSync(join(folder, 'config.json'), JSON.stringify(source))
  writeFileSync(join(folder, 'guide.md'), '# Fixture\nThis source exists solely for isolated loopback credential verification. '.repeat(12))
  let refreshes = 0
  const ctx = {
    sessionId: 'source-test', workspacePath: workspaceRoot, sourcesPath: join(workspaceRoot, 'sources'), skillsPath: join(workspaceRoot, 'skills'), plansFolderPath: join(workspaceRoot, 'plans'),
    callbacks: {}, fs: {
      exists: existsSync, readFile: (p: string) => readFileSync(p, 'utf8'), readFileBuffer: readFileSync,
      writeFile: (p: string, content: string) => writeFileSync(p, content),
      isDirectory: (p: string) => existsSync(p) && statSync(p).isDirectory(), readdir: readdirSync,
      stat: (p: string) => ({ size: statSync(p).size, isDirectory: () => statSync(p).isDirectory() }),
    },
    loadSourceConfig: () => JSON.parse(readFileSync(join(folder, 'config.json'), 'utf8')),
    saveSourceConfig: (s: unknown) => writeFileSync(join(folder, 'config.json'), JSON.stringify(s)),
    credentialManager: {
      getToken: async () => null,
      refresh: async () => { refreshes++; if (throws) throw new Error('fixture refresh failed'); return refreshed },
      hasValidCredentials: async () => !!refreshed,
    },
  }
  return { ctx, refreshes: () => refreshes, read: () => JSON.parse(readFileSync(join(folder, 'config.json'), 'utf8')) }
}
for (const state of ['missing', 'failed', 'refreshed']) await check(`R04 source_test ${state}`, async () => {
  const fixture = sourceContext(state, state === 'refreshed' ? 'fixture-token' : null, state === 'failed')
  const countBefore = apiRequests.length
  const result = await handleSourceTest(fixture.ctx as any, { sourceSlug: state })
  const saved = fixture.read()
  assert(fixture.refreshes() >= 1, 'refresh not attempted')
  if (state === 'refreshed') {
    assert(apiRequests.slice(countBefore).some(request => request.authenticated), 'refreshed credential not used')
    assert(saved.connectionStatus === 'connected', 'refreshed source not connected')
  } else {
    assert(saved.connectionStatus !== 'connected', 'missing credential marked connected')
    assert(!apiRequests.slice(countBefore).length, 'missing credential reached unauthenticated API probe')
  }
  return { state, savedStatus: saved.connectionStatus, refreshes: fixture.refreshes(), isError: result.isError }
})
api.stop(true)

await check('R05 activation retry hides duplicate, keeps steers and attachments', async () => {
  const manager = new host.SessionManager() as any
  const managed = host.createManagedSession({ id: 'activation-retry', name: 'retry' }, workspace as any, { messagesLoaded: true }) as any
  managed.messages = [{ id: 'original', role: 'user', content: 'original request', timestamp: Date.now() }]
  managed.turnSteers = ['correction: use latest data']
  managed.lastSentAttachments = [{ name: 'fixture.txt', type: 'text', content: 'fixture' }]
  managed.lastSentStoredAttachments = [{ id: 'attachment' }]
  managed.thinkingLevel = 'max'
  managed.lastSentOptions = { skillSlugs: ['fixture-skill'] }
  manager.sessions.set(managed.id, managed)
  const calls: any[] = []
  manager.sendMessage = async (...args: any[]) => {
    if (host.claimAutoRetryPending(managed, args[1]) !== 'drop') calls.push(args)
  }
  await manager.processEvent(managed, { type: 'source_activated', sourceSlug: 'demo', originalMessage: 'original request' })
  await new Promise(resolve => setTimeout(resolve, 160))
  assert(calls.length === 1, 'activation did not resend once')
  assert(calls[0][1].includes('correction: use latest data'), 'steer lost')
  assert(calls[0][4]?.hidden === true, 'retry becomes another visible user message')
  assert(calls[0][2]?.length === 1 && calls[0][3]?.length === 1, 'retry lost attachments')
  assert(managed.thinkingLevel === 'max', 'retry lost the session thinking setting')
  assert(calls[0][4]?.skillSlugs?.[0] === 'fixture-skill', 'retry lost message options')
  assert(host.claimAutoRetryPending(managed, 'original request\n\n[demo activated]') === 'drop', 'legacy duplicate not dropped')
  return { content: calls[0][1], options: calls[0][4], messageCount: managed.messages.length }
})
await check('R06 unknown background task does not wake host or invent start time', async () => {
  const manager = new host.SessionManager() as any
  const managed = host.createManagedSession({ id: 'background', name: 'background' }, workspace as any, { messagesLoaded: true }) as any
  manager.sessions.set(managed.id, managed)
  manager.keepBackgroundTasksAlive = true
  let wakes = 0
  manager.sendMessage = async () => { wakes++ }
  await manager.processEvent(managed, { type: 'task_completed', taskId: 'unknown', status: 'completed' })
  assert(wakes === 0, 'unknown task woke session')
  assert(managed.backgroundTaskRegistry.get('unknown')?.startTime === undefined, 'invented task start time')
  managed.backgroundTaskRegistry.set('known', { taskId: 'known', startTime: Date.now(), status: 'running' })
  await manager.processEvent(managed, { type: 'task_completed', taskId: 'known', status: 'completed' })
  await manager.processEvent(managed, { type: 'task_completed', taskId: 'known', status: 'completed' })
  assert(wakes === 1, 'known task lost or duplicated wakeup')
})
await check('R05 real host retry persists one visible input and one hidden continuation', async () => {
  writeFileSync(join(configRoot, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id, llmConnections: [], activeSessionId: null }))
  const session = await storage.createSession(workspaceRoot, { name: 'durable activation retry' })
  const manager = new host.SessionManager() as any
  const managed = host.createManagedSession({ ...session, thinkingLevel: 'max' }, workspace as any, { messagesLoaded: true }) as any
  const events: any[] = [], chats: any[] = []
  manager.sessions.set(managed.id, managed)
  manager.eventSink = (_channel: string, _target: unknown, event: any) => events.push(event)
  const agent = new Proxy({
    getModel: () => 'pi/gpt-5-mini', getSessionId: () => null, getBackendProvider: () => 'pi',
    chat: async function* (content: string, attachments: unknown, options: unknown) {
      chats.push({ content, attachments, options })
      yield { type: 'text_complete', text: 'fixture reply' }
      yield { type: 'complete' }
    },
  }, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key as keyof typeof target] : () => undefined })
  manager.getOrCreateAgent = async () => { managed.agent = agent; return agent }
  const attachment = { id: 'fixture-file', name: 'fixture.txt', type: 'text', mimeType: 'text/plain', storedPath: join(workspaceRoot, 'fixture.txt') }
  await manager.sendMessage(managed.id, 'original durable request', [attachment], [attachment])
  managed.turnSteers = ['correction: keep the attachment']
  await manager.processEvent(managed, { type: 'source_activated', sourceSlug: 'demo', originalMessage: 'original durable request' })
  // The legacy renderer wins the race; the real admission path upgrades its payload.
  const legacy = 'original durable request\n\n[demo activated]'
  // The duplicate RPC arrives within the dedup window, while the winner's turn
  // is still running. Waiting for the entire turn first can outlive that window.
  await Promise.all([manager.sendMessage(managed.id, legacy), manager.sendMessage(managed.id, legacy)])
  await new Promise(resolve => setTimeout(resolve, 160))
  const { sessionPersistenceQueue } = await import('../../packages/shared/src/sessions/persistence-queue.ts')
  await sessionPersistenceQueue.flush(managed.id)
  const saved = storage.loadSession(workspaceRoot, managed.id)!
  const userInputs = saved.messages.filter((message: any) => message.type === 'user')
  assert(chats.length === 2, `duplicate retry reached the backend or the continuation failed (chats=${chats.length})`)
  assert(userInputs.length === 2 && userInputs.filter((message: any) => !message.hidden).length === 1, 'visible input duplicated in session JSONL')
  assert(chats[1].content.includes('correction: keep the attachment') && chats[1].attachments?.length === 1, 'real retry lost its corrections or attachment')
  assert(managed.thinkingLevel === 'max', 'session thinking level changed')
  assert(!events.some(event => event.type === 'error'), 'real retry failed in the host')
  const projection = manager.durableRuntime.getCanonicalSessionProjection(workspaceRoot, managed.id)
  assert(projection.items.filter((item: any) => item.kind === 'user').length === 2, 'canonical inputs duplicated or missing')
  const reloaded = host.createManagedSession({ id: managed.id }, workspace as any) as any
  await manager.ensureMessagesLoaded(reloaded)
  assert(reloaded.messages.filter((message: any) => message.role === 'user' && !message.hidden).length === 1, 'restart made the hidden retry visible')
  return { sessionFile: storage.getSessionFilePath(workspaceRoot, managed.id), userInputs, chats, acceptedEvents: events.filter(event => event.type === 'user_message'), durableProjection: projection }
})
await check('R07 safe minimum, platform update and bypasses', () => {
  const status = rtk.getRtkStatus()
  assert((status as any).minSafeVersion === '0.44.0', 'safe RTK minimum missing')
  assert(process.platform !== 'win32' || !(status as any).updateCommand.includes('| sh'), 'Windows received Unix installer command')
  for (const command of ['command grep fixture', 'builtin echo fixture', 'grep fixture']) {
    const result = rewriteBashWithRtk('Bash', { command }, join(fixtures, 'must-not-execute.exe'), ['grep'])
    assert(!result.modified, 'bypass/excluded command rewritten')
  }
  return status
})
await check('R08 create accented, truncated and duplicate labels', () => {
  const first = labels.createLabel(workspaceRoot, { name: 'Task PowerShell fejlesztők képzése' })
  const second = labels.createLabel(workspaceRoot, { name: 'Task PowerShell fejlesztők képzése' })
  assert(isValidLabelIdFormat(first.id) && isValidLabelIdFormat(second.id), 'invalid label slug')
  assert(first.id.includes('fejleszt'), 'accent folding lost letters')
  assert(first.id !== second.id, 'duplicate label id')
  return [first.id, second.id]
})

const decisions = await import('../../packages/shared/src/decisions/index.ts')
const decisionRequest = { state: 'fixture-private-state', questions: { useful: { type: 'noul' as const, instructions: 'Is this useful?' } } }
const decisionApi = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as { state: string }
  if (body.state === 'slow') await new Promise(resolve => setTimeout(resolve, 500))
  return Response.json({ model: 'fixture', answers: { useful: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 9, output_tokens: 2 } })
} })
const decisionClient = new decisions.SystemOneClient({ baseUrl: decisionApi.url.href, model: 'fixture' })
await check('B3 caller cancellation differs from a deadline', async () => {
  const controller = new AbortController()
  const pending = decisionClient.decide({ ...decisionRequest, state: 'slow' }, controller.signal)
  setTimeout(() => controller.abort(), 25)
  let cancelled: unknown
  try { await pending } catch (error) { cancelled = error }
  assert((cancelled as { kind?: string })?.kind === 'cancelled', 'caller abort was not classified as cancelled')
  let timedOut: unknown
  try { await decisionClient.decide({ ...decisionRequest, state: 'slow', deadlineMs: 250 }) } catch (error) { timedOut = error }
  assert((timedOut as { kind?: string })?.kind === 'timeout', 'deadline was not classified as timeout')
})
await check('B3 decision logs, linked outcomes and report remain private', async () => {
  const point = await import('../../packages/server-core/src/decisions/decision-point.ts')
  const usage = await import('../../packages/shared/src/decisions/usage.ts')
  const logPath = join(fixtures, 'decisions.jsonl')
  const recorder = new decisions.DecisionRecorder({ path: logPath })
  const ask = await point.openDecisionPoint({
    feature: 'taskVerdicts', record: 'integration', sessionId: 'decision-fixture', recorder,
    resolveClient: async () => ({ ok: true, value: {
      client: decisionClient, provider: 'custom', keySource: 'none',
      settings: decisions.normalizeDecisionLayerSettings({ enabled: true }),
      endpoint: { baseUrl: decisionApi.url.href, model: 'fixture', requiresKey: false },
    } } as any),
  })
  assert(ask, 'configured decision point unavailable')
  const result = await ask!(decisionRequest, { apiKey: 'fixture-secret' })
  assert(result, 'decision point lost successful answer')
  point.recordDecisionOutcome(result, { action: 'kept', changed: false, detail: { token: 'fixture-secret' } })
  point.recordDecisionOutcome(result, { action: 'duplicate', changed: true })
  point.recordDecisionFollowUp(result, { result: 'verified' })
  await (recorder as any).flush()
  const body = readFileSync(logPath, 'utf8')
  assert(!body.includes('fixture-private-state') && !body.includes('fixture-secret'), 'decision log exposed state or secrets')
  const lines = usage.parseDecisionLog(body + '\nnull\n[]\n{}\nbroken\n')
  const summary = usage.summarizeDecisionUsage(lines)
  assert(summary.total === 1 && summary.features[0]?.withOutcome === 1 && summary.features[0]?.changed === 0, 'outcome not joined once')
  assert(summary.features[0]?.followUps.verified === 1, 'follow-up not joined')
  assert(summary.features[0]?.inputTokens === 9, 'usage missing')
  const disabled = await point.openDecisionPoint({ feature: 'taskVerdicts', record: 'disabled', resolveClient: async () => ({ ok: false, failure: { kind: 'disabled', message: 'off' } }) })
  assert(disabled === null, 'disabled point did not preserve fallback')
  return { logPath, summary }
})
await check('B3 default test recorder stays outside user configuration', () => {
  const path = decisions.getDecisionRecorder().path
  assert(path.startsWith(tmpdir()) && !path.startsWith(configRoot), 'test recorder writes configuration logs')
  assert(path.includes('phaneris-decisions-test-'), 'test recorder uses another product identity')
  return path
})
decisionApi.stop(true)

const baseline = process.argv.includes('--baseline')
const resultPath = join(root, 'docs/verification/results', baseline ? 'upstream-0.14.0-before.json' : 'upstream-0.14.0-first-batch.json')
mkdirSync(resolve(resultPath, '..'), { recursive: true })
const failures = records.filter(record => !record.pass)
writeFileSync(resultPath, JSON.stringify({
  executedAt: new Date().toISOString(), command: `bun scripts/verification/upstream-0140.ts${baseline ? ' --baseline' : ''}`,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  upstream: '73bd9c2a3573158bea880984eb8d5fdb41e0cac2', baseline, fixtures,
  scope: 'Real host/permission/storage/source code with isolated transport and loopback API; no dangerous shell execution, GUI or live provider.',
  total: records.length, passed: records.length - failures.length, failed: failures.length, records,
}, null, 2) + '\n')
console.log(`${records.length - failures.length}/${records.length} passed; ${failures.length} failed. ${resultPath}`)
for (const failure of failures) console.log(`FAIL ${failure.id}: ${failure.error}`)
process.exitCode = failures.length ? 1 : 0
