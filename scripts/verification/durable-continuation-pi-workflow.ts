/** RC04–RC13: real Pi subprocess + Host + SQLite + Windows PowerShell/Python. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { verificationWorkflow } from './verification-artifacts'
import { createDurableRuntime, type DurableRuntime } from '../../packages/server-core/src/durable-runtime'
import { assembleSessionAgent } from '../../packages/server-core/src/sessions/agent-assembly'
import { createSessionAgentCallbacks } from '../../packages/server-core/src/sessions/agent-product-callbacks'
import { buildAgentSessionSnapshot } from '../../packages/server-core/src/sessions/agent-product-context'
import { PiRuntimeDriver, bindPiRuntime } from '../../packages/server-core/src/runtime-adapters/pi-driver'

await verificationWorkflow('durable-continuation-pi', async evidence => {
  const repo = resolve(import.meta.dir, '../..'), workspace = join(evidence.directory, 'workspace'), sessionId = 'continuation'
  const project = join(workspace, 'project'), sessionPath = join(workspace, 'sessions', sessionId)
  mkdirSync(project, { recursive: true }); mkdirSync(sessionPath, { recursive: true })
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config'); process.env.NODE_ENV = 'test'
  const requests: any[] = [], events: any[] = [], checks: string[] = []
  let call: { name: string; id: string; args: object } | undefined
  let rejectNext = false
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json(); requests.push(body)
    if (rejectNext) { rejectNext = false; return Response.json({ error: { message: 'fixture transient provider error' } }, { status: 500 }) }
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `continuation-${requests.length}`, object: 'chat.completion.chunk', created: 1,
      model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 } } : {}) })}\n\n`
    let text = chunk({ role: 'assistant' })
    if (call) { const current = call; call = undefined; text += chunk({ tool_calls: [{ index: 0, id: current.id, type: 'function', function: { name: current.name, arguments: JSON.stringify(current.args) } }] }) + chunk({}, 'tool_calls') }
    else text += chunk({ content: 'CONTINUATION_READY' }) + chunk({}, 'stop')
    return new Response(text + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const product = { id: sessionId, workspaceRootPath: workspace, workingDirectory: project, createdAt: 1, lastUsedAt: 1, name: 'Continuation', messages: [] as any[] }
  let rt: DurableRuntime = createDurableRuntime(), sequence = 0
  let holdPrepare = false
  let prepared = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const check = (scene: string, run: () => void) => { run(); checks.push(scene) }
  const makeAgent = () => {
    const resources = bindPiRuntime(rt, { workspaceRootPath: workspace, sessionId })
    const original = resources.durableToolBoundary!.prepare
    resources.durableToolBoundary!.prepare = async request => {
      const result = await original(request)
      if (holdPrepare) { prepared.resolve(); await release.promise }
      return result
    }
    const agent = assembleSessionAgent({
      context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
        connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, baseUrl: provider.url.href,
          customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Controlled provider', provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
      hostRuntime: { appRootPath: repo, isPackaged: false, nodeRuntimePath: process.execPath },
      config: { model: 'pi/fixture', miniModel: 'pi/fixture', isHeadless: true, session: buildAgentSessionSnapshot(product),
        workspace: { id: 'continuation', slug: 'continuation', name: 'Continuation', rootPath: workspace, createdAt: 1 },
        envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, HOME: evidence.directory, USERPROFILE: evidence.directory, NODE_ENV: 'test' } },
      callbacks: createSessionAgentCallbacks({ read: () => product, patch: changes => Object.assign(product, changes), persist: () => {}, flush: async () => {}, thinkingChanged: () => {}, log: () => {}, error: () => {} }),
      resources,
    })
    agent.setPermissionMode('allow-all')
    rt.execution.subscribe(sessionId, { event: event => { events.push(event) } })
    return agent
  }
  let agent = makeAgent()
  const turn = async (message: string) => {
    const id = `input-${++sequence}`, scope = { workspaceRootPath: workspace, sessionId }
    product.messages.push({ id, role: 'user', content: message, timestamp: sequence })
    rt.execution.refreshRecovery(sessionId)
    const handle = rt.execution.begin(scope)
    rt.execution.accept(handle, { operationId: `run-${id}`, userMessageId: id, userMessage: message })
    const driver = await rt.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
    return rt.execution.drive(handle, driver, { message, options: { inputId: id } })
  }
  const waitFor = async (condition: () => boolean) => {
    for (let index = 0; index < 200; index++) { if (condition()) return; await Bun.sleep(25) }
    throw new Error('Timed out waiting for the native execution barrier')
  }
  try {
    const draft = join(project, 'draft.txt')
    rt.admin.start([workspace], () => {})
    const sql = new Database(join(workspace, 'runtime/runtime.db'))
    sql.exec("CREATE TRIGGER fail_t2 BEFORE INSERT ON runtime_events WHEN NEW.event_type='tool_outcome_committed' BEGIN SELECT RAISE(ABORT, 'fixture tool outcome failure'); END")
    call = { name: 'write', id: 'write-once', args: { path: draft, content: 'KNOWN_NATIVE_DRAFT' } }
    await turn('Create the draft once, then report its actual result.')
    check('RC05 actual native result reaches the provider despite SQLite T2 failure', () => {
      assert.equal(readFileSync(draft, 'utf8'), 'KNOWN_NATIVE_DRAFT')
      assert(JSON.stringify(requests.at(-1)).includes('Successfully wrote'))
      assert.equal(rt.execution.view(sessionId).blocked, false)
    })
    check('RC04 main model response survives pending tool bookkeeping', () => assert(events.some(event => event.type === 'text_complete' && event.text.includes('CONTINUATION_READY'))))
    sql.exec('DROP TRIGGER fail_t2'); sql.close()
    await turn('Continue using the existing draft; do not recreate it.')
    check('RC05 next native boundary backfills the original result exactly once', () => {
      const facts = rt.queries.events(workspace, { sessionId }).filter(event => event.type === 'tool_outcome_committed')
      assert.equal(facts.length, 1)
      assert(JSON.stringify(facts).includes('KNOWN_NATIVE_DRAFT') === false) // native write acknowledgement, not file content
    })
    check('RC07 actual model outcomes record consumed input identities', () => {
      assert(rt.queries.events(workspace, { sessionId }).some(event => event.type === 'model_outcome_committed' && (event.payload as { consumedInputIds?: string[] }).consumedInputIds?.includes('input-1')))
      const restored = rt.execution.recoverQueued({ workspaceRootPath: workspace, sessionId }, [{ messageId: 'input-1', message: 'Create draft.', reception: { disposition: 'unknown' } }])
      assert.equal(restored.queued, 0)
    })
    holdPrepare = true; prepared = Promise.withResolvers<void>(); release = Promise.withResolvers<void>()
    const notDispatched = join(project, 'must-not-dispatch.txt')
    call = { name: 'write', id: 'cancel-before-dispatch', args: { path: notDispatched, content: 'must not execute' } }
    const interrupted = turn('Exercise cancellation at the prepared boundary.')
    await prepared.promise
    rt.execution.requestStop(sessionId)
    await interrupted
    holdPrepare = false; release.resolve()
    await turn('Continue independent work after the cancelled invocation.')
    check('RC06 lost preparation ACK cancels without executing the implementation', () => assert.equal(existsSync(notDispatched), false))
    check('RC11 cancelled preparation can settle late without blocking the new turn', () => assert.equal(rt.execution.view(sessionId).blocked, false))
    const beforeRetry = requests.length
    rejectNext = true
    const retrying = turn('Exercise stop during provider retry backoff.')
    await waitFor(() => requests.length > beforeRetry)
    await Bun.sleep(50)
    const stopAt = Date.now()
    rt.execution.requestStop(sessionId)
    await retrying
    check('RC06 SDK stop acknowledgement drains retry waits without a foreground timeout', () => assert(Date.now() - stopAt < 2500))
    await turn('Continue after the stopped provider retry.')

    const started = join(project, 'started.txt'), late = join(project, 'late.txt'), script = join(project, 'long.py')
    writeFileSync(script, `import pathlib,time\npathlib.Path(${JSON.stringify(started)}).write_text('started')\ntime.sleep(4)\npathlib.Path(${JSON.stringify(late)}).write_text('late')\n`)
    const quoted = `'${script.replaceAll("'", "''")}'`
    call = { name: process.platform === 'win32' ? 'powershell' : 'bash', id: 'native-long-command', args: { command: `python -X utf8 ${quoted}`, timeout: 20 } }
    const running = turn('Run the local process, then exercise application shutdown.')
    await waitFor(() => existsSync(started))
    const beforeClose = Date.now()
    await rt.close(); await running
    await Bun.sleep(4300)
    check('RC10 normal shutdown drains the native process tree before teardown', () => assert.equal(existsSync(late), false))
    evidence.json('shutdown.json', { elapsedMs: Date.now() - beforeClose, started, lateOutputExists: existsSync(late), platform: process.platform })
    rt = createDurableRuntime(); rt.admin.start([workspace], () => {}); agent = makeAgent()
    await turn('Continue the original task from the existing draft after restart.')
    check('RC01 RC08 restart continues the original session without manual reconciliation', () => {
      assert(JSON.stringify(requests.at(-1)).includes('KNOWN_NATIVE_DRAFT') || JSON.stringify(requests.at(-1)).includes('draft.txt'))
      assert.equal(rt.execution.view(sessionId).blocked, false)
      assert(events.some(event => event.type === 'text_complete' && event.text.includes('CONTINUATION_READY')))
    })
    const journal = join(sessionPath, '.pi-sessions', readdirSync(join(sessionPath, '.pi-sessions'))[0]!)
    check('RC07 native journal retains original input identities', () => assert(readFileSync(journal, 'utf8').includes('phanerisInputId')))
    evidence.json('pi-continuation.json', { checks, requests, events, draft, scope: 'Controlled inference; real Pi/Host/SQLite/files and native process cancellation' })
    evidence.complete(checks, ['Live model quality', 'Signed release', 'Other OS process cancellation'])
    console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
  } finally { release.resolve(); await rt.close(); provider.stop(true) }
})
