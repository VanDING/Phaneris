#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createStore } from 'jotai/vanilla'
import { verificationWorkflow } from './verification-artifacts'
import { obstructDirectory } from './fixtures/directory-obstruction'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Before implementation: metadata/settings must not hydrate timelines or erase
// cached messages; cold header edits preserve encoded body bytes, queue ownership
// and failure retry. Legacy GET/SET bridges still return full diagnostic history.
await verificationWorkflow('resident-metadata', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { saveConfig } = await import('../../packages/shared/src/config/repository')
  const { createWorkspaceAtPath } = await import('../../packages/shared/src/workspaces/storage')
  const { saveSession, getSessionFilePath } = await import('../../packages/shared/src/sessions')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { registerResidentAssistantHandlers } = await import('../../packages/server-core/src/handlers/rpc/resident-assistant')
  const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { WsRpcClient } = await import('../../packages/server-core/src/transport/client')
  const { buildClientApi } = await import('../../apps/electron/src/transport/build-api')
  const { CHANNEL_MAP } = await import('../../apps/electron/src/transport/channel-map')
  const { sessionAtomFamily, sessionMetaMapAtom, loadedSessionsAtom, upsertSessionMetadataAtom } = await import('../../apps/electron/src/renderer/atoms/sessions')
  const workspaces = ['alpha', 'beta'].map(id => ({ id, slug: id, name: id, rootPath: join(run.directory, id), createdAt: 1 }))
  for (const ws of workspaces) createWorkspaceAtPath(ws.rootPath, ws.name)
  const ws = workspaces[0]!
  saveConfig({ workspaces, activeWorkspaceId: ws.id, activeSessionId: null })
  const prompt = 'PRESERVED_PROMPT_SNAPSHOT_'.repeat(1000)
  const messages = Array.from({ length: 40 }, (_, index) => ({ id: `reply-${index}`, type: 'assistant' as const,
    timestamp: index + 1, content: `ORIGINAL_REPLY_${index}`, promptSnapshot: prompt }))
  await saveSession({ id: 'resident-cold', workspaceRootPath: ws.rootPath, createdAt: 1, lastUsedAt: 1,
    sessionKind: 'resident_assistant', hidden: true, messages,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } })
  const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  await manager.initialize()
  const originalGet = manager.getSession.bind(manager)
  let fullReads = 0
  manager.getSession = async id => { fullReads++; return originalGet(id) }
  const port = manager as unknown as { sessions: Map<string, { messages: unknown[]; messagesLoaded: boolean; messageCount?: number }>; productRepository: { load: (...args: unknown[]) => unknown } }
  const cold = () => { const managed = port.sessions.get('resident-cold')!; managed.messages = []; managed.messagesLoaded = false; managed.messageCount = messages.length }
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  const deps = { sessionManager: manager, oauthFlowStore, platform: createHeadlessPlatform() } satisfies HandlerDeps
  registerResidentAssistantHandlers(server, deps); registerSessionsHandlers(server, deps)
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: ws.id, autoReconnect: false })
  client.connect()
  const api = buildClientApi(client, CHANNEL_MAP, () => true)
  const file = getSessionFilePath(ws.rootPath, 'resident-cold')
  const body = () => { const bytes = readFileSync(file); return bytes.subarray(bytes.indexOf(10) + 1) }
  const bodyHash = () => createHash('sha256').update(body()).digest('hex')
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  try {
    await scene('new-metadata-and-setting-zero-timeline-loads', async () => {
      cold(); fullReads = 0
      const hash = bodyHash(), originalLoad = port.productRepository.load
      port.productRepository.load = () => { throw new Error('Timeline load forbidden for metadata/settings') }
      try {
        const metadata = await api.getResidentAssistantMetadata(ws.id)
        assert.equal(metadata.id, 'resident-cold'); assert.equal(metadata.messageCount, messages.length)
        assert(!('messages' in metadata))
        assert.equal(await api.changeResidentExecutionMode(ws.id, 'ask'), undefined)
        assert.equal(fullReads, 0); assert.equal(bodyHash(), hash)
        assert.equal(port.sessions.get('resident-cold')!.messagesLoaded, false)
      } finally { port.productRepository.load = originalLoad }
    })
    await scene('legacy-bridges-retain-complete-history', async () => {
      const get = await api.getResidentAssistant(ws.id), set = await api.setAssistantExecutionMode(ws.id, 'safe')
      for (const session of [get, set]) { assert.equal(session.messages.length, messages.length); assert.equal(session.messages.at(-1)?.promptSnapshot, prompt) }
    })
    await scene('unknown-header-count-is-not-zero', async () => {
      cold(); port.sessions.get('resident-cold')!.messageCount = undefined
      assert.equal((await api.getResidentAssistantMetadata(ws.id)).messageCount, undefined)
    })
    await scene('metadata-patch-preserves-cache-and-load-marker', async () => {
      const metadata = await api.getResidentAssistantMetadata(ws.id), store = createStore()
      store.set(upsertSessionMetadataAtom, metadata)
      assert(!store.get(loadedSessionsAtom).has(metadata.id))
      assert.equal(store.get(sessionMetaMapAtom).get(metadata.id)?.messageCount, undefined)
      const complete = await api.getResidentAssistant(ws.id)
      store.set(sessionAtomFamily(metadata.id), complete); store.set(loadedSessionsAtom, new Set([metadata.id]))
      store.set(upsertSessionMetadataAtom, { ...metadata, name: 'Updated identity' })
      assert.equal(store.get(sessionAtomFamily(metadata.id))?.messages.length, messages.length)
      assert(store.get(loadedSessionsAtom).has(metadata.id))
      assert.equal(store.get(sessionMetaMapAtom).get(metadata.id)?.name, 'Updated identity')
    })
    await scene('failed-header-write-preserves-mode-body-and-retry', async () => {
      cold()
      const old = await api.getResidentAssistantMetadata(ws.id), hash = bodyHash()
      const restore = obstructDirectory(join(dirname(file), 'tmp'))
      try {
        await assert.rejects(api.changeResidentExecutionMode(ws.id, 'guarded'))
        assert.equal((await api.getResidentAssistantMetadata(ws.id)).workerPermissionMode, old.workerPermissionMode)
        assert.equal(bodyHash(), hash)
      } finally { restore() }
      await api.changeResidentExecutionMode(ws.id, 'guarded')
      assert.equal((await api.getResidentAssistantMetadata(ws.id)).workerPermissionMode, 'guarded')
    })
    await scene('concurrent-first-identity-is-unique', async () => {
      const identities = await Promise.all(Array.from({ length: 3 }, () => manager.getResidentAssistantMetadata('beta')))
      assert.equal(new Set(identities.map(value => value.id)).size, 1)
      assert.equal(manager.getSessions('beta').filter(value => value.sessionKind === 'resident_assistant').length, 1)
    })
    run.json('scenarios.json', { checks, failures, fullReads, bodySha256: bodyHash() })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['Physical JSONL body bytes are streamed during an atomic header replacement; no message decode or snapshot RPC is needed', 'No paid model or installed user profile'])
  } finally { client.destroy(); await disconnected.promise; server.close(); await manager.cleanup() }
})
