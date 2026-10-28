/** Failure cases declared before the fix: default cwd, shell cwd, cross-session
 * collisions, explicit project paths, legacy sdkCwd, cold resume, directory changes,
 * prompt/runtime disagreement and permission checks against the wrong directory.
 * Real Pi child + tools + SQLite, deterministic loopback inference; no live API.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { PiAgent } from '../../packages/shared/src/agent/pi-agent'

await verificationWorkflow('session-working-directory-pi', async evidence => {
  const repo = resolve(import.meta.dir, '../..'), workspace = join(evidence.directory, 'workspace')
  const packagedResources = process.env.PHANERIS_VERIFY_PI_RESOURCES
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config')
  process.env.NODE_ENV = 'test'
  mkdirSync(workspace, { recursive: true })
  const requests: any[] = [], events: any[] = [], prompts: any[] = []
  const issued = new Set<string>(), scenes: string[] = []
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json() as any
    requests.push(body)
    const user = body.messages.findLast((message: any) => message.role === 'user')
    const text = typeof user.content === 'string' ? user.content : JSON.stringify(user.content)
    const tag = /CWD_CASE:([a-z-]+)/.exec(text)?.[1]
    assert(tag, 'Missing workflow case in inference request')
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({
      id: `cwd-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
      ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } : {}),
    })}\n\n`
    const tool = (name: string) => {
      const found = body.tools.find((item: any) => item.function.name === name)
      assert(found, `Missing native tool ${name}`)
      return found.function.name
    }
    let output = chunk({ role: 'assistant' })
    if (!issued.has(tag)) {
      issued.add(tag)
      const calls = tag === 'guarded-outside'
        ? [{ name: 'write', args: { path: join(workspace, 'must-not-write.txt'), content: 'DENIED' } }]
        : [{ name: 'write', args: { path: 'relative.txt', content: tag } },
          { name: process.platform === 'win32' ? 'powershell' : 'bash', args: { command: 'node -e "require(\'fs\').writeFileSync(\'shell-cwd.txt\', process.cwd())"' } }]
      output += chunk({ tool_calls: calls.map((call, index) => ({ index, id: `${tag}-${index}`,
        type: 'function', function: { name: tool(call.name), arguments: JSON.stringify(call.args) } })) }, 'tool_calls')
    } else output += chunk({ content: 'CWD_VERIFIED' }) + chunk({}, 'stop')
    return new Response(output + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const active: ReturnType<typeof createDurableRuntime>[] = []
  const create = (id: string, workingDirectory?: string, sdkSessionId?: string) => {
    mkdirSync(join(workspace, 'sessions', id), { recursive: true })
    if (workingDirectory) mkdirSync(workingDirectory, { recursive: true })
    const runtime = createDurableRuntime(), scope = { workspaceRootPath: workspace, sessionId: id }
    active.push(runtime)
    const agent = assembleSessionAgent({
      context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
        connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1,
          baseUrl: api.url.href, customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture',
            shortName: 'Fixture', description: 'Loopback fixture', provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
      hostRuntime: { appRootPath: packagedResources ? join(packagedResources, 'app') : repo,
        isPackaged: !!packagedResources, resourcesPath: packagedResources,
        nodeRuntimePath: packagedResources ? join(packagedResources, 'app/vendor/bun', process.platform === 'win32' ? 'bun.exe' : 'bun') : process.execPath },
      config: { model: 'pi/fixture', miniModel: 'pi/fixture', isHeadless: true,
        workspace: { id: 'cwd', slug: 'cwd', name: 'Cwd fixture', rootPath: workspace, createdAt: 1 },
        session: { id, workspaceRootPath: workspace, createdAt: 1, lastUsedAt: 1,
          workingDirectory, sdkCwd: workspace, sdkSessionId },
        envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, NODE_ENV: 'test' } },
      callbacks: {}, resources: bindPiRuntime(runtime, scope),
    }) as PiAgent
    agent.setPermissionMode('allow-all')
    runtime.execution.subscribe(id, { event: event => { events.push(event) } })
    const turn = async (tag: string) => {
      const driver = await runtime.execution.ensureDriver(id, async () => new PiRuntimeDriver(agent))
      const handle = runtime.execution.begin(scope), message = `CWD_CASE:${tag} Verify relative file and shell execution.`
      runtime.execution.accept(handle, { operationId: `run-${tag}`, userMessageId: tag, userMessage: message })
      assert.equal((await runtime.execution.drive(handle, driver, { message, options: { inputId: tag } })).kind, 'terminal')
    }
    return { agent, runtime, turn }
  }
  const verifyFiles = (directory: string, tag: string) => {
    assert.equal(readFileSync(join(directory, 'relative.txt'), 'utf8'), tag)
    assert.equal(resolve(readFileSync(join(directory, 'shell-cwd.txt'), 'utf8')), resolve(directory))
  }
  try {
    const first = create('default-a')
    await first.turn('default-first')
    verifyFiles(join(workspace, 'sessions/default-a'), 'default-first')
    assert(!existsSync(join(workspace, 'relative.txt')))
    assert(JSON.stringify(requests[0]).includes(join(workspace, 'sessions/default-a').replaceAll('\\', '\\\\')))
    scenes.push('default session native write and shell use its own folder')
    scenes.push('prompt and actual cwd agree despite legacy workspace sdkCwd')
    const sdkSessionId = first.agent.getSessionId()!
    await first.runtime.close()

    const second = create('default-b')
    await second.turn('default-second')
    verifyFiles(join(workspace, 'sessions/default-b'), 'default-second')
    verifyFiles(join(workspace, 'sessions/default-a'), 'default-first')
    scenes.push('same relative names do not collide across sessions')
    await second.runtime.close()

    const resumed = create('default-a', undefined, sdkSessionId)
    await resumed.turn('resumed')
    verifyFiles(join(workspace, 'sessions/default-a'), 'resumed')
    scenes.push('cold resume preserves session cwd with legacy sdk metadata')

    const changed = join(workspace, 'selected project with spaces')
    mkdirSync(changed, { recursive: true })
    resumed.agent.updateWorkingDirectory(changed)
    await resumed.turn('changed-project')
    verifyFiles(changed, 'changed-project')
    verifyFiles(join(workspace, 'sessions/default-a'), 'resumed')
    scenes.push('directory change takes effect in real tools on the next turn')
    await resumed.runtime.close()

    const selected = join(workspace, 'explicit project with spaces'), explicit = create('explicit', selected)
    await explicit.turn('explicit-project')
    verifyFiles(selected, 'explicit-project')
    assert(!existsSync(join(workspace, 'sessions/explicit/relative.txt')))
    scenes.push('explicit project directory remains respected')
    await explicit.runtime.close()

    const guarded = create('guarded')
    guarded.agent.guardedModeCheck = { isActive: () => true, canPrompt: () => true, check: async () => ({ risks: [] }) }
    guarded.agent.onPermissionRequest = request => {
      prompts.push(request)
      guarded.agent.respondToPermission(request.requestId, false)
    }
    guarded.agent.setPermissionMode('guarded')
    await guarded.turn('guarded-outside')
    assert.equal(prompts.length, 1, 'Workspace-root write must require approval outside this session')
    assert(!existsSync(join(workspace, 'must-not-write.txt')))
    scenes.push('permission boundary uses session cwd rather than workspace root')
    await guarded.runtime.close()
    evidence.json('cwd.json', { scenes, workspace, packagedResources, requests, events, prompts })
    evidence.complete(scenes, ['Live model APIs', 'Signed installer'])
    console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
  } finally {
    for (const runtime of active) await runtime.close()
    api.stop(true)
    evidence.json('cwd-evidence.json', { scenes, requests, events, prompts })
  }
})
