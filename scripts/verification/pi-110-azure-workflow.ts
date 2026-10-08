/** Real host + bundled Pi child + Azure Responses loopback, including legacy history. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..'), fixture = mkdtempSync(join(tmpdir(), 'phaneris-azure-'))
process.env.PHANERIS_CONFIG_DIR = fixture; process.env.NODE_ENV = 'test'
const requests: any[] = [], effects: any[] = [], checks: any[] = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push({ path: new URL(req.url).pathname, model: body.model })
  const message = { id: 'azure-message', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Azure fixture complete', annotations: [] }] }
  const response = { id: `azure-${requests.length}`, object: 'response', status: 'completed', model: body.model, output: [message], usage: { input_tokens: 7, output_tokens: 3, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [], status: 'in_progress' } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Azure fixture complete' },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response },
  ]
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
} })
const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
const { getCredentialManager } = await import('../../packages/shared/src/credentials/index.ts')
const { getPiModelsForAuthProvider } = await import('../../packages/shared/src/config/models-pi.ts')
const model = getPiModelsForAuthProvider('azure-openai-responses').find(m => m.id === 'pi/gpt-5-mini') ?? getPiModelsForAuthProvider('azure-openai-responses')[0]
await getCredentialManager().setLlmApiKey('azure-fixture', 'inert-key')
const workspace = join(fixture, 'workspace'), id = 'azure-fixture'
mkdirSync(join(workspace, 'sessions', id), { recursive: true })
async function round(prompt: string) {
  const wire: any[] = []
  const agent = new PiAgent({ provider: 'pi', providerType: 'pi', authType: 'api_key', connectionSlug: id, model: model.id,
    workspace: { id, name: 'Azure fixture', rootPath: workspace } as any,
    session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 } as any, isHeadless: true,
    runtime: { paths: { piServer: process.env.PHANERIS_VERIFY_PI_ENTRY ?? join(root, 'packages/pi-agent-server/dist/index.js'), node: process.env.PHANERIS_VERIFY_PI_BUN ?? process.execPath }, piAuthProvider: 'azure-openai-responses', baseUrl: api.url.href },
    envOverrides: { HOME: fixture, USERPROFILE: fixture, PHANERIS_CONFIG_DIR: fixture, NODE_ENV: 'test' },
    durableModelBoundary: { prepare: async request => { effects.push({ phase: 'T1', provider: request.provider, model: request.model }); return { operationId: `m-${effects.length}`, idempotencyKey: `m-${effects.length}`, created: true, status: 'prepared', committedSeq: effects.length } },
      commitOutcome: async request => { effects.push({ phase: 'T2', provider: request.provider, stopReason: request.stopReason }); return { committedSeq: effects.length } }, recordObservation: () => {} } as any,
  }) as any
  const handle = agent.handleLine.bind(agent)
  agent.handleLine = (line: string) => { try { wire.push(JSON.parse(line)) } catch {} handle(line) }
  try {
    await agent.ensureSubprocess()
    agent.send({ type: 'prompt', id: prompt, message: prompt, systemPrompt: 'Azure fixture', durableRunOperationId: prompt })
    const end = Date.now() + 20000
    while (!wire.some(m => m.type === 'event' && m.event?.type === 'agent_settled')) { if (Date.now() > end) throw Error('Azure workflow deadline'); await Bun.sleep(10) }
    assert(!wire.some(m => m.type === 'error'), JSON.stringify(wire.filter(m => m.type === 'error')))
    assert.equal(wire.find(m => m.type === 'event' && m.event.type === 'agent_settled').event.aborted, false)
    return { sessionId: agent.piSessionId, settled: true }
  } finally { await agent.disposeForRestart(); agent.destroy() }
}
try {
  const first = await round('first')
  const files = readdirSync(join(workspace, 'sessions', id, '.pi-sessions'), { recursive: true }).filter(f => String(f).endsWith('.jsonl'))
  assert.equal(files.length, 1)
  const file = join(workspace, 'sessions', id, '.pi-sessions', String(files[0]))
  const saved = readFileSync(file, 'utf8')
  const legacy = saved.split('\n').map(line => {
    if (!line.trim()) return line
    const e = JSON.parse(line)
    if (e.provider === 'azure') e.provider = 'azure-openai-responses'
    if (e.message?.provider === 'azure') e.message.provider = 'azure-openai-responses'
    return JSON.stringify(e)
  }).join('\n')
  assert.notEqual(legacy, saved)
  writeFileSync(file, legacy)
  const resumed = await round('resumed')
  assert.equal(first.sessionId, resumed.sessionId)
  assert.equal(requests.length, 2)
  assert(requests.every(r => r.path.includes('/responses') && r.model === model.id.slice(3)))
  assert(effects.every(e => e.provider === 'azure'))
  assert.equal(effects.filter(e => e.phase === 'T1').length, 2)
  assert.equal(effects.filter(e => e.phase === 'T2').length, 2)
  checks.push({ id: 'native Azure endpoint and legacy session preserve configured model/account', pass: true, observation: { first, resumed, requests, effects } })
} catch (error) { checks.push({ id: 'native Azure endpoint and legacy session preserve configured model/account', pass: false, error: String(error) }) }
finally { api.stop(true) }
const output = resolve(process.argv[2] ?? join(root, '.cache/pi-110-implementation/azure.json'))
mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: 'pi-110-azure-v1', checks }, null, 2) + '\n')
console.log(JSON.stringify({ output, checks })); process.exit(checks.every(c => c.pass) ? 0 : 1)
