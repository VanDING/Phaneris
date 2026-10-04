/** Real installed Pi subprocess + host MCP sources. --live explicitly permits paid fixture inference. */
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { McpClientPool } from '../../packages/shared/src/mcp/mcp-pool'
import { liveDeepSeek, liveOutput } from './live-deepseek'
if (!process.argv.includes('--live')) throw new Error('Use --live only with explicit user authorization for DeepSeek fixture requests')
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-live-tools-'))
const provider = await liveDeepSeek(), pool = new McpClientPool(), observations: any[] = [], runs: any[] = []
const codemodeOnly = process.argv.includes('--codemode-only')
if (codemodeOnly && existsSync(join(liveOutput, 'multi-source-comparison.json'))) {
  const previous = JSON.parse(readFileSync(join(liveOutput, 'multi-source-comparison.json'), 'utf8'))
  runs.push(...previous.runs.filter((r: any) => r.mode !== 'codemode')); observations.push(...previous.observations)
}
const facts: Record<string, Record<string, any>> = {
  sales: { Atlas: { revenue: 12000 }, Boreal: { revenue: 18000 } },
  billing: { Atlas: { unpaid: 3000 }, Boreal: { unpaid: 0 } },
  support: { Atlas: { priorityOne: 2 }, Boreal: { priorityOne: 0 } },
}
for (const sourceName of Object.keys(facts)) {
  const server = new McpServer({ name: sourceName, version: '1' })
  server.registerTool('read', { description: `Read Q3 2026 ${sourceName} facts for a named client`,
    inputSchema: { client: z.enum(['Atlas', 'Boreal']) }, outputSchema: { client: z.string(), facts: z.record(z.string(), z.number()), citation: z.string() },
    annotations: { readOnlyHint: true } }, async ({ client }) => ({
      content: [{ type: 'text', text: JSON.stringify(facts[sourceName]![client]) },
        { type: 'resource_link', uri: `source://${sourceName}/${client}`, name: `${sourceName} ${client}` }],
      structuredContent: { client, facts: facts[sourceName]![client], citation: `source://${sourceName}/${client}` },
    }))
  for (let i = 0; i < 23; i++) server.registerTool(`archive_${i}`, {
    description: `Read historical ${sourceName} archive partition ${i}. This unrelated historical archive is not needed for current-quarter client comparison.`,
    inputSchema: { year: z.number().describe('Archive year, not the current quarter'), itemId: z.string().describe('Stable historical record identifier'),
      includeDetails: z.boolean().optional().describe('Include optional historical metadata') }, annotations: { readOnlyHint: true },
  }, async () => ({ content: [{ type: 'text', text: 'Unrelated archive' }] }))
  await pool.connectInProcess(sourceName, server)
}
const task = '用三个数据源比较 Atlas 与 Boreal 在 2026 Q3 的收入、未收款和一级支持问题。必须实际读取两家客户的全部三个来源，给出精简中文 Markdown 对比表，指出应优先跟进谁，并为每个来源引用 source:// 地址。不要猜测任何数字。工具按需发现时先搜索；能够批量执行时批量获取证据。仅使用来源工具，不读写本地文件、不运行命令。'
async function run(mode: 'direct' | 'deferred' | 'codemode') {
  const path = join(fixture, mode); mkdirSync(path)
  const wire: any[] = [], effects: any[] = [], calls: any[] = []; let started = 0, firstToolMs: number | undefined
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    if (calls.length >= 5) return Response.json({ error: { message: 'Fixture per-path inference limit' } }, { status: 429 })
    const body: any = await req.json(); calls.push({ schemaBytes: Buffer.byteLength(JSON.stringify(body.tools ?? [])), toolNames: body.tools?.map((t: any) => t.function.name) })
    return provider.request(body, `multi-source-${mode}`, 1000)
  } })
  const env: Record<string, string> = { PHANERIS_CONFIG_DIR: path, HOME: path, USERPROFILE: path, NODE_ENV: 'test' }
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]!
  const child = spawn(process.execPath, [join(root, 'packages/pi-agent-server/dist/index.js')], { cwd: path, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n')
  let stderr = ''; child.stderr.on('data', c => { stderr += c.toString() })
  createInterface({ input: child.stdout }).on('line', line => {
    let m: any; try { m = JSON.parse(line) } catch { return }; wire.push(m)
    if (m.type === 'sdk_observation') observations.push(m.observation)
    if (m.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: m.requestId,
      action: ['tool_search', 'codemode'].includes(m.toolName) || m.toolName.startsWith('mcp__') ? 'allow' : 'block', reason: 'Fixture source-only scope' })
    if (m.type === 'durable_model_prepare_request') send({ type: 'durable_model_prepare_response', requestId: m.requestId, ok: true,
      prepared: { operationId: `model-${mode}-${wire.length}`, idempotencyKey: `model-${mode}-${wire.length}`, created: true, status: 'prepared', committedSeq: wire.length } })
    if (m.type === 'durable_tool_prepare_request') {
      effects.push({ phase: 'T1', ...m }); send({ type: 'durable_tool_prepare_response', requestId: m.requestId, ok: true,
        prepared: { operationId: `tool-${mode}-${m.providerToolCallId}`, idempotencyKey: `tool-${mode}-${m.providerToolCallId}`, canonicalArgsHash: 'fixture', recoveryMode: 'pure', created: true, status: 'prepared', committedSeq: wire.length } })
    }
    if (m.type === 'tool_execute_request') {
      firstToolMs ??= performance.now() - started
      effects.push({ phase: 'execute', tool: m.toolName, input: m.args })
      void pool.callTool(m.toolName, m.args).then(result => send({ type: 'tool_execute_response', requestId: m.requestId, result }), () =>
        send({ type: 'tool_execute_response', requestId: m.requestId, result: { content: 'Fixture source execution failed', isError: true } }))
    }
    if (m.type === 'durable_tool_outcome_request' || m.type === 'durable_model_outcome_request') {
      effects.push({ phase: 'T2', ...m }); send({ type: m.type.replace('_request', '_response'), requestId: m.requestId, ok: true, committedSeq: wire.length })
    }
  })
  const until = async (predicate: () => boolean, timeout = 180_000) => {
    const clock = Date.now(); while (!predicate()) { if (Date.now() - clock > timeout || child.exitCode !== null) throw new Error(`Fixture timed out/exited; ${stderr.slice(-500)}`); await Bun.sleep(25) }
  }
  try {
    send({ type: 'init', apiKey: 'loopback-only', model: 'pi/deepseek-flash', cwd: path, workspaceRootPath: path,
      sessionId: mode, sessionPath: path, workingDirectory: path, plansFolderPath: join(path, 'plans'), thinkingLevel: 'off',
      providerType: 'pi_compat', authType: 'api_key', baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' },
      customModels: [{ id: 'deepseek-flash', contextWindow: 1000000, maxTokens: 1000 }],
      piAuth: { provider: 'custom-endpoint', credential: { type: 'api_key', key: 'loopback-only' } } })
    await until(() => wire.some(m => m.type === 'ready'), 30_000)
    send({ type: 'sync_tools', tools: pool.getProxyToolDefs().map(tool => ({ ...tool, exposure: mode === 'direct' ? 'direct' : 'deferred', namespace: { name: tool.name.split('__')[1]! } })) })
    started = performance.now()
    send({ type: 'prompt', id: `compare-${mode}`, message: task + (mode === 'codemode' ? '\n本次功能验收要求：发现需要的 read 工具后，必须使用一次 codemode 脚本批量读取六项证据。' : ''), systemPrompt: 'You are a precise business analyst. Use only the provided MCP sources. Return the requested cited Markdown report.', durableRunOperationId: `run-${mode}` })
    await until(() => wire.some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
    const elapsedMs = performance.now() - started
    const finals = wire.filter(m => m.type === 'event' && m.event?.type === 'message_end' && m.event.message?.role === 'assistant')
    const report = finals.map(m => m.event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')).at(-1) ?? ''
    const executed = effects.filter(e => e.phase === 'execute'), normalized = report.replaceAll(',', '')
    const missing = ['Atlas', 'Boreal', '12000', '18000', '3000', 'source://sales/', 'source://billing/', 'source://support/'].filter(text => !normalized.includes(text))
    const readPairs = new Set(executed.filter(e => e.tool.endsWith('__read')).map(e => `${e.tool}:${e.input.client}`))
    const orchestrationTools = effects.filter(e => e.phase === 'T1').map(e => e.toolName)
    const record: any = { mode, pass: missing.length === 0 && readPairs.size === 6 && (mode !== 'codemode' || orchestrationTools.includes('codemode')), elapsedMs, firstToolMs,
      modelRoundTrips: calls.length, initialSchemaBytes: calls[0]?.schemaBytes, totalSchemaBytes: calls.reduce((sum, c) => sum + c.schemaBytes, 0),
      calls, executed, orchestrationTools, distinctEvidenceReads: readPairs.size, missing, artifact: join(liveOutput, `multi-source-${mode}.md`),
      usage: provider.ledger.requests.filter((r: any) => r.tag === `multi-source-${mode}`) }
    writeFileSync(record.artifact, report + '\n'); writeFileSync(join(liveOutput, `multi-source-${mode}-wire.json`), JSON.stringify({ wire, effects }, null, 2))
    runs.push(record); console.log(JSON.stringify({ mode, pass: record.pass, modelRoundTrips: calls.length, elapsedMs, missing }))
  } finally { child.kill(); api.stop(true) }
}
try { if (codemodeOnly) await run('codemode'); else { await run('direct'); await run('deferred') } }
finally {
  await pool.disconnectAll(); writeFileSync(join(liveOutput, 'multi-source-comparison.json'), JSON.stringify({ task, fixture,
    sourceTools: 72, runs, observations, connection: provider.connection,
    scope: 'One identical-input direct/deferred pair; optional codemode sample adds an explicit batch instruction and is a correctness check, not a fair latency comparison. Real SDK/provider/MCP and native sandbox. Host preflight/T1/T2 RPC fixture; full host persistence covered separately. Latency includes loopback metering proxy. No population speed/quality claim.',
  }, null, 2))
}
assert(runs.length >= 2); assert(runs.every(r => r.pass), 'Real model task did not satisfy the fixed evidence requirements')
