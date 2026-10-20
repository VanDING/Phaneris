#!/usr/bin/env bun
/**
 * B1 failure matrix for the 2026-10-18 batch: the Pi 1.3.0 SDK graph, the
 * Anthropic/OpenAI tool-schema adapters as they serialize real requests, the
 * built-in provider endpoints, and the compaction reserve the Pi subprocess
 * reports for the *current* model.
 *
 * Everything here runs against shipping code: the real interceptor (whose fetch
 * patch is exercised over loopback), the real SDK catalog, and a real Pi
 * subprocess driven by the real PiAgent host.
 *
 * Usage: bun run scripts/verification/upgrade-0153-b1-workflow.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const evidence = new VerificationRun('upgrade-0153-b1')
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const scenes: string[] = []
let failure: unknown

try {
  evidence.checkArguments()

  // --- scene 1: the frozen dependency graph ---------------------------------
  const piPackages = ['pi-agent-core', 'pi-ai', 'pi-codemode', 'pi-coding-agent']
  const piVersions: Record<string, string> = {}
  for (const name of [...piPackages, 'pi-mcp', 'pi-telemetry', 'pi-tui']) {
    piVersions[name] = JSON.parse(readFileSync(join(root, 'node_modules/@earendil-works', name, 'package.json'), 'utf8')).version
  }
  for (const name of piPackages) assert.equal(piVersions[name], '1.3.0', `${name} must be 1.3.0`)
  // The internal packages move with the direct four; they are not overridden.
  for (const name of ['pi-mcp', 'pi-telemetry', 'pi-tui']) assert.equal(piVersions[name], '1.3.0')
  const lock = readFileSync(join(root, 'bun.lock'), 'utf8')
  // Pi's own exact pins must survive: no cross-parent dedupe of its SDK copies.
  const codingAgentEntry = lock.split('\n').find(line => line.includes('"@earendil-works/pi-coding-agent@1.3.0"'))
  assert(codingAgentEntry, 'pi-coding-agent must be locked at 1.3.0')
  // Pi owns these exact versions; the direct `undici` upgrade must not reach them.
  assert(codingAgentEntry!.includes('"undici": "8.10.2"'), "pi-coding-agent's own undici pin must survive")
  assert(codingAgentEntry!.includes('"semver": "7.8.5"'), "pi-coding-agent's own semver pin must survive")
  const aiEntry = lock.split('\n').find(line => line.includes('"@earendil-works/pi-ai@1.3.0"'))
  assert(aiEntry, 'pi-ai must be locked at 1.3.0')
  for (const pin of ['"@anthropic-ai/sdk": "0.129.0"', '"openai": "7.19.0"', '"typebox": "1.3.27"']) {
    assert(aiEntry!.includes(pin), `pi-ai's own ${pin} pin must survive`)
  }
  const directUndici = JSON.parse(readFileSync(join(root, 'node_modules/undici/package.json'), 'utf8')).version
  assert.equal(directUndici, '8.12.2')
  const directAnthropic = JSON.parse(readFileSync(join(root, 'node_modules/zod/package.json'), 'utf8')).version
  assert.equal(directAnthropic, '4.6.7')
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version, '1.32.1')
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/http-cache-semantics/package.json'), 'utf8')).version, '4.3.0')
  const internalPins = { undici: directUndici, zod: directAnthropic }
  evidence.json('sdk-graph.json', { piVersions, internalPins })
  scenes.push('pi-130-uniform-sdk-graph')

  // --- scene 2/3: tool schema as actually serialized -------------------------
  const requests: { url: string; body: Record<string, unknown> }[] = []
  const api = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const body = await request.json() as Record<string, unknown>
      requests.push({ url: new URL(request.url).pathname, body })
      if (new URL(request.url).pathname.includes('chat/completions')) {
        return Response.json({
          id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      }
      return Response.json({
        id: 'fixture', type: 'message', role: 'assistant', model: 'fixture',
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    },
  })
  const base = `http://127.0.0.1:${api.port}`
  process.env.ANTHROPIC_BASE_URL = base
  // Import for its side effect: the interceptor patches globalThis.fetch, which
  // is exactly what the Pi subprocess preloads. Nothing below calls an adapter
  // directly — the assertions read what the patch actually put on the wire.
  await import('../../packages/shared/src/unified-network-interceptor')
  // Exercise the adapters exactly as the preloaded interceptor does on a request.
  const anthropicBody = {
    model: 'fixture', max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{
      name: 'mcp__fixture__echo',
      description: 'echo',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    }],
  }
  const openAiBody = {
    model: 'fixture', max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{
      type: 'function',
      function: {
        name: 'mcp__fixture__echo', description: 'echo',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      },
    }],
  }
  try {
    await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fixture', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(anthropicBody),
    })
    await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture' },
      body: JSON.stringify(openAiBody),
    })
  } finally { api.stop(true) }

  const anthropicSchema = (requests[0]!.body.tools as any[])[0].input_schema
  assert.equal(anthropicSchema.additionalProperties, false, 'Anthropic schemas must KEEP additionalProperties: false')
  for (const field of ['_intent', '_displayName']) {
    assert.ok(Object.prototype.hasOwnProperty.call(anthropicSchema.properties, field), `${field} must be declared in properties`)
    assert.ok(anthropicSchema.required.includes(field), `${field} must be required`)
  }
  const openAiSchema = (requests[1]!.body.tools as any[])[0].function.parameters
  assert.equal(Object.prototype.hasOwnProperty.call(openAiSchema, 'additionalProperties'), false,
    'the OpenAI adapter must keep its existing permissive behaviour (key removed)')
  evidence.json('tool-schema-payloads.json', { anthropic: anthropicSchema, openAi: openAiSchema })
  scenes.push('anthropic-schema-keeps-additional-properties')
  scenes.push('openai-schema-unchanged')

  // --- scene 4: built-in provider endpoints ---------------------------------
  const { getBuiltinModels } = await import('@earendil-works/pi-ai/providers/all')
  const kimi = getBuiltinModels('kimi-coding' as Parameters<typeof getBuiltinModels>[0]) as Array<{ api?: string; baseUrl?: string }>
  assert(kimi.length > 0, 'Kimi Coding must be a native provider')
  assert.equal(kimi[0]!.baseUrl, 'https://api.kimi.com/coding/v1')
  assert.equal(kimi[0]!.api, 'openai-completions')
  const grouped = (provider: string) => {
    const models = getBuiltinModels(provider as Parameters<typeof getBuiltinModels>[0]) as Array<{ api?: string; baseUrl?: string }>
    const byProtocol = new Map<string, Set<string>>()
    for (const model of models) {
      const urls = byProtocol.get(model.api ?? 'unknown') ?? new Set<string>()
      urls.add(model.baseUrl ?? '')
      byProtocol.set(model.api ?? 'unknown', urls)
    }
    return Object.fromEntries([...byProtocol].map(([api, urls]) => [api, [...urls]]))
  }
  const opencode = grouped('opencode')
  const opencodeGo = grouped('opencode-go')
  // One provider, several protocols, several base URLs: the old single Zen URL
  // could not describe it, and pinning every model to Chat Completions is wrong.
  assert(Object.keys(opencode).length > 1, 'opencode must expose more than one protocol')
  assert(!JSON.stringify(opencode).includes('opencode.ai/zen'), 'retired zen URLs must not remain in the catalog')

  const { normalizeRetiredNativeEndpoint, isRetiredNativeEndpoint } = await import('../../packages/shared/src/config/legacy-endpoints')
  const legacyKimi = normalizeRetiredNativeEndpoint({ providerType: 'pi', piAuthProvider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding' })
  assert.equal(legacyKimi.baseUrl, undefined)
  assert.equal(legacyKimi.providerType, 'pi')
  const legacyOpencode = normalizeRetiredNativeEndpoint({
    providerType: 'pi_compat', piAuthProvider: 'opencode', baseUrl: 'https://opencode.ai/zen/v1',
    customEndpoint: { api: 'openai-completions' },
  })
  // A custom-endpoint connection keeps its protocol (and therefore its user
  // models); only the dead URL moves to the endpoint that protocol serves today.
  assert.equal(legacyOpencode.providerType, 'pi_compat')
  assert.equal(legacyOpencode.baseUrl, 'https://opencode.ai/inference/v1')
  assert.deepEqual(legacyOpencode.customEndpoint, { api: 'openai-completions' })
  // A user's own endpoint, protocol and model are never touched.
  const userEndpoint = { providerType: 'pi_compat', piAuthProvider: 'opencode', baseUrl: 'https://my-gateway.example/v1', customEndpoint: { api: 'anthropic-messages' as const } }
  assert.deepEqual(normalizeRetiredNativeEndpoint(userEndpoint), userEndpoint)
  const userAnthropicOnDefaultHost = { providerType: 'pi_compat', piAuthProvider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding', customEndpoint: { api: 'anthropic-messages' as const } }
  assert.deepEqual(normalizeRetiredNativeEndpoint(userAnthropicOnDefaultHost), userAnthropicOnDefaultHost,
    'an explicitly configured Anthropic-compatible connection must not be re-protocoled')
  assert.equal(isRetiredNativeEndpoint('anthropic', 'https://api.kimi.com/coding'), false)
  evidence.json('endpoints.json', { kimi: kimi[0], opencode, opencodeGo, legacyKimi, legacyOpencode })
  scenes.push('provider-endpoints-and-legacy-normalization')

  // --- scene 5: real Pi subprocess - reserve follows the current model -------
  const fixture = mkdtempSync(join(tmpdir(), 'phaneris-0153-b1-'))
  process.env.PHANERIS_CONFIG_DIR = join(fixture, 'config')
  process.env.NODE_ENV = 'test'
  const workspace = join(fixture, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const seen: { maxTokens?: number; model?: string }[] = []
  const toolCalls: string[] = []
  const inference = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const body = await request.json() as { model?: string; max_tokens?: number; messages: Array<{ role: string; content: unknown }> }
      seen.push({ maxTokens: body.max_tokens, model: body.model })
      const text = JSON.stringify(body.messages)
      const wantsTool = text.includes('USE_TOOL_NOW')
      const event = (delta: unknown, finishReason: string | null = null) => `data: ${JSON.stringify({
        id: `b1-${seen.length}`, object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(finishReason ? { usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010 } } : {}),
      })}\n\n`
      if (wantsTool && !toolCalls.includes('called')) {
        toolCalls.push('called')
        return new Response(
          event({ role: 'assistant' })
          + event({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'mcp__session__web_fetch', arguments: '{"url":"http://127.0.0.1:1/"}' } }] })
          + event({}, 'tool_calls') + 'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return new Response(event({ role: 'assistant' }) + event({ content: 'B1_FIXTURE_REPLY' }) + event({}, 'stop') + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })

  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  const sessionPath = (id: string) => join(workspace, 'sessions', id)
  const agent = new PiAgent({
    provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'pi/fixture', miniModel: 'pi/fixture',
    workspace: { id: 'b1', name: 'B1 fixture', rootPath: workspace },
    session: { id: 'b1-session', workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1 },
    isHeadless: true, contextPolicy: 'manual',
    runtime: {
      paths: { piServer: join(root, 'packages/pi-agent-server/dist/index.js'), node: process.execPath },
      baseUrl: inference.url.href, customEndpoint: { api: 'openai-completions' },
      customModels: [{ id: 'fixture', contextWindow: 200_000, maxTokens: 16_384 }],
    },
    envOverrides: { HOME: fixture, USERPROFILE: fixture, PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, NODE_ENV: 'test' },
  } as any) as any
  const wire: any[] = []
  const handleLine = agent.handleLine.bind(agent)
  agent.handleLine = (line: string) => { try { wire.push(JSON.parse(line)) } catch {} return handleLine(line) }
  let sequence = 0
  async function turn(message: string) {
    await agent.ensureSubprocess()
    const start = wire.length
    agent.send({ type: 'prompt', id: `turn-${++sequence}`, message })
    const deadline = Date.now() + 60_000
    while (!wire.slice(start).some((row: any) => row.type === 'event' && row.event?.type === 'agent_settled')) {
      assert(Date.now() < deadline, 'B1 Pi workflow deadline')
      const errors = wire.slice(start).filter((row: any) => row.type === 'error')
      assert.equal(errors.length, 0, JSON.stringify(errors))
      await Bun.sleep(10)
    }
  }
  try {
    const contextUsages: any[] = []
    const originalHandle = agent.handleLine
    agent.handleLine = (line: string) => {
      try {
        const row = JSON.parse(line)
        if (row.type === 'event' && row.event?.type === 'context_usage') contextUsages.push(row.event)
      } catch {}
      return originalHandle(line)
    }
    mkdirSync(sessionPath('b1-session'), { recursive: true })
    await turn('USE_TOOL_NOW then answer')
    assert(toolCalls.includes('called'), 'the loopback provider must have been asked for a tool call')
    assert(wire.some((row: any) => row.type === 'event' && JSON.stringify(row.event).includes('mcp__session__web_fetch')),
      'the tool call must round-trip into the session')
    assert(contextUsages.length > 0, 'the subprocess must report context usage')
    const reserve = contextUsages.at(-1)?.compactionSettings?.reserveTokens
    assert.equal(typeof reserve, 'number', 'the reported reserve must come from the SDK')

    // The reserve is read for the *current* model: prove the argument flows by
    // comparing against an SDK manager that carries a per-model override.
    const { SettingsManager } = await import('@earendil-works/pi-coding-agent')
    const { readContextUsage } = await import('../../packages/pi-agent-server/src/context-usage')
    const modelA = { provider: 'custom-endpoint', id: 'model-a', contextWindow: 1_000_000, maxTokens: 64_000 }
    const manager = SettingsManager.inMemory({ compaction: { reserveTokens: 16_384, modelOverrides: { 'custom-endpoint/model-a': { reserveTokens: 600_000 } } } } as any)
    const viaModel = readContextUsage({ getContextUsage: () => undefined, settingsManager: manager, model: modelA } as any)
    const viaDefault = readContextUsage({ getContextUsage: () => undefined, settingsManager: manager, model: undefined } as any)
    assert.equal(viaModel.compactionSettings?.reserveTokens, 600_000, 'the current model override must be honoured')
    assert.equal(viaDefault.compactionSettings?.reserveTokens, 16_384, 'without a model the override is invisible')
    // The SDK computes the summary budget from the reserve it is given, capped
    // by the model's own output limit (dist/core/compaction/compaction.js).
    const summaryBudget = (reserveTokens: number, maxTokens: number) => Math.min(Math.floor(0.8 * reserveTokens), maxTokens)
    evidence.json('pi-session.json', {
      reserve, contextUsages: contextUsages.slice(-3), toolCallRoundTripped: true,
      reserveResolution: { withModel: viaModel.compactionSettings, withoutModel: viaDefault.compactionSettings },
      summarizationBudget: {
        note: 'min(floor(0.8 x reserveTokens), model.maxTokens) as the SDK computes it',
        atSdkReserve: summaryBudget(16_384, 64_000),
        atOverriddenReserve: summaryBudget(600_000, 64_000),
      },
      journals: readdirSync(sessionPath('b1-session'), { recursive: true }).filter(entry => String(entry).endsWith('.jsonl')).map(String),
    })
    scenes.push('pi-subprocess-tools-and-model-reserve')
  } finally {
    await agent.disposeForRestart()
    agent.destroy()
    inference.stop(true)
  }

  evidence.complete(scenes, [
    'live provider APIs', 'live OAuth network refresh', 'macOS/Linux execution', 'signed installers/release',
    'Kimi/OpenCode accounts (no live credentials used; loopback only)',
  ])
} catch (error) { failure = error }
evidence.json('b1.json', { scenes, sha256: { lock: sha256(readFileSync(join(root, 'bun.lock'))) } })
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
