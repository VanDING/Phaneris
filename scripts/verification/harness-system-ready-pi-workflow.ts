/** HE01–HE08/HE18: declared before production changes; real Pi/Host/SQLite. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { PiAgent } from '../../packages/shared/src/agent/pi-agent'

await verificationWorkflow('harness-system-ready-pi', async evidence => {
  const repo = resolve(import.meta.dir, '../..'), workspace = join(evidence.directory, 'workspace'), sessionId = 'ready-report'
  const project = join(workspace, 'project'), skillDir = join(project, '.agents/skills/research')
  process.env.PHANERIS_CONFIG_DIR = join(evidence.directory, 'config')
  process.env.NODE_ENV = 'test'
  mkdirSync(join(workspace, 'sessions', sessionId), { recursive: true })
  mkdirSync(skillDir, { recursive: true })
  mkdirSync(join(workspace, 'skills/research'), { recursive: true })
  writeFileSync(join(workspace, 'skills/research/SKILL.md'), '---\nname: Research\ndescription: Workspace fallback\n---\nWRONG_WORKSPACE_SKILL')
  const skill = (version: string) => `---\nname: Research\ndescription: Report fixture\nrequiredCapabilities:\n  - deliverables\n---\n${version}\nUse original evidence in the report.\n`
  writeFileSync(join(skillDir, 'SKILL.md'), skill('SELECTED_PROJECT_SKILL_V1'))
  writeFileSync(join(project, 'AGENTS.md'), 'PROJECT_RULE_EXACT\nKeep references attached to the report.\n')
  writeFileSync(join(project, 'evidence.txt'), 'Confirmed fact: the fixture amount is 42.\n')
  const requests: any[] = [], events: any[] = []
  const report = join(project, 'report.md')
  let toolSent = false, pendingHistory = false, rejectNext = false, largeReply = -1
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json(); requests.push(body)
    if (rejectNext) { rejectNext = false; return Response.json({ error: { message: 'Fixture rejects this request' } }, { status: 400 }) }
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `ready-${requests.length}`, object: 'chat.completion.chunk',
      created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
      ...(finish_reason ? { usage: { prompt_tokens: 6000, completion_tokens: 30, total_tokens: 6030 } } : {}) })}\n\n`
    let output = chunk({ role: 'assistant' })
    if (pendingHistory) {
      pendingHistory = false
      output += chunk({ tool_calls: [{ index: 0, id: 'history', type: 'function', function: { name: 'mcp__session__get_session_info',
        arguments: JSON.stringify({ history: { messageId: 'historic-8', maxCharacters: 1000 } }) } }] }) + chunk({}, 'tool_calls')
    } else if (!toolSent) {
      toolSent = true
      output += chunk({ tool_calls: [{ index: 0, id: 'write-report', type: 'function', function: { name: 'write',
        arguments: JSON.stringify({ path: report, content: '# Report\nConfirmed fact: 42.\nSource: evidence.txt\n' }) } }] }) + chunk({}, 'tool_calls')
    } else output += chunk({ content: largeReply >= 0 ? `COMPACTED_OLD_PAYLOAD_${largeReply}_` + 'record '.repeat(9000) : 'REPORT_READY' }) + chunk({}, 'stop')
    return new Response(output + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const { assembleSessionAgent } = await import('../../packages/server-core/src/sessions/agent-assembly')
  const { createSessionAgentCallbacks } = await import('../../packages/server-core/src/sessions/agent-product-callbacks')
  const { buildAgentSessionSnapshot } = await import('../../packages/server-core/src/sessions/agent-product-context')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PiRuntimeDriver, bindPiRuntime } = await import('../../packages/server-core/src/runtime-adapters/pi-driver')
  const product = { id: sessionId, workspaceRootPath: workspace, workingDirectory: project, createdAt: 1, lastUsedAt: 1,
    name: 'Report', description: 'Write a verified report', acceptanceCriteria: 'Reference evidence.txt', messages: [] as any[],
    transferredSessionSummary: '', transferredSessionSummaryApplied: false }
  const runtime = createDurableRuntime(), scope = { workspaceRootPath: workspace, sessionId }
  const agent = assembleSessionAgent({
    context: { provider: 'pi', authType: 'api_key', resolvedModel: 'pi/fixture', capabilities: { needsHttpPoolServer: true },
      connection: { slug: 'fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
        customEndpoint: { api: 'openai-completions' }, models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Loopback fixture',
          provider: 'pi', contextWindow: 128000, maxTokens: 4096 }] } },
    hostRuntime: { appRootPath: repo, isPackaged: false, nodeRuntimePath: process.execPath },
    config: { model: 'pi/fixture', miniModel: 'pi/fixture', session: buildAgentSessionSnapshot(product), isHeadless: true,
      workspace: { id: 'ready', slug: 'ready', name: 'Ready fixture', rootPath: workspace, createdAt: 1 },
      envOverrides: { PHANERIS_CONFIG_DIR: process.env.PHANERIS_CONFIG_DIR!, HOME: evidence.directory, USERPROFILE: evidence.directory, NODE_ENV: 'test' } },
    callbacks: createSessionAgentCallbacks({ read: () => product, patch: changes => Object.assign(product, changes), persist: () => {}, flush: async () => {},
      thinkingChanged: () => {}, log: () => {}, error: () => {} }), resources: bindPiRuntime(runtime, scope),
  })
  const checks: string[] = [], failures: Array<{ scene: string; error: string }> = []
  const { mergeSessionScopedToolCallbacks } = await import('../../packages/shared/src/agent/session-scoped-tool-callback-registry')
  const { readTaskHistory } = await import('../../packages/shared/src/agent/core/task-continuity')
  mergeSessionScopedToolCallbacks(sessionId, { getSessionInfoFn: () => ({ id: sessionId, name: 'Report', labels: [], status: 'todo',
    permissionMode: 'allow-all', createdAt: 1, isActive: true }), readSessionMessagesFn: async (_id, query) => readTaskHistory(product.messages, query) })
  agent.setPermissionMode('allow-all')
  runtime.execution.subscribe(sessionId, { event: event => { events.push(event) } })
  const check = (scene: string, run: () => void) => { try { run(); checks.push(scene) } catch (error) { failures.push({ scene, error: String(error) }) } }
  const content = (value: any): string => typeof value === 'string' ? value : (value ?? []).map((block: any) => block.text ?? '').join('\n')
  try {
    const driver = await runtime.execution.ensureDriver(sessionId, async () => new PiRuntimeDriver(agent))
    let sequence = 0
    const turn = async (message: string, attachment = false) => {
      const id = `ready-${++sequence}`
      product.messages.push({ id, role: 'user', content: message, timestamp: sequence })
      const handle = runtime.execution.begin(scope)
      runtime.execution.accept(handle, { operationId: `run-${id}`, userMessageId: id, userMessage: message })
      const result = await runtime.execution.drive(handle, driver, { message,
        attachments: attachment ? [{ type: 'text', path: join(project, 'evidence.txt'), storedPath: join(project, 'evidence.txt'),
          name: 'evidence.txt', mimeType: 'text/plain', size: 51 }] : undefined, options: { inputId: id } })
      assert.equal(result.kind, 'terminal')
    }
    await turn('[skill:research] Write report.md using evidence.txt.', true)
    const first = requests[0], initial = first.messages.map((message: any) => content(message.content)).join('\n')
    check('HE01 selected exact instructions reach the first actual request', () => {
      assert(initial.includes('SELECTED_PROJECT_SKILL_V1')); assert(!initial.includes('WRONG_WORKSPACE_SKILL'))
      assert(initial.includes('SKILL.md')); assert(initial.includes('sha256'))
    })
    check('HE01 native write creates a draft without a guide read roundtrip', () => {
      assert(existsSync(report)); assert.match(readFileSync(report, 'utf8'), /Confirmed fact: 42/)
      assert.equal(requests.length, 2)
    })
    check('HE03 root project rules are prepared as original content', () => assert(initial.includes('PROJECT_RULE_EXACT')))
    check('HE03 small attached original text reaches the first request with its identity', () => {
      assert(initial.includes('Confirmed fact: the fixture amount is 42.')); assert(initial.includes('attachment_materials'))
    })
    check('HE07 explicitly required deliverables are available immediately', () => {
      assert(first.tools.some((tool: any) => tool.function?.name === 'mcp__session__artifact_create'))
    })
    for (let index = 0; index < 24; index++) product.messages.push({ id: `historic-${index}`, role: 'user', timestamp: index,
      content: index === 8 ? 'MIDDLE_REQUIREMENT_KEEP_CITATIONS' : `Historical task clarification ${index}` })
    writeFileSync(join(skillDir, 'SKILL.md'), skill('SELECTED_PROJECT_SKILL_V2'))
    await turn('Continue the current report.')
    check('HE02 continued task receives the current skill version', () => {
      const latest = content(requests.at(-1).messages.findLast((message: any) => message.role === 'user').content)
      assert(latest.includes('SELECTED_PROJECT_SKILL_V2'))
    })
    check('HE13 middle user requirement remains in the actual continued request', () => {
      const latest = content(requests.at(-1).messages.findLast((message: any) => message.role === 'user').content)
      assert(latest.includes('MIDDLE_REQUIREMENT_KEEP_CITATIONS')); assert(latest.includes('historic-8'))
    })
    await turn('[skill:missing-skill] Continue the independent report work and explain the missing skill.')
    check('HE02 missing explicit skill is visible without terminating independent work', () => {
      const latest = content(requests.at(-1).messages.findLast((message: any) => message.role === 'user').content)
      assert(latest.includes('missing-skill')); assert(/unavailable|not found/i.test(latest)); assert.equal(requests.length, 4)
    })
    pendingHistory = true
    await turn('Look up the original middle requirement.')
    check('HE13 original message lookup passes through real tool T1/T2 and the next provider request', () => {
      const tool = requests.at(-1).messages.findLast((message: any) => message.role === 'tool')
      assert(content(tool.content).includes('MIDDLE_REQUIREMENT_KEEP_CITATIONS'))
      assert(content(tool.content).includes('historic-8'))
    })
    await turn('[skill:research] Continue the report before compression.')
    for (let index = 0; index < 4; index++) { largeReply = index; await turn(`Continue report detail ${index}.`) }
    largeReply = -1
    await turn('/compact')
    await turn('Continue after compression.')
    check('HE05 native SDK compaction keeps selected instructions and original requirements available', () => {
      const latest = content(requests.at(-1).messages.findLast((message: any) => message.role === 'user').content)
      assert(latest.includes('SELECTED_PROJECT_SKILL_V2')); assert(latest.includes('MIDDLE_REQUIREMENT_KEEP_CITATIONS'))
    })
    check('HE21 actual native compaction removes old large output from the continued provider request', () => {
      assert(!JSON.stringify(requests.at(-1).messages).includes('COMPACTED_OLD_PAYLOAD_0_'))
      assert(JSON.stringify(requests.at(-1).messages).includes('COMPACTED_OLD_PAYLOAD_3_'))
    })
    product.transferredSessionSummary = 'UNDELIVERED_TRANSFER_CONTEXT'
    product.transferredSessionSummaryApplied = false
    rejectNext = true
    await turn('Receive the transfer context, with an intentionally rejected request.')
    check('HE05 rejected request does not consume one-shot context', () => assert.equal(product.transferredSessionSummaryApplied, false))
    await turn('Retry the current task after the rejected request.')
    check('HE05 next successful request receives and acknowledges the original one-shot context', () => {
      assert(JSON.stringify(requests.at(-1)).includes('UNDELIVERED_TRANSFER_CONTEXT')); assert.equal(product.transferredSessionSummaryApplied, true)
    })
    await (agent as PiAgent).queryLlm({ prompt: 'UTILITY_ONLY', systemPrompt: 'ISOLATED_UTILITY_ONLY', model: 'pi/fixture' })
    check('HE18 utility request cannot inherit prepared task instructions or tools', () => {
      const utility = requests.at(-1)
      assert.equal((utility.tools ?? []).length, 0)
      assert(!JSON.stringify(utility.messages).includes('SELECTED_PROJECT_SKILL_V2'))
      assert(!JSON.stringify(utility.messages).includes('MIDDLE_REQUIREMENT_KEEP_CITATIONS'))
    })
    await turn('Continue the report after the isolated utility query.')
    check('HE18 main task preparation survives an isolated utility request', () => {
      assert(JSON.stringify(requests.at(-1)).includes('SELECTED_PROJECT_SKILL_V2'))
      assert(!JSON.stringify(requests.at(-1)).includes('ISOLATED_UTILITY_ONLY'))
    })
    evidence.json('ready-report.json', { checks, failures, requests, events, report, scope: 'Controlled inference, real Pi/Host/SQLite/files; task quality NOT RUN' })
    if (failures.length) throw new Error(JSON.stringify(failures))
    evidence.complete(checks, ['Live model quality', 'Signed cross-platform packaging'])
    console.log(JSON.stringify({ passed: checks.length, output: evidence.directory }))
  } finally { await runtime.close(); api.stop(true) }
})
