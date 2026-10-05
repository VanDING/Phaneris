import OpenAI from 'openai';
import type {
  ImageGenerateParamsNonStreaming,
  ImagesResponse,
} from 'openai/resources/images';
import { getImageGenerationSettings, getLlmConnections, getLlmConnection, getDefaultLlmConnection, supportsNativeImageGeneration, type ImageGenerationSettings, type ImageGenerationStatus, type LlmConnection } from '@phaneris/shared/config';
import { getCredentialManager } from '@phaneris/shared/credentials';
export { supportsNativeImageGeneration } from '@phaneris/shared/config/image-generation';

export const DEFAULT_IMAGE_GENERATION_MODEL = 'gpt-image-2';
export const MAX_GENERATED_IMAGE_BYTES = 50 * 1024 * 1024;

export type GeneratedImageFormat = 'png' | 'jpeg' | 'webp';

export interface GenerateImageRequest {
  prompt: string;
  model?: string;
  size?: string;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  background?: 'auto' | 'opaque' | 'transparent';
  outputFormat?: GeneratedImageFormat;
}

export interface GeneratedImage {
  bytes: Buffer;
  model: string;
  format: GeneratedImageFormat;
  revisedPrompt?: string;
  providerCreatedAt?: number;
  provider?: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  costStatus?: 'reported' | 'estimated' | 'unknown';
}

/** Validation can fail after a paid response; keep any usage the provider disclosed. */
export class ImageGenerationError extends Error {
  constructor(cause: unknown, public readonly usage: GeneratedImage['usage'], public readonly costStatus: GeneratedImage['costStatus']) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error && cause.name === 'AbortError' ? 'AbortError' : 'ImageGenerationError';
  }
}

export interface OpenAIImageProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface ImageProviderConfig extends OpenAIImageProviderConfig {
  provider: 'openai' | 'openrouter';
}

export interface ImageApiClient {
  images: {
    generate(params: ImageGenerateParamsNonStreaming): Promise<ImagesResponse>;
  };
}

export interface ResolvedImageGenerationConnection {
  connection: LlmConnection;
  apiKey: string;
}

function createClient(config: OpenAIImageProviderConfig): ImageApiClient {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl?.trim() || undefined,
    timeout: config.timeoutMs ?? 300_000,
    maxRetries: config.maxRetries ?? 2,
  });
}

export function getDefaultImageModel(connection: LlmConnection): string {
  return connection.piAuthProvider === 'openrouter' ? 'google/gemini-2.5-flash-image' : DEFAULT_IMAGE_GENERATION_MODEL;
}

export async function getImageModels(connection: LlmConnection): Promise<Array<{ id: string; name: string }>> {
  if (connection.piAuthProvider === 'openai') return [
    { id: 'gpt-image-2', name: 'GPT Image 2' }, { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
    { id: 'gpt-image-1', name: 'GPT Image 1' }, { id: 'gpt-image-1-mini', name: 'GPT Image 1 Mini' },
  ];
  const { getBuiltinImageModels } = await import('@earendil-works/pi-ai/providers/all');
  return getBuiltinImageModels('openrouter').map(model => ({ id: model.id, name: model.name }));
}

interface ImageResolutionOptions {
  explicitSlug?: string;
  model?: string;
  preferredConnection?: LlmConnection | null;
  connections: readonly LlmConnection[];
  getApiKey: (connectionSlug: string) => Promise<string | null>;
  settings?: ImageGenerationSettings;
}

/** Explicit tool choices override app defaults. A saved explicit choice never falls back. */
export async function resolveConfiguredImageGeneration(input: ImageResolutionOptions): Promise<ResolvedImageGenerationConnection & { model: string }> {
  const settings = input.settings ?? getImageGenerationSettings();
  const explicitSlug = input.explicitSlug?.trim();
  const selected = await resolveImageGenerationConnection({ ...input, explicitSlug: explicitSlug || settings.connectionSlug });
  // A one-off account override also uses that account's model default.
  const model = input.model?.trim() || (!explicitSlug || explicitSlug === settings.connectionSlug ? settings.model : undefined) || getDefaultImageModel(selected.connection);
  return { ...selected, model };
}

export async function getImageGenerationStatus(input: Partial<Pick<ImageResolutionOptions, 'connections' | 'getApiKey' | 'preferredConnection'>> = {}): Promise<ImageGenerationStatus> {
  const settings = getImageGenerationSettings(), connections = input.connections ?? getLlmConnections();
  const getApiKey = input.getApiKey ?? (slug => getCredentialManager().getLlmApiKey(slug));
  const status: ImageGenerationStatus = { settings, connections: [] };
  for (const connection of connections.filter(supportsNativeImageGeneration)) {
    status.connections.push({ slug: connection.slug, name: connection.name, provider: connection.piAuthProvider as 'openai' | 'openrouter',
      available: !!await getApiKey(connection.slug), models: await getImageModels(connection) });
  }
  try {
    const defaultSlug = getDefaultLlmConnection();
    const preferredConnection = input.preferredConnection ?? (defaultSlug ? getLlmConnection(defaultSlug) : null);
    const selected = await resolveConfiguredImageGeneration({ connections, getApiKey, settings, preferredConnection });
    status.effective = { connectionSlug: selected.connection.slug, connectionName: selected.connection.name, model: selected.model };
  } catch (error) { status.error = error instanceof Error ? error.message : String(error); }
  return status;
}

export async function resolveImageGenerationConnection(input: {
  explicitSlug?: string;
  preferredConnection?: LlmConnection | null;
  connections: readonly LlmConnection[];
  getApiKey: (connectionSlug: string) => Promise<string | null>;
}): Promise<ResolvedImageGenerationConnection> {
  const explicitSlug = input.explicitSlug?.trim();
  const candidates = explicitSlug
    ? input.connections.filter((connection) => connection.slug === explicitSlug)
    : [
        ...(input.preferredConnection ? [input.preferredConnection] : []),
        ...input.connections.filter((connection) => connection.slug !== input.preferredConnection?.slug),
      ];
  if (explicitSlug && candidates.length === 0) {
    throw new Error(`LLM connection "${explicitSlug}" was not found.`);
  }
  if (explicitSlug && candidates[0]?.piAuthProvider === 'openai-codex') {
    throw new Error('No image-capable OpenAI API-key connection was selected. ChatGPT OAuth credentials cannot call the Images API.');
  }

  for (const connection of candidates) {
    if (!supportsNativeImageGeneration(connection)) continue;
    const apiKey = await input.getApiKey(connection.slug);
    if (apiKey) return { connection, apiKey };
    if (explicitSlug) throw new Error(`Image provider API key is missing for connection "${connection.slug}".`);
  }
  throw new Error('No image-capable API-key connection is configured. Add an OpenAI or OpenRouter API connection in AI Settings.');
}

function decodeBase64Image(value: string): Buffer {
  const normalized = value.replaceAll(/\s/g, '');
  if (!normalized || normalized.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 4) {
    throw new Error('The image provider returned an empty or oversized base64 payload.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('The image provider returned invalid base64 data.');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error('The generated image is empty or exceeds the 50 MB safety limit.');
  }
  return bytes;
}

function assertImageSignature(bytes: Buffer, format: GeneratedImageFormat): void {
  const valid = format === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : format === 'jpeg'
      ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!valid) throw new Error(`The image provider payload does not match the declared ${format.toUpperCase()} format.`);
}

/**
 * Official OpenAI Images API adapter. It deliberately requests exactly one
 * image so one paid operation maps to one managed Artifact review decision.
 */
export async function generateImageWithOpenAI(
  config: OpenAIImageProviderConfig,
  request: GenerateImageRequest,
  client: ImageApiClient = createClient(config),
): Promise<GeneratedImage> {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error('Image prompt must not be empty.');
  if (prompt.length > 32_000) throw new Error('Image prompt exceeds the 32,000 character limit.');

  const model = request.model?.trim() || DEFAULT_IMAGE_GENERATION_MODEL;
  if (model.startsWith('dall-e-')) {
    throw new Error('Legacy DALL-E models are not supported by the native Artifact workflow; use a GPT Image model.');
  }
  const outputFormat = request.outputFormat ?? 'png';
  const background = request.background ?? 'auto';
  if (background === 'transparent' && outputFormat === 'jpeg') {
    throw new Error('Transparent backgrounds require PNG or WebP output.');
  }
  if (background === 'transparent' && (model === 'gpt-image-2' || model === 'gpt-image-2-2026-04-21')) {
    throw new Error(`${model} does not support transparent backgrounds.`);
  }

  const params: ImageGenerateParamsNonStreaming = {
    prompt,
    model,
    n: 1,
    output_format: outputFormat,
    background,
    quality: request.quality ?? 'auto',
    size: request.size ?? 'auto',
    stream: false,
  };

  const response = await (client.images.generate as (params: ImageGenerateParamsNonStreaming, options?: { signal?: AbortSignal }) => Promise<ImagesResponse>)(params, { signal: config.signal });
  const usage = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined;
  try {
  const image = response.data?.[0];
  if (!image?.b64_json) {
    throw new Error('The image provider returned no inline image data.');
  }
  const bytes = decodeBase64Image(image.b64_json);
  const actualFormat = response.output_format ?? outputFormat;
  assertImageSignature(bytes, actualFormat);
  return {
    bytes,
    model,
    format: actualFormat,
    revisedPrompt: image.revised_prompt,
    providerCreatedAt: response.created,
    provider: 'openai',
    usage,
    costStatus: 'unknown',
  };
  } catch (cause) { throw new ImageGenerationError(cause, usage, 'unknown'); }
}

/** Native Pi image models remain separate from the chat catalog. Auth is explicit. */
export async function generateImage(config: ImageProviderConfig, request: GenerateImageRequest): Promise<GeneratedImage> {
  if (config.provider === 'openai') return generateImageWithOpenAI(config, request);
  if ((request.size && request.size !== 'auto') || (request.quality && request.quality !== 'auto')
    || (request.background && request.background !== 'auto') || request.outputFormat === 'webp') {
    throw new Error('This Pi image adapter does not support explicit size, quality, background, or WebP conversion. Use an OpenAI image connection for those controls.');
  }
  const prompt = request.prompt.trim();
  if (!prompt || prompt.length > 32_000) throw new Error('Image prompt must contain 1–32,000 characters.');
  const { getBuiltinImageModels, builtinModels } = await import('@earendil-works/pi-ai/providers/all');
  const modelId = request.model?.trim() || 'google/gemini-2.5-flash-image';
  const nativeModel = getBuiltinImageModels('openrouter').find(model => model.id === modelId);
  if (!nativeModel) throw new Error(`No Pi image model "${modelId}" exists for OpenRouter. Chat models cannot be used for image generation.`);
  const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  const models = builtinModels({ credentials: new InMemoryCredentialStore() });
  const model = config.baseUrl ? { ...nativeModel, baseUrl: config.baseUrl } : nativeModel;
  const result = await models.generateImages(model, { input: [{ type: 'text', text: prompt }] }, {
    apiKey: config.apiKey, signal: config.signal, timeoutMs: config.timeoutMs ?? 300_000,
    // An image request is a paid effect. Retry belongs to the caller, never hidden replay.
    maxRetries: config.maxRetries ?? 0,
  });
  const priced = Object.values(model.cost).some(rate => typeof rate === 'number' && rate > 0);
  // The SDK supplies zero-valued usage on transport errors as well. Those are
  // not evidence that an interrupted paid request was free.
  const reportedUsage = result.usage;
  const observedUsage = reportedUsage && (reportedUsage.input + reportedUsage.output + reportedUsage.cacheRead + reportedUsage.cacheWrite > 0 || reportedUsage.cost.total > 0) ? reportedUsage : undefined;
  const usage = observedUsage ? { inputTokens: observedUsage.input + observedUsage.cacheRead + observedUsage.cacheWrite,
    outputTokens: observedUsage.output, costUsd: priced ? observedUsage.cost.total : undefined } : undefined;
  const costStatus = observedUsage && priced ? 'estimated' as const : 'unknown' as const;
  try {
  if (result.stopReason !== 'stop') throw new Error(result.errorMessage ?? `Image generation ${result.stopReason}`);
  const images = result.output.filter(item => item.type === 'image');
  if (images.length !== 1) throw new Error(`The image provider returned ${images.length} images; this Artifact operation requires exactly one.`);
  const image = images[0]!;
  const format = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/jpeg' ? 'jpeg' : image.mimeType === 'image/webp' ? 'webp' : undefined;
  if (!format) throw new Error(`Unsupported generated image type: ${image.mimeType}`);
  const bytes = decodeBase64Image(image.data); assertImageSignature(bytes, format);
  let output = bytes;
  let outputFormat: GeneratedImageFormat = format;
  if (request.outputFormat && request.outputFormat !== format) {
    const { convertGeneratedImage } = await import('./image-utils');
    output = await convertGeneratedImage(bytes, request.outputFormat); outputFormat = request.outputFormat;
    assertImageSignature(output, outputFormat);
  }
  return { bytes: output, format: outputFormat, provider: 'openrouter', model: result.model,
    providerCreatedAt: result.timestamp, usage, costStatus };
  } catch (cause) { throw new ImageGenerationError(cause, usage, costStatus); }
}
