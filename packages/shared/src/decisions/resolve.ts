/**
 * Decision layer — resolve a ready-to-use client from settings + credentials.
 *
 * Gate order (all must pass, otherwise `{ ok: false }`):
 *   1. `DecisionLayerSettings.enabled` — the Settings > AI switch is the only master gate
 *   2. the requested feature toggle (optional)
 *   3. a key: from an LLM connection (`connectionSlug`) or `decision_api_key::{provider}`
 *   4. a valid endpoint (custom provider needs a base URL)
 *
 * Callers on hot paths use `getDecisionClient()` and treat `null` as "behave as
 * before" (invariant 2). Callers that explain themselves (Settings → Test) use
 * `resolveDecisionClient()` and read the failure.
 */

import { getCredentialManager } from '../credentials/index.ts';
import { getLlmConnection, loadStoredConfig, type StoredConfig } from '../config/storage.ts';
import { SystemOneClient } from './client.ts';
import { resolveDecisionAccounting } from './accounting.ts';
import { DECISION_PROVIDER_PRESETS, decisionProviderForConnection } from './providers.ts';
import {
  normalizeDecisionLayerSettings,
  resolveDecisionEndpoint,
  type DecisionLayerFeature,
  type DecisionLayerSettings,
  type DecisionLayerStoredSettings,
  type ResolvedDecisionEndpoint,
} from './settings.ts';
import { isDecisionError, type DecisionFailure, type DecisionProviderId } from './types.ts';

/**
 * The narrow slice of the credential vault the decision layer is allowed to
 * touch. `credentials/manager.ts` implements it (`getDecisionApiKey` +
 * `getLlmApiKey`); depending on this shape instead of the concrete
 * `CredentialManager` class keeps this module unit-testable and stops decision
 * code from reaching any other secret.
 */
export interface DecisionCredentialSource {
  /** Key stored for a decision provider (`decision_api_key::{provider}`). */
  getDecisionApiKey(provider: DecisionProviderId): Promise<string | null>;
  /** Key of an existing LLM connection, reused when settings set `connectionSlug`. */
  getLlmApiKey(connectionSlug: string): Promise<string | null>;
}

/**
 * The process-wide vault, seen through the slice above.
 *
 * `credentials/manager.ts` gains `getDecisionApiKey` in the batch that first
 * stores a decision key (`setDecisionApiKey`); the upstream anchors are
 * `manager.ts:167` (`getLlmApiKey`) and the `decision_api_key` credential type.
 * Until that method exists a stored decision key cannot be read and the layer
 * fails closed — no key means `unconfigured`, which is invariant 2 by another
 * route — so the cast below documents the contract instead of widening the
 * interface to `any`.
 */
export function getDecisionCredentialSource(): DecisionCredentialSource {
  return getCredentialManager() as unknown as DecisionCredentialSource;
}

/** `config.json` → `decisionLayer`. The field lands with the settings-storage batch. */
type StoredConfigWithDecisionLayer = StoredConfig & { decisionLayer?: DecisionLayerStoredSettings };

/**
 * Read the stored decision-layer settings.
 *
 * `config/storage.ts` owns `config.json`; this is the decision layer's read path
 * onto it. It goes through the canonical `loadStoredConfig()` loader and the
 * same normalizer as `config/storage.ts:getDecisionLayerSettings()` (the
 * RPC-facing accessor), so both callers see identical settings without this
 * module importing a decisions-specific accessor.
 */
export function readDecisionLayerSettings(): DecisionLayerSettings {
  const config = loadStoredConfig() as unknown as StoredConfigWithDecisionLayer | null;
  return normalizeDecisionLayerSettings(config?.decisionLayer);
}

export interface ResolvedDecisionClient {
  /** An explicitly configured budget is a hard cap, including on cold calls. */
  deadlineIsExplicit?: boolean;
  client: SystemOneClient;
  settings: DecisionLayerSettings;
  provider: DecisionProviderId;
  endpoint: ResolvedDecisionEndpoint;
  /** Where the key came from. `none` only for providers that do not require one. */
  keySource: 'connection' | 'provider' | 'none';
}

export type DecisionClientResolution =
  | { ok: true; value: ResolvedDecisionClient }
  | { ok: false; failure: DecisionFailure };

export interface ResolveDecisionClientOptions {
  sessionId?: string;
  /** Defaults to the stored settings. */
  settings?: DecisionLayerSettings;
  credentialManager?: DecisionCredentialSource;
  /** Also require this feature toggle to be on. */
  feature?: DecisionLayerFeature;
  /** Skip the enabled + feature gates (Settings → Test must work before enabling). */
  skipGates?: boolean;
  /** Use this key instead of looking one up (unsaved key typed into Settings). */
  apiKeyOverride?: string;
  fetch?: typeof globalThis.fetch;
}

/** Master switch on. Sync; no key check. */
export function isDecisionLayerActive(settings: DecisionLayerSettings = readDecisionLayerSettings()): boolean {
  return settings.enabled;
}

/** Master switch on AND the feature toggle on. Sync; no key check. */
export function isDecisionFeatureActive(feature: DecisionLayerFeature, settings: DecisionLayerSettings = readDecisionLayerSettings()): boolean {
  return isDecisionLayerActive(settings) && settings.features[feature];
}

function fail(failure: DecisionFailure): DecisionClientResolution {
  return { ok: false, failure };
}

export async function resolveDecisionClient(options: ResolveDecisionClientOptions = {}): Promise<DecisionClientResolution> {
  const stored = options.settings ? undefined : loadStoredConfig()?.decisionLayer;
  const settings = options.settings ?? normalizeDecisionLayerSettings(stored);
  const deadlineIsExplicit = !!options.settings || stored?.deadlineMs !== undefined;

  if (!options.skipGates) {
    if (!settings.enabled) {
      return fail({ kind: 'disabled', message: 'The decision model is disabled in Settings > AI' });
    }
    if (options.feature && !settings.features[options.feature]) {
      return fail({ kind: 'disabled', message: `The decision model feature '${options.feature}' is disabled in Settings > AI` });
    }
  }

  const credentialManager = options.credentialManager ?? getDecisionCredentialSource();
  let provider: DecisionProviderId = settings.provider;
  let apiKey: string | undefined;
  let keySource: ResolvedDecisionClient['keySource'] = 'none';

  if (options.apiKeyOverride?.trim()) {
    apiKey = options.apiKeyOverride.trim();
    keySource = 'provider';
  } else if (settings.connectionSlug) {
    const connection = getLlmConnection(settings.connectionSlug);
    if (!connection) {
      return fail({ kind: 'unconfigured', message: `Decision model: LLM connection '${settings.connectionSlug}' no longer exists` });
    }
    const derived = decisionProviderForConnection(connection.piAuthProvider);
    if (!derived) {
      return fail({ kind: 'unconfigured', message: `Decision model: connection '${connection.name}' is not an OpenRouter or Vercel AI Gateway connection` });
    }
    provider = derived;
    const key = await credentialManager.getLlmApiKey(connection.slug);
    if (!key) {
      return fail({ kind: 'unconfigured', message: `Decision model: connection '${connection.name}' has no API key stored` });
    }
    apiKey = key;
    keySource = 'connection';
  } else {
    const key = await credentialManager.getDecisionApiKey(provider);
    if (key) {
      apiKey = key;
      keySource = 'provider';
    } else if (DECISION_PROVIDER_PRESETS[provider].requiresKey) {
      return fail({
        kind: 'unconfigured',
        message: `Decision model: no API key stored for ${DECISION_PROVIDER_PRESETS[provider].label}. Add one in Settings > AI > Decision model`,
      });
    }
  }

  let endpoint: ResolvedDecisionEndpoint;
  try {
    endpoint = resolveDecisionEndpoint(settings, provider);
  } catch (error) {
    if (isDecisionError(error)) return fail(error.toFailure());
    throw error;
  }

  const client = new SystemOneClient({
    accounting: resolveDecisionAccounting({ sessionId: options.sessionId, feature: options.feature, provider, model: endpoint.model }),
    baseUrl: endpoint.baseUrl,
    apiKey,
    model: endpoint.model,
    defaultDeadlineMs: settings.deadlineMs,
    extraHeaders: endpoint.extraHeaders,
    // Some servers enforce a smaller state cap than the client default (laya-serve: 50k chars).
    maxStateBytes: endpoint.preset.maxStateBytes,
    fetch: options.fetch,
  });

  return { ok: true, value: { client, settings, provider, endpoint, keySource, deadlineIsExplicit } };
}

/** Fail-closed convenience: `null` whenever the layer cannot be used. */
export async function getDecisionClient(options: ResolveDecisionClientOptions = {}): Promise<ResolvedDecisionClient | null> {
  try {
    const resolution = await resolveDecisionClient(options);
    return resolution.ok ? resolution.value : null;
  } catch {
    return null;
  }
}
