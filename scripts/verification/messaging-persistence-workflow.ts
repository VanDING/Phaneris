#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, renameSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Before implementation: every failed mutation must throw, preserve committed
// memory/disk and emit no success notification. Lockdown bulk-commits bindings
// before platform config; either write can fail and an identical retry completes.
await verificationWorkflow('messaging-persistence', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { BindingStore } = await import('../../packages/messaging-gateway/src/binding-store')
  const { ConfigStore } = await import('../../packages/messaging-gateway/src/config-store')
  const { MessagingGatewayRegistry } = await import('../../packages/messaging-gateway/src/registry')
  const { evaluateBindingAccess } = await import('../../packages/messaging-gateway/src/access-control')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { getCredentialManager } = await import('../../packages/shared/src/credentials')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { registerMessagingHandlers } = await import('../../packages/server-core/src/handlers/rpc/messaging')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => void | Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  const block = (path: string) => {
    assert(path.startsWith(run.directory + '\\') || path.startsWith(run.directory + '/'))
    renameSync(path, `${path}.saved`); mkdirSync(path)
    return () => { rmdirSync(path); renameSync(`${path}.saved`, path) }
  }
  const mutations = ['bind', 'update', 'unbind', 'unbindById', 'unbindSession'] as const
  for (const operation of mutations) await scene(`binding-${operation}-failure-preserves-commit`, () => {
    const directory = join(run.directory, `binding-${operation}`), store = new BindingStore(directory)
    const binding = store.bind('ws', 'session', 'telegram', 'channel', undefined, { accessMode: 'open' }, 123)
    let notifications = 0; store.onChange(() => notifications++)
    const original = store.getAll(), disk = readFileSync(join(directory, 'bindings.json'), 'utf8')
    const restore = block(join(directory, 'bindings.json'))
    try {
      assert.throws(() => {
        if (operation === 'bind') store.bind('ws', 'replacement', 'telegram', 'channel', undefined, undefined, 123)
        else if (operation === 'update') store.updateBindingConfig(binding.id, { accessMode: 'allow-list', allowedSenderIds: ['invited'] })
        else if (operation === 'unbind') store.unbind('telegram', 'channel', 123)
        else if (operation === 'unbindById') store.unbindById(binding.id)
        else store.unbindSession('session')
      })
      assert.deepEqual(store.getAll(), original)
      assert.equal(notifications, 0)
    } finally { restore() }
    assert.equal(readFileSync(join(directory, 'bindings.json'), 'utf8'), disk)
    assert.deepEqual(new BindingStore(directory).getAll(), JSON.parse(JSON.stringify(original)))
    store.updateBindingConfig(binding.id, { accessMode: 'allow-list', allowedSenderIds: ['invited'] })
    assert.equal(notifications, 1)
    assert.equal(new BindingStore(directory).getAll()[0]?.id, binding.id)
  })
  await scene('config-write-failure-preserves-memory-and-restart', () => {
    const directory = join(run.directory, 'config-store'), store = new ConfigStore(directory)
    store.update({ enabled: true })
    const restore = block(join(directory, 'config.json'))
    try { assert.throws(() => store.update({ enabled: false })); assert.equal(store.get().enabled, true) }
    finally { restore() }
    assert.equal(new ConfigStore(directory).get().enabled, true)
    store.update({ enabled: false }); assert.equal(new ConfigStore(directory).get().enabled, false)
  })
  await scene('store-snapshots-cannot-bypass-persistence', () => {
    const directory = join(run.directory, 'snapshots'), bindings = new BindingStore(directory), config = new ConfigStore(directory)
    const first = bindings.bind('ws', 'session', 'telegram', 'channel', undefined, { accessMode: 'open' })
    first.config.accessMode = 'allow-list'
    bindings.getAll()[0]!.config.allowedSenderIds.push('unsaved')
    assert.equal(bindings.findByChannel('telegram', 'channel')?.config.accessMode, 'open')
    assert.deepEqual(bindings.findBySession('session')[0]?.config.allowedSenderIds, [])
    config.update({ platforms: { telegram: { enabled: false, owners: [{ userId: 'owner', addedAt: 1 }] } } })
    config.get().platforms.telegram!.owners!.push({ userId: 'unsaved', addedAt: 2 })
    assert.equal(config.get().platforms.telegram!.owners!.length, 1)
  })
  const manager = new SessionManager(createDurableRuntime()), oauthFlowStore = new OAuthFlowStore(); oauthFlowStore.dispose()
  const directory = join(run.directory, 'registry'), events: string[] = []
  const registry = new MessagingGatewayRegistry({ sessionManager: manager, credentialManager: getCredentialManager(),
    getMessagingDir: () => directory, publishEvent: channel => events.push(channel) })
  registry.getConfig('ws')
  const state = (registry as unknown as { workspaces: Map<string, { configStore: InstanceType<typeof ConfigStore>; gateway: { getBindingStore(): InstanceType<typeof BindingStore> } }> }).workspaces.get('ws')!
  state.configStore.update({ platforms: { telegram: { enabled: false, accessMode: 'open', owners: [{ userId: 'owner', addedAt: 1 }] } } })
  const store = state.gateway.getBindingStore()
  const first = store.bind('ws', 'session', 'telegram', 'one', undefined, { accessMode: 'open' })
  const second = store.bind('ws', 'session', 'telegram', 'two', undefined, { accessMode: 'open' })
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  registerMessagingHandlers(server, { sessionManager: manager, platform: createHeadlessPlatform(), oauthFlowStore, messagingRegistry: registry } satisfies HandlerDeps)
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: 'ws' })
  try {
    await client.connect()
    await scene('rpc-binding-failure-no-false-notification', async () => {
      const before = events.length, restore = block(join(directory, 'bindings.json'))
      try {
        await assert.rejects(client.invoke(c.messaging.SET_BINDING_ACCESS, first.id, { mode: 'allow-list', allowedSenderIds: ['invited'] }))
        assert.equal(events.length, before)
        assert.equal(store.getAll().find(b => b.id === first.id)?.config.accessMode, 'open')
      } finally { restore() }
    })
    await scene('lockdown-binding-write-failure-leaves-platform-unchanged', async () => {
      const restore = block(join(directory, 'bindings.json'))
      try {
        await assert.rejects(client.invoke(c.messaging.SET_PLATFORM_ACCESS_MODE, 'telegram', 'owner-only'))
        assert.equal(registry.getPlatformAccessMode('ws', 'telegram'), 'open')
        assert(store.getAll().every(b => b.config.accessMode === 'open'))
      } finally { restore() }
    })
    await scene('lockdown-config-failure-is-retryable-and-reports-effective-policy', async () => {
      const restore = block(join(directory, 'config.json'))
      try {
        await assert.rejects(client.invoke(c.messaging.SET_PLATFORM_ACCESS_MODE, 'telegram', 'owner-only'), /bindings.*inherit.*platform.*open/i)
        assert(store.getAll().every(b => b.config.accessMode === 'inherit'))
        assert.equal(registry.getPlatformAccessMode('ws', 'telegram'), 'open')
      } finally { restore() }
      await client.invoke(c.messaging.SET_PLATFORM_ACCESS_MODE, 'telegram', 'owner-only')
      assert.equal(new ConfigStore(directory).get().platforms.telegram?.accessMode, 'owner-only')
      assert.deepEqual(new BindingStore(directory).getAll().map(b => b.id), [first.id, second.id])
    })
    await scene('lockdown-batch-has-one-binding-notification', async () => {
      await client.invoke(c.messaging.SET_PLATFORM_ACCESS_MODE, 'telegram', 'open')
      for (const binding of store.getAll()) store.updateBindingConfig(binding.id, { accessMode: 'open' })
      const before = events.length
      await client.invoke(c.messaging.SET_PLATFORM_ACCESS_MODE, 'telegram', 'owner-only')
      assert.equal(events.slice(before).filter(cn => cn === c.messaging.BINDING_CHANGED).length, 2, 'one binding commit + one config commit')
    })
    await scene('committed-policy-allows-invited-and-rejects-stranger', () => {
      store.updateBindingConfig(first.id, { accessMode: 'allow-list', allowedSenderIds: ['invited'] })
      const binding = new BindingStore(directory).getAll().find(b => b.id === first.id)!
      const msg = { platform: 'telegram', senderId: 'invited' } as Parameters<typeof evaluateBindingAccess>[0]['msg']
      assert.equal(evaluateBindingAccess({ msg, workspaceConfig: new ConfigStore(directory).get(), binding }).allow, true)
      assert.equal(evaluateBindingAccess({ msg: { ...msg, senderId: 'stranger' }, workspaceConfig: new ConfigStore(directory).get(), binding }).allow, false)
    })
    run.json('scenarios.json', { checks, failures, events })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['Live external messaging accounts and power-loss durability not exercised'])
  } finally { client.destroy(); await disconnected.promise; server.close(); await registry.stopAll(); await manager.cleanup() }
})
