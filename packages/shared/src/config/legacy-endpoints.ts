/**
 * Runtime normalization for built-in provider endpoints that moved.
 *
 * A vendor can move an endpoint between SDK releases: Kimi Coding moved from
 * `/coding` to `/coding/v1` when it switched to Chat Completions, and OpenCode
 * replaced its single Zen URL with one base URL per protocol family.
 *
 * Two different situations hide behind "the stored URL is a retired default",
 * and they must not be treated alike:
 *
 * - A **native** connection (no `customEndpoint`) merely carries the preset's
 *   old default URL. The SDK catalog owns that provider's endpoint, so dropping
 *   the stale URL loses nothing — no user choice is expressed by it.
 * - A **custom-endpoint** connection (`pi_compat`) is the user's explicit
 *   configuration. Dropping `customEndpoint` would silently re-route it to the
 *   native catalog, where its models are *not* registered: the Pi subprocess
 *   registers user models only on the custom-endpoint branch, so off-catalog
 *   IDs become unavailable and per-model overrides stop being applied. For
 *   those, only the dead URL is rewritten to the endpoint that protocol is
 *   served from today.
 *
 * Anything that is not an exact match on a provider's own retired default —
 * another host, a proxy path, a port, a hand-set protocol — is left exactly as
 * stored. Nothing here is persisted: the stored config keeps the user's bytes,
 * so a downgrade still finds what it wrote.
 */

import type { CustomEndpointConfig } from './llm-connections.ts';

/** Current base URL per retired endpoint, keyed by provider and protocol. */
const RETIRED_ENDPOINT_REPLACEMENTS: Record<string, Partial<Record<CustomEndpointConfig['api'], string>>> = {
  // Mirrors the Pi SDK catalog (`@earendil-works/pi-ai/providers/data/*.json`),
  // which serves each protocol from its own base URL; one Zen URL could never
  // describe all of them.
  'opencode': {
    'openai-completions': 'https://opencode.ai/inference/v1',
    'openai-responses': 'https://opencode.ai/inference/v1',
    'anthropic-messages': 'https://opencode.ai/inference',
  },
  'opencode-go': {
    'openai-completions': 'https://opencode.ai/inference/go/v1',
    'openai-responses': 'https://opencode.ai/inference/go/v1',
    'anthropic-messages': 'https://opencode.ai/inference/go',
  },
  // Kimi Coding's native provider is Chat Completions at /coding/v1.
  'kimi-coding': {
    'openai-completions': 'https://api.kimi.com/coding/v1',
  },
};

/** Defaults a built-in provider used to ship, keyed by SDK provider id. */
const RETIRED_NATIVE_ENDPOINTS: Record<string, readonly string[]> = {
  'kimi-coding': ['https://api.kimi.com/coding'],
  'opencode': ['https://opencode.ai/zen/v1', 'https://opencode.ai/zen/go/v1'],
  'opencode-go': ['https://opencode.ai/zen/go/v1'],
};

const normalizeUrl = (value?: string | null): string => (value ?? '').trim().replace(/\/+$/, '');

/** True when `baseUrl` is exactly one of the provider's own retired defaults. */
export function isRetiredNativeEndpoint(piAuthProvider?: string | null, baseUrl?: string | null): boolean {
  const retired = piAuthProvider ? RETIRED_NATIVE_ENDPOINTS[piAuthProvider] : undefined;
  if (!retired) return false;
  const url = normalizeUrl(baseUrl);
  return url.length > 0 && retired.some((candidate) => normalizeUrl(candidate) === url);
}

export interface PiEndpointFields {
  providerType?: string;
  piAuthProvider?: string;
  baseUrl?: string;
  customEndpoint?: CustomEndpointConfig;
}

/**
 * Move a connection off a retired built-in default.
 *
 * Native connections lose the stale URL (the catalog takes over). Custom-endpoint
 * connections keep their protocol, their models and their per-model overrides;
 * only the URL moves to the endpoint that protocol is served from today. When no
 * current endpoint is known for that protocol the connection is returned
 * untouched — a visible unknown endpoint beats a silent re-route.
 *
 * Returns the input untouched in every other case.
 */
export function normalizeRetiredNativeEndpoint<T extends PiEndpointFields>(connection: T): T {
  if (!isRetiredNativeEndpoint(connection.piAuthProvider, connection.baseUrl)) return connection;
  const protocol = connection.customEndpoint?.api;
  const isCustomEndpoint = Boolean(connection.customEndpoint) || connection.providerType === 'pi_compat';
  if (!isCustomEndpoint) {
    const { baseUrl: _baseUrl, ...rest } = connection;
    return { ...rest, providerType: 'pi' } as T;
  }
  const replacement = connection.piAuthProvider && protocol
    ? RETIRED_ENDPOINT_REPLACEMENTS[connection.piAuthProvider]?.[protocol]
    : undefined;
  if (!replacement) return connection;
  return { ...connection, baseUrl: replacement } as T;
}
