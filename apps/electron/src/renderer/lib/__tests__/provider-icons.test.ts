import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getProviderIcon, providerIcons } from '../provider-icons'

describe('provider marks are bundled', () => {
  // The user-visible contract: opening the app never reaches the network for a
  // provider logo. Adding a remote URL here is the regression this pins.
  it('resolves every provider mark without a network request', () => {
    const remote = Object.entries(providerIcons)
      .filter(([, mark]) => String(mark).startsWith('http'))
      .map(([provider]) => provider)
    expect(remote).toEqual([])
  })

  /**
   * The set-completeness check above cannot see a URL that sits in a *branch*
   * rather than in the map — which is exactly where the last four lived (a
   * Google favicon fallback for Groq, Cerebras, Z.ai, and Manifest). Assert
   * against the source so re-adding one fails here rather than in production.
   */
  it('contains no quoted URL literal anywhere in the module', () => {
    const source = readFileSync(resolve(import.meta.dir, '..', 'provider-icons.ts'), 'utf8')
    const quoted = source.match(/['"`]https?:\/\/[^'"`]*['"`]/g) ?? []
    expect(quoted).toEqual([])
    expect(source).not.toContain('gstatic')
  })

  it('maps Pi auth providers to their bundled marks', () => {
    expect(getProviderIcon('pi', null, 'deepseek')).toBe(providerIcons.deepseek)
    expect(getProviderIcon('pi', null, 'groq')).toBe(providerIcons.groq)
    expect(getProviderIcon('pi', null, 'cerebras')).toBe(providerIcons.cerebras)
    expect(getProviderIcon('pi', null, 'zai')).toBe(providerIcons.zai)
  })

  it('resolves a Manifest gateway endpoint to its bundled logomark', () => {
    // The last provider that used to be fetched from Google's favicon service.
    expect(getProviderIcon('pi_compat', 'https://app.manifest.build/v1', 'openai'))
      .toBe(providerIcons.manifest)
    expect(getProviderIcon('openai_compat', 'https://manifest.build/v1', 'openai'))
      .toBe(providerIcons.manifest)
  })

  it('detects those endpoints from their base URL alone', () => {
    expect(getProviderIcon('pi_compat', 'https://api.deepseek.com/v1', 'openai'))
      .toBe(providerIcons.deepseek)
    expect(getProviderIcon('pi_compat', 'https://api.groq.com/openai/v1', 'openai'))
      .toBe(providerIcons.groq)
    expect(getProviderIcon('pi_compat', 'https://api.cerebras.ai/v1', 'openai'))
      .toBe(providerIcons.cerebras)
    expect(getProviderIcon('pi_compat', 'https://api.z.ai/api/paas/v4', 'openai'))
      .toBe(providerIcons.zai)
  })

  it('keeps the neutral fallback for an unrelated endpoint', () => {
    // `fizz.ai` must not be mistaken for Z.ai by a bare `z.ai` substring match.
    expect(getProviderIcon('pi_compat', 'https://fizz.ai/v1', 'openai', 'private-model'))
      .toBeNull()
  })
})

describe('custom endpoint provider icons', () => {
  it('uses the endpoint brand instead of the OpenAI transport adapter', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://api.deepseek.com',
      'openai',
      'deepseek-chat',
    )).toBe(providerIcons.deepseek)
  })

  it('infers a known model vendor when the custom endpoint domain is neutral', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://llm.example.com/v1',
      'openai',
      'deepseek-reasoner',
    )).toBe(providerIcons.deepseek)
  })

  it('uses the neutral fallback for an unknown custom endpoint', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://llm.example.com/v1',
      'openai',
      'private-model',
    )).toBeNull()
  })

  it('uses the bundled xAI icon for xAI endpoints and Grok models', () => {
    expect(getProviderIcon(
      'pi_compat',
      'https://api.x.ai/v1',
      'openai',
      'grok-4',
    )).toBe(providerIcons.xai)

    expect(getProviderIcon(
      'pi_compat',
      'https://llm.example.com/v1',
      'openai',
      'grok-4',
    )).toBe(providerIcons.xai)
  })
})
