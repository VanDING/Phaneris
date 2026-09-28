import { describe, expect, it } from 'bun:test'
import type { LlmConnectionWithStatus } from '@config/llm-connections'
import { buildModelCatalog } from '../model-catalog'

// Failure cases: unauthenticated Claude wins; workspace preference is ignored;
// connection default is ignored; duplicate model IDs route to the wrong connection;
// a stale default is selected; an empty catalog invents an Opus fallback.
const connection = (slug: string, extra: Partial<LlmConnectionWithStatus> = {}): LlmConnectionWithStatus => ({
  slug, name: slug, providerType: 'pi', authType: 'api_key',
  models: ['pi/model-a', 'pi/model-b'], defaultModel: 'pi/model-b',
  isAuthenticated: true, createdAt: 0, ...extra,
})

describe('task model routing', () => {
  it('selects the authenticated connection default without Claude', () => {
    const catalog = buildModelCatalog([
      connection('claude', { isAuthenticated: false, isDefault: true, models: ['pi/claude-opus-4-8'] }),
      connection('other'),
    ])
    expect(catalog.defaultModel).toBe('pi/model-b')
    expect(catalog.groups).toHaveLength(1)
    expect(catalog.modelToConnection.get(catalog.defaultModel!)).toBe('other')
  })
  it('prefers the workspace connection and keeps duplicate IDs routed to it', () => {
    const catalog = buildModelCatalog([connection('global', { isDefault: true }), connection('workspace')], 'workspace')
    expect(catalog.modelToConnection.get(catalog.defaultModel!)).toBe('workspace')
  })
  it('uses global preference when the workspace connection is unavailable', () => {
    const catalog = buildModelCatalog([connection('first'), connection('global', { isDefault: true })], 'missing')
    expect(catalog.modelToConnection.get(catalog.defaultModel!)).toBe('global')
  })
  it('falls back within the authenticated catalog when the default is stale', () => {
    expect(buildModelCatalog([connection('other', { defaultModel: 'missing' })]).defaultModel).toBe('pi/model-a')
  })
  it('does not invent models with no authenticated connections', () => {
    const catalog = buildModelCatalog([connection('offline', { isAuthenticated: false })])
    expect(catalog.defaultModel).toBeUndefined()
    expect(catalog.groups).toEqual([])
    expect(catalog.modelToConnection.size).toBe(0)
  })
})
