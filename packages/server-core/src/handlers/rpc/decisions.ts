/**
 * Decision layer (Jev / TypeSafe System One) RPC handlers.
 *
 * Settings + key management + one-shot connectivity test for the Settings > AI
 * card. Everything here is opt-in configuration; no handler runs a decision
 * that affects permissions or session behaviour.
 *
 * Credential red line: `GET_SETTINGS` / `GET_STATUS` never return key material —
 * only booleans (`hasKey` / `providersWithKey`) and the settings that name a
 * provider. Only `TEST` (server-side) ever touches a key. Keys go in through
 * `getCredentialManager().setDecisionApiKey(...)` and nowhere else.
 *
 * All seven channels run on the authenticated workspace server, which owns
 * the settings and credential vault used by that server’s sessions.
 */

import { RPC_CHANNELS } from '@phaneris/shared/protocol'
import { isDecisionProviderId, type DecisionProviderId } from '@phaneris/shared/decisions/types'
import type { RpcServer } from '@phaneris/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.decisions.GET_SETTINGS,
  RPC_CHANNELS.decisions.GET_USAGE,
  RPC_CHANNELS.decisions.SET_SETTINGS,
  RPC_CHANNELS.decisions.GET_STATUS,
  RPC_CHANNELS.decisions.SET_API_KEY,
  RPC_CHANNELS.decisions.DELETE_API_KEY,
  RPC_CHANNELS.decisions.TEST,
  RPC_CHANNELS.decisions.PROBE_SERVER,
] as const

function assertProvider(provider: unknown): asserts provider is DecisionProviderId {
  if (!isDecisionProviderId(provider)) {
    throw new Error(`Invalid decision provider: ${String(provider)}`)
  }
}

export function registerDecisionsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.decisions.GET_USAGE, async () => {
    const { readDecisionUsageReport } = await import('@phaneris/shared/decisions')
    return readDecisionUsageReport(new Date(Date.now() - 7 * 24 * 3_600_000))
  })
  // The decision layer's single read path: `decisions/resolve.ts` reads
  // config.json → `decisionLayer` through the same loader + normalizer that
  // `resolveDecisionClient()` uses. `config/storage.ts` owns only the writer.
  server.handle(RPC_CHANNELS.decisions.GET_SETTINGS, async () => {
    const { readDecisionLayerSettings } = await import('@phaneris/shared/decisions')
    return readDecisionLayerSettings()
  })

  server.handle(RPC_CHANNELS.decisions.SET_SETTINGS, async (_ctx, patch: Record<string, unknown>) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Decision settings patch must be an object')
    }
    const { setDecisionLayerSettings } = await import('@phaneris/shared/config/storage')
    return setDecisionLayerSettings(patch)
  })

  server.handle(RPC_CHANNELS.decisions.GET_STATUS, async () => {
    const { getDecisionLayerStatus } = await import('@phaneris/shared/decisions')
    return getDecisionLayerStatus()
  })

  server.handle(RPC_CHANNELS.decisions.SET_API_KEY, async (_ctx, provider: string, apiKey: string) => {
    assertProvider(provider)
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('API key must not be empty')
    }
    const { getCredentialManager } = await import('@phaneris/shared/credentials')
    await getCredentialManager().setDecisionApiKey(provider, apiKey.trim())
  })

  server.handle(RPC_CHANNELS.decisions.DELETE_API_KEY, async (_ctx, provider: string) => {
    assertProvider(provider)
    const { getCredentialManager } = await import('@phaneris/shared/credentials')
    return getCredentialManager().deleteDecisionApiKey(provider)
  })

  // Local servers (Laya, custom): GET {baseUrl}/health so the Settings card can say whether
  // the server is up and which checkpoints it loaded. Never throws; no key is sent.
  server.handle(RPC_CHANNELS.decisions.PROBE_SERVER, async (_ctx, options?: { baseUrl?: string }) => {
    const { probeConfiguredDecisionServer } = await import('@phaneris/shared/decisions')
    return probeConfiguredDecisionServer(undefined, {
      baseUrlOverride: typeof options?.baseUrl === 'string' ? options.baseUrl : undefined,
    })
  })

  server.handle(RPC_CHANNELS.decisions.TEST, async (_ctx, options?: { settings?: Record<string, unknown>; apiKey?: string }) => {
    const { testDecisionConnection } = await import('@phaneris/shared/decisions')
    return testDecisionConnection({
      settings: options?.settings as import('@phaneris/shared/decisions').DecisionLayerSettingsPatch | undefined,
      apiKey: typeof options?.apiKey === 'string' ? options.apiKey : undefined,
    })
  })
}
