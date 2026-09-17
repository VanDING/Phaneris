import { describe, it, expect } from 'bun:test';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../src/config/models-pi.ts';

describe('models-pi filtering', () => {
  it('excludes codex-mini-latest for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.includes('pi/codex-mini-latest')).toBe(false);
  });

  it('excludes all gpt-4* models for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.some(id => id.startsWith('pi/gpt-4'))).toBe(false);
  });

  it('keeps Claude Opus 4.6 models in Anthropic catalogs', () => {
    // TODO(opus-4.6-sunset): flip these back to exclusion when 4.6 is deprecated.
    const anthropicIds = getPiModelsForAuthProvider('anthropic').map(m => m.id);
    expect(anthropicIds).toContain('pi/claude-opus-4-6');

    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds.some(id => id.includes('claude-opus-4-6'))).toBe(true);
  });

  it('includes DeepSeek in the Pi API key provider list with a human-readable label', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'deepseek' && provider.label === 'DeepSeek')).toBe(true);
  });

  it('returns current DeepSeek models, including the patched deepseek-flash entry', () => {
    // The pinned Pi SDK (0.85.1) still ships only the retired
    // `deepseek-v4-flash` / `-vision-exp` aliases. PI_CATALOG_PATCHES adds the
    // canonical multimodal `deepseek-flash` (upstream commit 12f59336) and
    // PI_EXCLUDED_MODELS hides the aliases it replaced. Delete this test's
    // patch expectations together with PI_CATALOG_PATCHES once the SDK ships
    // the fix — then only the catalog assertions below should remain.
    const models = getPiModelsForAuthProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('pi/deepseek-flash');
    expect(ids).toContain('pi/deepseek-v4-pro');

    // Retired aliases are hidden rather than duplicated next to deepseek-flash.
    expect(ids).not.toContain('pi/deepseek-v4-flash');
    expect(ids).not.toContain('pi/deepseek-v4-flash-vision-exp');

    const flash = models.find(m => m.id === 'pi/deepseek-flash');
    expect(flash).toBeDefined();
    expect(flash?.name).toBe('DeepSeek V4.1 Flash');
    expect(flash?.contextWindow).toBe(1_000_000);
    expect(flash?.maxTokens).toBe(384_000);
    expect(flash?.supportsThinking).toBe(true);
    expect(flash?.supportsImages).toBe(true);
    // `supportedThinkingLevels` must be derived from the PATCHED model, not
    // inherited from the (nonexistent) catalog entry: low is reachable, while
    // unmapped minimal/medium and unsupported xhigh are not.
    expect(flash?.supportedThinkingLevels).toEqual(['off', 'low', 'high', 'max']);
    expect(flash?.thinkingLevelMap).toMatchObject({ low: 'low', high: 'high', max: 'max' });
  });

  it('includes Moonshot AI in the Pi API key provider list with human-readable labels', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'moonshotai' && provider.label === 'Moonshot AI')).toBe(true);
    expect(providers.some(provider => provider.key === 'moonshotai-cn' && provider.label === 'Moonshot AI (CN)')).toBe(true);
  });

  it('returns Claude Opus 5 from the Pi SDK catalog for Anthropic and Bedrock', () => {
    const anthropicIds = getPiModelsForAuthProvider('anthropic').map(m => m.id);
    expect(anthropicIds).toContain('pi/claude-opus-5');

    // Bedrock exposes Opus 5 only as regional inference profiles (us./eu./global.).
    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds).toContain('pi/us.anthropic.claude-opus-5');
  });

  it('returns GPT-6 Astra from the Pi SDK catalog for OpenAI API keys and ChatGPT accounts', () => {
    // Added in Pi SDK 0.85.1 for `openai` and `openai-codex` only.
    expect(getPiModelsForAuthProvider('openai').map(m => m.id)).toContain('pi/gpt-6-astra');
    expect(getPiModelsForAuthProvider('openai-codex').map(m => m.id)).toContain('pi/gpt-6-astra');
  });

  it('returns Kimi K3 from the Pi SDK catalog for both Moonshot providers', () => {
    const ids = getPiModelsForAuthProvider('moonshotai').map(m => m.id);
    expect(ids).toContain('pi/kimi-k3');
    expect(ids).toContain('pi/kimi-k2.6');

    const cnIds = getPiModelsForAuthProvider('moonshotai-cn').map(m => m.id);
    expect(cnIds).toContain('pi/kimi-k3');
  });
});
