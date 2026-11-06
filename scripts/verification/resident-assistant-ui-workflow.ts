import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-ui', async run => {
  mkdirSync(resolve('.cache/verification'), { recursive: true })
  const config = mkdtempSync(resolve('.cache/verification/resident-ui-'))
  const workspace = join(config, 'workspace')
  mkdirSync(workspace)
  process.env.PHANERIS_CONFIG_DIR = config
  let providerCalls = 0
  let questionSent = false
  const taskSteps = new Map<string, number>()
  const inboxSteps = new Map<string, number>()
  const providerInputs: Array<{ worker: boolean; lastInput: string }> = []
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model' }] })
    const body = await request.json() as { tools?: Array<{ function: { name: string } }>; messages?: Array<{ role: string; content?: unknown }> }
    providerCalls++
    const worker = !JSON.stringify(body).includes('resident_assistant_role')
    const lastInput = JSON.stringify(body.messages?.findLast(message => message.role === 'user')?.content ?? '')
    providerInputs.push({ worker, lastInput })
    writeFileSync(join(run.directory, 'provider-inputs.json'), JSON.stringify(providerInputs, null, 2))
    if (worker && lastInput.includes('PANEL_ERROR_PROBE')) return Response.json({ error: { message: 'Use /provider/v1/messages: incompatible request shape', type: 'invalid_request_error' } }, { status: 400 })
    if (worker && lastInput.includes('PANEL_WAIT_PROBE') && !lastInput.includes('PANEL_MANUAL_CONTINUATION')) {
      const frame = (delta: object) => `data: ${JSON.stringify({ id: 'panel-thinking', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(frame({ role: 'assistant' }) + frame({ reasoning_content: 'Fixture activity signal' })))
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const tool = body.tools?.find(tool => tool.function.name.endsWith('ask_user'))?.function.name
    const ask = !!tool && !questionSent
    if (ask) questionSent = true
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `island-${providerCalls}`, object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
    const users = (body.messages ?? []).filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content
      : (message.content as Array<{ text?: string }> ?? []).map(part => part.text ?? '').join('\n'))
    const inbox = users.findLast(text => text.includes('<resident_inbox>'))?.match(/<resident_inbox>\n([\s\S]*?)\n<\/resident_inbox>/)
    let taskCall: { name: string; args: object } | undefined
    const assignment = users.findLast(text => text.includes('PANEL_OUTPUT_PATH:'))
    if (worker && assignment) {
      const count = taskSteps.get(assignment) ?? 0; taskSteps.set(assignment, count + 1)
      if (!count) taskCall = { name: 'mcp__session__report_task_result', args: { requestId: 'ui-result', summary: 'Requested document is complete.', outputs: [
        { key: 'document', path: join(workspace, 'island-delivery.md'), role: 'final', title: 'ISLAND_REAL_DELIVERY' },
        { key: 'helper', path: join(workspace, 'verify.py'), role: 'intermediate' },
      ] } }
    }
    if (!worker && inbox) {
      const events = JSON.parse(inbox[1]!) as Array<{ eventId: string; delegationId: string; result?: { sessionId: string; messageId: string } }>
      const event = events.find(event => event.result), key = events[0]!.eventId
      const count = inboxSteps.get(key) ?? 0; inboxSteps.set(key, count + 1)
      if (event && !count) taskCall = { name: 'mcp__session__assistant_memory_read', args: event.result! }
      else if (event && count === 1) taskCall = { name: 'mcp__session__assistant_work', args: { id: event.delegationId } }
      else if (count === (event ? 2 : 0)) taskCall = { name: 'mcp__session__assistant_delivery_ack', args: { eventIds: events.map(item => item.eventId),
        ...(event && JSON.stringify(body.messages).includes('ISLAND_REAL_DELIVERY') ? { deliverables: [{ delegationId: event.delegationId, expectedRevision: 1, keys: ['document'] }] } : {}) } }
    }
    const reply = taskCall ? chunk({ tool_calls: [{ index: 0, id: `ui-task-${providerCalls}`, type: 'function', function: { name: taskCall.name, arguments: JSON.stringify(taskCall.args) } }] }, 'tool_calls') : ask
      ? chunk({ tool_calls: [{ index: 0, id: 'island-decision', type: 'function', function: { name: tool, arguments: JSON.stringify({ questions: [{ id: 'delivery', question: 'ISLAND_REAL_DECISION', options: [{ label: 'Continue' }] }] }) } }] }, 'tool_calls')
      : chunk({ content: 'ISLAND_REAL_WORK_DONE' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const connection = { slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1,
    baseUrl: provider.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture',
    models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: true, supportedThinkingLevels: ['off', 'high'] }] }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'resident-ui', name: 'Assistant workspace', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'resident-ui', setupDeferred: true, defaultLlmConnection: 'fixture', llmConnections: [connection], appearance: { mode: 'light', colorTheme: 'default', font: 'inter' } }))
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'resident-ui', name: 'Assistant workspace', defaults: { defaultLlmConnection: 'fixture', model: 'fixture', permissionMode: 'safe', workingDirectory: 'none' } }))
  writeFileSync(join(workspace, 'verify.py'), 'print("PROCESS_ONLY")')
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only-key')
  const { saveSession } = await import('@phaneris/shared/sessions')
  await saveSession({ id: 'ordinary-history-ui', workspaceRootPath: workspace, name: 'Existing ordinary Session', createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'source-user', type: 'user', content: 'UI_SOURCE_DECISION', timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const input = join(run.directory, 'input.json')
  writeFileSync(input, JSON.stringify({ root: resolve('.'), config, output: run.directory, executable: process.env.PHANERIS_VERIFICATION_EXECUTABLE }))
  const child = Bun.spawn(['node', 'scripts/verification/fixtures/resident-assistant-ui.cjs', input], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  provider.stop(true)
  writeFileSync(join(run.directory, 'native.log'), out + err)
  assert.equal(code, 0, (out + err).slice(-8000))
  const result = JSON.parse(readFileSync(join(run.directory, 'ui-evidence.json'), 'utf8')) as { scenes: string[] }
  run.complete(result.scenes, ['Paid model quality', 'Physical touch hardware', 'Signed installer distribution and real external messaging accounts'])
})
