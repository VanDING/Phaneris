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
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model' }] })
    const body = await request.json() as { tools?: Array<{ function: { name: string } }> }
    providerCalls++
    const tool = body.tools?.find(tool => tool.function.name.endsWith('ask_user'))?.function.name
    const ask = !!tool && !questionSent
    if (ask) questionSent = true
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `island-${providerCalls}`, object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}) })}\n\n`
    const reply = ask
      ? chunk({ tool_calls: [{ index: 0, id: 'island-decision', type: 'function', function: { name: tool, arguments: JSON.stringify({ questions: [{ id: 'delivery', question: 'ISLAND_REAL_DECISION', options: [{ label: 'Continue' }] }] }) } }] }, 'tool_calls')
      : chunk({ content: 'ISLAND_REAL_WORK_DONE' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const connection = { slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1,
    baseUrl: provider.url.href, customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture',
    models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Test only', provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }] }
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'resident-ui', name: 'Assistant workspace', rootPath: workspace, createdAt: 1 }],
    activeWorkspaceId: 'resident-ui', setupDeferred: true, defaultLlmConnection: 'fixture', llmConnections: [connection], appearance: { mode: 'light', colorTheme: 'default', font: 'inter' } }))
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'resident-ui', name: 'Assistant workspace', defaults: { defaultLlmConnection: 'fixture', model: 'fixture', permissionMode: 'safe', workingDirectory: 'none' } }))
  const { getCredentialManager } = await import('@phaneris/shared/credentials')
  await getCredentialManager().setLlmApiKey('fixture', 'loopback-only-key')
  const { saveSession } = await import('@phaneris/shared/sessions')
  await saveSession({ id: 'ordinary-history-ui', workspaceRootPath: workspace, name: 'Existing ordinary Session', createdAt: 1, lastUsedAt: 1,
    messages: [{ id: 'source-user', type: 'user', content: 'UI_SOURCE_DECISION', timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const input = join(run.directory, 'input.json')
  writeFileSync(input, JSON.stringify({ root: resolve('.'), config, output: run.directory }))
  const child = Bun.spawn(['node', 'scripts/verification/fixtures/resident-assistant-ui.cjs', input], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  provider.stop(true)
  writeFileSync(join(run.directory, 'native.log'), out + err)
  assert.equal(code, 0, (out + err).slice(-8000))
  const result = JSON.parse(readFileSync(join(run.directory, 'ui-evidence.json'), 'utf8')) as { scenes: string[] }
  run.complete(result.scenes, ['Paid model quality', 'Physical touch hardware', 'Signed packaging and remote deployment'])
})
