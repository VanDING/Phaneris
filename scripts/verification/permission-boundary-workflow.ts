#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { verificationWorkflow } from './verification-artifacts'
import type { HandlerDeps } from '../../packages/server-core/src/handlers/handler-deps'

// Fixed before production changes. Commands never launch real installers.
// Reject chains, pipelines, redirection, expansion and extra installer operands.
// Responses must preserve foreign requests, consume once, report actual delivery,
// honor expiry/hash, and forward bounded optional remembering over the real wire.
await verificationWorkflow('permission-boundary', async run => {
  process.env.PHANERIS_CONFIG_DIR = join(run.directory, 'config')
  const { SessionManager } = await import('../../packages/server-core/src/sessions/SessionManager')
  const { createDurableRuntime } = await import('../../packages/server-core/src/durable-runtime')
  const { PrivilegedExecutionBroker } = await import('../../packages/server-core/src/services/privileged-execution-broker')
  const { runPreToolUseChecks } = await import('../../packages/shared/src/agent/core/pre-tool-use')
  const { PermissionManager } = await import('../../packages/shared/src/agent/core/permission-manager')
  const { PiAgent } = await import('../../packages/shared/src/agent/pi-agent')
  const { registerSessionsHandlers } = await import('../../packages/server-core/src/handlers/rpc/sessions')
  const { createHeadlessPlatform } = await import('../../packages/server-core/src/runtime/platform-headless')
  const { WsRpcServer } = await import('../../packages/server-core/src/transport/server')
  const { CliRpcClient } = await import('../../apps/cli/src/client')
  const { RPC_CHANNELS: c } = await import('../../packages/shared/src/protocol')
  const { OAuthFlowStore } = await import('../../packages/shared/src/auth')
  const oauthFlowStore = new OAuthFlowStore()
  oauthFlowStore.dispose()
  const manager = new SessionManager(createDurableRuntime())
  const state = manager as unknown as {
    sessions: Map<string, unknown>
    pendingPermissionRequests: Map<string, { sessionId: string; type: string; commandHash?: string }>
    privilegedExecutionBroker: InstanceType<typeof PrivilegedExecutionBroker>
    hasActiveAdminRememberApproval(sessionId: string, hash: string): boolean
  }
  const platform = createHeadlessPlatform()
  const broker = state.privilegedExecutionBroker
  const deliveries: Array<{ sessionId: string; requestId: string; allowed: boolean }> = []
  for (const id of ['permission-a', 'permission-b']) state.sessions.set(id, { id, workspace: { id: 'permissions' }, runtime: { agent: {
    respondToPermission(requestId: string, allowed: boolean) { deliveries.push({ sessionId: id, requestId, allowed }); return requestId !== 'gone-in-agent' },
  } } })
  const seed = (requestId: string, sessionId = 'permission-b', ttl = 120) => {
    const request = broker.createRequest({ requestId, sessionId, command: 'brew install --cask fixture', approvalTtlSeconds: ttl })
    state.pendingPermissionRequests.set(requestId, { sessionId, type: 'admin_approval', commandHash: request.commandHash })
    return request
  }
  const checks: string[] = [], failures: Array<{ id: string; error: string }> = []
  const scene = async (id: string, verify: () => void | Promise<void>) => {
    try { await verify(); checks.push(id) }
    catch (error) { failures.push({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
  }
  const token = crypto.randomUUID(), disconnected = Promise.withResolvers<void>()
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async value => value === token,
    onClientDisconnected: () => disconnected.resolve() })
  registerSessionsHandlers(server, { platform, sessionManager: manager, oauthFlowStore } satisfies HandlerDeps)
  await server.listen()
  const client = new CliRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: 'permissions' })
  const respond = (sessionId: string, requestId: string, allowed = true, options?: object) =>
    client.invoke(c.sessions.RESPOND_TO_PERMISSION, sessionId, requestId, allowed, false, ...(options ? [options] : []))
  try {
    await client.connect()
    const valid = ['brew install --cask fixture', 'brew upgrade --cask fixture', 'installer -pkg "/tmp/Example App.pkg" -target /']
    for (const [index, command] of valid.entries()) await scene(`valid-policy-${index}`, () => {
      const request = broker.createRequest({ requestId: `valid-${index}`, sessionId: 'permission-b', command })
      assert(broker.resolveApproval(request.requestId, true).ok)
    })
    const invalid = ['brew install --cask fixture && echo extra', 'brew upgrade --cask fixture; echo extra',
      'brew install --cask fixture | cat', 'brew install --cask fixture > output',
      'brew install --cask $(echo fixture)', 'brew install --cask fixture\necho extra',
      'installer -pkg /tmp/example.pkg -target / && echo extra', 'installer -pkg /tmp/example.pkg -target / extra']
    for (const [index, command] of invalid.entries()) await scene(`reject-compound-policy-${index}`, () => {
      const decision = runPreToolUseChecks({ toolName: 'Bash', input: { command }, workspaceRootPath: run.directory,
        workspaceId: 'permissions', sessionId: 'permission-b', permissionMode: 'ask', activeSourceSlugs: [], allSourceSlugs: [], hasSourceActivation: false,
        permissionManager: new PermissionManager({ sessionId: 'permission-b' }) })
      assert(!(decision.type === 'prompt' && decision.promptType === 'admin_approval'))
      const request = broker.createRequest({ requestId: `invalid-${index}`, sessionId: 'permission-b', command })
      assert.equal(broker.resolveApproval(request.requestId, true).ok, false)
    })
    await scene('wrong-session-cannot-consume-request', async () => {
      seed('owned')
      assert.equal(await respond('permission-a', 'owned'), false)
      assert(state.pendingPermissionRequests.has('owned'))
      assert.equal(await respond('permission-b', 'owned'), true)
      assert.equal(await respond('permission-b', 'owned'), false)
      assert.equal(deliveries.filter(d => d.requestId === 'owned').length, 1)
    })
    await scene('unknown-agent-request-is-not-delivered', async () => {
      const before = deliveries.length
      assert.equal(await respond('permission-b', 'unknown'), false)
      assert.equal(deliveries.length, before)
      seed('gone-in-agent')
      assert.equal(await respond('permission-b', 'gone-in-agent'), false)
    })
    await scene('expired-admin-request-fails-closed', async () => {
      seed('expired', 'permission-b', -1)
      assert.equal(await respond('permission-b', 'expired'), false)
      assert.equal(deliveries.find(d => d.requestId === 'expired')?.allowed, false)
    })
    await scene('hash-mismatch-does-not-consume-approval', () => {
      const request = seed('hash')
      assert.equal(broker.resolveApproval('hash', true, { expectedCommandHash: 'wrong' }).ok, false)
      assert.equal(broker.resolveApproval('hash', true, { expectedCommandHash: request.commandHash }).ok, true)
      state.pendingPermissionRequests.delete('hash')
    })
    await scene('remember-options-forwarded-and-scoped', async () => {
      const request = seed('remember')
      assert.equal(await respond('permission-b', request.requestId, true, { rememberForMinutes: 10 }), true)
      assert(state.hasActiveAdminRememberApproval('permission-b', request.commandHash))
      assert(!state.hasActiveAdminRememberApproval('permission-a', request.commandHash))
      assert(!state.hasActiveAdminRememberApproval('permission-b', 'another-command'))
    })
    await scene('invalid-remember-options-rejected-before-consumption', async () => {
      seed('invalid-remember')
      for (const rememberForMinutes of [-1, 0, 61, '10']) {
        await assert.rejects(respond('permission-b', 'invalid-remember', true, { rememberForMinutes }))
        assert(state.pendingPermissionRequests.has('invalid-remember'))
      }
      assert.equal(await respond('permission-b', 'invalid-remember', false), true)
    })
    await scene('pi-reports-real-delivery', () => {
      const pendingPermissions = new Map([['pending', { resolve: (allowed: boolean) => assert.equal(allowed, true) }]])
      const port = { pendingPermissions } as unknown as InstanceType<typeof PiAgent>
      assert.equal(PiAgent.prototype.respondToPermission.call(port, 'missing', true), false)
      assert.equal(PiAgent.prototype.respondToPermission.call(port, 'pending', true), true)
      assert.equal(PiAgent.prototype.respondToPermission.call(port, 'pending', true), false)
    })
    await scene('mac-wrapper-quotes-validated-argv', async () => {
      const { parsePrivilegedCommand, buildMacAdminCommand } = await import('../../packages/shared/src/agent/privileged-command')
      const parsed = parsePrivilegedCommand(`installer -pkg "/tmp/Example's App.pkg" -target /`)
      assert(parsed)
      const bash = process.env.PHANERIS_TEST_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
      // bash-parser truncates adjacent quoted fragments. A real shell and an
      // inert function verify the wrapper without invoking osascript/installer.
      const wrapper = spawnSync(bash, ['--noprofile', '--norc', '-s'], { encoding: 'utf8',
        input: `osascript() { printf '%s\\0' "$@"; }\n${buildMacAdminCommand(parsed)}\n` })
      assert.equal(wrapper.status, 0, wrapper.stderr)
      const argv = wrapper.stdout.split('\0').filter(Boolean)
      assert.equal(argv[0], '-e')
      assert.equal(argv.length, 2)
      const script = argv[1]!
      assert(script.endsWith(' with administrator privileges'))
      const shell = JSON.parse(script.slice('do shell script '.length, -' with administrator privileges'.length)) as string
      const inner = spawnSync(bash, ['--noprofile', '--norc', '-s'], { encoding: 'utf8',
        input: `installer() { printf '%s\\0' "$@"; }\n${shell}\n` })
      assert.equal(inner.status, 0, inner.stderr)
      assert.deepEqual(inner.stdout.split('\0').filter(Boolean), parsed.argv.slice(1))
      run.json('mac-shell-roundtrip.json', { wrapperArguments: argv, installerArguments: inner.stdout.split('\0').filter(Boolean) })
    })
    run.json('scenarios.json', { checks, failures, deliveries })
    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
    run.complete(checks, ['macOS native administrator prompt and system refusal require macOS',
      'Host permission callback is a delivery recorder; Pi resolver itself is exercised without a paid model'])
  } finally {
    client.destroy(); await disconnected.promise; server.close()
    state.sessions.clear()
    await manager.cleanup()
  }
})
