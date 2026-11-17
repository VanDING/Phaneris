/** BF08–BF11, declared before implementation: real subprocess, SDK journals and delayed HTTP. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { InboundMessage } from '../../packages/pi-agent-server/src/messages'
import { VerificationRun } from './verification-artifacts'

const evidence = new VerificationRun('upstream-bugfix-pi')
const root = resolve(import.meta.dir, '../..')
const checks: Array<{ id: string; passed: boolean; error?: string; stack?: string }> = []
const requests: Array<{ at: number; kind: string; body: Record<string, any>; released?: number }> = []
const summaryReleases: Array<() => void> = []
const releaseSummary = () => { for (const done of summaryReleases.splice(0)) done() }
let holdSummary = false, failNext = false
let holdRevokedCall = false, releaseRevokedCall = () => {}
let failure: unknown
const check = async (id: string, action: () => Promise<void>) => {
  try { await action(); checks.push({ id, passed: true }) }
  catch (error) { checks.push({ id, passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }) }
  evidence.json('checks.json', checks)
}
const until = async (predicate: () => boolean, label: string, timeout = 20_000) => {
  const deadline = Date.now() + timeout
  while (!predicate()) { assert(Date.now() < deadline, `Timed out: ${label}`); await Bun.sleep(10) }
}
const assistant = (text: string): AssistantMessage => ({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions',
  provider: 'custom-endpoint', model: 'fixture', usage: { input: 100, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 112,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() })
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }], timestamp: Date.now() })
const texts = (manager: SessionManager) => JSON.stringify(manager.buildSessionProjection().messages)
const journal = (directory: string) => {
  const folder = join(directory, '.pi-sessions')
  const files = existsSync(folder) ? readdirSync(folder).filter(file => file.endsWith('.jsonl')).sort() : []
  assert(files.length > 0, `No journal in ${folder}`)
  return SessionManager.open(join(folder, files.at(-1)!))
}
const tool = (name: string) => ({ name, description: 'Fixture source', inputSchema: { type: 'object', properties: {} }, readOnly: true })
const children: Array<{ stop(): Promise<void> }> = []
const http = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const body = await request.json() as Record<string, any>
  const kind = body.tools?.length ? 'chat' : 'summary'
  const record = { at: Date.now(), kind, body, released: undefined as number | undefined }
  requests.push(record)
  if (kind === 'summary' && holdSummary) await new Promise<void>(done => { summaryReleases.push(done) })
  record.released = Date.now()
  const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `fixture-${requests.length}`,
    object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } } : {}),
  })}\n\n`
  if (kind === 'chat' && failNext) {
    failNext = false
    return new Response(chunk({ role: 'assistant' }) + chunk({ content: 'ABANDONED_PARTIAL' }), { headers: { 'content-type': 'text/event-stream' } })
  }
  if (kind === 'chat' && holdRevokedCall && JSON.stringify(body.messages).includes('REVOKE_WHILE_BUSY')) {
    await new Promise<void>(done => { releaseRevokedCall = done })
    holdRevokedCall = false
    return new Response(chunk({ role: 'assistant' }) + chunk({ tool_calls: [{ index: 0, id: 'revoked-call', type: 'function',
      function: { name: 'mcp__fixture__read_record', arguments: '{}' } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response(chunk({ role: 'assistant' }) + chunk({ content: kind === 'summary' ? 'FIXTURE_COMPACTION_SUMMARY' : 'FIXTURE_REPLY' })
    + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
} })

try {
  evidence.checkArguments()
  writeFileSync(join(evidence.directory, 'bunfig.toml'), 'preload = []\n')
  async function start(id: string, branch?: { parent: string; anchor?: string }) {
    const directory = join(evidence.directory, id)
    mkdirSync(directory, { recursive: true })
    const rows: Array<Record<string, any>> = [], stderr: string[] = []
    const entry = process.env.PHANERIS_BUGFIX_PI_ENTRY ?? join(root, 'packages/pi-agent-server/src/index.ts')
    const child = Bun.spawn([process.execPath, `--config=${join(evidence.directory, 'bunfig.toml')}`, entry], {
      cwd: directory, env: { ...process.env, PHANERIS_CONFIG_DIR: join(evidence.directory, 'config'),
        HOME: evidence.directory, USERPROFILE: evidence.directory, NODE_ENV: 'test' }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    const send = (message: InboundMessage) => { child.stdin.write(JSON.stringify(message) + '\n'); child.stdin.flush() }
    const stdout = (async () => {
      const reader = child.stdout.getReader(), decoder = new TextDecoder()
      let pending = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
          if (line.trim()) {
            const row = JSON.parse(line)
            rows.push(row)
            // A revoked call reaching host preflight is already a failed boundary.
            // Respond with a refusal so the negative control can settle without effects.
            if (row.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: row.requestId, action: 'block', reason: 'Fixture source was revoked' })
          }
        }
      }
    })()
    const errorOutput = new Response(child.stderr).text().then(text => { stderr.push(text) })
    let stopped = false
    const stop = async () => {
      if (stopped) return
      stopped = true
      send({ type: 'shutdown' })
      const deadline = setTimeout(() => child.kill(), 3000)
      await child.exited; clearTimeout(deadline)
      await Promise.all([stdout, errorOutput])
      evidence.json(`${id}-wire-${children.length}.json`, { rows, stderr })
    }
    children.push({ stop })
    send({ type: 'init', apiKey: 'fixture-not-a-real-key', model: 'pi/fixture', thinkingLevel: 'off',
      cwd: directory, workingDirectory: directory, workspaceRootPath: evidence.directory, sessionId: id, sessionPath: directory,
      plansFolderPath: join(directory, 'plans'), providerType: 'pi_compat', customEndpoint: { api: 'openai-completions' },
      baseUrl: http.url.href, customModels: [{ id: 'fixture', contextWindow: 200000, maxTokens: 4096 }], contextPolicy: 'manual',
      ...(branch ? { branchFromSessionPath: branch.parent, branchFromSdkTurnId: branch.anchor } : {}),
    })
    await until(() => rows.some(row => row.type === 'ready'), `ready ${id}`)
    return { rows, send, stop, directory }
  }
  const ready = async (client: Awaited<ReturnType<typeof start>>, id: string) => {
    client.send({ type: 'ensure_session_ready', id })
    await until(() => client.rows.some(row => row.type === 'ensure_session_ready_result' && row.id === id) || client.rows.some(row => row.type === 'error'), `ensure ${id}`)
    const result = client.rows.find(row => row.type === 'ensure_session_ready_result' && row.id === id)
    assert(result?.sessionId, JSON.stringify(client.rows.filter(row => row.type === 'error')))
  }
  const parentPath = join(evidence.directory, 'parent')
  const parent = SessionManager.create(parentPath, join(parentPath, '.pi-sessions'))
  parent.appendMessage(user('PARENT_BEFORE'))
  const anchor = parent.appendMessage(assistant('PARENT_ANCHOR'))
  parent.appendMessage(user('PARENT_AFTER')); parent.appendMessage(assistant('PARENT_AFTER_ANSWER'))
  const parentFile = parent.getSessionFile()!
  const parentHash = () => createHash('sha256').update(readFileSync(parentFile)).digest('hex')
  const originalParentHash = parentHash()
  await check('BF08 branch cutoff survives restart before first child message', async () => {
    const first = await start('branch', { parent: parentPath, anchor })
    try { await ready(first, 'first') } finally { await first.stop() }
    assert(!texts(journal(first.directory)).includes('PARENT_AFTER'))
    const second = await start('branch', { parent: parentPath })
    try { await ready(second, 'second') } finally { await second.stop() }
    assert(!texts(journal(second.directory)).includes('PARENT_AFTER'))
    assert.equal(readdirSync(join(second.directory, '.pi-sessions')).filter(path => path.endsWith('.jsonl')).length, 1)
    assert.equal(parentHash(), originalParentHash)
  })
  await check('BF08 branch own messages survive tools and no longer need parent', async () => {
    const directory = join(evidence.directory, 'independent-branch')
    const first = await start('independent-branch', { parent: parentPath, anchor })
    try { await ready(first, 'independent-first') } finally { await first.stop() }
    const childJournal = journal(directory)
    childJournal.appendMessage(user('CHILD_PRIVATE')); childJournal.appendMessage(assistant('CHILD_ANSWER'))
    const second = await start('independent-branch', { parent: join(evidence.directory, 'missing-parent') })
    try {
      await ready(second, 'independent-second')
      second.send({ type: 'sync_tools', tools: [tool('mcp__fixture__read_record')] })
      const from = second.rows.length
      second.send({ type: 'prompt', id: 'child-next', message: 'CHILD_NEXT', systemPrompt: 'Fixture.' })
      await until(() => second.rows.slice(from).some(row => row.event?.type === 'agent_end'), 'branch prompt')
      assert(texts(journal(directory)).includes('CHILD_PRIVATE'))
      assert(!texts(journal(directory)).includes('PARENT_AFTER'))
      assert(requests.some(request => JSON.stringify(request.body).includes('CHILD_PRIVATE')))
    } finally { await second.stop() }
  })
  await check('BF09 invalid anchor creates no resumable child journal', async () => {
    const invalid = await start('invalid-anchor', { parent: parentPath, anchor: 'not-an-entry' })
    invalid.send({ type: 'ensure_session_ready', id: 'invalid' })
    await until(() => invalid.rows.some(row => row.type === 'error'), 'invalid anchor')
    await invalid.stop()
    assert(invalid.rows.some(row => /anchor not found/.test(row.message ?? '')))
    assert.equal(readdirSync(join(invalid.directory, '.pi-sessions')).filter(file => file.endsWith('.jsonl')).length, 0)
    assert.equal(parentHash(), originalParentHash)
  })

  for (const cancel of [false, true]) await check(cancel ? 'BF10 Stop cancels a prompt waiting for compaction rebuild' : 'BF10 tool rebuild waits for real in-flight compaction', async () => {
    const id = cancel ? 'compact-cancel' : 'compact-wait', directory = join(evidence.directory, id)
    const seeded = SessionManager.create(directory, join(directory, '.pi-sessions'))
    seeded.appendMessage(user('EARLY_ORIGINAL')); seeded.appendMessage(assistant('EARLY_ANSWER'))
    seeded.appendMessage(user('OLD_BULK_' + 'evidence '.repeat(22000))); seeded.appendMessage(assistant('OLD_CONCLUSION'))
    seeded.appendMessage(user('CURRENT_BULK_' + 'current '.repeat(5000)))
    const metered = assistant('CURRENT_CONCLUSION'); metered.usage.input = 80000; metered.usage.totalTokens = 80012
    seeded.appendMessage(metered)
    const client = await start(id)
    try {
      await ready(client, `${id}-ready`)
      client.send({ type: 'set_auto_compaction', id: `${id}-policy`, enabled: false, policy: 'manual' })
      await until(() => client.rows.some(row => row.type === 'set_auto_compaction_result'), 'manual policy')
      holdSummary = true
      const before = requests.length
      client.send({ type: 'compact', id: `${id}-compact`, customInstructions: 'Summarize the fixture.' })
      await until(() => requests.slice(before).some(request => request.kind === 'summary'), 'held summary')
      client.send({ type: 'sync_tools', tools: [tool('mcp__fixture__read_record')] })
      client.send({ type: 'prompt', id: `${id}-next`, message: 'AFTER_COMPACTION', systemPrompt: 'Fixture.' })
      await Bun.sleep(300)
      assert(!requests.slice(before).some(request => request.kind === 'chat'), 'Prompt dispatched before original compaction settled')
      if (cancel) {
        const stoppedAt = Date.now()
        client.send({ type: 'abort', id: 'stop' })
        await until(() => client.rows.some(row => row.type === 'abort_result' && row.id === 'stop'), 'abort acknowledgement', 4000)
        assert(Date.now() - stoppedAt < 4000)
      }
      holdSummary = false; releaseSummary()
      await until(() => client.rows.some(row => row.type === 'compact_result' && row.id === `${id}-compact`), 'compact result')
      const result = client.rows.find(row => row.type === 'compact_result' && row.id === `${id}-compact`)!
      assert.equal(result.success, !cancel)
      await until(() => client.rows.some(row => row.type === 'input_received' && row.id === `${id}-next`), 'queued input disposition')
      if (cancel) {
        await Bun.sleep(250)
        assert(!requests.slice(before).some(request => request.kind === 'chat'))
      } else {
        await until(() => client.rows.some(row => row.event?.type === 'agent_end'), 'post-compaction answer')
        assert(texts(journal(directory)).includes('FIXTURE_COMPACTION_SUMMARY'))
        const prior = requests.length
        client.send({ type: 'prompt', id: 'tools-applied', message: 'TOOLS_REFRESHED', systemPrompt: 'Fixture.',
          taskPreparation: { instructions: '', sourceContext: '', capabilityFamilies: [], sourceSlugs: ['fixture'] } })
        await until(() => requests.length > prior, 'next request after rebuild')
        assert(requests.at(-1)!.body.tools.some((entry: any) => entry.function.name === 'mcp__fixture__read_record'))
      }
    } finally { holdSummary = false; releaseSummary(); await client.stop() }
  })
  await check('BF10 tool update preserves an SDK retry and its follow-up input', async () => {
    const client = await start('retry-wait')
    try {
      await ready(client, 'retry-ready')
      failNext = true
      client.send({ type: 'prompt', id: 'retry-first', message: 'RETRY_ORIGINAL', systemPrompt: 'Fixture.' })
      await until(() => client.rows.some(row => row.event?.type === 'auto_retry_start'), 'SDK retry')
      client.send({ type: 'sync_tools', tools: [tool('mcp__fixture__read_record')] })
      client.send({ type: 'prompt', id: 'retry-next', message: 'RETRY_FOLLOW_UP', systemPrompt: 'Fixture.' })
      await until(() => texts(journal(client.directory)).includes('RETRY_FOLLOW_UP') && client.rows.some(row => row.event?.type === 'agent_end'), 'retry and follow-up', 30000)
      const history = texts(journal(client.directory))
      assert(history.includes('RETRY_ORIGINAL')); assert(history.includes('FIXTURE_REPLY'))
      assert(!client.rows.some(row => row.type === 'error' && /disposed|reinitialized/.test(row.message)))
    } finally { await client.stop() }
  })
  await check('BF11 source revocation blocks old tools before host auto-activation', async () => {
    const client = await start('source-revoked')
    try {
      client.send({ type: 'sync_tools', tools: [tool('mcp__fixture__read_record')] })
      await ready(client, 'revocation-ready')
      holdRevokedCall = true
      const before = requests.length
      client.send({ type: 'prompt', id: 'revocation-turn', message: 'REVOKE_WHILE_BUSY', systemPrompt: 'Fixture.',
        taskPreparation: { instructions: '', sourceContext: '', capabilityFamilies: [], sourceSlugs: ['fixture'] } })
      await until(() => requests.length > before, 'held source tool call')
      client.send({ type: 'sync_tools', tools: [] })
      await ready(client, 'revocation-barrier')
      releaseRevokedCall()
      await until(() => client.rows.some(row => row.event?.type === 'agent_end'), 'revoked source call')
      assert(!client.rows.some(row => row.type === 'pre_tool_use_request'), 'Revoked tool reached the host activation path')
      assert(!client.rows.some(row => row.type === 'tool_execute_request'))
      const history = texts(journal(client.directory))
      assert(history.includes('no longer available'))
      assert(history.includes('FIXTURE_REPLY'))
    } finally { holdRevokedCall = false; releaseRevokedCall(); await client.stop() }
  })
  evidence.json('requests.json', requests)
  assert(checks.every(result => result.passed), JSON.stringify(checks.filter(result => !result.passed)))
  evidence.complete(checks.map(result => result.id), ['live provider accounts', 'native desktop UI', 'macOS/Linux', 'signed installer'])
} catch (error) { failure = error }
finally { holdSummary = false; releaseSummary(); holdRevokedCall = false; releaseRevokedCall(); await Promise.all(children.map(child => child.stop())); await http.stop(true); evidence.json('requests.json', requests) }
evidence.finish(failure)
console.log(JSON.stringify({ passed: checks.length, directory: evidence.directory }))
