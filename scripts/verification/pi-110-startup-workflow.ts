/** Real Pi child + loopback provider. Failure cases are defined before production changes. */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'phaneris-pi-startup-'))
process.env.PHANERIS_CONFIG_DIR = fixture
process.env.NODE_ENV = 'test'
const requests: any[] = [], commands: any[] = [], received: any[] = [], checks: any[] = []
const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as any
  requests.push(body)
  const event = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ id: 'startup', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return new Response(event({ role: 'assistant' }) + event({ content: 'fixture complete' }) + event({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
} })
const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent.ts')
let seq = 0
const boundary = {
  prepare: async () => ({ operationId: `model-${++seq}`, idempotencyKey: `model-${seq}`, created: true, status: 'prepared', committedSeq: seq }),
  commitOutcome: async () => ({ committedSeq: ++seq }),
}
function makeAgent(id: string) {
  const workspace = join(fixture, id)
  mkdirSync(join(workspace, 'sessions', id), { recursive: true })
  return new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture',
    workspace: { id, name: 'Startup fixture', rootPath: workspace } as any,
    session: { id, workspaceRootPath: workspace, createdAt: Date.now(), lastUsedAt: Date.now() } as any,
    isHeadless: true, durableModelBoundary: boundary as any,
    envOverrides: { PHANERIS_CONFIG_DIR: fixture, HOME: fixture, USERPROFILE: fixture, NODE_ENV: 'test' },
    runtime: { paths: { piServer: process.env.PHANERIS_VERIFY_PI_ENTRY ?? join(root, 'packages/pi-agent-server/dist/index.js'), node: process.env.PHANERIS_VERIFY_PI_BUN ?? process.execPath }, baseUrl: api.url.href,
      customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] },
  }) as any
}
async function until(f: () => boolean, ms = 20000) {
  const end = Date.now() + ms
  while (!f()) { if (Date.now() > end) throw Error('Workflow deadline exceeded'); await Bun.sleep(10) }
}
async function check(id: string, action: () => Promise<any>) {
  try { checks.push({ id, pass: true, observation: await action() }) }
  catch (error) { checks.push({ id, pass: false, error: String(error) }) }
}
const agent = makeAgent('startup')
const send = agent.send.bind(agent), handleLine = agent.handleLine.bind(agent)
agent.send = (command: any) => { commands.push({ ...command, at: performance.now() }); return send(command) }
agent.handleLine = (line: string) => {
  let message: any
  try { message = JSON.parse(line) } catch { return handleLine(line) }
  received.push(message)
  // Delay an actual IPC reply so the race is repeatable without changing the child.
  if (message.type === 'set_auto_compaction_result') setTimeout(() => handleLine(line), 250)
  else handleLine(line)
}
try {
  const startup = agent.ensureSubprocess()
  await until(() => received.some(m => m.type === 'ready'))
  const concurrent = agent.ensureSubprocess()
  await concurrent
  agent.send({ type: 'prompt', id: 'first', message: 'first', systemPrompt: 'Fixture', durableRunOperationId: 'run-first' })
  await until(() => received.some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
  await startup
  const before = received.length
  agent.send({ type: 'prompt', id: 'second', message: 'second', systemPrompt: 'Fixture', durableRunOperationId: 'run-second' })
  await until(() => received.slice(before).some(m => m.type === 'event' && m.event?.type === 'agent_settled'))
  await check('first and subsequent provider tools are identical', async () => {
    const names = requests.map(r => (r.tools ?? []).map((t: any) => t.function?.name).sort())
    assert.equal(names.length, 2)
    assert(names[0].includes('mcp__session__call_llm'), 'First turn lacks session tools')
    assert.deepEqual(names[0], names[1])
    return { tools: names }
  })
  await check('concurrent startup waits for policy and sync_tools', async () => {
    assert(commands.findIndex(c => c.type === 'sync_tools') < commands.findIndex(c => c.type === 'prompt'))
    return { order: commands.map(c => c.type), pid: agent.subprocess?.pid }
  })
} finally { agent.destroy() }
await check('concurrent credential lookup owns a single child', async () => {
  const a = makeAgent('concurrent')
  const original = a.getPiAuth.bind(a)
  let lookups = 0
  a.getPiAuth = async () => { lookups++; await Bun.sleep(100); return original() }
  try { await Promise.all([a.ensureSubprocess(), a.ensureSubprocess()]); assert.equal(lookups, 1); return { lookups } }
  finally { a.destroy() }
})
await check('destroy during credential lookup rejects startup', async () => {
  const a = makeAgent('destroy')
  a.getPiAuth = async () => { await Bun.sleep(150); return null }
  const pending = a.ensureSubprocess()
  a.destroy()
  try {
    await assert.rejects(Promise.race([pending, Bun.sleep(1500).then(() => { throw Error('deadline guard') })]), /destroy|cancel|abort|exit/i)
  } finally { a.destroy() }
  return { settled: true }
})
api.stop(true)
const output = resolve(process.argv[2] ?? join(root, '.cache/pi-110-implementation/startup.json'))
mkdirSync(resolve(output, '..'), { recursive: true })
writeFileSync(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixture: 'pi-110-startup-v1', checks,
  providerTools: requests.map(r => (r.tools ?? []).map((t: any) => t.function?.name)), commands: commands.map(c => ({ type: c.type, at: c.at })) }, null, 2) + '\n')
console.log(JSON.stringify({ output, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length }))
process.exit(checks.some(c => !c.pass) ? 1 : 0)
