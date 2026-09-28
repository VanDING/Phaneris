/**
 * Tests for model detection utilities in config/models.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  isClaudeModel,
  getModelShortName,
  getModelDisplayName,
  getModelContextWindow,
  getModelById,
  ANTHROPIC_MODELS,
  getModelIdByShortName,
  normalizeDeprecatedModelId,
} from '../src/config/models.ts';

// Pi is an internal routing prefix. Formatting it first produced "Pi/MiniMax"
// and defeated the case-sensitive prefix cleanup in several model selectors.
describe('Pi display names', () => {
  it('strips routing metadata before formatting a model name', () => {
    expect(getModelDisplayName('pi/MiniMax-M3')).toBe('MiniMax M3');
    expect(getModelDisplayName('pi/deepseek-flash')).toBe('Deepseek flash');
    expect(getModelDisplayName('pi/claude-opus-4-8')).toBe('Opus 4.8');
  });
});

describe('isClaudeModel', () => {
  // Direct Anthropic model IDs
  it('detects direct Anthropic Claude model IDs', () => {
    expect(isClaudeModel('claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('claude-opus-4-8')).toBe(true);
    expect(isClaudeModel('claude-haiku-4-5-20251001')).toBe(true);
    expect(isClaudeModel('claude-3-5-sonnet-20241022')).toBe(true);
  });

  // OpenRouter provider-prefixed Claude IDs
  it('detects OpenRouter-prefixed Claude model IDs', () => {
    expect(isClaudeModel('anthropic/claude-sonnet-4')).toBe(true);
    expect(isClaudeModel('anthropic/claude-opus-4-7')).toBe(true);
    expect(isClaudeModel('anthropic/claude-3.5-haiku')).toBe(true);
  });

  // Non-Claude models via OpenRouter
  it('rejects non-Claude OpenRouter models', () => {
    expect(isClaudeModel('openai/gpt-5')).toBe(false);
    expect(isClaudeModel('openai/gpt-4o')).toBe(false);
    expect(isClaudeModel('google/gemini-2.5-pro')).toBe(false);
    expect(isClaudeModel('meta-llama/llama-4-maverick')).toBe(false);
    expect(isClaudeModel('deepseek/deepseek-r1')).toBe(false);
    expect(isClaudeModel('mistralai/mistral-large')).toBe(false);
  });

  // Non-Claude models via Ollama (no provider prefix)
  it('rejects non-Claude Ollama models', () => {
    expect(isClaudeModel('llama3.2')).toBe(false);
    expect(isClaudeModel('deepseek-r1')).toBe(false);
    expect(isClaudeModel('qwen3-coder')).toBe(false);
    expect(isClaudeModel('mistral')).toBe(false);
    expect(isClaudeModel('gemma2')).toBe(false);
  });

  // Bedrock-native model IDs
  it('detects Bedrock-native Claude model IDs', () => {
    expect(isClaudeModel('anthropic.claude-opus-4-8')).toBe(true);
    expect(isClaudeModel('anthropic.claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true);
  });

  // Case insensitivity
  it('handles case variations', () => {
    expect(isClaudeModel('Claude-Sonnet-4-6')).toBe(true);
    expect(isClaudeModel('CLAUDE-OPUS-4-8')).toBe(true);
    expect(isClaudeModel('Anthropic/Claude-Sonnet-4')).toBe(true);
  });
});

describe('getModelShortName', () => {
  it('returns registry shortName for known models', () => {
    expect(getModelShortName('claude-opus-4-8')).toBe('Opus');
    expect(getModelShortName('claude-sonnet-4-6')).toBe('Sonnet');
    expect(getModelShortName('claude-haiku-4-5-20251001')).toBe('Haiku');
  });

  it('strips provider prefix for slash-separated IDs', () => {
    expect(getModelShortName('openai/gpt-5.4')).toBe('gpt-5.4');
    expect(getModelShortName('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4');
  });

  it('preserves version numbers for custom endpoint models', () => {
    expect(getModelShortName('gpt-5.4')).toBe('Gpt 5.4');
    expect(getModelShortName('gpt-5.2')).toBe('Gpt 5.2');
    expect(getModelShortName('glm-4.7')).toBe('Glm 4.7');
  });

  it('humanizes bare model names without versions', () => {
    expect(getModelShortName('mistral')).toBe('Mistral');
    expect(getModelShortName('gemma2')).toBe('Gemma2');
  });

  it('humanizes multi-part model names', () => {
    expect(getModelShortName('mistral-large')).toBe('Mistral large');
    expect(getModelShortName('deepseek-r1')).toBe('Deepseek r1');
  });

  it('strips date suffix for unknown claude models', () => {
    expect(getModelShortName('claude-sonnet-3-5-20241022')).toBe('Sonnet 3.5');
  });
});

describe('Opus registry', () => {
  it('keeps 4.8 first and lists Opus 5.5 / Opus 5 right behind it', () => {
    const opusIds = ANTHROPIC_MODELS.map(m => m.id).filter(id => id.startsWith('claude-opus-'));
    // 4.8 stays first on purpose: Opus 5.5 is registered as a selectable model,
    // not as the new-connection default.
    expect(opusIds).toEqual([
      'claude-opus-4-8',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-7',
      'claude-opus-4-6',
    ]);
  });

  it('resolves "Opus" shortName to 4.8, not to the newly registered 5.5', () => {
    expect(getModelIdByShortName('Opus')).toBe('claude-opus-4-8');
  });

  it('exposes Opus 5.5 and Opus 5 metadata with the real 1M context window', () => {
    // Unregistered ids fall back to a 200K window, so registration is what makes
    // the picker report 1M for these two.
    expect(getModelDisplayName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(getModelShortName('claude-opus-5-5')).toBe('Opus');
    expect(getModelContextWindow('claude-opus-5-5')).toBe(1_000_000);
    expect(getModelDisplayName('claude-opus-5')).toBe('Opus 5');
    expect(getModelContextWindow('claude-opus-5')).toBe(1_000_000);
  });

  it('maps Bedrock Opus 5.5 / Opus 5 IDs back to the bare IDs without cross-mapping', () => {
    expect(getModelById('us.anthropic.claude-opus-5-5')?.id).toBe('claude-opus-5-5');
    expect(getModelById('eu.anthropic.claude-opus-5-5')?.id).toBe('claude-opus-5-5');
    expect(getModelById('global.anthropic.claude-opus-5-5')?.id).toBe('claude-opus-5-5');
    expect(getModelById('anthropic.claude-opus-5-5')?.id).toBe('claude-opus-5-5');
    expect(getModelById('us.anthropic.claude-opus-5')?.id).toBe('claude-opus-5');
    expect(getModelById('anthropic.claude-opus-5')?.id).toBe('claude-opus-5');
    // Opus 5.5 must not be confused with Opus 5 or 4.8.
    expect(getModelById('us.anthropic.claude-opus-5-5')?.id).not.toBe('claude-opus-5');
    expect(getModelById('us.anthropic.claude-opus-4-8')?.id).toBe('claude-opus-4-8');
  });

  it('normalizes deprecated Opus IDs to Opus 4.8 without migrating Opus 4.7 or 4.6', () => {
    expect(normalizeDeprecatedModelId('claude-opus-4-5-20251101')).toBe('claude-opus-4-8');
    expect(normalizeDeprecatedModelId('claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(normalizeDeprecatedModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(normalizeDeprecatedModelId('pi/claude-opus-4-6')).toBe('pi/claude-opus-4-6');
    expect(normalizeDeprecatedModelId('us.anthropic.claude-opus-4-6-v1')).toBe('us.anthropic.claude-opus-4-6-v1');
    // Opus 5.5 / 5 are current, never migration targets.
    expect(normalizeDeprecatedModelId('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(normalizeDeprecatedModelId('claude-opus-5')).toBe('claude-opus-5');
  });

  it('migrates the retired DeepSeek v4 Flash aliases to deepseek-flash (pi 0.86+ catalog)', () => {
    expect(normalizeDeprecatedModelId('deepseek-v4-flash')).toBe('deepseek-flash');
    expect(normalizeDeprecatedModelId('pi/deepseek-v4-flash')).toBe('pi/deepseek-flash');
    expect(normalizeDeprecatedModelId('deepseek-v4-flash-vision-exp')).toBe('deepseek-flash');
    expect(normalizeDeprecatedModelId('pi/deepseek-v4-flash-vision-exp')).toBe('pi/deepseek-flash');
    // A current id passes through untouched.
    expect(normalizeDeprecatedModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(normalizeDeprecatedModelId('deepseek-flash')).toBe('deepseek-flash');
  });
});

describe('Sonnet registry', () => {
  it('includes Sonnet 5 and keeps Sonnet 4.6', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id);
    expect(ids).toContain('claude-sonnet-5');
    expect(ids).toContain('claude-sonnet-4-6');
  });

  it('resolves "Sonnet" shortName to Sonnet 5', () => {
    expect(getModelIdByShortName('Sonnet')).toBe('claude-sonnet-5');
  });

  it('exposes Sonnet 5 metadata', () => {
    expect(getModelDisplayName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(getModelShortName('claude-sonnet-5')).toBe('Sonnet');
    expect(getModelContextWindow('claude-sonnet-5')).toBe(1_000_000);
  });

  it('maps Bedrock Sonnet 5 IDs back to the bare ID', () => {
    expect(getModelById('us.anthropic.claude-sonnet-5')?.id).toBe('claude-sonnet-5');
    expect(getModelById('anthropic.claude-sonnet-5')?.id).toBe('claude-sonnet-5');
  });
});
