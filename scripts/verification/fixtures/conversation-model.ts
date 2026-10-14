/** Shared fixture for actual WebUI/Electron + Pi, not a substitute execution owner. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyConversationDurability(workspace: string, session: string, output: string, host: 'web' | 'electron') {
  const { Database, constants } = await import('bun:sqlite')
  const databasePath = join(workspace, 'runtime', 'runtime.db')
  // Electron has exited and checkpointed its WAL. Immutable read avoids asking
  // a read-only connection to create a new WAL/shm pair for that closed database.
  if (host === 'electron') assert(!existsSync(databasePath + '-wal') || statSync(databasePath + '-wal').size === 0,
    'Native shutdown must checkpoint the WAL before immutable snapshot inspection')
  // SQLite URI parameters require the explicit URI flag (including on Windows).
  const db = host === 'electron'
    ? new Database(pathToFileURL(databasePath).href + '?immutable=1', constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI)
    : new Database(databasePath, { readonly: true })
  try {
    db.exec('BEGIN')
    const events = db.query(`SELECT seq, operation_id, event_type, payload_json FROM runtime_events
      WHERE session_id = ? AND event_type IN ('tool_dispatch_committed', 'tool_outcome_committed', 'operation_terminal', 'tool_recovery_decided') ORDER BY seq`).all(session) as {
      seq: number; operation_id: string; event_type: string; payload_json: string
    }[]
    const facts = events.map(({ payload_json, ...event }) => ({ ...event, payload: JSON.parse(payload_json) as { toolName?: string } }))
    const plan = facts.filter(event => event.event_type === 'tool_outcome_committed' && event.payload.toolName?.endsWith('SubmitPlan'))
    const writes = facts.filter(event => event.event_type === 'tool_outcome_committed' && event.payload.toolName === 'Write')
    assert.equal(plan.length, 1); assert.equal(writes.length, 1)
    const terminal = facts.find(event => event.event_type === 'operation_terminal' && event.operation_id === plan[0]!.operation_id)
    assert(terminal && terminal.seq > plan[0]!.seq, 'Plan T2 must precede Host terminal')
    assert(!facts.some(event => event.event_type === 'tool_recovery_decided' && event.operation_id === plan[0]!.operation_id), 'A successful plan must not require reconciliation')
    writeFileSync(join(output, `${host}-conversation-runtime.json`), JSON.stringify({ checks: ['one real Write T2', 'one real SubmitPlan T2', 'plan T2 before Host terminal', 'no successful-plan recovery parking'], facts }, null, 2))
    writeFileSync(join(output, `${host}-conversation.db`), db.serialize())
  } finally { db.close() }
}

interface ModelRequest {
  messages?: { role: string; content: unknown }[]
  tools?: { function: { name: string } }[]
}
const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value)

export async function seedConversationFixture(config: string, workspace: string) {
  assert.equal(process.env.PHANERIS_CONFIG_DIR, config, 'Set the isolated config before importing its consumers')
  const { createSession } = await import('../../../packages/shared/src/sessions/storage')
  const session = await createSession(workspace, { name: 'Governance conversation', workingDirectory: workspace,
    permissionMode: 'ask', model: 'pi/fixture', llmConnection: 'fixture' })
  let filePath = join(workspace, 'governance 报告.txt'), planPath = join(workspace, 'sessions', session.id, 'plans', 'governance.md')
  mkdirSync(dirname(planPath), { recursive: true })
  writeFileSync(planPath, '# Governance fixture plan\n\nGOVERNANCE_PLAN_BODY\n\n1. Verify a finite platform port.\n')
  const requests: { mode: string; tools: string[]; toolResult: boolean }[] = []
  const streams = new Set<ReturnType<typeof setInterval>>()
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model', owned_by: 'fixture' }] })
    const body = await request.json() as ModelRequest
    const messages = body.messages ?? [], tools = (body.tools ?? []).map(tool => tool.function.name)
    const lastUser = messages.findLastIndex(message => message.role === 'user')
    const user = text(messages[lastUser]?.content ?? '')
    const toolResult = messages.slice(lastUser + 1).some(message => message.role === 'tool')
    const mode = tools.length === 0 ? 'utility' : user.includes('GOVERNANCE_PERMISSION') ? 'permission'
      : user.includes('GOVERNANCE_PLAN_REQUEST') ? 'plan' : user.includes('GOVERNANCE_CANCEL') ? 'cancel' : 'continuation'
    requests.push({ mode, tools, toolResult })
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: `ui-${requests.length}`, object: 'chat.completion.chunk',
      created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }],
      ...(finish ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
    const headers = { 'Content-Type': 'text/event-stream' }
    if (mode === 'cancel') {
      let timer: ReturnType<typeof setInterval> | undefined
      const release = () => { if (timer) { clearInterval(timer); streams.delete(timer); timer = undefined } }
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk({ role: 'assistant', content: 'GOVERNANCE_CANCEL_RUNNING' })))
          timer = setInterval(() => controller.enqueue(new TextEncoder().encode(': waiting for actual user cancellation\n\n')), 100)
          streams.add(timer)
          request.signal.addEventListener('abort', release, { once: true })
        }, cancel: release,
      })
      return new Response(stream, { headers })
    }
    let reply: string
    if ((mode === 'permission' || mode === 'plan') && !toolResult) {
      const tool = tools.find(name => mode === 'permission' ? /^write$/i.test(name) : /submitplan$/i.test(name))
      assert(tool, `Real ${mode} tool was absent from the production Pi catalog`)
      const args = mode === 'permission' ? { path: filePath, content: 'GOVERNANCE_WRITE_EVIDENCE\n' } : { planPath }
      reply = chunk({ tool_calls: [{ index: 0, id: `ui-${mode}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }, 'tool_calls')
    } else {
      const content = mode === 'permission' ? [
        'GOVERNANCE_PERMISSION_DONE',
        `[Preview governance file](<${filePath}>)`,
        `[Preview with slashes](<${filePath.replaceAll('\\', '/')}>)`,
        `[Preview file URL](${pathToFileURL(filePath).href})`,
        `[Preview encoded path](${encodeURI(filePath)})`,
        `[Preview relative file](<./${basename(filePath)}>)`,
        `[Preview source location](<${filePath.replaceAll('\\', '/')}:1>)`,
      ].join('\n\n')
        : mode === 'utility' ? 'Governance conversation' : 'GOVERNANCE_CONTINUATION_DONE'
      reply = chunk({ content }) + chunk({}, 'stop')
    }
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers })
  } })
  const { getCredentialManager } = await import('../../../packages/shared/src/credentials/manager')
  await getCredentialManager().setLlmApiKey('fixture', 'governance-fixture-only-api-key')
  const connection = { slug: 'fixture', name: 'Governance local model', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
    baseUrl: new URL('v1', api.url).href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'pi/fixture',
    models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Deterministic loopback model', provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] }
  return { session: session.id, name: session.name!, get filePath() { return filePath }, get planPath() { return planPath }, connection,
    relocate(restored: string) { filePath = join(restored, relative(workspace, filePath)); planPath = join(restored, relative(workspace, planPath)) },
    report: () => ({ requests, openStreams: streams.size }),
    stop: () => { for (const timer of streams) clearInterval(timer); streams.clear(); api.stop(true) },
  }
}
