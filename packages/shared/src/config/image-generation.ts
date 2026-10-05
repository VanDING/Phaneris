import type { LlmConnection } from './llm-connections.ts';

/** Image output defaults are separate from conversation models and image input. */
export interface ImageGenerationSettings {
  connectionSlug?: string;
  model?: string;
}

export interface ImageGenerationStatus {
  settings: ImageGenerationSettings;
  effective?: { connectionSlug: string; connectionName: string; model: string };
  error?: string;
  connections: Array<{ slug: string; name: string; provider: 'openai' | 'openrouter'; available: boolean; models: Array<{ id: string; name: string }> }>;
}

export function supportsNativeImageGeneration(connection: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'authType'>): boolean {
  return connection.providerType === 'pi'
    && (connection.piAuthProvider === 'openai' || connection.piAuthProvider === 'openrouter')
    && connection.authType === 'api_key';
}

export function normalizeImageGenerationSettings(input: unknown): ImageGenerationSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Image generation settings must be an object.');
  const settings: ImageGenerationSettings = {};
  for (const key of ['connectionSlug', 'model'] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.trim().length > 256) throw new Error(`Invalid image generation ${key}.`);
    if (value.trim()) settings[key] = value.trim();
  }
  return settings;
}
