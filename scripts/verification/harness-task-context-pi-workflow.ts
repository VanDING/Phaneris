/** Real Pi/Host/SQLite task projection, declared before the production data port. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('harness-task-context-pi', async evidence => {
  const repo = resolve(import.meta.dir, '../..'), workspace = join(evidence.directory, 'workspace'), sessionId = 'task-projection'
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config')
  process.env.NODE_ENV = 'test'
  mkdirSync(join(workspace, 'sessions', sessionId), { recursive: true })
  const requests: any[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json(); requests.push(body)
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `task-${requests.length}`, object: 'chat.completion.chunk',
      created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
      ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
    return new Response(chunk({ role: 'assistant' }) + chunk({ content: 'FIXTURE_COMPLETE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { createSessionAgentCallbacks } = await import('../../packages/server-core/src/sessions/agent-product-callbacks')
  const { buildAgentSessionSnapshot } = await import('../../packages/server-core/src/sessions/agent-product-context')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const product = { id: sessionId, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1, name: 'Report task',
    description: 'INITIAL_TASK_SCOPE', acceptanceCriteria: 'VERIFY_THE_OUTPUT', progress: 10,
    sdkSessionId: undefined as string | undefined, messages: [] }
  const checks: string[] = []
  const text = (content: any): string => typeof content === 'string' ? content : (content ?? []).map((part: any) => part.text ?? '').join('\n')
  let turn = 0
  try {
    for (const count of [2, 1]) {
      const runtime = createDurableRuntime(), scope = { workspaceRootPath: workspace, sessionId }
      const agent = assembleSessionAgent({
        context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
          connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
            customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback fixture',
              provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
        hostRuntime: { appRootPath: repo, isPackaged: false, nodeRuntimePath: process.execPath },
        config: { model: 'pi/fixture', miniModel: 'pi/fixture', session: buildAgentSessionSnapshot(product), isHeadless: true,
          workspace: { id: 'task', slug: 'task', name: 'Task fixture', rootPath: workspace, createdAt: 1 },
          envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, HOME: evidence.directory, USERPROFILE: evidence.directory, NODE_ENV: 'test' } },
        callbacks: createSessionAgentCallbacks({ read: () => product, patch: changes => Object.assign(product, changes), persist: () => {}, flush: async () => {},
          thinkingChanged: () => {}, log: () => {}, error: () => {} }), resources: bindPiRuntime(runtime, scope),
      })
      try {
        const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
        for (let index = 0; index < count; index++) {
          turn++
          if (turn === 2) { product.description = 'REVISED_TASK_SCOPE'; product.progress = 60 }
          if (turn === 3) { product.description = 'RESTORED_TASK_SCOPE'; product.progress = 100 }
          const inputId = `turn-${turn}`, message = `Continue task ${turn}`
          const handle = runtime.execution.begin(scope)
          runtime.execution.accept(handle, { operationId: `run-${turn}`, userMessageId: inputId, userMessage: message })
          const result = await runtime.execution.drive(handle, driver, { message, options: { inputId } })
          assert.equal(result.kind, 'terminal')
          const lastUser = requests.at(-1).messages.findLast((message: any) => message.role === 'user')
          const context = text(lastUser.content)
          assert(context.includes('<task_context'))
          assert(context.includes(product.description))
          assert(context.includes('VERIFY_THE_OUTPUT'))
          assert(context.includes(`"progress": ${product.progress}`))
          assert(context.includes('not approval or verified completion'))
          checks.push(turn === 1 ? 'initial product task context reaches real Pi request' : turn === 2
            ? 'live product updates reach the next turn without rebuilding the agent' : 'recreated agent receives current task data independent of compacted history')
        }
        await runtime.close()
        assert.equal((agent as any).subprocess, null)
      } finally { await runtime.close() }
    }
    const systemPrompts = requests.map(request => request.messages.filter((message: any) => message.role === 'system').map((message: any) => text(message.content)).join('\n'))
    assert.equal(new Set(systemPrompts).size, 1)
    assert(!systemPrompts[0].includes('INITIAL_TASK_SCOPE'))
    checks.push('task updates leave the model system prefix unchanged')
    assert.equal(requests.length, 3)
    evidence.json('task-context-pi.json', { scope: 'Real Pi/Host/SQLite with deterministic inference; no live provider quality claim', checks,
      requests, sdkSessionId: product.sdkSessionId, progress: product.progress })
    evidence.complete(checks, ['Live model quality', 'automatic completion verification', 'complete execution-step state machine'])
    console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
  } finally { api.stop(true) }
})
