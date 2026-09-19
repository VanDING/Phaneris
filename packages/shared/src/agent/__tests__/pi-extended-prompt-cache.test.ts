/**
 * Pi native extended-prompt-cache contract.
 *
 * The extendedPromptCache setting is no longer implemented by rewriting
 * Anthropic cache_control blocks in the network interceptor. It drives the Pi
 * SDK's native `cacheRetention` instead:
 *
 * - PiAgent spawns the subprocess with PI_CACHE_RETENTION=long/short and sends
 *   cacheRetention on init.
 * - Global settings changes are pushed to live subprocesses via
 *   `set_cache_retention` without interrupting an active turn.
 * - pi-agent-server injects that retention as the default for every wrapped
 *   stream call; explicit per-call values (notably compaction's 'none') win.
 *
 * Source-level assertions keep the cross-process contract pinned without
 * spawning a full subprocess.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pi extended prompt cache (native cacheRetention contract)', () => {
  const piAgentSource = readFileSync(join(__dirname, '..', 'pi-agent.ts'), 'utf-8')
  const serverSource = readFileSync(join(__dirname, '..', '..', '..', '..', 'pi-agent-server', 'src', 'index.ts'), 'utf-8')
  const streamWrapperSource = readFileSync(join(__dirname, '..', '..', '..', '..', 'pi-agent-server', 'src', 'durable-model-stream.ts'), 'utf-8')
  const settingsSource = readFileSync(join(__dirname, '..', '..', '..', '..', 'server-core', 'src', 'handlers', 'rpc', 'settings.ts'), 'utf-8')
  const sessionManagerSource = readFileSync(join(__dirname, '..', '..', '..', '..', 'server-core', 'src', 'sessions', 'SessionManager.ts'), 'utf-8')
  const interceptorSource = readFileSync(join(__dirname, '..', '..', 'unified-network-interceptor.ts'), 'utf-8')

  it('imports the setting from config storage in PiAgent', () => {
    expect(piAgentSource).toContain('getExtendedPromptCache')
    expect(piAgentSource).toMatch(/from ['"]\.\.\/config\/storage(\.ts)?['"]/)
  })

  it('spawns with the Pi-native env default and sends it on init', () => {
    expect(piAgentSource).toContain("PI_CACHE_RETENTION: extendedPromptCache ? 'long' : 'short'")
    expect(piAgentSource).toContain("cacheRetention: extendedPromptCache ? 'long' : 'short'")
  })

  it('pushes live setting changes without interrupting the active turn', () => {
    expect(piAgentSource).toContain("type: 'set_cache_retention', cacheRetention: enabled ? 'long' : 'short'")
    expect(serverSource).toContain("case 'set_cache_retention':")
    expect(serverSource).toContain('function handleSetCacheRetention(')
    expect(serverSource).toContain('piCacheRetention = msg.cacheRetention')
    expect(serverSource).toContain('process.env.PI_CACHE_RETENTION = piCacheRetention')
  })

  it('applies the retention as a default on wrapped Pi SDK streams', () => {
    expect(serverSource).toContain('let piCacheRetention: CacheRetention')
    expect(serverSource).toContain('cacheRetention?: CacheRetention')
    expect(serverSource).toContain('() => piCacheRetention')
    expect(streamWrapperSource).toContain('resolveDefaultCacheRetention?: () => CacheRetention')
    expect(streamWrapperSource).toContain("options?.cacheRetention === undefined")
  })

  it('does not invoke the legacy interceptor TTL rewrite', () => {
    expect(interceptorSource).not.toContain('upgradePromptCacheTtl(body)')
  })

  it('notifies live sessions when the global setting changes', () => {
    expect(settingsSource).toContain('deps.sessionManager.refreshExtendedPromptCache?.(enabled)')
    expect(sessionManagerSource).toContain('refreshExtendedPromptCache(enabled: boolean): void')
    expect(sessionManagerSource).toContain('managed.agent?.updateExtendedPromptCache?.(enabled)')
  })
})
