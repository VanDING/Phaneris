import { describe, expect, it } from 'bun:test'
import {
  parseTestConnectionError,
  validateModelList,
  validateSetupTestInput,
  isLoopbackBaseUrl,
  setupTestRequiresApiKey,
  resolveCustomEndpointSetup,
  resolveConnectionTransport,
  createBuiltInConnection,
  API_KEY_MASK,
  maskApiKey,
  isMaskedApiKey,
  resolveSetupTestApiKey,
} from './connection-setup-logic'
import type { ModelDefinition } from '@phaneris/shared/config/models'

describe('validateSetupTestInput', () => {
  it('rejects pi custom endpoint tests without piAuthProvider', () => {
    const result = validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('requires selecting a provider preset')
    }
  })

  it('allows pi custom endpoint tests with piAuthProvider', () => {
    expect(validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
      piAuthProvider: 'openai',
    })).toEqual({ valid: true })
  })
})

describe('setup test API key requirements', () => {
  it('detects loopback base URLs', () => {
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('requires API key for non-loopback setup tests', () => {
    expect(setupTestRequiresApiKey('https://api.anthropic.com')).toBe(true)
    expect(setupTestRequiresApiKey('https://example.com/v1')).toBe(true)
  })

  it('allows keyless setup tests for loopback endpoints', () => {
    expect(setupTestRequiresApiKey('http://localhost:11434/v1')).toBe(false)
    expect(setupTestRequiresApiKey('http://127.0.0.1:11434/v1')).toBe(false)
  })
})

describe('resolveCustomEndpointSetup', () => {
  it('treats loopback URL with no credential as keyless local model', () => {
    const result = resolveCustomEndpointSetup({
      baseUrl: 'http://localhost:11434/v1',
      credential: undefined,
      customEndpointApi: 'openai-completions',
    })

    expect(result).toEqual({ authType: 'none', name: 'Local Model' })
    expect(result.piAuthProvider).toBeUndefined()
  })

  it('treats loopback URL *with* a credential as a keyed custom endpoint (#636)', () => {
    // Real-world case: vLLM, LiteLLM, or any local OpenAI-compat server with --api-key.
    // Without piAuthProvider, getPiAuth() returns null at runtime → 401 on every chat request.
    const result = resolveCustomEndpointSetup({
      baseUrl: 'http://127.0.0.1:11111/v1',
      credential: 'sk-local-test',
      customEndpointApi: 'openai-completions',
    })

    expect(result).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
    expect(result.name).toBeUndefined()
  })

  it('uses the anthropic provider hint for anthropic-messages protocol', () => {
    const result = resolveCustomEndpointSetup({
      baseUrl: 'http://127.0.0.1:8080',
      credential: 'sk-ant-local',
      customEndpointApi: 'anthropic-messages',
    })

    expect(result).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'anthropic' })
  })

  it('treats remote endpoints with a credential as keyed custom endpoints', () => {
    expect(resolveCustomEndpointSetup({
      baseUrl: 'https://api.example.com/v1',
      credential: 'sk-remote',
      customEndpointApi: 'openai-completions',
    })).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
  })

  it('treats remote endpoints without a credential as keyed (still requires a key)', () => {
    // Non-loopback URLs are never assumed keyless, even if credential is missing —
    // setup validation handles "missing key" separately. We still set piAuthProvider
    // so the saved connection has a useful icon.
    expect(resolveCustomEndpointSetup({
      baseUrl: 'https://api.example.com/v1',
      credential: undefined,
      customEndpointApi: 'openai-completions',
    })).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
  })

  it('treats undefined baseUrl as a non-loopback (keyed) endpoint', () => {
    expect(resolveCustomEndpointSetup({
      baseUrl: undefined,
      credential: 'sk-anything',
      customEndpointApi: 'openai-completions',
    })).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
  })
})

// `pi_compat` means "the Pi SDK registers customEndpoint.api at baseUrl". A
// base URL alone is not a custom endpoint: every native Pi provider owns one,
// and the setup presets prefill it. Classifying on the URL stored connections
// that Pi could neither route to the provider nor register as an endpoint.
describe('resolveConnectionTransport', () => {
  it('keeps a native Pi provider native when the setup only carries its endpoint', () => {
    const transport = resolveConnectionTransport({
      baseUrl: 'https://api.minimaxi.com/anthropic',
      customEndpoint: undefined,
      credential: 'sk-test',
      current: { providerType: 'pi', authType: 'api_key' },
    })
    expect(transport).toEqual({ providerType: 'pi', authType: 'api_key', customEndpoint: undefined })
    expect(transport?.piAuthProvider).toBeUndefined()
  })

  it('classifies a prefilled provider endpoint on a brand new connection as native', () => {
    // Regression: new-connection setup sent the preset URL, the handler wrote
    // pi_compat, and the model picker split one backend into two sections.
    const transport = resolveConnectionTransport({
      baseUrl: 'https://api.deepseek.com',
      customEndpoint: undefined,
      credential: 'sk-test',
      current: undefined,
    })
    expect(transport?.providerType).toBe('pi')
    expect(transport?.customEndpoint).toBeUndefined()
  })

  it('keeps a real custom endpoint compat and pins its protocol', () => {
    const transport = resolveConnectionTransport({
      baseUrl: 'https://my-gateway.example.com/v1',
      customEndpoint: { api: 'openai-completions' },
      credential: 'sk-test',
      current: undefined,
    })
    expect(transport).toMatchObject({
      providerType: 'pi_compat',
      authType: 'api_key_with_endpoint',
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
  })

  it('treats a keyless loopback endpoint as a local model', () => {
    const transport = resolveConnectionTransport({
      baseUrl: 'http://localhost:11434/v1',
      customEndpoint: { api: 'openai-completions' },
      credential: undefined,
      current: undefined,
    })
    expect(transport).toMatchObject({ providerType: 'pi_compat', authType: 'none', name: 'Local Model' })
    // Keyless loopback endpoints carry no auth-header hint.
    expect(transport?.piAuthProvider).toBeUndefined()
  })

  it('drops the compat transport when a connection loses its protocol', () => {
    const transport = resolveConnectionTransport({
      baseUrl: 'https://api.minimaxi.com/anthropic',
      customEndpoint: undefined,
      credential: 'sk-test',
      current: { providerType: 'pi_compat', authType: 'api_key_with_endpoint' },
    })
    expect(transport).toEqual({ providerType: 'pi', authType: 'api_key', customEndpoint: undefined })
  })

  it('leaves OAuth connections untouched by endpoint fields', () => {
    expect(resolveConnectionTransport({
      baseUrl: 'https://example.com',
      customEndpoint: undefined,
      credential: undefined,
      current: { providerType: 'pi', authType: 'oauth' },
    })).toBeNull()
  })

  it('returns null when the setup did not touch the endpoint', () => {
    expect(resolveConnectionTransport({
      baseUrl: undefined,
      customEndpoint: undefined,
      credential: undefined,
      current: { providerType: 'pi', authType: 'api_key' },
    })).toBeNull()
  })

  it('preserves a non-api-key auth type on a native connection', () => {
    const transport = resolveConnectionTransport({
      baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
      customEndpoint: undefined,
      credential: undefined,
      current: { providerType: 'pi', authType: 'iam_credentials' },
    })
    expect(transport?.authType).toBe('iam_credentials')
    expect(transport?.providerType).toBe('pi')
  })
})

// New connections must persist a per-provider midStreamBehavior default so the
// per-connection submenu in Settings → AI shows a checkmark on the right item
// out of the box (no read-time fallback needed for fresh connections).
describe('createBuiltInConnection seeds midStreamBehavior', () => {
  // Post-migration: only Pi-based providers remain, and Pi's native steer is
  // non-destructive — defaultMidStreamBehavior always returns 'steer'.
  it("Anthropic API key → 'steer' (Pi backend)", () => {
    const conn = createBuiltInConnection('anthropic-api')
    expect(conn.providerType).toBe('pi')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("Claude Max OAuth → 'steer' (Anthropic subscription via Pi backend)", () => {
    const conn = createBuiltInConnection('claude-max')
    expect(conn.providerType).toBe('pi')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("ChatGPT Plus → 'steer' (Pi backend, native polite steer)", () => {
    const conn = createBuiltInConnection('chatgpt-plus')
    expect(conn.providerType).toBe('pi')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("Grok / X → 'steer' (xAI subscription via Pi backend)", () => {
    const conn = createBuiltInConnection('grok-x')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('oauth')
    expect(conn.piAuthProvider).toBe('xai')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("Kimi Code → 'steer' (Kimi subscription via Pi backend)", () => {
    const conn = createBuiltInConnection('kimi-coding')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('oauth')
    expect(conn.piAuthProvider).toBe('kimi-coding')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("OpenRouter → 'steer' (credits via Pi backend)", () => {
    const conn = createBuiltInConnection('openrouter')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('oauth')
    expect(conn.piAuthProvider).toBe('openrouter')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("Radius → 'steer' (gateway via Pi backend)", () => {
    const conn = createBuiltInConnection('radius')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('oauth')
    expect(conn.piAuthProvider).toBe('radius')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("Pi API key (Phaneris Backend) → 'steer'", () => {
    const conn = createBuiltInConnection('pi-api-key')
    expect(conn.providerType).toBe('pi')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("anthropic-api with a resolved custom-endpoint transport → 'steer'", () => {
    const conn = createBuiltInConnection('anthropic-api', 'pi_compat')
    expect(conn.providerType).toBe('pi_compat')
    expect(conn.midStreamBehavior).toBe('steer')
  })
})

describe('API key masking for the edit form', () => {
  it('masks long keys keeping the provider prefix and the last four characters', () => {
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnop')).toBe(`sk-ant-${API_KEY_MASK}mnop`)
  })

  it('masks short keys completely', () => {
    expect(maskApiKey('short-key')).toBe(API_KEY_MASK)
  })

  it('recognizes masked values and nothing else', () => {
    expect(isMaskedApiKey(maskApiKey('sk-ant-api03-abcdefghijklmnop'))).toBe(true)
    expect(isMaskedApiKey(API_KEY_MASK)).toBe(true)
    expect(isMaskedApiKey('sk-ant-api03-abcdefghijklmnop')).toBe(false)
    expect(isMaskedApiKey('')).toBe(false)
    expect(isMaskedApiKey(undefined)).toBe(false)
    expect(isMaskedApiKey(null)).toBe(false)
  })
})

// Regression for craft-agents-oss#1048 (PR #1049 by Code-MonkeyZhang): editing a
// connection and clicking Test sent the masked placeholder as the API key.
describe('resolveSetupTestApiKey', () => {
  const STORED = 'sk-ant-stored-key-0000000000'
  let lookups: string[] = []
  const store = async (slug: string) => {
    lookups.push(slug)
    return slug === 'anthropic' ? STORED : null
  }

  it('uses a typed key as-is and never consults the store', async () => {
    lookups = []
    const result = await resolveSetupTestApiKey({ apiKey: '  sk-new-key  ', connectionSlug: 'anthropic', allowEmptyApiKey: false }, store)
    expect(result).toEqual({ ok: true, apiKey: 'sk-new-key', source: 'input' })
    expect(lookups).toEqual([])
  })

  it('resolves the masked placeholder to the stored key of the edited connection', async () => {
    lookups = []
    const result = await resolveSetupTestApiKey({ apiKey: maskApiKey(STORED), connectionSlug: 'anthropic', allowEmptyApiKey: false }, store)
    expect(result).toEqual({ ok: true, apiKey: STORED, source: 'stored' })
    expect(lookups).toEqual(['anthropic'])
  })

  it('asks for the key when the placeholder arrives without a connection slug', async () => {
    const result = await resolveSetupTestApiKey({ apiKey: API_KEY_MASK, allowEmptyApiKey: false }, store)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Re-enter the API key')
  })

  it('asks for the key when nothing is stored for the slug', async () => {
    const result = await resolveSetupTestApiKey({ apiKey: API_KEY_MASK, connectionSlug: 'missing', allowEmptyApiKey: true }, store)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('No API key is stored')
  })

  it('requires a key for remote endpoints and allows none for loopback', async () => {
    expect(await resolveSetupTestApiKey({ apiKey: '', allowEmptyApiKey: false }, store)).toEqual({ ok: false, error: 'API key is required' })
    expect(await resolveSetupTestApiKey({ apiKey: undefined, allowEmptyApiKey: true }, store)).toEqual({ ok: true, apiKey: '', source: 'input' })
  })
})

describe('validateModelList', () => {
  it('accepts a string list with a matching default', () => {
    const result = validateModelList(['model-a', 'model-b', 'model-c'], 'model-b')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // Regression: Pi ModelDefinition[] with valid default was falsely rejected
  // because the old code used Array.includes() to compare strings against objects
  it('regression: Pi ModelDefinition[] with valid default is accepted', () => {
    const piModels: ModelDefinition[] = [
      { id: 'pi/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', shortName: 'Sonnet', description: '', provider: 'pi', contextWindow: 200000 },
      { id: 'pi/claude-haiku-4-5', name: 'Claude Haiku 4.5', shortName: 'Haiku', description: '', provider: 'pi', contextWindow: 200000 },
    ]
    const result = validateModelList(piModels, 'pi/claude-sonnet-4-6')
    expect(result.valid).toBe(true)
  })

  it('rejects when default model is not in the list', () => {
    const result = validateModelList(['model-a', 'model-b'], 'model-c')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('model-c')
    expect(result.error).toContain('not in the provided model list')
  })

  it('auto-selects first model when default is undefined', () => {
    const result = validateModelList(['first-model', 'second-model'], undefined)
    expect(result.valid).toBe(true)
    expect(result.resolvedDefaultModel).toBe('first-model')
  })

  it('auto-selects first ModelDefinition.id when default is undefined', () => {
    const models: ModelDefinition[] = [
      { id: 'def-first', name: 'First', shortName: 'F', description: '', provider: 'pi', contextWindow: 200000 },
    ]
    const result = validateModelList(models, undefined)
    expect(result.valid).toBe(true)
    expect(result.resolvedDefaultModel).toBe('def-first')
  })

  it('returns valid for empty model list', () => {
    const result = validateModelList([], 'anything')
    expect(result.valid).toBe(true)
  })
})

describe('createBuiltInConnection', () => {
  it('creates anthropic-api with the native Pi transport', () => {
    const conn = createBuiltInConnection('anthropic-api')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('api_key')
    expect(conn.name).toBe('Claude (via Pi) (API Key)')
  })

  it('honours a resolved custom-endpoint transport override', () => {
    const conn = createBuiltInConnection('anthropic-api', 'pi_compat')
    expect(conn.providerType).toBe('pi_compat')
    expect(conn.authType).toBe('api_key_with_endpoint')
    // Compat connections discover their own models; they must not inherit the
    // Pi catalog of the slug's template.
    expect(conn.models).toEqual([])
    expect(conn.defaultModel).toBe('')
  })

  it('creates claude-max with oauth', () => {
    const conn = createBuiltInConnection('claude-max')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('oauth')
  })

  it('creates pi-api-key with pi provider', () => {
    const conn = createBuiltInConnection('pi-api-key')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('api_key')
    expect(conn.modelSelectionMode).toBe('automaticallySyncedFromProvider')
  })

  it('handles numeric suffix slugs (anthropic-api-2) by deriving from base template', () => {
    const conn = createBuiltInConnection('anthropic-api-2')
    expect(conn.slug).toBe('anthropic-api-2')
    expect(conn.providerType).toBe('pi')
    expect(conn.name).toBe('Claude (via Pi) (API Key) 2')
  })

  it('handles numeric suffix slugs (pi-api-key-3)', () => {
    const conn = createBuiltInConnection('pi-api-key-3')
    expect(conn.slug).toBe('pi-api-key-3')
    expect(conn.name).toContain('3')
  })

  it('throws for unknown slug', () => {
    expect(() => createBuiltInConnection('unknown-provider')).toThrow('Unknown built-in connection slug')
  })

  it('always sets createdAt', () => {
    const conn = createBuiltInConnection('anthropic-api')
    expect(conn.createdAt).toBeGreaterThan(0)
  })

  it('sets piAuthProvider for chatgpt-plus', () => {
    const conn = createBuiltInConnection('chatgpt-plus')
    expect(conn.piAuthProvider).toBe('openai-codex')
  })

  it('sets piAuthProvider for github-copilot', () => {
    const conn = createBuiltInConnection('github-copilot')
    expect(conn.piAuthProvider).toBe('github-copilot')
  })
})

describe('parseTestConnectionError', () => {
  it('maps ECONNREFUSED to friendly message', () => {
    const result = parseTestConnectionError('connect ECONNREFUSED 127.0.0.1:8080')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps ENOTFOUND to friendly message', () => {
    const result = parseTestConnectionError('getaddrinfo ENOTFOUND api.example.com')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps fetch failed to friendly message', () => {
    const result = parseTestConnectionError('TypeError: fetch failed')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps 401 to invalid API key', () => {
    const result = parseTestConnectionError('Request failed with status 401')
    expect(result).toBe('Invalid API key')
  })

  it('maps unauthorized to invalid API key', () => {
    const result = parseTestConnectionError('Unauthorized access')
    expect(result).toBe('Invalid API key')
  })

  it('maps 404+model to model message', () => {
    const result = parseTestConnectionError('404: model not found')
    expect(result).toContain('Model not found')
  })

  it('maps 404 without model to endpoint message', () => {
    const result = parseTestConnectionError('404 Not Found')
    expect(result).toContain('API endpoint not found')
  })

  it('maps 429 to rate limit', () => {
    const result = parseTestConnectionError('429 Too Many Requests')
    expect(result).toContain('Rate limit')
  })

  it('maps 403 to permission error', () => {
    const result = parseTestConnectionError('403 Forbidden')
    expect(result).toContain('does not have permission')
  })

  it('maps provider mismatch API key errors to actionable guidance', () => {
    const result = parseTestConnectionError('No API key found for huggingface. Use /login or set an API key environment variable.')
    expect(result).toContain('Provider mismatch during setup')
  })

  it('passes through unknown errors truncated to 300 chars', () => {
    const longMsg = 'x'.repeat(500)
    const result = parseTestConnectionError(longMsg)
    expect(result.length).toBe(300)
  })

  it('passes through short unknown errors as-is', () => {
    const result = parseTestConnectionError('Something went wrong')
    expect(result).toBe('Something went wrong')
  })
})
