/**
 * Guards the volatile/stable context split (issue #862).
 *
 * The Pi adapter folded volatile context (date/time, session_state, sources)
 * into the cached system prefix, re-stamping it every turn and killing
 * prompt-cache reuse. The fix splits PromptBuilder.buildContextParts() into
 * buildVolatileContextParts() + buildStableContextParts() so the Pi path can
 * keep stable blocks in the system prompt and route volatile blocks to the user
 * tail (where the Claude path already puts everything).
 *
 * These tests pin three invariants:
 *  1. buildContextParts === [...volatile, ...stable] — the Claude path output is
 *     unchanged (same blocks, same order).
 *  2. Blocks are routed correctly: session_state + sources are volatile;
 *     workspace capabilities is stable.
 *  3. The one-shot mode-change signal is consumed exactly once, and only by the
 *     volatile builder — never by the stable builder.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { TestAgent, createMockBackendConfig } from './test-utils.ts'
import { cleanupModeState, initializeModeState, setPermissionMode } from '../mode-manager.ts'

// Matches createMockSession() in test-utils.ts
const SESSION_ID = 'test-session-id'
const OPTS = { plansFolderPath: '/tmp/plans', dataFolderPath: '/tmp/data' }
const SOURCE_BLOCK = '<sources>\nActive: none\n</sources>'

function makeBuilder() {
  return new TestAgent(createMockBackendConfig()).getPromptBuilder()
}

describe('PromptBuilder volatile/stable context split (issue #862)', () => {
  afterEach(() => cleanupModeState(SESSION_ID))

  it('buildContextParts equals [...volatile, ...stable] (Claude path stays byte-identical)', () => {
    // No pending one-shot signal → consume is a no-op → repeated calls are stable.
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const composed = [
      ...builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK),
      ...builder.buildStableContextParts(),
    ]
    const combined = builder.buildContextParts(OPTS, SOURCE_BLOCK)
    expect(combined).toEqual(composed)
  })

  it('routes session_state + sources to volatile and workspace capabilities to stable', () => {
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const stableText = builder.buildStableContextParts().join('\n')

    // session_state + source ride the volatile tail
    expect(volatileText).toContain('permissionMode:')
    expect(volatileText).toContain(SOURCE_BLOCK)
    // workspace capabilities is stable
    expect(stableText).toContain('<workspace_capabilities>')

    // The halves must not bleed into each other
    expect(volatileText).not.toContain('<workspace_capabilities>')
    expect(stableText).not.toContain('permissionMode:')
  })

  it('consumes the one-shot mode-change signal exactly once, only on the volatile path', () => {
    initializeModeState(SESSION_ID, 'safe')
    setPermissionMode(SESSION_ID, 'allow-all', {
      changedBy: 'user',
      changedAt: '2026-03-02T10:00:00.000Z',
    })
    const builder = makeBuilder()

    // Stable path never touches the one-shot signal.
    expect(builder.buildStableContextParts().join('\n')).not.toContain('modeChangeUserSignal:')

    // Volatile path emits it on the first call, then never again.
    const first = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const second = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    expect(first).toContain('modeChangeUserSignal:')
    expect(second).not.toContain('modeChangeUserSignal:')
  })

  it('routes the active plugin context to volatile and never to stable (P9-2)', () => {
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const PLUGIN_BLOCK = '<plugin_context name="demo">\nAlways cite sources.\n</plugin_context>'

    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK, PLUGIN_BLOCK).join('\n')
    const stableText = builder.buildStableContextParts().join('\n')

    // The block rides the user tail, so a plugin change cannot re-stamp the
    // cached system prefix (issue #862).
    expect(volatileText).toContain(PLUGIN_BLOCK)
    expect(stableText).not.toContain('plugin_context')

    // ...and the composed output keeps volatile-then-stable ordering, so the
    // Claude path is unaffected by the new block.
    const composed = [
      ...builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK, PLUGIN_BLOCK),
      ...builder.buildStableContextParts(),
    ]
    expect(builder.buildContextParts(OPTS, SOURCE_BLOCK, PLUGIN_BLOCK)).toEqual(composed)
  })

  it('omits the plugin block entirely when no plugin is active', () => {
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()

    expect(builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')).not.toContain(
      'plugin_context',
    )
  })
})
