/**
 * Failure matrix (written before the fix): real Host -> Pi child -> loopback provider.
 * Initial/regenerated titles must reach inference; utility prompts must stay isolated;
 * a rejected mini model must fall back on this endpoint; repeated requests must work.
 * A gateway's ModelProtocolUnsupported rejection must also fall back within the endpoint.
 * No user profile, credentials, or conversation files are modified.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('title-utility', async run => {
  const root = resolve(import.meta.dir, '../..')
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-title-utility-'))
  const workspace = join(fixture, 'workspace')
  process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
  process.env.NODE_ENV = 'test'
  const requests: Array<{ model: string; system: string; thinking: unknown }> = []
  const logs: string[] = []
  const checks: string[] = []
  const agents: import('../../packages/shared/src/agent/pi-agent').PiAgent[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as {
      model: string; messages: Array<{ role: string; content: unknown }>; reasoning_effort?: unknown
    }
    requests.push({ model: body.model, system: JSON.stringify(body.messages.filter(message => message.role === 'system')),
      thinking: body.reasoning_effort })
    if (body.model === 'rejected-flash') return Response.json({
      error: { code: 'model_not_found', message: 'Model rejected-flash does not exist' },
    }, { status: 404 })
    if (body.model === 'protocol-only') return Response.json({
      type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.',
    }, { status: 400 })
    const event = (delta: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
      id: `title-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(finishReason ? { usage: { prompt_tokens: 200, completion_tokens: 8, total_tokens: 208 } } : {}),
    })}\n\n`
    return new Response(event({ role: 'assistant' }) + event({ content: '投资组合交易复盘' })
      + event({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  function make(id: string, miniModel = 'pi/title-model') {
    mkdirSync(join(workspace, 'sessions', id), { recursive: true })
    const agent = new PiAgent({
      provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/title-model', miniModel,
      workspace: { id: 'title-fixture', slug: 'title-fixture', name: 'Title fixture', rootPath: workspace, createdAt: 1 },
      session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 },
      isHeadless: true,
      runtime: { paths: { piServer: join(root, 'packages/pi-agent-server/dist/index.js'), node: process.execPath },
        baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' },
        customModels: [{ id: 'title-model', contextWindow: 128000, maxTokens: 4096 },
          { id: 'rejected-flash', contextWindow: 128000, maxTokens: 4096 },
          { id: 'protocol-only', contextWindow: 128000, maxTokens: 4096 }] },
      envOverrides: { HOME: fixture, USERPROFILE: fixture, PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, NODE_ENV: 'test' },
    })
    agent.onDebug = message => logs.push(message)
    agents.push(agent)
    return agent
  }
  try {
    const agent = make('initial-and-refresh')
    assert.equal(await agent.generateTitle('更新交易记录，复盘持仓变化', { language: 'Chinese' }), '投资组合交易复盘')
    checks.push('initial-title-through-real-pi-child')
    assert.equal(await agent.regenerateTitle(['更新交易记录', '分析持仓变化'], '已完成交易复盘', { language: 'Chinese' }), '投资组合交易复盘')
    checks.push('regenerated-title-through-real-pi-child')
    assert(requests.every(request => request.system.includes('Reply with ONLY the requested text')))
    checks.push('utility-system-prompt-isolation')
    const fallback = make('mini-rejection', 'pi/rejected-flash')
    assert.equal(await fallback.regenerateTitle(['分析持仓变化'], '', { language: 'Chinese' }), '投资组合交易复盘')
    assert(requests.some(request => request.model === 'rejected-flash'))
    assert.equal(requests.at(-1)?.model, 'title-model')
    checks.push('rejected-mini-falls-back-to-selected-session-model')
    const missing = make('missing-mini', 'pi/missing-flash')
    assert.equal(await missing.generateTitle('复盘交易记录'), '投资组合交易复盘')
    assert.equal(requests.at(-1)?.model, 'title-model')
    checks.push('unresolvable-mini-falls-back-within-endpoint')
    const protocolFallback = make('protocol-mini', 'pi/protocol-only')
    const before = requests.length
    assert.equal(await protocolFallback.regenerateTitle(['复盘交易记录'], '', { language: 'Chinese' }), '投资组合交易复盘')
    assert.deepEqual(requests.slice(before).map(request => request.model), ['protocol-only', 'title-model'])
    checks.push('protocol-incompatible-mini-falls-back-to-session-model-on-same-endpoint')
    run.complete(checks, ['Live provider availability and authentication are outside this deterministic workflow.'])
  } finally {
    run.json('title-utility.json', { checks, requests })
    run.json('child-debug.json', logs)
    for (const agent of agents) { await agent.disposeForRestart(); agent.destroy() }
    api.stop(true)
  }
})
