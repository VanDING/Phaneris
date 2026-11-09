import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [output, proxy, model, mode] = process.argv.slice(2) as [string, string, string, string]
const config = join(output, 'config'), root = join(config, 'live'); mkdirSync(root, { recursive: true })
process.env.PHANERIS_CONFIG_DIR = config; process.env.NODE_ENV = 'test'
const workspace = { id: 'live', name: '0.6.3 synthetic live verification', rootPath: root, createdAt: 1 }
writeFileSync(join(config, 'config.json'), JSON.stringify({ workspaces: [workspace], activeWorkspaceId: 'live', setupDeferred: true, defaultLlmConnection: 'sample', llmConnections: [{
  slug: 'sample', name: 'Live verification', providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key', createdAt: 1, baseUrl: proxy,
  customEndpoint: { api: 'openai-completions' }, defaultModel: model, models: [{ id: model, name: model, shortName: model, provider: 'pi', contextWindow: 64000, maxTokens: 4096, supportsThinking: false }],
}] }))
writeFileSync(join(root, 'config.json'), JSON.stringify({ ...workspace, assistantMemory: { version: 1, learning: 'explicit', use: false }, defaults: { permissionMode: 'safe', defaultLlmConnection: 'sample', model, workingDirectory: 'none' } }))
const { getCredentialManager } = await import('@phaneris/shared/credentials'); await getCredentialManager().setLlmApiKey('sample', 'synthetic-proxy-only')
const { bootstrapServer } = await import('@phaneris/server-core/bootstrap')
const { SessionManager, setSessionPlatform, setSessionRuntimeHooks } = await import('@phaneris/server-core/sessions')
const { registerCoreRpcHandlers } = await import('@phaneris/server-core/handlers/rpc')
let manager!: InstanceType<typeof SessionManager>
const host = await bootstrapServer({ serverToken: 'context-063-live-isolated', rpcHost: '127.0.0.1', rpcPort: 0, bundledAssetsRoot: resolve('apps/electron'),
  applyPlatformToSubsystems(platform) { setSessionPlatform(platform); setSessionRuntimeHooks({ updateBadgeCount() {}, captureException() {} }) },
  createSessionManager: runtime => (manager = new SessionManager(runtime)), createHandlerDeps: deps => deps, registerAllRpcHandlers: (server, deps) => registerCoreRpcHandlers(server, deps),
  initializeSessionManager: manager => manager.initialize(), bindRpcServer: (manager, server) => manager.setRpcServer(server), setSessionEventSink: (manager, sink) => manager.setEventSink(sink),
  initModelRefreshService: () => ({ startAll() {}, stopAll() {} }), cleanupSessionManager: async manager => { await manager.flushAllSessions(); await manager.cleanup() },
})
const scenes: string[] = [], turns: unknown[] = []
try {
  const assistant = await manager.getOrCreateResidentAssistant('live')
  const send = async (text: string, id = assistant.id) => {
    const before = (await manager.getSession(id))!.messages.length
    const start = performance.now(); await manager.sendMessage(id, text)
    const session = (await manager.getSession(id))!, added = session.messages.slice(before), reply = added.findLast(m => m.role === 'assistant' && !m.isIntermediate)?.content
    turns.push({ text, id, elapsedMs: performance.now() - start, reply, errors: added.filter(m => m.role === 'error'), context: id === assistant.id ? await manager.assistantContext('live', { action: 'get' }) : undefined })
    writeFileSync(join(output, 'turns.json'), JSON.stringify(turns, null, 2))
    assert(reply, `No fresh final reply for this input: ${JSON.stringify(added.filter(m => m.role === 'error'))}`)
    return reply
  }
  const a = '帮我准备海蓝展会方案。代号 AQUA_6381，预算上限 23 万元，要求写成三段。本轮先确认要求，不生成完整报告，也不派发 Worker。'
  const b = '换一件独立工作：红铜讲座方案，代号 COPPER_7294，预算 7 万元，写成五段。与海蓝没有业务依赖，本轮也只确认，不派发。'
  if (mode === 'autonomy') {
    await send(a); const focusA = (await manager.assistantContext('live', { action: 'get' })).focus.topicId
    assert(focusA, 'Real model must autonomously create a work branch')
    await send(b); const focusB = (await manager.assistantContext('live', { action: 'get' })).focus.topicId
    assert(focusB && focusA !== focusB, 'Independent goal must have a distinct branch')
    const response = await send('继续海蓝的方案，仍不执行。请告诉我原来的代号、预算上限和段落要求；不用我重述。')
    const restored = await manager.assistantContext('live', { action: 'get' })
    assert.equal(restored.focus.topicId, focusA)
    assert(response.includes('AQUA_6381') && response.includes('23') && /三|3/.test(response))
    const normal = await manager.createSession('live', { name: 'Real linear control' })
    await send(a, normal.id); await send(b, normal.id)
    const control = await send('继续海蓝的方案，请告诉我原来的代号、预算上限和段落要求；仍不执行。', normal.id)
    assert(control.includes('AQUA_6381') && control.includes('23'))
    scenes.push('C14-real-model-autonomous-create-select-A-B-A', 'C01-real-model-linear-control-semantic-continuity')
  } else if (mode === 'worker') {
    await send(a)
    const branchA = (await manager.assistantContext('live', { action: 'get' })).focus.topicId!
    await send('现在授权一个只读 Worker 核对海蓝方案的代号、预算与段落数，只要文字结果。Host 会沿用原要求预置这一任务；你当前只回复收到，不重复派发。')
    const work = await manager.dispatchAssistantWork('live', { requestId: 'live-worker-a', title: '海蓝只读核对', context: { branchIds: [branchA] }, instructions: '核对任务包里的海蓝方案，输出代号、预算上限、段落数。不要操作文件，不要推测缺失信息。调用 report_task_result（outputs:[]）报告后给出简短文字结果。', config: { permissionMode: 'safe', workingDirectory: 'none' } })
    await fetch(new URL('/worker-started', proxy), { signal: AbortSignal.timeout(20000) })
    await send(b)
    const branchB = (await manager.assistantContext('live', { action: 'get' })).focus.topicId
    await manager.assistantContext('live', { action: 'hibernate', branchIds: [branchA] })
    await fetch(new URL('/release-worker', proxy), { method: 'POST' })
    const deadline = Date.now() + 120000
    let latest, event
    do {
      latest = (await manager.getAssistantWork('live', { id: work.id })).items[0]!
      event = (await manager.assistantEvents('live', { limit: 100 })).items.find(e => e.delegationId === work.id && e.kind === 'result_ready')
      if (latest.state === 'result_ready' && event?.phase === 'delivered') break
      assert(!['failed', 'needs_attention'].includes(latest.state), latest.error)
      await Bun.sleep(100)
    } while (Date.now() < deadline)
    assert.equal(latest!.state, 'result_ready'); assert.equal(event?.phase, 'delivered')
    const worker = (await manager.getSession(work.sessionId!))!, answer = worker.messages.findLast(m => m.role === 'assistant' && !m.isIntermediate)?.content ?? ''
    assert(answer.includes('AQUA_6381') && answer.includes('23')); assert(!answer.includes('COPPER_7294'))
    assert.equal((await manager.assistantContext('live', { action: 'get' })).focus.topicId, branchB)
    writeFileSync(join(output, 'worker-evidence.json'), JSON.stringify({ work: latest, worker, event }, null, 2))
    scenes.push('C07-real-model-worker-executes-only-task-material', 'C12-real-model-late-delivery-retains-original-work')
  } else if (mode === 'checkpoint') {
    await send(a)
    const branchA = (await manager.assistantContext('live', { action: 'get' })).focus.topicId!
    assert(branchA)
    await send('海蓝的段落要求修正为两段，其余原要求保持。只确认，不执行。')
    const checkpointReply = await send('请为海蓝保存一个恢复点，然后让这项工作休眠。保留已确认的要求、未决项和下一步；没有执行结果，也不要标记任务完成。')
    // Static import would load server-core before this fixture writes its isolated config.
    const { SessionContext } = await import('../../../packages/server-core/src/context/session-context')
    const context = new SessionContext(workspace, assistant.id, manager.getAssistantMemoryStore('live'))
    const checkpoint = context.checkpoint(branchA), sleeping = context.branch(branchA)
    assert(checkpoint?.coverage.length && sleeping.state === 'dormant')
    assert(!/没有保存|未保存|没能保存|保存失败/.test(checkpointReply), `Checkpoint reply contradicts the committed checkpoint: ${checkpointReply}`)
    assert(/恢复点|检查点/.test(checkpointReply) && /保存|记录|建立/.test(checkpointReply), `Checkpoint reply must acknowledge the saved checkpoint: ${checkpointReply}`)
    assert(checkpointReply.includes('两段'), `Checkpoint reply must retain the corrected requirement: ${checkpointReply}`)
    writeFileSync(join(output, 'checkpoint-evidence.json'), JSON.stringify({ checkpoint, sleeping, reply: checkpointReply }, null, 2)); context.close()
    await send(b)
    const reply = await send('接回休眠的海蓝工作，只告诉我当前代号、预算上限、段落数和仍待确定的事项。保持未执行状态。')
    assert(reply.includes('AQUA_6381') && reply.includes('23') && reply.includes('两段'))
    assert.equal((await manager.assistantContext('live', { action: 'get' })).focus.topicId, branchA)
    scenes.push('C09-real-model-checkpoint-sleep-restores-corrected-original-requirements')
  } else {
    await send(a); const branchA = (await manager.assistantContext('live', { action: 'get' })).focus.topicId!
    await send(b); const branchB = (await manager.assistantContext('live', { action: 'get' })).focus.topicId!
    assert(branchA && branchB && branchA !== branchB)
    await send('同时补充两项工作：海蓝的段落数改为两段；红铜的段落数改为四段。其余原要求全部保持，预算、代号不变。仍不执行。请分别确认当前有效要求。')
    const state = await manager.assistantContext('live', { action: 'get' })
    assert(state.activeSegment?.branchIds?.includes(branchA) && state.activeSegment.branchIds.includes(branchB), 'Real model must choose both works for the mixed input')
    const { SessionContext } = await import('../../../packages/server-core/src/context/session-context')
    const memory = manager.getAssistantMemoryStore('live'), metadata = new SessionContext(workspace, assistant.id, memory)
    const requirements = (branchId: string) => metadata.associations(branchId).filter(ref => ref.role === 'requirement').map(ref => {
      const source = memory.readSource({ ...ref, expectedContentHash: ref.contentHash })
      return source.content.slice(ref.range?.offset ?? 0, ref.range?.end ?? source.content.length)
    }).join('\n')
    const effectiveA = requirements(branchA), effectiveB = requirements(branchB); metadata.close()
    writeFileSync(join(output, 'effective-requirements.json'), JSON.stringify({ branchA, branchB, effectiveA, effectiveB }, null, 2))
    assert(effectiveA.includes('AQUA_6381') && effectiveA.includes('23') && effectiveA.includes('两段'))
    assert(!effectiveA.includes('写成三段') && !effectiveA.includes('COPPER_7294'))
    assert(effectiveB.includes('COPPER_7294') && effectiveB.includes('7') && effectiveB.includes('四段'))
    assert(!effectiveB.includes('写成五段') && !effectiveB.includes('AQUA_6381'))
    const answer = await send('只继续海蓝。请依据当前有效要求，回答代号、预算上限和段落数。不要混入红铜，也不要执行。')
    assert(answer.includes('AQUA_6381') && answer.includes('23') && answer.includes('两段'))
    scenes.push('C05-real-model-multiwork-partial-corrections-preserve-other-requirements', 'C04-real-model-mixed-input-associations-restore-one-work')
  }
  writeFileSync(join(output, 'live-evidence.json'), JSON.stringify({ scenes, turns, assistant: await manager.getSession(assistant.id) }, null, 2))
} finally { await host.stop() }
