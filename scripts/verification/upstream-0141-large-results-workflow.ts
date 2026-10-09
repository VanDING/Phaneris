/** Failure cases precede implementation. Real HTTP decisions, MCP/API, Pi child and raw files. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-0141-large-'))
process.env.PHANERIS_CONFIG_DIR = fixture; process.env.NODE_ENV = 'test'
const checks: any[] = [], requests: any[] = []
let mode = 'tail', delay = 0, summaries = 0
const raw = JSON.stringify({ provenance: 'complete source', items: Array.from({ length: 140 }, (_, i) => ({ id: i, text: i === 139 ? 'TAIL_EVIDENCE 最后一条证据 42' : `irrelevant row ${i} ` + '普通背景内容。'.repeat(100) })) })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  if (new URL(req.url).pathname === '/report') return new Response(raw, { headers: { 'Content-Type': 'application/json' } })
  const body = await req.json() as any; requests.push(body)
  const current = mode
  if (delay) await Bun.sleep(delay)
  if (current === 'failure') return new Response('injected failure', { status: 503 })
  const entries = Object.entries(body.questions).map(([key, q]: any) => [key, { type: 'noul', noul: current === 'all' ? .99 : current === 'none' ? .01 : String(q.instructions).includes('TAIL_EVIDENCE') ? .99 : .01 }])
  if (current === 'missing') entries.pop()
  return Response.json({ model: 'fixture', answers: Object.fromEntries(entries), usage: { input_tokens: 20, output_tokens: 5 } })
} })
writeFileSync(join(fixture, 'config.json'), JSON.stringify({ workspaces: [], decisionLayer: { enabled: true, provider: 'custom', baseUrl: api.url.href, model: 'fixture', features: { largeResults: true } } }))
const large = await import('../../packages/shared/src/utils/large-response.ts')
const filtering = await import('../../packages/server-core/src/decisions/large-result-filter.ts')
const decisions = await import('../../packages/shared/src/decisions/index.ts')
const { createLargeResultFilterClient } = await import('../../packages/pi-agent-server/src/large-result-filter.ts')
const { McpClientPool } = await import('../../packages/shared/src/mcp/mcp-pool.ts')
const { McpPoolServer } = await import('../../packages/shared/src/mcp/pool-server.ts')
const { ApiSourcePoolClient } = await import('../../packages/shared/src/mcp/api-source-pool-client.ts')
const { createApiServer } = await import('../../packages/shared/src/sources/api-tools.ts')
const sessionPath = join(fixture, 'sessions', 'filter'); mkdirSync(sessionPath, { recursive: true })
large.setLargeResultFilter(filtering.buildLargeResultFilter())
const handle = (text = raw, signal?: AbortSignal) => large.handleLargeResponse({ text, sessionPath, signal, context: { toolName: 'fixture', intent: 'Find TAIL_EVIDENCE' }, summarize: async () => { summaries++; return 'FALLBACK_SUMMARY' } })
async function check(id: string, action: () => any) { try { checks.push({ id, pass: true, observation: await action() }) } catch (error) { checks.push({ id, pass: false, error: error instanceof Error ? error.stack : String(error) }) } }
async function until(predicate: () => boolean, ms = 20000) { const end = Date.now() + ms; while (!predicate()) { if (Date.now() > end) throw Error('Workflow deadline'); await Bun.sleep(10) } }
try {
  await check('tail evidence reaches a bounded excerpt; full original is saved exactly', async () => {
    const result = (await handle())!; assert(result.message.includes('TAIL_EVIDENCE')); assert(!result.wasSummarized)
    assert(result.message.length <= 12000); assert.equal(readFileSync(result.filePath, 'utf8'), raw); assert.equal(summaries, 0)
    return { rawChars: raw.length, outputChars: result.message.length, sha256: hash(raw), filePath: result.filePath }
  })
  await check('missing answers, failed calls, none and nearly all relevant fall back without dropping unscored parts', async () => {
    for (mode of ['missing', 'failure', 'none', 'all']) assert((await handle())?.message.includes('FALLBACK_SUMMARY'), mode)
    assert.equal(summaries, 4); mode = 'tail'
  })
  await check('Chinese long lines and formatted headers/gaps obey the complete output budget', async () => {
    const text = '正文'.repeat(30000) + 'TAIL_EVIDENCE' + '结尾'.repeat(100)
    const filter = filtering.buildLargeResultFilter()
    const result = await filter({ text, context: { toolName: 'long-line', intent: 'TAIL_EVIDENCE' }, budgetChars: 27000, filePath: 'C:/fixture/original.txt' })
    assert(result?.text.includes('TAIL_EVIDENCE')); assert(result.text.length <= 27000)
    assert.equal(await filter({ text: raw, context: { toolName: 'tiny', intent: 'TAIL_EVIDENCE' }, budgetChars: 90, filePath: 'C:/fixture/' + 'x'.repeat(1000) }), null)
    const before = requests.length
    assert.equal(await filter({ text: '正文'.repeat(large.LARGE_RESULT_MAX_TEXT_CHARS), context: { toolName: 'too-large', intent: 'tail' }, budgetChars: 12000, filePath: 'fixture' }), null)
    assert.equal(requests.length, before)
    return { outputChars: result.text.length, boundedWholeText: true }
  })
  await check('one total deadline and cancellation stop all waves; cancellation never starts a summary', async () => {
    delay = 300
    large.setLargeResultFilter(filtering.buildLargeResultFilter({ totalDeadlineMs: 80 }))
    const start = performance.now(); assert((await handle())?.wasSummarized); assert(performance.now() - start < 1000)
    large.setLargeResultFilter(filtering.buildLargeResultFilter())
    const before = summaries, abort = new AbortController(), pending = handle(raw, abort.signal)
    setTimeout(() => abort.abort(), 30)
    await assert.rejects(pending, /abort/i); assert.equal(summaries, before)
    delay = 0
  })
  await check('JSONL filter settles send failures, cancellation, lost replies and ignores stale replies', async () => {
    const sent: any[] = [], client = createLargeResultFilterClient(m => sent.push(m), 50)
    const input = { text: raw, context: { toolName: 'fixture', intent: 'tail' }, budgetChars: 12000, filePath: 'C:/fixture/raw.json' }
    const pending = client.filter(input); assert.equal(sent[0].text, raw); assert.equal(await pending, null)
    client.handleResponse(sent[0].requestId, { text: 'late', kept: 2, total: 5 })
    const abort = new AbortController(), cancelled = client.filter({ ...input, signal: abort.signal }); abort.abort(); assert.equal(await cancelled, null)
    assert(sent.some(m => m.type === 'large_result_filter_cancel'))
    const all = client.filter(input); client.cancelAll(); assert.equal(await all, null)
    assert.equal(await createLargeResultFilterClient(() => { throw Error('broken pipe') }).filter(input), null)
  })
  await check('embedded API only receives declared intent; durable identity and cancellation survive', async () => {
    const source = new McpServer({ name: 'intent-contract', version: '1' }), observed: any[] = []
    source.registerTool('accept', { inputSchema: { _intent: z.string().optional() } }, async (args, extra) => { observed.push({ args, meta: extra._meta }); return { content: [{ type: 'text', text: 'ok' }] } })
    source.registerTool('plain', { inputSchema: {} }, async args => { observed.push({ args }); return { content: [{ type: 'text', text: 'ok' }] } })
    const client = new ApiSourcePoolClient(source)
    const identity = { operationId: 'durable-fixture', idempotencyKey: 'idempotent', canonicalArgsHash: 'hash' }
    try {
      await client.listTools(); await client.callTool('accept', {}, { intent: 'tail', durableTool: identity as any }); await client.callTool('plain', {}, { intent: 'tail' })
      assert.equal(observed[0].args._intent, 'tail'); assert.deepEqual(observed[0].meta['craft/durable-operation'], identity); assert.equal(observed[1].args._intent, undefined)
      const abort = new AbortController(); abort.abort(); await assert.rejects(client.callTool('accept', {}, { signal: abort.signal }))
    } finally { await client.close() }
  })
  await check('actual Pi host/child to MCP and API preserves intent, raw structured data and one T1/T2 per execution', async () => {
    const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
    const upstreamPool = new McpClientPool(), bridge = new McpPoolServer(upstreamPool)
    const source = new McpServer({ name: 'external', version: '1' }); let executed = 0
    source.registerTool('read', { inputSchema: {}, outputSchema: { raw: z.string() } }, async args => { assert.equal((args as any)._intent, undefined); executed++; return { content: [{ type: 'text', text: raw }], structuredContent: { raw } } })
    await upstreamPool.connectInProcess('external', source)
    // Also exercise shared pools without a storage path: the Pi child must save
    // the full result and request the host filter over the real JSONL transport.
    const filterInChild = process.env.PHANERIS_VERIFY_FILTER_IN_CHILD === '1'
    const sourceSessionPath = filterInChild ? undefined : sessionPath
    const pool = new McpClientPool({ sessionPath: sourceSessionPath }), wire: any[] = [], effects: any[] = [], models: any[] = []
    const sourceUrl = await bridge.start()
    const apiSource = createApiServer({ name: 'fixture', baseUrl: api.url.href, authType: 'none' } as any, '', sourceSessionPath)
    await pool.connect('fixture', { type: 'http', url: sourceUrl })
    await pool.connectInProcess('api', apiSource)
    let target = pool.getProxyToolDefs().find(t => !t.name.startsWith('mcp__api__'))!.name
    let toolArgs: any = { _intent: 'Find TAIL_EVIDENCE' }, seq = 0
    const model = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const body = await req.json() as any; models.push(body)
      const done = body.messages.findLastIndex((m: any) => m.role === 'tool') > body.messages.findLastIndex((m: any) => m.role === 'user')
      const event = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: 'filter', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      return new Response(event({ role: 'assistant' }) + (done ? event({ content: 'done' }) + event({}, 'stop') : event({ tool_calls: [{ index: 0, id: `call-${++seq}`, type: 'function', function: { name: target, arguments: JSON.stringify(toolArgs) } }] }) + event({}, 'tool_calls')) + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    const workspace = join(fixture, 'workspace'); mkdirSync(join(workspace, 'sessions', 'native'), { recursive: true })
    const agent = new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture', mcpPool: pool,
      workspace: { id: 'fixture', name: 'Fixture', rootPath: workspace }, session: { id: 'native', workspaceRootPath: workspace, createdAt: Date.now(), lastUsedAt: Date.now() },
      isHeadless: true, envOverrides: { PHANERIS_CONFIG_DIR: fixture, HOME: fixture, USERPROFILE: fixture, NODE_ENV: 'test' },
      durableModelBoundary: { prepare: async () => ({ operationId: `model-${++seq}`, idempotencyKey: `model-${seq}`, created: true, status: 'prepared', committedSeq: seq }), commitOutcome: async () => ({ committedSeq: ++seq }) },
      durableToolBoundary: { prepare: async (r: any) => { effects.push({ phase: 'T1', ...r }); return { operationId: `tool-${r.providerToolCallId}`, idempotencyKey: `tool-${r.providerToolCallId}`, canonicalArgsHash: 'fixture', recoveryMode: 'pure', created: true, status: 'prepared', committedSeq: ++seq } }, commitOutcome: async (r: any) => { effects.push({ phase: 'T2', ...r }); return { committedSeq: ++seq } } },
      runtime: { paths: { piServer: process.env.PHANERIS_VERIFY_PI_ENTRY ?? join(root, 'packages/pi-agent-server/dist/index.js'), node: process.env.PHANERIS_VERIFY_PI_BUN ?? process.execPath }, baseUrl: model.url.href, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
    } as any) as any
    const line = agent.handleLine.bind(agent), send = agent.send.bind(agent)
    agent.handleLine = (input: string) => { try { wire.push(JSON.parse(input)) } catch {} return line(input) }
    const hostReplies: any[] = []
    agent.send = (m: any) => { if (m.type === 'tool_execute_response') hostReplies.push(m); return send(m) }
    agent.onPermissionRequest = (request: any) => agent.respondToPermission(request.requestId, true, false)
    try {
      await agent.setSourceServers({ fixture: { type: 'http', url: sourceUrl } }, { api: apiSource }, ['fixture', 'api'])
      await agent.ensureSubprocess()
      const defs = pool.getProxyToolDefs().map(t => ({ ...t, exposure: 'direct' }))
      agent.send({ type: 'sync_tools', tools: defs })
      for (const kind of ['mcp', 'api']) {
        if (kind === 'api') { target = defs.find(t => t.name.startsWith('mcp__api__'))!.name; toolArgs = { path: '/report', method: 'GET', _intent: 'Find TAIL_EVIDENCE' }; await agent.disposeForRestart(); await agent.ensureSubprocess(); agent.send({ type: 'sync_tools', tools: defs }) }
        agent.prerequisiteManager.trackReadTool({ file_path: join(workspace, 'sources', kind === 'api' ? 'api' : 'fixture', 'guide.md') })
        const before = wire.length, modelBefore = models.length
        agent.send({ type: 'prompt', id: kind, message: 'Find evidence', systemPrompt: 'Use the provided source tool once.', durableRunOperationId: `run-${kind}` })
        await until(() => wire.slice(before).some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
        assert.equal(models.length - modelBefore, 2)
        const view = models.at(-1).messages.findLast((m: any) => m.role === 'tool').content
        assert(JSON.stringify(view).includes('TAIL_EVIDENCE'), `${kind}: evidence missing from tool response: ${JSON.stringify(view).slice(0, 1600)}`)
        assert(JSON.stringify(view).length < 14000, `${kind}: model tool response has ${JSON.stringify(view).length} chars`)
      }
      assert.equal(executed, 1); assert.equal(effects.filter(e => e.phase === 'T1').length, 2); assert.equal(effects.filter(e => e.phase === 'T2').length, 2)
      assert.equal(hostReplies[0].result.structuredContent?.raw ?? hostReplies[0].result.structuredContent?.structuredContent?.raw, raw)
      const filterRequests = wire.filter(m => m.type === 'large_result_filter_request')
      if (filterInChild) {
        assert.equal(filterRequests.length, 2)
        for (const request of filterRequests) {
          assert.equal(request.text, raw)
          assert.equal(hash(readFileSync(request.filePath, 'utf8')), hash(raw))
        }
      }
      return { filterInChild, executions: 2, externalExecutions: executed, t1: 2, t2: 2, rawHash: hash(raw), modelRequests: models.length, filterRequests: filterRequests.length, wireTypes: [...new Set(wire.map(m => m.type))] }
    } finally {
      const diagnostic = join(root, '.cache/pi-110-implementation/large-results-native-wire.json')
      mkdirSync(resolve(diagnostic, '..'), { recursive: true })
      writeFileSync(diagnostic, JSON.stringify({ fixture, wire, effects, models, hostReplies }, null, 2))
      await agent.disposeForRestart(); agent.destroy(); model.stop(true); await pool.disconnectAll(); await bridge.stop(); await upstreamPool.disconnectAll()
    }
  })
  await check('follow-up labels only exact-path access attempts; logs contain no result text', async () => {
    const result = (await handle())!; filtering.noteLargeResultFileUse('filter', { path: 'unrelated/' + result.filePath.split(/[\\/]/).at(-1) }); filtering.noteLargeResultFileUse('filter', { file_path: result.filePath }); filtering.finishLargeResultExcerpts('filter')
    await decisions.getDecisionRecorder().flush()
    const log = readFileSync(decisions.defaultDecisionsLogPath(), 'utf8')
    assert(log.includes('file_access_attempted')); assert(!log.includes('"file_read"')); assert(!log.includes('TAIL_EVIDENCE')); assert(!log.includes('普通背景内容'))
  })
} finally { api.stop(true); large.setLargeResultFilter(null) }
const output = resolve(process.argv[2] ?? join(root, '.cache/pi-110-implementation/large-results-b4.json'))
mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: 'upstream-0141-large-v1', checks, decisionRequests: requests.length, rawSha256: hash(raw) }, null, 2) + '\n')
console.log(JSON.stringify({ output, passed: checks.filter(c => c.pass).length, total: checks.length, failures: checks.filter(c => !c.pass) })); process.exit(checks.every(c => c.pass) ? 0 : 1)
