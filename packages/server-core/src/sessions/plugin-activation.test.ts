/**
 * Plugin activation, end to end through SessionManager.
 *
 * The load-bearing property here is **P9-3**: activating a plugin must not cost
 * a turn. The design says plugin-contributed sources are enabled by writing
 * `enabledSourceSlugs` — the same pre-turn path the skill-source pre-enable uses
 * — rather than by runtime source activation, which force-aborts the in-flight
 * turn so a subprocess can re-read its proxy tools (`AbortReason.SourceActivated`,
 * `pi-agent.ts`).
 *
 * These tests pin that difference rather than restating it: they drive the real
 * `setSessionActivePlugin`, and assert that the agent was never aborted and that
 * no `source_activated` event was emitted. A future change that "simplifies"
 * activation by routing it through the runtime path would fail here instead of
 * silently costing every plugin activation a discarded turn.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'
import { PLUGIN_MANIFEST_SCHEMA } from '@phaneris/shared/plugins/types'

const PLUGIN_NAME = 'market-analyst'

/**
 * `mcp.json` in Agent Plugins 1.0.0 wraps server entries under `mcpServers` and
 * discriminates on `type` — not the flatter `transport` shape the source config
 * uses internally. Getting this wrong makes every server look unsupported, so
 * the helpers below keep the fixture honest.
 */
function mcpServers(entries: Record<string, Record<string, unknown>>) {
  return { mcpServers: entries }
}

function stdioServer(command = 'node'): Record<string, unknown> {
  return { type: 'stdio', command }
}

function httpServer(url = 'https://example.test/mcp'): Record<string, unknown> {
  // A fixed non-secret header is what makes the materialized source
  // *credential-bearing*: `buildMcpSourceConfig` maps `headers` present →
  // `authType: 'bearer'`, and a bearer source is only usable once authenticated.
  // A headerless HTTP server would be public and therefore always usable.
  return { type: 'streamable-http', url, headers: { 'X-Api-Key': '${API_KEY}' } }
}

interface EmittedEvent {
  channel: string
  payload: unknown
}

/**
 * `SessionManager.eventSink` has two distinct call shapes, and the tests need
 * both:
 *   - `sendEvent`              → (channel, target, event)          — 3 args
 *   - `broadcast*Changed`      → (channel, target, scope, payload) — 4 args
 * Recording the last argument as the payload gets the session events wrong
 * (their payload is the 3rd arg), which reads as "the event was never emitted".
 */
function recordEmit(emitted: EmittedEvent[]) {
  return (...args: unknown[]) => {
    emitted.push({
      channel: String(args[0]),
      payload: args.length >= 4 ? args[3] : args[2],
    })
  }
}

/** Minimal stand-in for the live agent: SessionManager only reads its config. */
function createAgentStub() {
  const stub = {
    aborts: [] as string[],
    config: { session: { activePlugin: undefined as string | undefined } },
    forceAbort(reason: string) {
      stub.aborts.push(reason)
    },
  }
  return stub
}

describe('setSessionActivePlugin (D12 single slot, P9-3 no restart)', () => {
  let root: string
  let sm: SessionManager
  let emitted: EmittedEvent[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sm-plugin-activate-'))
    sm = new SessionManager()
    emitted = []
    // Capture pushes instead of standing up a real transport. The channel name is
    // what the assertions care about.
    ;(sm as unknown as { eventSink: (...args: unknown[]) => void }).eventSink = recordEmit(emitted)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Write `plugins/<name>/plugin.json` plus whatever else the case needs. */
  function writePlugin(files: {
    manifest?: Record<string, unknown>
    mcp?: Record<string, unknown>
    prompt?: string
  } = {}): string {
    const pluginRoot = join(root, 'plugins', PLUGIN_NAME)
    mkdirSync(pluginRoot, { recursive: true })
    writeFileSync(
      join(pluginRoot, 'plugin.json'),
      JSON.stringify({
        $schema: PLUGIN_MANIFEST_SCHEMA,
        name: PLUGIN_NAME,
        description: 'Equity research and modeling',
        ...files.manifest,
      }),
      'utf-8',
    )
    if (files.mcp) {
      writeFileSync(join(pluginRoot, 'mcp.json'), JSON.stringify(files.mcp), 'utf-8')
    }
    if (files.prompt) {
      writeFileSync(join(pluginRoot, 'PROMPT.md'), files.prompt, 'utf-8')
    }
    return pluginRoot
  }

  /** Materialize a workspace source, i.e. what an install leaves behind. */
  function writeSource(slug: string, options: { authenticated?: boolean } = {}): void {
    const sourceDir = join(root, 'sources', slug)
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(
      join(sourceDir, 'config.json'),
      JSON.stringify({
        id: `${slug}_test`,
        name: slug,
        slug,
        enabled: true,
        provider: 'test',
        type: 'mcp',
        mcp: { transport: 'stdio', command: 'node', args: ['server.js'] },
        isAuthenticated: options.authenticated,
      }),
      'utf-8',
    )
  }

  /** Give an already-written source a bearer requirement, i.e. "needs a credential". */
  function markSourceBearer(slug: string): void {
    const configPath = join(root, 'sources', slug, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    config.mcp = { ...config.mcp, authType: 'bearer' }
    writeFileSync(configPath, JSON.stringify(config), 'utf-8')
  }

  function buildSession(id: string, agent = createAgentStub()) {    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: root,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'plugin activation test' },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.agent = agent as never
    managed.enabledSourceSlugs = []
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return { managed, agent }
  }

  it('enables the plugin own sources through enabledSourceSlugs', async () => {
    writePlugin({ mcp: mcpServers({ alpha: stdioServer() }) })
    writeSource('alpha')
    const { managed } = buildSession('s1')

    const result = await sm.setSessionActivePlugin('s1', PLUGIN_NAME)

    expect(managed.activePlugin).toBe(PLUGIN_NAME)
    expect(managed.enabledSourceSlugs).toEqual(['alpha'])
    expect(result).toEqual({ pluginName: PLUGIN_NAME, enabledSources: ['alpha'], unusableSources: [] })
  })

  it('never aborts the agent and never emits source_activated (P9-3)', async () => {
    writePlugin({ mcp: mcpServers({ alpha: stdioServer() }) })
    writeSource('alpha')
    const { agent } = buildSession('s2')

    await sm.setSessionActivePlugin('s2', PLUGIN_NAME)

    // The regression this guards: runtime activation costs the in-flight turn.
    expect(agent.aborts).toEqual([])
    // Session-level events all ride `sessions:event`, discriminated by `type`,
    // so the assertion is on the payload rather than on a channel name.
    expect(
      emitted.some((e) => (e.payload as { type?: string } | undefined)?.type === 'source_activated'),
    ).toBe(false)
    // Positive control — the pre-turn path is the one that actually ran.
    expect(
      emitted.some((e) => (e.payload as { type?: string } | undefined)?.type === 'sources_changed'),
    ).toBe(true)
  })

  it('hands the live agent the new slot without rebuilding it', async () => {
    writePlugin({})
    const { agent } = buildSession('s3')

    await sm.setSessionActivePlugin('s3', PLUGIN_NAME)

    // `PiAgent.resolveActivePluginContext` reads this field once per turn, so
    // mutating it is the entire hand-off.
    expect(agent.config.session.activePlugin).toBe(PLUGIN_NAME)
  })

  it('clears the slot with null and reports it', async () => {
    writePlugin({})
    const { managed, agent } = buildSession('s4')

    await sm.setSessionActivePlugin('s4', PLUGIN_NAME)
    const cleared = await sm.setSessionActivePlugin('s4', null)

    expect(managed.activePlugin).toBeUndefined()
    expect(agent.config.session.activePlugin).toBeUndefined()
    expect(cleared).toEqual({ pluginName: null, enabledSources: [], unusableSources: [] })
    // Last, not first: this test activates and then clears, so there are two
    // `active_plugin_changed` events and the clear is the one under test.
    const event = emitted.filter(
      (e) => (e.payload as { type?: string } | undefined)?.type === 'active_plugin_changed',
    ).at(-1)
    expect(event?.payload).toMatchObject({ pluginName: null })
  })

  it('replaces the previous plugin silently (D12) and keeps its sources enabled', async () => {
    writePlugin({ mcp: mcpServers({ alpha: stdioServer() }) })
    writeSource('alpha')
    const { managed } = buildSession('s5')

    await sm.setSessionActivePlugin('s5', PLUGIN_NAME)
    // A second plugin, installed alongside the first.
    mkdirSync(join(root, 'plugins', 'other'), { recursive: true })
    writeFileSync(
      join(root, 'plugins', 'other', 'plugin.json'),
      JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'other' }),
      'utf-8',
    )

    const replaced = await sm.setSessionActivePlugin('s5', 'other')

    expect(managed.activePlugin).toBe('other')
    expect(replaced.enabledSources).toEqual([])
    // D12 is silent replacement, not cleanup: alpha is an ordinary workspace
    // source now and may be in use, so it stays on.
    expect(managed.enabledSourceSlugs).toEqual(['alpha'])
  })

  it('reports unusable contributed sources instead of failing the activation', async () => {
    writePlugin({
      mcp: mcpServers({
        alpha: stdioServer(),
        needsAuth: httpServer(),
      }),
    })
    writeSource('alpha')
    writeSource('needsAuth', { authenticated: false })
    // Mark it credential-bearing so `isSourceUsable` actually has something to
    // refuse — an auth-free source is usable regardless of `isAuthenticated`.
    markSourceBearer('needsAuth')
    const { managed } = buildSession('s6')

    const result = await sm.setSessionActivePlugin('s6', PLUGIN_NAME)

    // The plugin is active; only the unusable source is withheld. The user is
    // told, because only they can authenticate it.
    expect(managed.activePlugin).toBe(PLUGIN_NAME)
    expect(result.enabledSources).toEqual(['alpha'])
    expect(result.unusableSources).toEqual(['needsAuth'])
    expect(managed.enabledSourceSlugs).toEqual(['alpha'])
  })

  it('rejects activating a plugin that is not installed', async () => {
    const { managed } = buildSession('s7')

    await expect(sm.setSessionActivePlugin('s7', 'ghost')).rejects.toThrow(/not installed/)
    expect(managed.activePlugin).toBeUndefined()
  })

  it('is idempotent — re-activating does not duplicate enabled sources', async () => {
    writePlugin({ mcp: mcpServers({ alpha: stdioServer() }) })
    writeSource('alpha')
    const { managed } = buildSession('s8')

    await sm.setSessionActivePlugin('s8', PLUGIN_NAME)
    const second = await sm.setSessionActivePlugin('s8', PLUGIN_NAME)

    expect(managed.enabledSourceSlugs).toEqual(['alpha'])
    expect(second.enabledSources).toEqual([])
  })

  it('throws for an unknown session rather than silently doing nothing', async () => {
    await expect(sm.setSessionActivePlugin('missing', PLUGIN_NAME)).rejects.toThrow(/Session not found/)
  })
})
