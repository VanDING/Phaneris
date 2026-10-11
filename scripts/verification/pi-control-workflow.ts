import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts.ts'
import { deadline } from './fixtures/governance-process-support.ts'

await verificationWorkflow('pi-control', async run => {
  run.checkArguments()
  const workspace = join(run.directory, 'workspace'), session = join(workspace, 'sessions/control')
  mkdirSync(session, { recursive: true })
  const child = spawn(process.execPath, ['packages/pi-agent-server/dist/index.js'], {
    cwd: resolve(import.meta.dir, '../..'), env: { ...process.env, PHANERIS_CONFIG_DIR: join(run.directory, 'config'), HOME: run.directory, USERPROFILE: run.directory }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const messages: Record<string, unknown>[] = []
  let stdout = '', stderr = '', remainder = ''
  child.stdout.on('data', data => {
    stdout += String(data); remainder += String(data)
    while (remainder.includes('\n')) { const index = remainder.indexOf('\n'); const line = remainder.slice(0, index); remainder = remainder.slice(index + 1); if (line.trim()) messages.push(JSON.parse(line)) }
  })
  child.stderr.on('data', data => { stderr += String(data) })
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve))
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n')
  const wait = async (predicate: (message: Record<string, unknown>) => boolean) => deadline((async () => {
    for (;;) {
      const message = messages.find(predicate)
      if (message) return message
      if (child.exitCode !== null) throw new Error(`Pi exited early: ${stderr.slice(-1500)}`)
      await Bun.sleep(10)
    }
  })(), 25_000)
  const scenes: string[] = []
  let requests = 0
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const input = await request.json() as { messages?: { content?: unknown }[] }
    requests++
    const abortProbe = JSON.stringify(input.messages).includes('abort-live-probe')
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      const chunk = (delta: unknown, finish: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        id: `control-${requests}`, object: 'chat.completion.chunk', model: 'fixture', created: 1,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`))
      chunk({ role: 'assistant', content: abortProbe ? 'live-abort-started' : 'batched-prompt-completed' })
      const timer = setTimeout(() => { try { chunk({}, 'stop'); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close() } catch {} }, abortProbe ? 5000 : 20)
      request.signal.addEventListener('abort', () => { clearTimeout(timer); try { controller.close() } catch {} }, { once: true })
    } })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const init = { type: 'init', apiKey: 'fixture', model: 'pi/fixture', cwd: workspace, thinkingLevel: 'off',
    workspaceRootPath: workspace, sessionId: 'control', sessionPath: session, workingDirectory: workspace, plansFolderPath: join(session, 'plans'),
    providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${provider.port}/v1`, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }] }
  try {
    send(init)
    send({ type: 'ensure_session_ready', id: 'first' }); send({ type: 'ensure_session_ready', id: 'second' })
    await wait(message => message.type === 'ready')
    scenes.push('batched-init-before-dependent-commands')
    const first = await wait(message => message.type === 'ensure_session_ready_result' && message.id === 'first')
    const second = await wait(message => message.type === 'ensure_session_ready_result' && message.id === 'second')
    assert.equal(first.sessionId, second.sessionId, 'Concurrent ready must construct exactly one SDK session')
    assert.equal(messages.filter(message => message.type === 'session_id_update').length, 1)
    scenes.push('concurrent-ready-single-session')
    send({ type: 'set_model', model: 'pi/fixture' })
    const model = await wait(message => message.type === 'set_model_result')
    assert.equal(model.model, 'pi/fixture'); assert.equal(model.contextWindow, 128000)
    scenes.push('active-model-registry-refresh')
    send({ type: 'pre_tool_use_response', requestId: 'late-unknown', action: 'allow' })
    send({ type: 'durable_model_outcome_response', requestId: 'late-unknown', ok: true })
    send({ type: 'ensure_session_ready', id: 'third' })
    assert.equal((await wait(message => message.id === 'third')).sessionId, first.sessionId)
    scenes.push('late-response-does-not-create-session')
    send({ type: 'abort' })
    send({ type: 'steer', id: 'after-abort', message: 'Do not execute' })
    await wait(message => message.type === 'input_received' && message.id === 'after-abort')
    scenes.push('abort-and-steer-control')
    send(init)
    send({ type: 'ensure_session_ready', id: 'after-init' })
    await wait(message => message.type === 'ready' && messages.filter(row => row.type === 'ready').length >= 2)
    assert.equal(typeof (await wait(message => message.id === 'after-init')).sessionId, 'string')
    scenes.push('reinitialize-ready')
    const start = messages.length
    child.stdin.write(JSON.stringify(init) + '\n' + JSON.stringify({ type: 'prompt', id: 'batched-prompt',
      message: 'batch-init-prompt-probe', systemPrompt: 'Reply with the fixture text.' }) + '\n')
    await wait(message => message.type === 'input_received' && message.id === 'batched-prompt')
    await wait(message => messages.indexOf(message) >= start && message.type === 'event'
      && (message.event as { type?: string })?.type === 'agent_settled')
    assert(JSON.stringify(messages.slice(start)).includes('batched-prompt-completed'))
    assert(requests > 0, 'Prompt must reach the real loopback provider')
    scenes.push('batched-init-and-real-prompt')
    const abortStart = messages.length
    send({ type: 'prompt', id: 'live-abort', message: 'abort-live-probe', systemPrompt: 'Reply with the fixture text.' })
    await wait(message => messages.indexOf(message) >= abortStart && JSON.stringify(message).includes('live-abort-started'))
    send({ type: 'abort' })
    await wait(message => messages.indexOf(message) >= abortStart && message.type === 'event'
      && (message.event as { type?: string })?.type === 'agent_settled')
    scenes.push('abort-during-real-stream')
    child.stdin.end()
    assert.equal(await deadline(exited), 0)
    scenes.push('parent-pipe-close-shutdown')
    run.json('pi-control.json', { scenes, requests, messages: messages.map(({ callbackToken: _token, ...message }) => message) })
    run.complete(scenes, ['live OAuth refresh and MCP providers', 'native Windows/Linux'])
  } finally {
    provider.stop(true)
    if (child.exitCode === null && !child.signalCode) { child.kill('SIGKILL'); await deadline(exited) }
    writeFileSync(join(run.directory, 'pi-stderr.log'), stderr)
    // ready contains a short-lived callback secret; retain protocol types and sanitized messages only.
    writeFileSync(join(run.directory, 'pi-stdout-types.json'), JSON.stringify(messages.map(message => message.type)))
  }
})
