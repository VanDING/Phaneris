/** Written from B5's cancellation failure matrix before the stop-response repair. Actual Pi JSONL and a loopback tool call. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-ask-stop-'))
process.env.PHANERIS_CONFIG_DIR = fixture; process.env.NODE_ENV = 'test'
const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
const { AbortReason } = await import('../../packages/shared/src/agent/backend/types.ts')
const wire: any[] = [], sent: any[] = [], checks: any[] = []
let question = '', requests = 0, seq = 0
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
  requests++
  const event = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: 'question', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  const args = { questions: [{ id: 'approach', question: 'Which inert option?', options: [{ label: 'First' }, { label: 'Second' }] }] }
  return new Response(event({ role: 'assistant' }) + event({ tool_calls: [{ index: 0, id: 'question-call', type: 'function',
    function: { name: 'mcp__session__ask_user', arguments: JSON.stringify(args) } }] }) + event({}, 'tool_calls') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } })
} })
const workspace = join(fixture, 'workspace'); mkdirSync(join(workspace, 'sessions', 'ask-stop'), { recursive: true })
const agent = new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture',
  workspace: { id: 'fixture', name: 'Fixture', rootPath: workspace }, session: { id: 'ask-stop', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 },
  isHeadless: true, envOverrides: { PHANERIS_CONFIG_DIR: fixture, HOME: fixture, USERPROFILE: fixture, NODE_ENV: 'test' },
  runtime: { paths: { piServer: process.env.PHANERIS_VERIFY_PI_ENTRY ?? join(root, 'packages/pi-agent-server/dist/index.js'), node: process.env.PHANERIS_VERIFY_PI_BUN ?? process.execPath },
    baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
  durableModelBoundary: { prepare: async () => ({ operationId: `model-${++seq}`, idempotencyKey: `model-${seq}`, created: true, status: 'prepared', committedSeq: seq }),
    commitOutcome: async () => ({ committedSeq: ++seq }) },
  durableToolBoundary: { prepare: async () => ({ operationId: `tool-${++seq}`, idempotencyKey: `tool-${seq}`, canonicalArgsHash: 'fixture', recoveryMode: 'pure', created: true, status: 'prepared', committedSeq: seq }),
    commitOutcome: async () => ({ committedSeq: ++seq }) },
} as any) as any
const originalHandle = agent.handleLine.bind(agent), originalSend = agent.send.bind(agent)
agent.handleLine = (line: string) => { try { wire.push(JSON.parse(line)) } catch {} return originalHandle(line) }
agent.send = (message: any) => { sent.push(message); return originalSend(message) }
agent.onAskUserRequest = (id: string) => { question = id }
agent.onPermissionRequest = (request: any) => agent.respondToPermission(request.requestId, true, false)
async function until(predicate: () => boolean) {
  const end = Date.now() + 20000
  while (!predicate()) { if (Date.now() > end) throw Error('Ask-user workflow deadline'); await Bun.sleep(10) }
}
try {
  await agent.ensureSubprocess()
  agent.send({ type: 'sync_tools', tools: [{ name: 'mcp__session__ask_user', namespace: { name: 'session' }, description: 'Ask an inert question',
    exposure: 'direct', inputSchema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object' } } }, required: ['questions'] } }] })
  agent.send({ type: 'prompt', id: 'ask', message: 'Ask one question', systemPrompt: 'Fixture', durableRunOperationId: 'ask-run' })
  await until(() => question.length > 0)
  agent.forceAbort(AbortReason.UserStop)
  await until(() => wire.some(message => message.type === 'event' && message.event?.type === 'agent_settled'))
  await until(() => agent.pendingHostToolRequests.size === 0)
  const dismissal = sent.find(message => message.type === 'tool_execute_response')
  assert(dismissal?.result.content.includes('dismissed'), 'Stop must return the completed question dismissal to the live child')
  assert.equal(dismissal.result.isError, false)
  assert.equal(wire.find(message => message.type === 'event' && message.event?.type === 'agent_settled').event.aborted, true)
  assert.equal(agent.pendingAskUser.size, 0)
  assert.equal(requests, 1)
  checks.push({ id: 'Stop returns the question dismissal, drains host/child waits and settles once as aborted', pass: true,
    observation: { requests, toolResponses: sent.filter(message => message.type === 'tool_execute_response').length, settled: true } })
} catch (error) { checks.push({ id: 'question cancellation', pass: false, error: error instanceof Error ? error.stack : String(error) }) }
finally { await agent.disposeForRestart(); agent.destroy(); api.stop(true) }
const output = resolve(process.argv[2] ?? join(root, '.cache/pi-110-implementation/ask-user-stop.json'))
mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), fixture, checks }, null, 2) + '\n')
console.log(JSON.stringify({ output, checks })); process.exit(checks.every(check => check.pass) ? 0 : 1)
