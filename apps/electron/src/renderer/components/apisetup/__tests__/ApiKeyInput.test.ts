import { describe, expect, it } from 'bun:test'
import {
  resolveCustomEndpointPayload,
  resolvePiAuthProviderForSubmit,
} from '../submit-helpers'
import { resolveDefaultCatalogModel } from '../tier-models'

const MODELS = [
  { id: 'pi/zai-best', name: 'Best', costInput: 10, costOutput: 20, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-balanced', name: 'Balanced', costInput: 5, costOutput: 10, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-fast', name: 'Fast', costInput: 1, costOutput: 2, contextWindow: 128000, reasoning: false },
]

describe('ApiKeyInput catalog default hydration', () => {
  it('keeps a saved default when it remains in the provider catalog', () => {
    expect(resolveDefaultCatalogModel(MODELS, 'pi/zai-fast')).toBe('pi/zai-fast')
  })

  it('returns a saved model verbatim even when the catalog no longer lists it', () => {
    // The catalog is a snapshot of what the provider offers today, not an
    // authority over an existing connection's choice: substituting the first
    // entry would silently change which model the connection runs on.
    expect(resolveDefaultCatalogModel(MODELS, 'pi/not-real')).toBe('pi/not-real')
  })

  it('falls back to the first catalog model when nothing was saved', () => {
    expect(resolveDefaultCatalogModel(MODELS, undefined)).toBe('pi/zai-best')
  })

  it('returns an empty default for an empty catalog with nothing saved', () => {
    expect(resolveDefaultCatalogModel([], undefined)).toBe('')
  })
})

describe('resolvePiAuthProviderForSubmit', () => {
  it('preserves the last non-custom provider when custom endpoint mode is selected', () => {
    expect(resolvePiAuthProviderForSubmit('custom', 'openai')).toBe('openai')
  })

  it('defaults custom endpoint mode to anthropic routing when none was selected yet', () => {
    expect(resolvePiAuthProviderForSubmit('custom', null)).toBe('anthropic')
  })

  it('passes through non-custom presets unchanged', () => {
    expect(resolvePiAuthProviderForSubmit('google', 'anthropic')).toBe('google')
  })
})

describe('resolveCustomEndpointPayload', () => {
  const BRANDED = new Set(['manifest'])

  it('routes branded openai-compat presets through openai-completions regardless of toggle', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: 'https://app.manifest.build/v1',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
  })

  it('honors the protocol toggle for the generic custom preset', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://my-endpoint.example.com',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
    })
  })

  it('routes openai-responses through the openai provider (Responses adapter)', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://api.deepseek.com',
      customApi: 'openai-responses',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-responses' },
      piAuthProvider: 'openai',
    })
  })

  it('returns no customEndpoint for a standard preset, passing through the fallback piAuth', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: 'openrouter',
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: 'openrouter',
    })
  })

  it('treats branded preset with empty URL as non-custom (no customEndpoint)', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: '',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: undefined,
    })
  })
})
