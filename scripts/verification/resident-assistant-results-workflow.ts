import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('resident-assistant-results', async run => {
  const config = join(run.directory, 'config'), root = join(config, 'alpha'), outputRoot = join(root, 'outputs')
  mkdirSync(outputRoot, { recursive: true })
  mkdirSync(join(root, 'runtime'), { recursive: true }); writeFileSync(join(root, 'runtime', 'private-proof.txt'), 'PRIVATE_HOST_STATE')
  process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
  const workspace = { id: 'alpha', name: 'Result fixture', rootPath: root, createdAt: 1 }
  type ProviderRequest = { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }
  const requests: ProviderRequest[] = [], workerSteps = new Map<string, number>(), inboxSteps = new Map<string, number>()
  let goal = 'DECLARE_REPORT'
  let userAttachmentPath = ''
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as ProviderRequest; requests.push(body)
    if (requests.length > 70) return Response.json({ error: { message: 'Result fixture exceeded its model budget' } }, { status: 400 })
    const all = JSON.stringify(body.messages)
    const userText = body.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string'
      ? message.content : (message.content as Array<{ text?: string }> ?? []).map(part => part.text ?? '').join('\n'))
    const inboxText = userText.findLast(text => text.includes('<resident_inbox>'))
    const inbox = inboxText?.match(/<resident_inbox>\n([\s\S]*?)\n<\/resident_inbox>/)
    const resident = all.includes('resident_assistant_role')
    let call: { name: string; args: Record<string, unknown> } | undefined
    let calls: Array<{ name: string; args: Record<string, unknown> }> | undefined
    if (resident && inbox) {
      const events = JSON.parse(inbox[1]!) as Array<{ eventId: string; delegationId: string; result?: { sessionId: string; messageId: string } }>
      const event = events.find(event => event.result)
      const step = inboxSteps.get(events[0]!.eventId) ?? 0
      inboxSteps.set(events[0]!.eventId, step + 1)
      if (event && step === 0) call = { name: 'mcp__session__assistant_memory_read', args: event.result! }
      else if (event && step === 1) call = { name: 'mcp__session__assistant_work', args: { id: event.delegationId } }
      else if (step === (event ? 2 : 0)) call = { name: 'mcp__session__assistant_delivery_ack', args: {
        eventIds: events.map(event => event.eventId), ...(event ? { deliverables: [{ delegationId: event.delegationId,
          expectedRevision: 1, keys: ['DECLARE_TEXT', 'DECLARE_PRIVATE', 'DECLARE_ATTACHMENT'].includes(goal) ? [] : [goal === 'DECLARE_SCRIPT' ? 'script' : 'report'] }] } : {}),
      } }
    } else if (!resident) {
      const assignment = userText.findLast(text => text.includes('[Delegated work '))?.match(/\[Delegated work ([^\]]+)\]/)?.[1] ?? 'unknown'
      const step = workerSteps.get(assignment) ?? 0; workerSteps.set(assignment, step + 1)
      const folder = join(outputRoot, goal)
      const files = [
        { key: 'report', path: join(folder, 'report.md'), content: 'FINAL_REPORT_EVIDENCE', role: goal === 'DECLARE_SCRIPT' ? 'intermediate' : 'final' },
        { key: 'script', path: join(folder, 'verify.py'), content: 'print("SCRIPT_RESULT_EVIDENCE")', role: goal === 'DECLARE_SCRIPT' ? 'final' : 'intermediate' },
        { key: 'config', path: join(folder, 'preferences.json'), content: '{"temporary":true}', role: 'intermediate' },
      ]
      if (goal === 'DECLARE_ATTACHMENT' && step === 0) {
        const text = userText.findLast(text => text.includes('[Delegated work ')) ?? ''
        const copied = text.match(/<delegated_attachments>\n([\s\S]*?)\n<\/delegated_attachments>/)
        const path = copied ? (JSON.parse(copied[1]!) as Array<{ storedPath: string }>)[0]!.storedPath : userAttachmentPath
        call = { name: 'read', args: { path } }
      } else if (goal === 'DECLARE_PRIVATE' && step === 0) call = { name: 'mcp__session__report_task_result', args: { requestId: 'forged-private-output', summary: 'This is not an authorized result.', outputs: [{ key: 'host-state', role: 'final', path: join(root, 'runtime', 'private-proof.txt') }] } }
      else if (step === 0 && goal !== 'DECLARE_TEXT') calls = files.map(file => ({ name: 'write', args: { path: file.path, content: file.content } }))
      else if (step === (goal === 'DECLARE_TEXT' ? 0 : 1)) call = { name: 'mcp__session__report_task_result', args: {
        requestId: 'declared-result-v1', summary: 'The requested task is complete; helper files are intermediate.',
        outputs: ['DECLARE_TEXT', 'DECLARE_PRIVATE', 'DECLARE_ATTACHMENT'].includes(goal) ? [] : files.map(({ key, path, role }) => ({ key, path, role })),
      } }
    }
    const selected = calls ?? (call ? [call] : [])
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'task-result', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    const reply = selected.length ? chunk({ tool_calls: selected.map((call, index) => ({ index, id: `result-call-${requests.length}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) }, 'tool_calls')
      : chunk({ content: resident ? 'RESULT_REVIEWED_AND_DELIVERED' : 'WORKER_RESULT_COMPLETE' }) + chunk({}, 'stop')
    return new Response(chunk({ role: 'assistant' }) + reply + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'alpha', setupDeferred: true, defaultLlmConnection: 'fixture',
    llmConnections: [{ slug: 'fixture', name: 'Loopback', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: api.url.href,
      customEndpoint: { api: 'openai-completions' }, defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', shortName: 'Fixture', description: 'Fixture', provider: 'pi', contextWindow: 64000, maxTokens: 4096 }] }] }))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, defaults: { permissionMode: 'allow-all', defaultLlmConnection: 'fixture', model: 'fixture' } }))
  const { getCredentialManager } = await import('@phaneris/shared/credentials'); await getCredentialManager().setLlmApiKey('fixture', 'loopback-only')
  const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
  const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
  const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  let manager!: InstanceType<typeof SessionManager>
  const host = await bootstrapServer({ serverToken: 'task-results-fixture', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
    applyPlatformToSubsystems(platform) { platform.logger = { info() {}, warn() {}, debug() {}, error() {} }; setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
    createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps,
    registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps), initializeSessionManager: manager => manager.initialize(),
    bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
    initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
  })
  const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { workspaceId: 'alpha', token: 'task-results-fixture', autoReconnect: false }); await client.connect()
  const scenes: string[] = []
  try {
    const assistant = await client.invoke(RPC_CHANNELS.residentAssistant.GET, 'alpha')
    const { getSessionAttachmentsPath } = await import('@phaneris/shared/sessions/paths')
    const attachmentRoot = getSessionAttachmentsPath(root, assistant.id); mkdirSync(attachmentRoot, { recursive: true })
    userAttachmentPath = join(attachmentRoot, 'user-document.txt'); writeFileSync(userAttachmentPath, 'ORIGIN_USER_DOCUMENT_FOR_THIS_TASK')
    const legacy = await manager.createSession('alpha', { name: 'Legacy helper', parentSessionId: assistant.id, workingDirectory: outputRoot })
    const legacyPath = join(outputRoot, 'legacy-verify.py'); writeFileSync(legacyPath, 'LEGACY_HELPER_RETAINED')
    const oldArtifact = await client.invoke(RPC_CHANNELS.artifacts.REGISTER_CURRENT, 'alpha', { sessionId: legacy.id, sourcePath: legacyPath })
    const assignments = []
    for (const requested of ['DECLARE_REPORT', 'DECLARE_SCRIPT', 'DECLARE_TEXT', 'DECLARE_PRIVATE', 'DECLARE_ATTACHMENT']) {
      goal = requested
      mkdirSync(join(outputRoot, goal), { recursive: true })
      await client.invoke(RPC_CHANNELS.residentAssistant.CONTEXT, 'alpha', { action: 'focus', label: goal, anchors: [] })
      await manager.sendMessage(assistant.id, `${goal}: produce the requested final result and keep verification/configuration files as process evidence.`, undefined,
        goal === 'DECLARE_ATTACHMENT' ? [{ id: 'selected-user-document', type: 'text', name: 'user-document.txt', mimeType: 'text/plain', size: 34, storedPath: userAttachmentPath }] : undefined)
      const assignment = await client.invoke(RPC_CHANNELS.residentAssistant.DISPATCH, 'alpha', { requestId: goal, title: goal, instructions: goal,
        config: { llmConnection: 'fixture', model: 'fixture', thinkingLevel: 'off', permissionMode: 'allow-all', workingDirectory: goal === 'DECLARE_PRIVATE' ? root : join(outputRoot, goal) } })
      assignments.push(assignment.id)
      const until = Date.now() + 25000
      let delivered = false
      while (!delivered && Date.now() < until) {
        delivered = (await client.invoke(RPC_CHANNELS.residentAssistant.EVENTS, 'alpha', { limit: 100 })).items.some(event => event.delegationId === assignment.id && event.kind === 'result_ready' && event.phase === 'delivered')
        if (!delivered) await Bun.sleep(25)
      }
      assert(delivered, `${goal} must deliver through the real assistant inbox`)
      const page = await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'deliverables', limit: 20 })
      assert.equal(page.deliverables?.length, goal === 'DECLARE_REPORT' ? 1 : 2)
      assert(!page.deliverables?.some(item => item.artifactId === oldArtifact.artifact.id || item.sourcePath.endsWith('preferences.json')))
      if (goal === 'DECLARE_SCRIPT') assert(page.deliverables?.some(item => item.sourcePath.endsWith('verify.py')), 'An explicitly requested script is a final result')
      const detail = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: assignment.id })).items[0]!
      assert.equal(detail.outputManifest?.outputs.length, ['DECLARE_TEXT', 'DECLARE_PRIVATE', 'DECLARE_ATTACHMENT'].includes(goal) ? 0 : 3)
      if (goal === 'DECLARE_ATTACHMENT') {
        const worker = await manager.getSession(assignment.sessionId!)
        assert(requests.some(request => request.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('ORIGIN_USER_DOCUMENT_FOR_THIS_TASK'))), 'The actual model receives the selected document through a native read of its scoped copy')
        const input = worker!.messages.find(message => message.id === detail.inputMessageId)!
        assert(input.attachments?.[0]?.storedPath.startsWith(join(root, 'sessions', worker!.id, 'attachments')))
        assert.notEqual(input.attachments?.[0]?.storedPath, userAttachmentPath)
        assert.equal(readFileSync(userAttachmentPath, 'utf8'), 'ORIGIN_USER_DOCUMENT_FOR_THIS_TASK')
        const tool = worker!.messages.find(message => message.role === 'tool' && message.toolName?.toLowerCase() === 'read')!
        assert(tool?.durableOperationId)
        const memory = manager.getAssistantMemoryStore('alpha')
        const assessment = { confidence: 'supported', durability: 'durable', domain: 'experience', reason: 'The actual read receipt proves the scoped document handoff, not user acceptance or business completion.' } as const
        const observed = memory.mutate({ action: 'remember', requestId: 'observed-attachment-read', key: 'scoped-attachment-experience', kind: 'experience', basis: 'inferred',
          content: '用户附件通过 Host 的 Worker 副本交接后，可用原生读取工具检查。', assessment, sources: [{ sessionId: worker!.id, messageId: tool.id }] }, 'automatic')
        run.json('observation-diagnostic.json', { tool, source: memory.readSource({ sessionId: worker!.id, messageId: tool.id }),
          evidence: manager.getRecoveryEvidence(worker!.id, tool.durableOperationId!), observed })
        assert.equal(observed.record.state, 'active', 'A verified Runtime tool observation can be retained automatically as an attributed experience')
        assert.equal(observed.record.sources[0]?.observation?.operationId, tool.durableOperationId)
        const guessedPreference = memory.mutate({ action: 'remember', requestId: 'tool-is-not-user-preference', key: 'unconfirmed-tool-preference', kind: 'fact', basis: 'inferred',
          content: '工具输出不能确认用户的个人偏好。', assessment: { ...assessment, domain: 'user_fact' }, sources: [{ sessionId: worker!.id, messageId: tool.id }] }, 'automatic')
        assert.equal(guessedPreference.record.state, 'candidate')
        const { messageToStored } = await import('@phaneris/core/types'), { saveSession } = await import('@phaneris/shared/sessions')
        await saveSession({ id: 'forged-observation-source', workspaceRootPath: root, createdAt: 1, lastUsedAt: 1,
          messages: [{ ...messageToStored(tool), id: 'forged-tool' }], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
        const forged = memory.mutate({ action: 'remember', requestId: 'forged-observation', key: 'forged-observation', kind: 'experience', basis: 'inferred',
          content: 'A copied tool row is not execution evidence for another Session.', assessment, sources: [{ sessionId: 'forged-observation-source', messageId: 'forged-tool' }] }, 'automatic')
        assert.equal(forged.record.state, 'candidate')
        run.json('observation-evidence.json', { observed, guessedPreference, forged })
      }
      scenes.push(goal)
    }
    assert(existsSync(legacyPath), 'Changing presentation does not delete process files')
    assert((await client.invoke(RPC_CHANNELS.artifacts.LIST, 'alpha')).some(item => item.artifact.id === oldArtifact.artifact.id))
    const first = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'deliverables' })).deliverables!.find(item => item.key === 'report')!
    writeFileSync(first.sourcePath, 'LATER_REPORT_REVISION')
    const current = await client.invoke(RPC_CHANNELS.artifacts.GET, 'alpha', first.artifactId)
    assert(current)
    const ownerId = current.artifact.sessionId
    await client.invoke(RPC_CHANNELS.artifacts.REGISTER_CURRENT, 'alpha', { sessionId: ownerId, sourcePath: first.sourcePath })
    const reviewed = await client.invoke(RPC_CHANNELS.artifacts.GET, 'alpha', first.artifactId, first.revision)
    assert(reviewed)
    assert.equal(readFileSync(reviewed.activePath!, 'utf8'), 'FINAL_REPORT_EVIDENCE', 'A reviewed delivery opens its pinned immutable revision')
    assert.equal(reviewed.viewedRevision, first.revision)
    assert.equal(reviewed.editablePath, null)
    await assert.rejects(client.invoke(RPC_CHANNELS.artifacts.GET, 'alpha', first.artifactId, 'f'.repeat(64)), /revision/i)
    scenes.push('pinned revision preview survives later edits; unavailable revision rejected')
    const detail = (await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { id: first.delegationId })).items[0]!
    const command = { delegationId: first.delegationId, expectedRevision: detail.outputManifest!.revision, key: first.key, visible: false }
    await client.invoke(RPC_CHANNELS.residentAssistant.OUTPUT_VISIBILITY, 'alpha', command)
    const afterHide = await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'deliverables' })
    assert(!afterHide.deliverables!.some(item => item.id === first.id))
    assert(existsSync(first.sourcePath)); assert.equal(readFileSync(reviewed.activePath!, 'utf8'), 'FINAL_REPORT_EVIDENCE')
    await assert.rejects(client.invoke(RPC_CHANNELS.residentAssistant.OUTPUT_VISIBILITY, 'alpha', { ...command, expectedRevision: command.expectedRevision + 1 }), /revision/i)
    const intermediate = detail.outputManifest!.outputs.find(item => item.role === 'intermediate')!
    await assert.rejects(client.invoke(RPC_CHANNELS.residentAssistant.OUTPUT_VISIBILITY, 'alpha', { ...command, key: intermediate.key, visible: true }), /reviewed|process|deliverable/i)
    await client.invoke(RPC_CHANNELS.residentAssistant.OUTPUT_VISIBILITY, 'alpha', { ...command, visible: true })
    assert((await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'deliverables' })).deliverables!.some(item => item.id === first.id))
    scenes.push('user can reversibly remove a reviewed deliverable without deleting files or promoting process material')
    run.json('task-results-evidence.json', { scenes, assignments, requests, delivered: await client.invoke(RPC_CHANNELS.residentAssistant.WORK, 'alpha', { view: 'deliverables' }) })
    run.complete(scenes, ['Paid model classification quality', 'Interactive UI and installation (separate workflows)'])
    console.log(JSON.stringify({ passed: scenes.length, output: run.directory }))
  } finally { run.json('provider-requests.json', requests); client.destroy(); await host.stop(); api.stop(true) }
})
