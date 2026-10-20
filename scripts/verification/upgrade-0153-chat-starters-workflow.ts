#!/usr/bin/env bun
/**
 * Workspace Chat Starters acceptance (CS-01…CS-07).
 *
 * Two layers, both real:
 *   1. the settings RPC that stores the starters — validation, immediate read
 *      back, persistence across a fresh config load, workspace isolation and
 *      "nothing is written when the payload is rejected";
 *   2. the shipped click resolver the chips use (`resolveChatStarterAction`),
 *      which decides which sources to enable and which skills ride along on the
 *      send, including the "unknown mention does nothing" case.
 *
 * The chips are DOM components; pointer/keyboard interaction in a real window is
 * recorded as untested here rather than claimed (see `untested`).
 *
 * Usage: bun run scripts/verification/upgrade-0153-chat-starters-workflow.ts
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VerificationRun } from './verification-artifacts'

const root = resolve(import.meta.dir, '../..')
const evidence = new VerificationRun('upgrade-0153-chat-starters')
const scenes: string[] = []
let failure: unknown

type RpcServer = import('@phaneris/server-core/transport').RpcServer
type HandlerFn = import('@phaneris/server-core/transport').HandlerFn
type HandlerDeps = import('@phaneris/server-core/handlers').HandlerDeps

try {
  evidence.checkArguments()

  // Isolated profile with two workspaces, so isolation is a real difference.
  const home = mkdtempSync(join(tmpdir(), 'phaneris-starters-'))
  const configDir = join(home, 'config')
  mkdirSync(configDir, { recursive: true })
  const workspaceA = join(home, 'workspace-a')
  const workspaceB = join(home, 'workspace-b')
  for (const workspace of [workspaceA, workspaceB]) {
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, 'config.json'), JSON.stringify({
      id: `ws_${workspace.endsWith('a') ? 'a' : 'b'}`,
      name: workspace.endsWith('a') ? 'Alpha' : 'Beta',
      slug: workspace.endsWith('a') ? 'ws-a' : 'ws-b',
      defaults: { permissionMode: 'safe', cyclablePermissionModes: ['safe', 'allow-all'], enabledSourceSlugs: [] },
      localMcpServers: { enabled: true },
      createdAt: Date.now(), updatedAt: Date.now(),
    }))
  }
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [
      { id: 'ws-a', name: 'Alpha', rootPath: workspaceA },
      { id: 'ws-b', name: 'Beta', rootPath: workspaceB },
    ],
    activeWorkspaceId: 'ws-a',
    llmConnections: [],
  }))
  process.env.PHANERIS_CONFIG_DIR = configDir
  process.env.NODE_ENV = 'test'
  process.env.HOME = home
  process.env.USERPROFILE = home

  const { RPC_CHANNELS } = await import('@phaneris/shared/protocol')
  const { registerSettingsHandlers } = await import('@phaneris/server-core/handlers/rpc/settings')
  const { MAX_CHAT_STARTERS, MAX_CHAT_STARTER_LABEL_LENGTH, MAX_CHAT_STARTER_PROMPT_LENGTH } = await import('@phaneris/shared/workspaces')
  const { resolveChatStarterAction } = await import('../../apps/electron/src/renderer/lib/chat-starter-action')

  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
    sessionManager: { async waitForInit() {}, getSessions: () => [] },
    oauthFlowStore: {},
    platform: {
      appRootPath: '/', resourcesPath: '/', isPackaged: false, appVersion: 'verification', isDebugMode: true,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
    windowManager: { getWorkspaceForWindow: () => 'ws-a' },
  } as unknown as HandlerDeps
  registerSettingsHandlers(server, deps)
  const getSettings = handlers.get(RPC_CHANNELS.workspace.SETTINGS_GET)
  const updateSetting = handlers.get(RPC_CHANNELS.workspace.SETTINGS_UPDATE)
  assert(getSettings && updateSetting, 'workspace settings RPC must be registered')

  const readStarters = async (workspaceId: string) => {
    const settings = await getSettings({ clientId: 'v', workspaceId, webContentsId: 1 }, workspaceId) as { chatStarters?: Array<{ label: string; prompt: string }> }
    return settings.chatStarters ?? []
  }
  const writeStarters = (workspaceId: string, value: unknown) =>
    updateSetting({ clientId: 'v', workspaceId, webContentsId: 1 }, workspaceId, 'chatStarters', value)
  const configPath = (workspace: string) => join(workspace, 'config.json')
  const configBytes = (workspace: string) => readFileSync(configPath(workspace), 'utf8')

  // --- CS-01/02/03: shape, count and blank-input validation ----------------
  assert.deepEqual(await readStarters('ws-a'), [], 'a fresh workspace has no starters')

  const one = [{ label: 'Summarize inbox', prompt: 'Summarize my unread mail [source:gmail]' }]
  await writeStarters('ws-a', one)
  assert.deepEqual(await readStarters('ws-a'), one, 'one starter saves and reads back')

  const three = [
    { label: 'One', prompt: 'First prompt' },
    { label: 'Two', prompt: 'Second prompt' },
    { label: 'Three', prompt: 'Third prompt' },
  ]
  await writeStarters('ws-a', three)
  assert.deepEqual(await readStarters('ws-a'), three, 'three starters save and read back')

  const rejections: { name: string; payload: unknown; pattern: RegExp }[] = [
    { name: 'over the cap', payload: [...three, { label: 'Four', prompt: 'Fourth' }], pattern: /At most 3/ },
    { name: 'not a list', payload: { label: 'x', prompt: 'y' }, pattern: /must be a list/ },
    { name: 'blank label', payload: [{ label: '   ', prompt: 'x' }], pattern: /empty label/ },
    { name: 'blank prompt', payload: [{ label: 'x', prompt: '   ' }], pattern: /empty prompt/ },
    { name: 'missing prompt', payload: [{ label: 'x' }], pattern: /needs a text label and prompt/ },
    { name: 'non-string label', payload: [{ label: 5, prompt: 'x' }], pattern: /needs a text label and prompt/ },
    { name: 'label too long', payload: [{ label: 'x'.repeat(MAX_CHAT_STARTER_LABEL_LENGTH + 1), prompt: 'x' }], pattern: /label is longer/ },
    { name: 'prompt too long', payload: [{ label: 'x', prompt: 'x'.repeat(MAX_CHAT_STARTER_PROMPT_LENGTH + 1) }], pattern: /prompt is longer/ },
  ]
  const beforeRejections = configBytes(workspaceA)
  for (const rejection of rejections) {
    let message = ''
    try { await writeStarters('ws-a', rejection.payload) } catch (error) { message = error instanceof Error ? error.message : String(error) }
    assert.match(message, rejection.pattern, `${rejection.name} must be rejected with a readable error (got "${message}")`)
  }
  assert.equal(configBytes(workspaceA), beforeRejections, 'a rejected payload must not modify the stored config')
  assert.deepEqual(await readStarters('ws-a'), three, 'the previous value survives rejected writes')

  // Unknown fields are dropped rather than stored.
  await writeStarters('ws-a', [{ label: 'Trimmed', prompt: '  text  ', extra: 'nope' }])
  const trimmed = await readStarters('ws-a')
  assert.deepEqual(trimmed, [{ label: 'Trimmed', prompt: 'text' }], 'values are trimmed and unknown keys dropped')
  scenes.push('validation-accepts-0-1-3-and-rejects-malformed')

  // --- CS-05: persistence across a fresh config load and workspace isolation
  await writeStarters('ws-a', three)
  await writeStarters('ws-b', [{ label: 'Beta only', prompt: 'Beta prompt' }])
  assert.deepEqual(await readStarters('ws-a'), three)
  assert.deepEqual(await readStarters('ws-b'), [{ label: 'Beta only', prompt: 'Beta prompt' }],
    'starters must not leak between workspaces')
  // A second process would re-read the file from disk; emulate that by reading the
  // stored JSON directly and re-validating it through the same reader.
  const stored = JSON.parse(configBytes(workspaceA)) as { chatStarters?: unknown }
  assert.deepEqual(stored.chatStarters, three, 'starters live at the top level of the workspace config')
  const { readChatStarters } = await import('@phaneris/shared/workspaces')
  assert.deepEqual(readChatStarters(stored.chatStarters), three, 'the stored value reloads after a restart')
  // A stored value that no longer validates reads as "none" rather than crashing.
  assert.deepEqual(readChatStarters([{ label: '', prompt: '' }]), [])
  scenes.push('persistence-and-workspace-isolation')

  // --- CS-01 (clear) / CS-03 (immediate read-back) ------------------------
  await writeStarters('ws-a', [])
  assert.deepEqual(await readStarters('ws-a'), [], 'an empty list clears the starters')
  assert.equal(JSON.parse(configBytes(workspaceA)).chatStarters, undefined, 'clearing removes the key')
  scenes.push('empty-list-clears-the-field')

  // --- CS-06/CS-07: what a click enables and sends ------------------------
  const prompt = 'Review the open pull requests [source:github] [skill:review-prs]'
  const action = resolveChatStarterAction({
    prompt,
    availableSources: ['github', 'gmail'],
    availableSkills: ['review-prs'],
    enabledSources: [],
  })
  assert.equal(action.prompt, prompt, 'the starter prompt is sent verbatim')
  assert.deepEqual(action.enableSources, ['github'], 'the mentioned source is enabled')
  assert.deepEqual(action.skillSlugs, ['review-prs'], 'the mentioned skill rides on the send')

  const alreadyEnabled = resolveChatStarterAction({
    prompt, availableSources: ['github'], availableSkills: ['review-prs'], enabledSources: ['github'],
  })
  assert.deepEqual(alreadyEnabled.enableSources, [], 'an already enabled source is not re-enabled')

  const stale = resolveChatStarterAction({
    prompt: 'Use [source:deleted] and [skill:gone]',
    availableSources: ['github'],
    availableSkills: ['review-prs'],
    enabledSources: [],
  })
  assert.deepEqual(stale, { prompt: 'Use [source:deleted] and [skill:gone]', enableSources: [], skillSlugs: [] },
    'mentions of things the workspace no longer has resolve to nothing')

  const plain = resolveChatStarterAction({ prompt: 'Just a question', availableSources: [], availableSkills: [], enabledSources: [] })
  assert.deepEqual(plain, { prompt: 'Just a question', enableSources: [], skillSlugs: [] })

  evidence.json('chat-starters.json', {
    limits: {
      maxStarters: MAX_CHAT_STARTERS,
      maxLabel: MAX_CHAT_STARTER_LABEL_LENGTH,
      maxPrompt: MAX_CHAT_STARTER_PROMPT_LENGTH,
    },
    accepted: { one: one.length, three: three.length },
    rejections: rejections.map(rejection => rejection.name),
    stored: { workspaceA: three.length, workspaceB: 1, afterClear: 'removed' },
    click: { action, alreadyEnabled, stale, plain },
    workspaceConfigExisted: existsSync(configPath(workspaceA)),
  })
  evidence.json('settings-read.json', { api: 'workspace.SETTINGS_GET/UPDATE', storedStarters: three })
  scenes.push('click-resolves-sources-and-skills-with-unknowns-ignored')

  evidence.complete(scenes, [
    'pointer, keyboard and focus behaviour of the chips in a real Electron window',
    'macOS/Linux execution',
    'a live model turn triggered by a starter (the send path itself is covered by the Pi workflows)',
  ])
} catch (error) { failure = error }
evidence.json('summary.json', { scenes })
evidence.finish(failure)
console.log(JSON.stringify({ passed: scenes.length, output: evidence.directory }))
