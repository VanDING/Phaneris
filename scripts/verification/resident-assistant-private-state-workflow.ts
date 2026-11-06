import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-private-state', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha'), other = join(config, 'beta'), cwd = join(root, 'project'), sessionId = 'private-state-worker'
  process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  for (const path of [join(root, 'assistant'), join(root, 'memory'), join(root, 'runtime'), cwd, join(other, 'assistant'), join(root, 'sessions', sessionId)]) mkdirSync(path, { recursive: true })
  const workspaces = [root, other].map((rootPath, index) => ({ id: index ? 'beta' : 'alpha', slug: index ? 'beta' : 'alpha', name: 'Private state fixture', rootPath, createdAt: 1 }))
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces, activeWorkspaceId: 'alpha', setupDeferred: true }))
  for (const path of [join(root, 'assistant'), join(root, 'memory'), join(root, 'runtime'), join(other, 'assistant')]) writeFileSync(join(path, 'private-proof.txt'), 'PRIVATE_NEVER_MODEL_VISIBLE')
  writeFileSync(join(cwd, 'public.md'), 'PUBLIC_RETRIEVAL_EVIDENCE')
  writeFileSync(join(config, 'credentials.enc'), 'PRIVATE_NEVER_MODEL_VISIBLE')
  const projectMemory = join(root, 'projects', 'personal', 'MEMORY.md')
  mkdirSync(join(root, 'projects', 'personal'), { recursive: true }); writeFileSync(projectMemory, 'PUBLIC_RETRIEVAL_EVIDENCE')
  for (const path of [join(root, 'sessions', sessionId, 'meta'), join(root, 'sessions', sessionId, '.pi-sessions')]) {
    mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'private-proof.txt'), 'PRIVATE_NEVER_MODEL_VISIBLE')
  }
  writeFileSync(join(root, 'sessions', sessionId, 'session.jsonl'), 'PRIVATE_NEVER_MODEL_VISIBLE')
  symlinkSync(join(root, 'assistant'), join(cwd, 'linked-private'), process.platform === 'win32' ? 'junction' : 'dir')
  const probes = [
    { name: 'read', args: { path: join(config, 'credentials.enc') }, denied: true },
    { name: 'write', args: { path: projectMemory, content: 'MUST_NOT_REPLACE_PROJECT_OWNER' }, denied: true },
    { name: 'edit', args: { path: projectMemory, oldText: 'PUBLIC_RETRIEVAL_EVIDENCE', newText: 'MUST_NOT_REPLACE_PROJECT_OWNER' }, denied: true },
    { name: 'read', args: { path: projectMemory }, public: true },
    { name: 'read', args: { path: join(root, 'sessions', sessionId, 'session.jsonl') }, denied: true },
    { name: 'read', args: { path: join(root, 'sessions', sessionId, '.pi-sessions', 'private-proof.txt') }, denied: true },
    { name: 'read', args: { path: join(root, 'assistant', 'private-proof.txt') }, denied: true },
    { name: 'read', args: { path: join(cwd, 'linked-private', 'private-proof.txt') }, denied: true },
    { name: 'read', args: { path: join(root, 'runtime', 'private-proof.txt') }, denied: true },
    { name: 'grep', args: { path: root, pattern: 'PRIVATE_' }, denied: false },
    { name: 'find', args: { path: root, pattern: '**/private-proof.txt' }, denied: false },
    { name: 'ls', args: { path: join(root, 'assistant') }, denied: true },
    { name: 'ls', args: { path: root }, denied: false },
    { name: 'grep', args: { path: root, pattern: 'PUBLIC_RETRIEVAL_EVIDENCE' }, public: true },
    { name: 'read', args: { path: join(other, 'assistant', 'private-proof.txt') }, denied: true },
    { name: 'read', args: { path: join(root, 'memory', 'private-proof.txt') }, denied: true },
    { name: 'read', args: { path: join(cwd, 'public.md') }, public: true },
  ]
  type Request = { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }
  const requests: Request[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as Request; requests.push(body)
    assert(!body.tools?.some(tool => tool.function.name.startsWith('mcp__session__assistant_')), 'Workers do not receive assistant memory tools')
    const index = requests.length - 1, probe = probes[Math.floor(index / 2)]
    if (!probe || requests.length > probes.length * 2) return Response.json({ error: { message: 'Private state fixture exceeded model budget' } }, { status: 400 })
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'private-state', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const reply = index % 2 === 0 ? chunk({ tool_calls: [{ index: 0, id: `private-call-${index}`, type: 'function', function: { name: probe.name, arguments: JSON.stringify(probe.args) } }] }, 'tool_calls')
      : chunk({ content: 'PRIVATE_STATE_PROBE_DONE' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const runtime = createDurableRuntime(), workspace = workspaces[0]!, scope = { sessionId, workspaceRootPath: root }
  const agent = assembleSessionAgent({
    context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
      connection: { slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
        customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Fixture', provider: 'pi', contextWindow: 64000, maxTokens: 4096 }] } },
    hostRuntime: { appRootPath: resolve('.'), isPackaged: false, nodeRuntimePath: process.execPath },
    config: { model: 'pi/fixture', workspace, session: { id: sessionId, workspaceRootPath: root, workingDirectory: cwd, permissionMode: 'allow-all', createdAt: 1, lastUsedAt: 1 },
      isHeadless: true, envOverrides: { PHANERIS_CONFIG_DIR: config, NODE_ENV: 'test' } }, callbacks: {}, resources: bindPiRuntime(runtime, scope),
  })
  const scenes: string[] = []
  try {
    const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
    for (const [index, probe] of probes.entries()) {
      const handle = runtime.execution.begin(scope)
      runtime.execution.accept(handle, { operationId: `private-run-${index}`, userMessageId: `private-user-${index}`, userMessage: 'Run the bounded file access probe.' })
      await runtime.execution.drive(handle, driver, { message: 'Run the bounded file access probe.', options: { inputId: `private-user-${index}` } })
      const result = JSON.stringify(requests[index * 2 + 1]!.messages.filter(message => message.role === 'tool').at(-1))
      assert(!result.includes('PRIVATE_NEVER_MODEL_VISIBLE'), `${probe.name} cannot reveal assistant private state`)
      if (probe.denied) assert(/private|memory|protected/i.test(result), 'A forbidden direct path reports the private-state boundary')
      if (probe.public) assert(result.includes('PUBLIC_RETRIEVAL_EVIDENCE'), 'Public project evidence remains readable through parent searches')
      if (probe.name === 'find') assert(!result.includes('private-proof.txt'), 'Find excludes private directories before enumeration')
      scenes.push(`${index + 1}-${probe.name}-${probe.denied ? 'direct-denied' : probe.public ? 'public-evidence' : 'private-subtrees-excluded'}`)
    }
    run.json('private-state-evidence.json', { scenes, requests })
    run.complete(scenes, ['Arbitrary shell or external processes require an operating-system sandbox; this workflow tests product file tools'])
  } finally { await runtime.close(); api.stop(true) }
})
