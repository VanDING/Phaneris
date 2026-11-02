#!/usr/bin/env bun
/** P150-02/03: shipping JSONL child + loopback SSE + plain JSON Schema tools. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('pi-150-tool-schema', async run => {
  const root = resolve(import.meta.dir, '../..')
  const runtime = join(run.directory, 'runtime')
  cpSync(join(root, 'packages/pi-agent-server/dist'), runtime, { recursive: true })
  const workspace = join(run.directory, 'workspace')
  mkdirSync(workspace)
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
  const payload = '中文 😀 "quoted" \\ newline\n'.repeat(12_000)
  const calls = [
    { id: 'coercion', args: { count: '3.5', labels: 'alpha', text: 123, enabled: 'true', payload } },
    { id: 'missing-required', args: { labels: [], text: 'invalid', enabled: true, payload: 'must not execute' } },
  ]
  const requests: { scene: string; toolNames: string[]; toolResults: unknown[] }[] = []
  const wire: any[] = [], executions: any[] = []
  let scene = 0
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any
    const lastUser = body.messages.findLastIndex((message: any) => message.role === 'user')
    const results = body.messages.slice(lastUser + 1).filter((message: any) => message.role === 'tool')
    const call = calls[scene]!
    requests.push({ scene: call.id, toolNames: body.tools.map((tool: any) => tool.function.name), toolResults: results })
    const event = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({
      id: call.id, object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`
    const chunks = [event({ role: 'assistant' })]
    if (results.length) chunks.push(event({ content: `SCHEMA_${call.id}_COMPLETE` }), event({}, 'stop'))
    else {
      chunks.push(event({ tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: 'fixture_schema', arguments: '' } }] }))
      const args = JSON.stringify(call.args)
      for (let offset = 0; offset < args.length; offset += 113) {
        chunks.push(event({ tool_calls: [{ index: 0, function: { arguments: args.slice(offset, offset + 113) } }] }))
      }
      chunks.push(event({}, 'tool_calls'))
    }
    chunks.push('data: [DONE]\n\n')
    return new Response(new ReadableStream({
      async start(controller) {
        for (let index = 0; index < chunks.length; index += 32) {
          controller.enqueue(new TextEncoder().encode(chunks.slice(index, index + 32).join('')))
          await Bun.sleep(1)
        }
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const child = spawn(process.execPath, [join(runtime, 'index.js')], {
    cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: run.directory, USERPROFILE: run.directory,
      PHANERIS_CONFIG_DIR: join(run.directory, 'config'), NODE_ENV: 'test' },
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const exited = new Promise(resolve => child.once('exit', resolve))
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n')
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    const message = JSON.parse(line)
    wire.push(message)
    if (message.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: message.requestId, action: 'allow' })
    if (message.type === 'durable_model_prepare_request' || message.type === 'durable_tool_prepare_request') {
      send({ type: message.type.replace('_request', '_response'), requestId: message.requestId, ok: true,
        prepared: { operationId: `effect-${wire.length}`, idempotencyKey: `effect-${wire.length}`, canonicalArgsHash: 'fixture',
          recoveryMode: 'pure', created: true, status: 'prepared', committedSeq: wire.length } })
    }
    if (message.type === 'durable_tool_outcome_request' || message.type === 'durable_model_outcome_request') {
      send({ type: message.type.replace('_request', '_response'), requestId: message.requestId, ok: true, committedSeq: wire.length })
    }
    if (message.type === 'tool_execute_request') {
      executions.push(message)
      send({ type: 'tool_execute_response', requestId: message.requestId,
        result: { content: `PAYLOAD_SHA256:${digest(message.args.payload)}`, isError: false } })
    }
  })
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 35_000
    while (!predicate()) {
      assert.equal(child.exitCode, null, stderr.slice(-2000))
      assert(Date.now() < deadline, `Pi schema workflow timeout: ${stderr.slice(-1000)}`)
      const errors = wire.filter(message => message.type === 'error')
      assert.equal(errors.length, 0, JSON.stringify(errors))
      await Bun.sleep(10)
    }
  }
  const scenes: string[] = []
  try {
    send({ type: 'init', apiKey: 'fixture-key', model: 'pi/fixture', cwd: workspace, workspaceRootPath: workspace,
      sessionId: 'schema', sessionPath: join(workspace, 'sessions/schema'), workingDirectory: workspace,
      plansFolderPath: join(workspace, 'plans'), thinkingLevel: 'off', providerType: 'pi_compat', authType: 'api_key',
      baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' },
      customModels: [{ id: 'fixture', contextWindow: 1_000_000, maxTokens: 4096 }] })
    await until(() => wire.some(message => message.type === 'ready'))
    send({ type: 'sync_tools', tools: [{ name: 'fixture_schema', description: 'Validate fixture arguments',
      inputSchema: { type: 'object', properties: { count: { type: 'integer' }, labels: { type: 'array', items: { type: 'string' } },
        text: { type: 'string' }, enabled: { type: 'boolean' }, payload: { type: 'string' } },
      required: ['count', 'labels', 'text', 'enabled', 'payload'], additionalProperties: false } }] })
    for (scene = 0; scene < calls.length; scene++) {
      const start = wire.length
      send({ type: 'prompt', id: calls[scene]!.id, message: calls[scene]!.id,
        systemPrompt: 'Use the fixture_schema tool then report completion.', durableRunOperationId: `run-${scene}` })
      await until(() => wire.slice(start).some(message => message.type === 'event' && message.event?.type === 'agent_settled'))
      assert(JSON.stringify(wire.slice(start)).includes(`SCHEMA_${calls[scene]!.id}_COMPLETE`))
      const pair = requests.filter(request => request.scene === calls[scene]!.id)
      assert.equal(pair.length, 2, 'Each tool call must yield exactly one follow-up model request')
      for (const name of ['fixture_schema', 'mcp__session__web_search', 'mcp__session__web_fetch']) assert(pair[0]!.toolNames.includes(name), `Tool not registered: ${name}`)
      if (scene === 0) {
        assert.equal(executions.length, 1)
        assert.deepEqual(executions[0].args, { count: 3, labels: ['alpha'], text: '123', enabled: true, payload })
        assert(JSON.stringify(pair[1]!.toolResults).includes(digest(payload)))
        scenes.push('plain-json-schema-coercion-crosses-host-boundary', 'fragmented-large-tool-call-preserves-unicode-and-escapes')
      } else {
        assert.equal(executions.length, 1, 'Missing required arguments must never execute')
        assert(JSON.stringify(pair[1]!.toolResults).includes('count: missing'))
        assert(wire.slice(start).some(message => message.type === 'event'
          && message.event?.type === 'tool_execution_end' && message.event.isError === true))
        scenes.push('invalid-tool-arguments-return-schema-error-without-executing')
      }
      const messages = wire.slice(start).filter(message => message.type === 'event' && message.event?.type === 'message_end')
      for (const message of messages) {
        for (const block of message.event.message.content ?? []) {
          for (const key of ['partialJson', 'partialArgs', 'customInput', 'streamIndex']) assert(!(key in block), `Private parser state leaked: ${key}`)
        }
      }
    }
    scenes.push('web-tools-register-without-removed-pi-ai-typebox-export', 'parser-state-excluded-from-final-messages')
    run.json('schema.json', { scenes, requests, payloadBytes: Buffer.byteLength(payload), payloadSha256: digest(payload),
      executions: executions.map(message => ({ toolName: message.toolName, args: { ...message.args, payload: { sha256: digest(message.args.payload) } } })),
      artifacts: Object.fromEntries(['index.js', 'bundle.js', 'worker.js', 'node_modules/quickjs-wasi/quickjs.wasm']
        .map(name => [name, digest(readFileSync(join(runtime, name)))])) })
    run.complete(scenes, ['live provider APIs', 'live OAuth', 'Linux/macOS', 'signed installers/release'])
  } finally {
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), 5000)
    await exited
    clearTimeout(timer)
    lines.close()
    api.stop(true)
    run.json('wire.json', wire)
    run.json('child.json', { exitCode: child.exitCode, stderr })
  }
})
