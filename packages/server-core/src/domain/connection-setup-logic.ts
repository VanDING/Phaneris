/**
 * Connection Setup Logic
 *
 * Pure functions extracted from ipc.ts for testability.
 * No dependency on ipcMain, sessionManager, credential manager, or file I/O.
 */

import type { ModelDefinition } from '@phaneris/shared/config/models'
import {
  type LlmConnection,
  type LlmProviderType,
  type CustomEndpointApi,
  type CustomEndpointConfig,
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
  defaultMidStreamBehavior,
} from '@phaneris/shared/config'

// ============================================================
// Error Parsing
// ============================================================

/**
 * Parse an error message from a connection test into a user-friendly string.
 */
export function parseTestConnectionError(msg: string): string {
  const lower = msg.toLowerCase()

  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.'
  }
  if (lower.includes('no api key found for')) {
    return 'Provider mismatch during setup. Select a provider preset in Phaneris Backend API Key mode, or use Anthropic API Key mode for arbitrary compatible endpoints.'
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'Invalid API key'
  }
  if (lower.includes('404') && lower.includes('model')) {
    return 'Model not found. Check the model name and try again.'
  }
  if (lower.includes('404')) {
    return 'API endpoint not found. Check the URL.'
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again.'
  }
  if (lower.includes('403')) {
    return 'API key does not have permission to access this resource'
  }

  return msg.slice(0, 300)
}

/**
 * Guard against ambiguous Pi custom endpoint tests where no provider routing is selected.
 */
export function validateSetupTestInput(params: {
  provider: LlmProviderType
  baseUrl?: string
  piAuthProvider?: string
}): { valid: true } | { valid: false; error: string } {
  const hasCustomEndpoint = !!params.baseUrl?.trim()
  if (params.provider === 'pi' && hasCustomEndpoint && !params.piAuthProvider) {
    return {
      valid: false,
      error: 'Custom endpoint in Phaneris Backend mode requires selecting a provider preset. For arbitrary Anthropic-compatible endpoints, use Anthropic API Key mode.',
    }
  }

  return { valid: true }
}

/**
 * Returns true when a URL points to local loopback.
 * Used to permit keyless setup tests for local model runtimes (e.g. Ollama).
 */
export function isLoopbackBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false
  try {
    const hostname = new URL(baseUrl.trim()).hostname
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
    return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1'
  } catch {
    return false
  }
}

/**
 * Setup tests require API keys for non-local endpoints, but local loopback
 * endpoints may be keyless.
 */
export function setupTestRequiresApiKey(baseUrl?: string): boolean {
  return !isLoopbackBaseUrl(baseUrl)
}

/**
 * Decide how a custom OpenAI/Anthropic-compatible endpoint should be persisted.
 *
 * - Loopback URL with no credential → keyless local model (Ollama, LM Studio).
 * - Loopback URL *with* a credential → real local OpenAI-compat server (vLLM, LiteLLM, etc.);
 *   must be treated like a remote custom endpoint so `piAuthProvider` is set, otherwise
 *   `getPiAuth()` returns null at runtime and chat requests fail with 401 (#636).
 * - Remote URL → always keyed with provider hint for the correct icon.
 *
 * Pure: caller spreads the result into the connection updates patch.
 */
export function resolveCustomEndpointSetup(input: {
  baseUrl: string | undefined
  credential: string | undefined
  customEndpointApi: CustomEndpointApi
}): {
  authType: Extract<LlmConnection['authType'], 'none' | 'api_key_with_endpoint'>
  name?: 'Local Model'
  piAuthProvider?: 'openai' | 'anthropic'
} {
  const isKeylessLoopback = isLoopbackBaseUrl(input.baseUrl) && !input.credential
  if (isKeylessLoopback) {
    return { authType: 'none', name: 'Local Model' }
  }
  return {
    authType: 'api_key_with_endpoint',
    piAuthProvider: input.customEndpointApi === 'anthropic-messages' ? 'anthropic' : 'openai',
  }
}

// ============================================================
// Built-in Connection Templates
// ============================================================

/**
 * Transport a setup writes onto a connection: which backend route it takes and
 * which endpoint protocol (if any) the Pi SDK registers.
 */
export interface ConnectionTransport {
  providerType: LlmProviderType
  authType: LlmConnection['authType']
  customEndpoint: CustomEndpointConfig | undefined
  /** Auth-header hint. Only custom endpoints pin it ('openai' / 'anthropic'). */
  piAuthProvider?: 'openai' | 'anthropic'
  /** 'Local Model' for a keyless loopback endpoint. */
  name?: 'Local Model'
}

/**
 * Resolve the transport for a setup that touched the connection's endpoint.
 *
 * `pi_compat` means "the Pi SDK registers `customEndpoint.api` at `baseUrl`" —
 * nothing else. A base URL on its own never qualifies: every built-in Pi
 * provider (DeepSeek, Minimax, Groq, …) owns an endpoint, and the setup presets
 * prefill exactly that URL. Classifying on the URL instead of the protocol
 * stored connections Pi can neither route to the provider nor register as
 * endpoints (there is no protocol to register), and split one backend across
 * two provider sections in the model picker.
 *
 * Returns `null` when the setup did not touch the endpoint (`baseUrl ===
 * undefined`) or when the connection authenticates with OAuth — those keep the
 * transport they are stored with. `null` or a blank string are a touched,
 * cleared endpoint.
 */
export function resolveConnectionTransport(input: {
  baseUrl: string | null | undefined
  customEndpoint: CustomEndpointConfig | undefined
  credential: string | undefined
  /** Transport the connection is stored with today; absent for a new connection. */
  current?: Pick<LlmConnection, 'providerType' | 'authType'>
}): ConnectionTransport | null {
  if (input.baseUrl === undefined) return null
  // OAuth connections are never reclassified by endpoint fields.
  if (input.current?.authType === 'oauth') return null

  const baseUrl = input.baseUrl?.trim() ?? ''
  if (baseUrl && input.customEndpoint) {
    const branch = resolveCustomEndpointSetup({
      baseUrl,
      credential: input.credential,
      customEndpointApi: input.customEndpoint.api,
    })
    return {
      providerType: 'pi_compat',
      authType: branch.authType,
      customEndpoint: input.customEndpoint,
      ...(branch.piAuthProvider !== undefined ? { piAuthProvider: branch.piAuthProvider } : {}),
      ...(branch.name !== undefined ? { name: branch.name } : {}),
    }
  }

  // No protocol → not a custom endpoint. A connection previously stored as
  // compat drops the protocol it never had and falls back to the native Pi
  // provider named by its piAuthProvider.
  return {
    providerType: 'pi',
    authType: input.current?.authType && input.current.authType !== 'api_key_with_endpoint'
      ? input.current.authType
      : 'api_key',
    customEndpoint: undefined,
  }
}

/**
 * Built-in connection templates for the onboarding flow.
 * Each template defines the default configuration for a known connection slug.
 */
export const BUILT_IN_CONNECTION_TEMPLATES: Record<string, {
  name: string
  providerType: LlmConnection['providerType']
  authType: LlmConnection['authType']
  piAuthProvider?: string
}> = {
  'anthropic-api': {
    name: 'Claude (via Pi) (API Key)',
    providerType: 'pi',
    authType: 'api_key',
  },
  'claude-max': {
    name: 'Claude Max',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'anthropic',
  },
  'chatgpt-plus': {
    name: 'ChatGPT Plus',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'github-copilot',
  },
  'grok-x': {
    name: 'Grok / X',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'xai',
  },
  'kimi-coding': {
    name: 'Kimi Code',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'kimi-coding',
  },
  'openrouter': {
    name: 'OpenRouter',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openrouter',
  },
  'radius': {
    name: 'Radius',
    providerType: 'pi',
    authType: 'oauth',
    piAuthProvider: 'radius',
  },
  'pi-api-key': {
    name: 'Phaneris Backend (API Key)',
    providerType: 'pi',
    authType: 'api_key',
    // piAuthProvider set dynamically from setup.piAuthProvider
  },
}

// ============================================================
// Pi Auth Provider Display Names
// ============================================================

const PI_AUTH_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI',
  google: 'Google AI Studio',
  openrouter: 'OpenRouter',
  'azure-openai-responses': 'Azure OpenAI',
  'amazon-bedrock': 'Amazon Bedrock',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  cerebras: 'Cerebras',
  zai: 'z.ai',
  huggingface: 'Hugging Face',
  minimax: 'Minimax',
  'minimax-cn': 'Minimax CN',
  'kimi-coding': 'Kimi (Coding)',
  'vercel-ai-gateway': 'Vercel AI Gateway',
}

/** Get a human-readable display name for a Pi auth provider key */
export function piAuthProviderDisplayName(piAuthProvider: string): string | null {
  return PI_AUTH_PROVIDER_DISPLAY_NAMES[piAuthProvider] ?? null
}

// ============================================================
// Connection Creation
// ============================================================

/**
 * Create an LLM connection configuration from a connection slug.
 * Uses built-in templates for known slugs, throws for unknown slugs
 * (custom connections are created through the settings UI).
 *
 * `providerType` overrides the template default when the setup resolved a
 * different transport (see {@link resolveConnectionTransport}). The seeded
 * model list follows it, so a custom-endpoint connection starts empty and
 * discovers its own models instead of inheriting the Pi catalog.
 */
export function createBuiltInConnection(slug: string, providerType?: LlmProviderType): LlmConnection {
  // Try exact match first, then strip numeric suffix for derived slugs (e.g. 'anthropic-api-2' → 'anthropic-api')
  const baseSlug = slug.replace(/-\d+$/, '')
  const template = BUILT_IN_CONNECTION_TEMPLATES[slug] ?? BUILT_IN_CONNECTION_TEMPLATES[baseSlug]
  if (!template) {
    throw new Error(`Unknown built-in connection slug: ${slug}. Custom connections should be created through settings.`)
  }

  const resolvedProviderType = providerType ?? template.providerType
  // Overrides only ever come from non-OAuth setups, so the derived auth type
  // stays an API-key one.
  const authType = resolvedProviderType === template.providerType
    ? template.authType
    : resolvedProviderType === 'pi_compat'
      ? 'api_key_with_endpoint' as const
      : 'api_key' as const
  let name = template.name

  // Append suffix number to name for derived connections (e.g. 'anthropic-api-2' → 'Claude (via Pi) (API Key) 2')
  const suffixMatch = slug.match(/-(\d+)$/)
  if (suffixMatch && !BUILT_IN_CONNECTION_TEMPLATES[slug]) {
    name = `${name} ${suffixMatch[1]}`
  }

  return {
    slug,
    name,
    providerType: resolvedProviderType,
    authType,
    models: getDefaultModelsForConnection(resolvedProviderType, template.piAuthProvider),
    defaultModel: getDefaultModelForConnection(resolvedProviderType, template.piAuthProvider),
    modelSelectionMode: resolvedProviderType === 'pi' ? 'automaticallySyncedFromProvider' : undefined,
    piAuthProvider: template.piAuthProvider,
    midStreamBehavior: defaultMidStreamBehavior(resolvedProviderType),
    createdAt: Date.now(),
  }
}

// ============================================================
// Model Validation
// ============================================================

/**
 * Validate that the default model exists in the provided model list.
 * Handles both string and ModelDefinition model entries.
 *
 * This was extracted from inline logic in the setupLlmConnection IPC handler
 * to fix a bug where Array.includes() compared strings against ModelDefinition
 * objects, always returning false for Pi connections.
 */
export function validateModelList(
  models: Array<ModelDefinition | string>,
  defaultModel: string | undefined,
): { valid: boolean; error?: string; resolvedDefaultModel?: string } {
  if (!models || models.length === 0) {
    return { valid: true }
  }

  const modelIds = models.map(m => typeof m === 'string' ? m : m.id)

  if (defaultModel && !modelIds.includes(defaultModel)) {
    return {
      valid: false,
      error: `Default model "${defaultModel}" is not in the provided model list.`,
    }
  }

  if (!defaultModel) {
    const firstModel = models[0]
    const firstModelId = typeof firstModel === 'string' ? firstModel : firstModel!.id
    return {
      valid: true,
      resolvedDefaultModel: firstModelId,
    }
  }

  return { valid: true }
}
