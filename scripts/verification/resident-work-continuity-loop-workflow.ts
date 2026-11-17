import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

// Real Pi + Host + Runtime: a persistently rejected call must yield a final
// diagnostic, with no T1, and the next user input must restore normal tools.
await verificationWorkflow('resident-work-continuity-loop', async run => {
  const workspace = join(run.directory, 'workspace'), sessionId = 'bounded-recovery'
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config'); process.env.NODE_ENV = 'test'
  mkdirSync(join(workspace, 'sessions', sessionId), { recursive: true })
  const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = []
  let rejected = 0
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async req => {
    const body = await req.json() as typeof requests[number]; requests.push(body)
    if (requests.length > 10) return Response.json({ error: { message: 'Unbounded rejected tool loop' } }, { status: 400 })
    const read = body.tools?.find(tool => /^read$/i.test(tool.function.name))
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `loop-${requests.length}`,
      object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const reply = read ? chunk({ tool_calls: [{ index: 0, id: `rejected-${requests.length}`, type: 'function',
      function: { name: read.function.name, arguments: JSON.stringify({ path: join(workspace, 'unavailable.txt') }) } }] }, 'tool_calls')
      : chunk({ content: 'DIAGNOSTIC_COMPLETE: source unavailable; no execution was dispatched.' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const runtime = createDurableRuntime(), scope = { sessionId, workspaceRootPath: workspace }
  const agent = assembleSessionAgent({
    context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
      connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
        customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback fixture', provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
    hostRuntime: { appRootPath: resolve('.'), isPackaged: false, nodeRuntimePath: process.execPath },
    config: { model: 'pi/fixture', miniModel: 'pi/fixture', systemPromptPreset: 'resident_assistant',
      workspace: { id: 'loop', slug: 'loop', createdAt: 1, name: 'Bounded loop', rootPath: workspace },
      session: { id: sessionId, sessionKind: 'resident_assistant', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 }, isHeadless: true,
      envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR, USERPROFILE: run.directory, NODE_ENV: 'test' } },
    callbacks: {}, resources: bindPiRuntime(runtime, scope, { modelContext: { valid: () => true,
      select: () => ({ cursor: 0, items: [], resident: { segmentId: 'isolated-view', contextText: 'Source unavailable. Diagnose without replay.' } }),
      assertTool: () => { rejected++; throw new Error('context_source_unavailable: The exact source remains withdrawn') } } }),
  })
  try {
    const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
    for (const input of ['first', 'next']) {
      const before = rejected, handle = runtime.execution.begin(scope)
      runtime.execution.accept(handle, { operationId: `run-${input}`, userMessageId: input, userMessage: 'Diagnose the unavailable source' })
      const result = await runtime.execution.drive(handle, driver, { message: 'Diagnose the unavailable source', options: { inputId: input } })
      assert.equal(result.kind, 'terminal')
      assert.equal(rejected - before, 3, 'Repeated deterministic rejection must disable the failing tool for this input only')
    }
    const events = runtime.queries.events(workspace, { sessionId })
    assert.equal(events.filter(event => event.type === 'tool_dispatch_committed').length, 0)
    assert.equal(events.filter(event => event.type === 'operation_terminal').length, 2)
    run.json('loop-evidence.json', { requests, rejected, events })
    run.complete(['WC05-repeated-rejection-yields-diagnostic-without-T1', 'WC05-next-input-restores-tools'])
  } finally { await runtime.close(); api.stop(true) }
})
