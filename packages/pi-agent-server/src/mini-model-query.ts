import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import type { LLMQueryResult } from '@phaneris/shared/agent/llm-tool';
import { getDefaultSummarizationModel } from '@phaneris/shared/config/models';
import { PI_PREFERRED_DEFAULTS } from '@phaneris/shared/config/llm-connections';
import { stripPiPrefix } from './custom-endpoint-models.ts';
import { isDeniedMiniModelId, isModelRejectionError, resolvePiModel } from './model-resolution.ts';

interface MiniModelQueryOptions {
  model: string;
  miniModel?: string;
  sessionModel?: string;
  authProvider?: string;
  modelRegistry: PiModelRegistry;
  preferCustomEndpoint: boolean;
  onFallback?: (rejectedModel: string, retryModel: string) => void;
}

/**
 * Run a utility query, retrying model/catalog or endpoint-protocol rejections within the connection.
 * A catalog entry can resolve locally yet be unavailable to a ChatGPT account (notably
 * gpt-5.4-mini). Keep cheap fallbacks first, then the selected session model and provider
 * defaults; never assume the first locally resolvable model is accepted by the account.
 * The caller retains the single request deadline/cancellation scope across all attempts.
 */
export async function queryMiniModel(
  options: MiniModelQueryOptions,
  runQuery: (model: string) => Promise<string>,
): Promise<LLMQueryResult> {
  const fallbackCandidates = [
    'pi/gpt-5-mini',
    options.miniModel,
    getDefaultSummarizationModel(),
    options.sessionModel,
    ...(options.authProvider ? PI_PREFERRED_DEFAULTS[options.authProvider] ?? [] : []),
  ].filter((candidate): candidate is string => !!candidate && !isDeniedMiniModelId(candidate, options.authProvider));

  const triedModels = new Set<string>();
  let currentModel = options.model;
  const resolveCandidate = (candidate: string) => {
    const resolved = resolvePiModel(options.modelRegistry, candidate, options.authProvider, options.preferCustomEndpoint);
    if (!resolved) return undefined;
    // A compatible API authenticates its own catalog, not similarly named models
    // in the SDK's global catalog. Never leave that endpoint during a utility retry.
    if (options.preferCustomEndpoint && resolved.provider !== 'custom-endpoint') return undefined;
    if (options.authProvider && resolved.provider !== options.authProvider && resolved.provider !== 'custom-endpoint') return undefined;
    return resolved;
  };

  while (true) {
    triedModels.add(stripPiPrefix(currentModel));
    try {
      if (!resolveCandidate(currentModel)) {
        throw new Error(`model_not_found: Could not resolve mini model "${currentModel}" within the configured connection`);
      }
      const text = await runQuery(currentModel);
      return { text, model: currentModel };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A compatible gateway can list a model that only accepts another wire
      // protocol. Its explicit model-level code is safe to retry; generic tool,
      // parameter, authentication and rate-limit failures must still propagate.
      const incompatibleProtocol = options.preferCustomEndpoint && /\bModelProtocolUnsupported\b/.test(message);
      if (!incompatibleProtocol && !isModelRejectionError(message, stripPiPrefix(currentModel))) throw error;

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(stripPiPrefix(candidate))) return false;
        return !!resolveCandidate(candidate);
      });
      if (!retryModel) throw error;

      options.onFallback?.(currentModel, retryModel);
      currentModel = retryModel;
    }
  }
}
