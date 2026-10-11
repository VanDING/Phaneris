import { normalizeModelIds, modelSetEquals, inferModelSelectionMode, ensureDefaultLlmConnection } from './connection-normalize.ts';
export { modelSetEquals, inferModelSelectionMode, ensureDefaultLlmConnection } from './connection-normalize.ts';
/** migrations ownership. config.json writes belong exclusively to repository.ts. */

import { getCredentialManager } from '../credentials/index.ts';

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../workspaces/storage.ts';

import { debug } from '../utils/debug.ts';

import { type AuthType } from '@phaneris/core/types';

import { type LlmConnection, isValidProviderAuthCombination, getDefaultModelsForConnection, getDefaultModelForConnection, isPiProvider, toBedrockNativeId, type LlmProviderType } from './llm-connections.ts';

import { getModelProvider, getModelById, getModelDisplayName, normalizeDeprecatedModelId, type ModelDefinition } from './models.ts';

import { type StoredConfig } from './persisted-types.ts';

import { loadStoredConfig, saveConfig } from './repository.ts';

import { getWorkspaces } from './workspace-selection.ts';

/**
 * Migrate Codex (OpenAI) and Copilot connections to Pi backend.
 * Runs on startup — transparently routes existing users through PiAgent.
 *
 * No re-auth needed: credentials are keyed by connection slug (not provider),
 * and PiAgent reads the same OAuth tokens via piAuthProvider.
 *
 * Migration rules:
 * - openai + oauth       → pi + openai-codex
 * - openai + api_key     → pi + openai
 * - openai_compat        → pi + openai  (keep baseUrl)
 * - copilot              → pi + github-copilot
 * - defaultModel reset to Pi's default (stale Codex/Copilot model IDs dropped)
 * - codexPath removed (no longer needed)
 */
function migrateCodexCopilotToPi(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;
  let changed = false;

  for (const connection of config.llmConnections) {
    // Cast to string for legacy providerType values that were removed from LlmProviderType
    // but may still exist on disk in old configs. Cast to any for legacy codexPath field.
    const providerStr = connection.providerType as string;
    const connAny = connection as any;
    if (providerStr === 'openai' && connection.authType === 'oauth') {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'openai-codex';
      connection.name = 'ChatGPT Plus (via Pi)';
      delete connAny.codexPath;
      connection.defaultModel = undefined; // reset — backfill picks Pi default
      connection.models = undefined;
      changed = true;
    } else if (providerStr === 'openai' && (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint')) {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'openai';
      connection.name = 'OpenAI API (via Pi)';
      delete connAny.codexPath;
      connection.defaultModel = undefined;
      connection.models = undefined;
      changed = true;
    } else if (providerStr === 'openai_compat') {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'openai';
      // keep baseUrl for custom endpoints
      delete connAny.codexPath;
      connection.defaultModel = undefined;
      connection.models = undefined;
      changed = true;
    } else if (providerStr === 'copilot') {
      connection.providerType = 'pi';
      connection.piAuthProvider = 'github-copilot';
      connection.name = 'GitHub Copilot (via Pi)';
      delete connAny.codexPath;
      connection.defaultModel = undefined;
      connection.models = undefined;
      changed = true;
    }
  }

  // Clean up openaiVariant config field (Codex-specific A/B testing, no longer relevant)
  const configAny = config as any;
  if (configAny.openaiVariant) {
    delete configAny.openaiVariant;
    changed = true;
  }

  return changed;
}

/**
 * Backfill models and defaultModel on ALL connections.
 * Ensures built-in connections (anthropic, openai) always have models populated,
 * not just compat connections.
 */
export function shouldMigratePiOpenAiProvider(connection: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'authType' | 'baseUrl'>): boolean {
  // Legacy cleanup: old ChatGPT Plus OAuth connections may still be tagged as `openai`.
  // Only migrate those to `openai-codex`.
  //
  // IMPORTANT: Do NOT migrate API-key or custom-endpoint connections:
  // - `api_key` / `api_key_with_endpoint` with `openai` must remain regular OpenAI API auth.
  // - forcing them to `openai-codex` routes requests to ChatGPT backend auth and breaks on restart.
  if (!isPiProvider(connection.providerType)) return false;
  if (connection.piAuthProvider !== 'openai') return false;
  if (connection.authType !== 'oauth') return false;
  if (typeof connection.baseUrl === 'string' && connection.baseUrl.trim().length > 0) return false;
  return true;
}

export function shouldRepairPiApiKeyCodexProvider(connection: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'authType'>): boolean {
  // Repair broken state from previous startup migrations:
  // API-key connections tagged as `openai-codex` try ChatGPT backend JWT auth and fail.
  if (!isPiProvider(connection.providerType)) return false;
  if (connection.piAuthProvider !== 'openai-codex') return false;
  return connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint';
}







function backfillAllConnectionModels(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;
  let changed = false;
  for (const connection of config.llmConnections) {
    // Repair previously broken API-key migration first.
    if (shouldRepairPiApiKeyCodexProvider(connection)) {
      connection.piAuthProvider = 'openai';
      changed = true;
    }

    // Migrate only legacy OAuth-backed Pi OpenAI connections to ChatGPT backend provider key.
    if (shouldMigratePiOpenAiProvider(connection)) {
      connection.piAuthProvider = 'openai-codex';
      changed = true;
    }

    const defaultModels = getDefaultModelsForConnection(connection.providerType, connection.piAuthProvider);
    const defaultModel = getDefaultModelForConnection(connection.providerType, connection.piAuthProvider);
    const providerDefaultModelIds = normalizeModelIds(defaultModels as Array<{ id: string } | string>);

    // Note: bedrock connections are migrated to pi + amazon-bedrock by migrateLegacyProviderTypes()
    // before this function runs, so no bedrock-specific normalization needed here.

    if (isPiProvider(connection.providerType) && connection.piAuthProvider) {
      // Copilot models are always server-managed (GitHub policy controls which
      // models are enabled), so force automaticallySyncedFromProvider regardless
      // of what inferModelSelectionMode would compute from stale static SDK data.
      const isCopilot = connection.piAuthProvider === 'github-copilot';
      const mode = isCopilot
        ? 'automaticallySyncedFromProvider' as const
        : (connection.modelSelectionMode ?? inferModelSelectionMode(connection, providerDefaultModelIds));
      if (connection.modelSelectionMode !== mode) {
        debug('[storage] backfill mode inferred', {
          slug: connection.slug,
          piAuthProvider: connection.piAuthProvider,
          from: connection.modelSelectionMode,
          to: mode,
          currentModelCount: normalizeModelIds(connection.models).length,
        });
        connection.modelSelectionMode = mode;
        changed = true;
      }

      if (mode === 'automaticallySyncedFromProvider') {
        const currentIds = normalizeModelIds(connection.models);
        if (providerDefaultModelIds.length > 0 && !modelSetEquals(currentIds, providerDefaultModelIds)) {
          connection.models = defaultModels;
          changed = true;
        }
      } else {
        const currentIds = normalizeModelIds(connection.models);
        if (providerDefaultModelIds.length > 0) {
          const allowedIds = new Set(providerDefaultModelIds);
          const canonicalCurrentIds = currentIds.map((id) => {
            if (allowedIds.has(id)) return id;
            if (!id.startsWith('pi/')) {
              const prefixed = `pi/${id}`;
              if (allowedIds.has(prefixed)) return prefixed;
            }
            return id;
          });
          const filtered = canonicalCurrentIds.filter(id => allowedIds.has(id));

          if (!modelSetEquals(canonicalCurrentIds, currentIds) || filtered.length !== currentIds.length) {
            debug('[storage] backfill userDefined filtered', {
              slug: connection.slug,
              piAuthProvider: connection.piAuthProvider,
              beforeCount: currentIds.length,
              canonicalCount: canonicalCurrentIds.length,
              afterCount: filtered.length,
              beforeFirst5: currentIds.slice(0, 5),
              afterFirst5: filtered.slice(0, 5),
            });
            connection.models = filtered;
            changed = true;
          }

          if (filtered.length === 0) {
            debug('[storage] backfill userDefined fallback-to-defaults', {
              slug: connection.slug,
              piAuthProvider: connection.piAuthProvider,
              defaultCount: providerDefaultModelIds.length,
            });
            connection.models = defaultModels;
            changed = true;
          }
        }
      }
    }

    if (defaultModels.length > 0 && (!connection.models || (Array.isArray(connection.models) && connection.models.length === 0))) {
      connection.models = defaultModels;
      changed = true;
    }

    if (!connection.defaultModel && defaultModel) {
      connection.defaultModel = defaultModel;
      changed = true;
    }

    // Validate that existing defaultModel is in the models list
    if (connection.defaultModel && connection.models && Array.isArray(connection.models) && connection.models.length > 0) {
      const modelIds = connection.models.map(m => typeof m === 'string' ? m : m.id);
      if (!modelIds.includes(connection.defaultModel)) {
        // Reset to first available model in the list
        const firstModelId = modelIds[0];
        if (firstModelId) {
          connection.defaultModel = firstModelId;
        }
        changed = true;
      }
    }
  }
  return changed;
}

const OPUS_DEFAULT_ID = 'claude-opus-4-8';

const OPUS_FALLBACK_ID = 'claude-opus-4-7';

function defaultModelIdsForConnection(connection: LlmConnection): Set<string> {
  return new Set(
    getDefaultModelsForConnection(connection.providerType, connection.piAuthProvider)
      .map(model => typeof model === 'string' ? model : model.id),
  );
}

function normalizeConnectionModelId(connection: LlmConnection, modelId: string): string {
  const normalized = normalizeDeprecatedModelId(modelId);

  // Bedrock connections run through Pi and need native inference-profile IDs.
  if (connection.providerType === 'pi' && connection.piAuthProvider === 'amazon-bedrock') {
    const hasPiPrefix = normalized.startsWith('pi/');
    const bare = hasPiPrefix ? normalized.slice(3) : normalized;
    const native = toBedrockNativeId(bare);
    const defaults = defaultModelIdsForConnection(connection);
    const prefixedCandidate = `pi/${native}`;
    const candidate = hasPiPrefix || defaults.has(prefixedCandidate) ? prefixedCandidate : native;

    // Pi 0.73.1 does not yet expose Opus 4.8. Keep 4.7 as the selectable fallback
    // until the upstream catalog adds 4.8; the preferred-default list is already future-proofed.
    if (bare === OPUS_DEFAULT_ID || native.endsWith(`.${OPUS_DEFAULT_ID}`)) {
      const fallbackNative = toBedrockNativeId(OPUS_FALLBACK_ID);
      const prefixedFallback = `pi/${fallbackNative}`;
      const fallback = defaults.has(prefixedFallback) ? prefixedFallback : fallbackNative;
      if (!defaults.has(candidate) && defaults.has(fallback)) return fallback;
    }
    return candidate;
  }

  if (connection.providerType === 'pi') {
    const defaults = defaultModelIdsForConnection(connection);
    const hasPiPrefix = normalized.startsWith('pi/');
    const bare = hasPiPrefix ? normalized.slice(3) : normalized;
    const prefixedCandidate = `pi/${bare}`;
    const candidate = hasPiPrefix || defaults.has(prefixedCandidate) ? prefixedCandidate : normalized;
    const prefixedFallback = `pi/${OPUS_FALLBACK_ID}`;
    const fallback = defaults.has(prefixedFallback) ? prefixedFallback : OPUS_FALLBACK_ID;
    if ((bare === OPUS_DEFAULT_ID)
      && !defaults.has(candidate)
      && defaults.has(fallback)) {
      return fallback;
    }
    if (bare === OPUS_DEFAULT_ID && candidate !== normalized) {
      return candidate;
    }
  }

  return normalized;
}

function displayNameForMigratedModel(modelId: string): string {
  const bareModelId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;
  return getModelDisplayName(bareModelId);
}

function withUpdatedModelEntry(
  _connection: LlmConnection,
  entry: ModelDefinition | string,
  nextId: string,
): ModelDefinition | string {
  if (typeof entry === 'string') {
    return nextId;
  }

  const nextEntry: ModelDefinition = { ...entry, id: nextId };
  if (nextEntry.name && /Opus 4\.[56]/.test(nextEntry.name)) {
    nextEntry.name = displayNameForMigratedModel(nextId);
  }
  return nextEntry;
}

function modelEntryForDefault(_connection: LlmConnection, modelId: string): ModelDefinition | string {
  return modelId;
}

/**
 * Migrate deprecated Opus 4.5/4.6 IDs and previous direct-Anthropic Opus 4.7 defaults to the current default Opus model.
 * Custom/compat endpoints are intentionally skipped because provider-specific aliases may differ.
 */
function migrateLegacyOpusToDefaultOpus(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  let changed = false;

  for (const connection of config.llmConnections) {
    if (connection.providerType !== 'pi') continue;

    if (connection.defaultModel) {
      let normalizedDefault = normalizeConnectionModelId(connection, connection.defaultModel);
      // The previous direct-Anthropic default was Opus 4.7. Move existing
      // direct-Anthropic defaults to Opus 4.8 while keeping 4.7 in the model list.
      // Pi stays on 4.7 until the current Pi catalog exposes 4.8.
      if (normalizedDefault !== connection.defaultModel) {
        connection.defaultModel = normalizedDefault;
        changed = true;
      }
    }

    if (connection.models && Array.isArray(connection.models)) {
      const nextModels: Array<ModelDefinition | string> = [];
      const seen = new Set<string>();
      let connectionModelsChanged = false;

      for (const entry of connection.models) {
        const currentId = typeof entry === 'string' ? entry : entry.id;
        const nextId = normalizeConnectionModelId(connection, currentId);

        if (seen.has(nextId)) {
          connectionModelsChanged = true;
          continue;
        }
        seen.add(nextId);

        if (nextId !== currentId) {
          nextModels.push(withUpdatedModelEntry(connection, entry, nextId));
          connectionModelsChanged = true;
        } else {
          nextModels.push(entry);
        }
      }

      if (connection.defaultModel && !seen.has(connection.defaultModel)) {
        nextModels.unshift(modelEntryForDefault(connection, connection.defaultModel));
        connectionModelsChanged = true;
      }

      if (connectionModelsChanged) {
        connection.models = nextModels;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Restore claude-opus-4-6 to direct Anthropic connections that were previously
 * force-migrated to 4.8 and no longer list 4.6. Runs once per user (tracked via
 * config.migrationsApplied). Never touches `defaultModel` — users keep whatever
 * default they had, and can switch models themselves.
 *
 * The marker is versioned ("-2") because the pre-4.8 restore already consumed
 * 'opus-4-6-restored' in long-time users' configs; this restore must fire
 * again after the 4.8-era removal.
 *
 * TODO(opus-4.6-sunset): drop this call and the function when 4.6 is deprecated.
 */
function restoreOpus46ToAnthropicConnections(config: StoredConfig): boolean {
  const OPUS_46_ID = 'claude-opus-4-6';
  const MARKER = 'opus-4-6-restored-2';
  const alreadyRan = config.migrationsApplied?.includes(MARKER) ?? false;

  // Anthropic connection.models entries are stored as full ModelDefinition
  // objects (via backfillAllConnectionModels). The model picker reads
  // model.name and falls back to the raw ID for bare strings, so we must
  // push the object form to render as "Opus 4.6".
  const opus46Model = getModelById(OPUS_46_ID);
  if (!opus46Model) {
    // Defensive — 4.6 is registered in this same PR, should never happen.
    if (!alreadyRan) {
      config.migrationsApplied = [...(config.migrationsApplied ?? []), MARKER];
      return true;
    }
    return false;
  }

  let changed = false;

  for (const connection of config.llmConnections ?? []) {
    // Fork: single-Pi-backend — direct Anthropic connections are 'pi' provider
    // with piAuthProvider === 'anthropic'. Upstream's 'anthropic' providerType
    // does not exist here.
    if (connection.providerType !== 'pi') continue;
    if (connection.piAuthProvider !== 'anthropic') continue;
    if (!Array.isArray(connection.models) || connection.models.length === 0) continue;

    // Fork model IDs carry the 'pi/' provider prefix (e.g. 'pi/claude-opus-4-6').
    const stripPiPrefix = (id: string): string => id.startsWith('pi/') ? id.slice(3) : id;

    // Idempotent shape repair: normalize any bare-string 'claude-opus-4-6'
    // entry to the ModelDefinition object form. Runs regardless of the
    // one-shot marker because it's a display-shape fix, not a new entry.
    // Prefixed strings ('pi/claude-opus-4-6') are already in the canonical
    // fork shape and stay untouched.
    for (let i = 0; i < connection.models.length; i++) {
      const m = connection.models[i];
      if (typeof m === 'string' && m === OPUS_46_ID) {
        connection.models[i] = { ...opus46Model, id: `pi/${OPUS_46_ID}` };
        changed = true;
      }
    }

    // One-shot restore: only append 4.6 on the first run for a given user.
    // A deliberate removal after the marker is set should stick.
    if (alreadyRan) continue;

    const ids = connection.models.map(m => typeof m === 'string' ? m : m.id);
    const hasDefaultOpus = ids.some(id => {
      const bare = stripPiPrefix(id);
      return bare === OPUS_DEFAULT_ID || bare === OPUS_FALLBACK_ID;
    });
    if (hasDefaultOpus && !ids.some(id => stripPiPrefix(id) === OPUS_46_ID)) {
      connection.models.push({ ...opus46Model, id: `pi/${OPUS_46_ID}` });
      changed = true;
    }
  }

  // Mark the migration as seen on the first run — even when no connection
  // was eligible — so subsequent runs don't keep re-checking.
  if (!alreadyRan) {
    config.migrationsApplied = [...(config.migrationsApplied ?? []), MARKER];
    return true;
  }
  return changed;
}

/**
 * Migrate Sonnet 4.5 to Sonnet 4.6 for direct Anthropic connections.
 * Updates stored model IDs and names for direct Anthropic connections.
 */
function migrateSonnet45ToSonnet46(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  const SONNET_45_ID = 'claude-sonnet-4-5-20250929';
  const SONNET_46_ID = 'claude-sonnet-4-6';

  let changed = false;

  for (const connection of config.llmConnections) {
    // Only migrate pi connections (not compat/third-party)

    if (connection.providerType !== 'pi') continue;
    if (connection.defaultModel === SONNET_45_ID) {
      connection.defaultModel = SONNET_46_ID;
      changed = true;
    }

    // Migrate models array
    if (connection.models && Array.isArray(connection.models)) {
      const hasNew = connection.models.some(m =>
        (typeof m === 'string' ? m : m.id) === SONNET_46_ID
      );

      if (hasNew) {
        // New model already exists — just remove the old entry to avoid duplicates
        const before = connection.models.length;
        connection.models = connection.models.filter(m =>
          (typeof m === 'string' ? m : m.id) !== SONNET_45_ID
        );
        if (connection.models.length !== before) changed = true;
      } else {
        // New model doesn't exist — rename the old entry in place
        for (let i = 0; i < connection.models.length; i++) {
          const model = connection.models[i];
          if (typeof model === 'string' && model === SONNET_45_ID) {
            connection.models[i] = SONNET_46_ID;
            changed = true;
          } else if (typeof model === 'object' && model.id === SONNET_45_ID) {
            model.id = SONNET_46_ID;
            if (model.name?.includes('4.5')) {
              model.name = model.name.replace('4.5', '4.6');
            }
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

/**
 * Migrate Sonnet 4.5 to Sonnet 4.6 in workspace default models.
 */
function migrateWorkspaceSonnet45ToSonnet46(config: StoredConfig): void {
  if (!config.workspaces) return;

  const SONNET_45_ID = 'claude-sonnet-4-5-20250929';
  const SONNET_46_ID = 'claude-sonnet-4-6';

  for (const workspace of config.workspaces) {
    const wsConfig = loadWorkspaceConfig(workspace.rootPath);
    if (!wsConfig?.defaults?.model) continue;

    if (wsConfig.defaults.model === SONNET_45_ID) {
      wsConfig.defaults.model = SONNET_46_ID;
      saveWorkspaceConfig(workspace.rootPath, wsConfig);
    }
  }
}

/**
 * Migrate deprecated/previous Opus defaults in workspace default models to the current default Opus model.
 */
function migrateWorkspaceLegacyOpusToDefaultOpus(config: StoredConfig): void {
  if (!config.workspaces) return;

  for (const workspace of config.workspaces) {
    const wsConfig = loadWorkspaceConfig(workspace.rootPath);
    if (!wsConfig?.defaults?.model) continue;

    const normalized = normalizeDeprecatedModelId(wsConfig.defaults.model);
    const nextModel = normalized === OPUS_FALLBACK_ID ? OPUS_DEFAULT_ID : normalized;
    if (nextModel !== wsConfig.defaults.model) {
      wsConfig.defaults.model = nextModel;
      saveWorkspaceConfig(workspace.rootPath, wsConfig);
    }
  }
}

/**
 * Migrate legacy provider types to the active set (anthropic, pi, pi_compat).
 *
 * 1. providerType==='bedrock' → 'pi' with piAuthProvider='amazon-bedrock'.
 *    Model IDs are normalized to Bedrock-native (pi-prefixed) for Pi SDK resolution.
 *
 * 2. providerType==='vertex' → 'pi' with piAuthProvider='google-vertex'.
 *
 * 3. providerType==='anthropic_compat' → 'pi_compat' with customEndpoint.api='anthropic-messages'.
 *    Preserves baseUrl and models; authType 'api_key_with_endpoint' stays the same.
 *
 * Also normalizes Pi+Bedrock connections that already have correct providerType.
 */
function migrateLegacyProviderTypes(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  let changed = false;

  for (const connection of config.llmConnections) {
    // Cast to string for legacy values removed from LlmProviderType
    const providerStr = connection.providerType as string;

    // --- bedrock → pi + amazon-bedrock ---
    if (providerStr === 'bedrock') {
      (connection as { providerType: LlmProviderType }).providerType = 'pi';
      connection.piAuthProvider = connection.piAuthProvider || 'amazon-bedrock';
      // Normalize model IDs to Bedrock-native (pi-prefixed) for Pi SDK
      if (connection.defaultModel) {
        connection.defaultModel = normalizePiBedrockId(connection.defaultModel);
      }
      if (connection.models && Array.isArray(connection.models)) {
        for (let i = 0; i < connection.models.length; i++) {
          const model = connection.models[i];
          if (typeof model === 'string') {
            connection.models[i] = normalizePiBedrockId(model);
          } else if (model && typeof model === 'object') {
            model.id = normalizePiBedrockId(model.id);
          }
        }
      }
      changed = true;
      continue;
    }

    // --- vertex → pi + google-vertex ---
    if (providerStr === 'vertex') {
      (connection as { providerType: LlmProviderType }).providerType = 'pi';
      connection.piAuthProvider = 'google-vertex';
      changed = true;
      continue;
    }

    // --- anthropic_compat → pi_compat + customEndpoint ---
    if (providerStr === 'anthropic_compat') {
      (connection as { providerType: LlmProviderType }).providerType = 'pi_compat';
      connection.customEndpoint = { api: 'anthropic-messages' };
      // authType 'api_key_with_endpoint' stays; baseUrl and models are preserved
      changed = true;
      continue;
    }

    // --- anthropic → pi ---
    if (providerStr === 'anthropic') {
      (connection as { providerType: LlmProviderType }).providerType = 'pi';
      // Direct Anthropic connections map to the Pi 'anthropic' auth provider so
      // model catalogs, defaults, and the Opus 4.6 restore apply to them.
      connection.piAuthProvider = connection.piAuthProvider || 'anthropic';
      changed = true;
      continue;
    }

    // Forward: Pi+Bedrock connections need Bedrock-native IDs (pi-prefixed) for Pi SDK resolution
    if (connection.providerType === 'pi' && connection.piAuthProvider === 'amazon-bedrock') {
      if (connection.defaultModel) {
        const normalized = normalizePiBedrockId(connection.defaultModel);
        if (normalized !== connection.defaultModel) {
          connection.defaultModel = normalized;
          changed = true;
        }
      }
      if (connection.models && Array.isArray(connection.models)) {
        for (let i = 0; i < connection.models.length; i++) {
          const model = connection.models[i];
          if (typeof model === 'string') {
            const normalized = normalizePiBedrockId(model);
            if (normalized !== model) { connection.models[i] = normalized; changed = true; }
          } else if (model && typeof model === 'object') {
            const normalized = normalizePiBedrockId(model.id);
            if (normalized !== model.id) { model.id = normalized; changed = true; }
          }
        }
      }
    }
  }

  return changed;
}

/** Normalize a pi/-prefixed model ID for Bedrock: pi/claude-opus-4-8 → pi/us.anthropic.claude-opus-4-8 */
function normalizePiBedrockId(id: string): string {
  const bare = id.startsWith('pi/') ? id.slice(3) : id;
  const native = toBedrockNativeId(normalizeDeprecatedModelId(bare));
  return `pi/${native}`;
}

/**
 * Enforce the endpoint invariant: `customEndpoint` exists iff the connection is
 * `pi_compat`.
 *
 * Older setup classified on the presence of a base URL, so two contradictory
 * shapes exist: compat connections with no protocol at all, and native
 * connections still carrying a protocol from a save that once went compat. The
 * first cannot be routed (Pi has no protocol to register) nor reach the
 * provider's own catalog; the second makes the next save disagree with the
 * stored routing. Both collapse to the native Pi provider their
 * `piAuthProvider` names.
 */
function repairConnectionTransports(config: StoredConfig): boolean {
  if (!config.llmConnections) return false;

  let changed = false;
  for (const connection of config.llmConnections) {
    if (connection.providerType === 'pi_compat') {
      if (connection.customEndpoint?.api) continue;
      connection.providerType = 'pi';
      if (connection.authType === 'api_key_with_endpoint') {
        connection.authType = 'api_key';
      }
      changed = true;
      continue;
    }

    // Native transports never register an endpoint protocol; a leftover one is
    // stale metadata from the URL-based classification.
    if (connection.customEndpoint !== undefined) {
      delete connection.customEndpoint;
      changed = true;
    }
  }
  return changed;
}

/**
 * Migrate modelDefaults onto connection.defaultModel, then delete modelDefaults.
 * If user had set modelDefaults.anthropic, apply it to the default anthropic connection.
 * Same for openai. Then remove modelDefaults from config.
 */
function migrateModelDefaultsToConnections(config: StoredConfig): boolean {
  const configAny = config as any;
  if (!configAny.modelDefaults || !config.llmConnections) return false;
  let changed = false;

  // Apply anthropic model default to the default pi connection
  if (configAny.modelDefaults.anthropic) {
    const defaultSlug = config.defaultLlmConnection;
    const anthropicConn = config.llmConnections.find(c =>
      c.slug === defaultSlug && c.providerType === 'pi'
    ) || config.llmConnections.find(c =>
      c.providerType === 'pi'
    );
    if (anthropicConn) {
      anthropicConn.defaultModel = configAny.modelDefaults.anthropic;
      changed = true;
    }
  }

  // Apply openai model default to the default openai connection
  // Cast providerType to string for legacy values removed from LlmProviderType
  if (configAny.modelDefaults.openai) {
    const openaiConn = config.llmConnections.find(c =>
      (c.providerType as string) === 'openai' || (c.providerType as string) === 'openai_compat'
    );
    if (openaiConn) {
      openaiConn.defaultModel = configAny.modelDefaults.openai;
      changed = true;
    }
  }

  // Delete modelDefaults
  delete configAny.modelDefaults;
  changed = true;

  return changed;
}

/**
 * Migrate legacy auth config to LLM connections.
 * Call this on app startup before any getLlmConnections() calls.
 *
 * This is a one-time migration that converts:
 * - Legacy authType field → LlmConnection in llmConnections array
 * - Legacy anthropicBaseUrl → LlmConnection.baseUrl
 * - Legacy customModel → LlmConnection.defaultModel
 * - Legacy model → modelDefaults (per provider)
 *
 * After migration, the legacy fields are deleted since they are no longer used.
 */
export function migrateLegacyLlmConnectionsConfig(): void {
  const config = loadStoredConfig();
  if (!config) return;

  const normalizeModelList = (models?: Array<{ id: string } | string>): string[] => {
    if (!models) return [];
    return models
      .map(model => (typeof model === 'string' ? model : model.id))
      .filter(Boolean);
  };

  const applyCompatDefaults = (target: StoredConfig): boolean => {
    if (!target.llmConnections) return false;
    let changed = false;
    for (const connection of target.llmConnections) {
      // Cast to string for legacy 'openai_compat' values that may still exist on disk
      const providerStr = connection.providerType as string;
      if (providerStr !== 'openai_compat') {
        continue;
      }
      const compatDefaults = getDefaultModelsForConnection(connection.providerType).map(
        m => typeof m === 'string' ? m : m.id
      );
      const normalizedModels = normalizeModelList(connection.models);
      if (normalizedModels.length === 0) {
        connection.models = [...compatDefaults];
        changed = true;
      } else if (normalizedModels.length !== (connection.models?.length ?? 0)) {
        connection.models = [...normalizedModels];
        changed = true;
      }
      // Backfill any new default models that are missing from existing connections
      // (e.g., Sonnet added to compat defaults after user already created connection)
      let currentModels = normalizeModelList(connection.models);
      for (const defaultModel of compatDefaults) {
        if (!currentModels.includes(defaultModel)) {
          currentModels = [...currentModels, defaultModel];
          changed = true;
        }
      }
      if (changed) {
        connection.models = currentModels;
      }
      const currentDefault = connection.defaultModel?.trim();
      if (!currentDefault) {
        connection.defaultModel = (normalizeModelList(connection.models)[0] ?? compatDefaults[0]);
        changed = true;
      } else if (!normalizeModelList(connection.models).includes(currentDefault)) {
        connection.models = [currentDefault, ...normalizeModelList(connection.models).filter(m => m !== currentDefault)];
        changed = true;
      }
    }
    return changed;
  };

  // Already migrated - llmConnections array exists
  if (config.llmConnections !== undefined) {
    // Clean up any remaining legacy fields from previous runs
    let needsSave = false;
    const configAny = config as any;
    if ('authType' in config) {
      delete configAny.authType;
      needsSave = true;
    }
    if ('anthropicBaseUrl' in config) {
      delete configAny.anthropicBaseUrl;
      needsSave = true;
    }
    if ('customModel' in config) {
      delete configAny.customModel;
      needsSave = true;
    }
    if ('model' in config) {
      const legacyModel = configAny.model as string | undefined;
      if (legacyModel) {
        const provider = getModelProvider(legacyModel) ?? 'anthropic';
        configAny.modelDefaults = { ...(configAny.modelDefaults ?? {}), [provider]: legacyModel };
      }
      delete configAny.model;
      needsSave = true;
    }
    // Note: applyCompatDefaults() is NOT called here for already-migrated configs.
    // Compat connections are user-owned after creation — the app should not
    // silently extend or override the user's model list on every startup.
    // Compat defaults are only applied during fresh connection creation or
    // first-time legacy migration (the config.llmConnections === undefined path below).

    // Phase 1a-bis: Migrate Codex/Copilot connections to Pi backend
    if (migrateCodexCopilotToPi(config)) {
      needsSave = true;
    }

    // Phase 1b: Normalize legacy Opus IDs/defaults before Pi model-list filtering.
    if (migrateLegacyOpusToDefaultOpus(config)) {
      needsSave = true;
    }
    // Phase 1c: Backfill models/defaultModel on ALL connections (not just compat)
    // This ensures built-in connections (anthropic, openai) always have models populated
    if (backfillAllConnectionModels(config)) {
      needsSave = true;
    }
    // Phase 1d: Migrate modelDefaults onto connection.defaultModel, then delete modelDefaults
    if (migrateModelDefaultsToConnections(config)) {
      needsSave = true;
    }
    // Phase 1e: Normalize anything introduced by modelDefaults.
    if (migrateLegacyOpusToDefaultOpus(config)) {
      needsSave = true;
    }
    // Phase 1f: Migrate legacy/previous Opus workspace defaults → current default Opus
    migrateWorkspaceLegacyOpusToDefaultOpus(config);
    // Phase 1g: Migrate Sonnet 4.5 → Sonnet 4.6 for direct Anthropic connections
    if (migrateSonnet45ToSonnet46(config)) {
      needsSave = true;
    }
    // Phase 1h: Migrate Sonnet 4.5 → Sonnet 4.6 in workspace default models
    migrateWorkspaceSonnet45ToSonnet46(config);
    // Phase 1j: Migrate legacy provider types (bedrock/vertex/anthropic_compat → pi/pi_compat)
    if (migrateLegacyProviderTypes(config)) {
      needsSave = true;
    }
    // Phase 1j-bis: Enforce the endpoint invariant (customEndpoint ⇔ pi_compat)
    if (repairConnectionTransports(config)) {
      needsSave = true;
    }
    // Phase 1k: Normalize legacy Opus IDs introduced by provider-type migration.
    // Important for old Bedrock connections: they become Pi+Bedrock first, then can
    // fall back from Opus 4.8 to 4.7 while Pi's catalog lacks 4.8.
    if (migrateLegacyOpusToDefaultOpus(config)) {
      needsSave = true;
    }
    // Phase 1m: Restore Opus 4.6 to direct Anthropic connections that were
    // previously force-migrated away from it (one-shot, guarded by marker).
    // TODO(opus-4.6-sunset): drop this call and the function when 4.6 is deprecated.
    if (restoreOpus46ToAnthropicConnections(config)) {
      needsSave = true;
    }

    if (needsSave) {
      saveConfig(config);
    }
    return;
  }

  // Initialize empty array
  config.llmConnections = [];

  // Legacy migration: if user had authType set, create a connection for them
  const configAny = config as any;
  const legacyAuthType = configAny.authType as AuthType | undefined;
  const legacyBaseUrl = configAny.anthropicBaseUrl as string | undefined;
  const legacyCustomModel = configAny.customModel as string | undefined;
  const legacyModel = configAny.model as string | undefined;

  if (legacyAuthType) {
    let migrated: LlmConnection | null = null;

    if (legacyAuthType === 'oauth_token') {
      // Claude Max OAuth
      migrated = {
        slug: 'claude-max',
        name: 'Claude Max',
        providerType: 'pi',
        authType: 'oauth',
        models: getDefaultModelsForConnection('pi'),
        createdAt: Date.now(),
      };
    } else if (legacyAuthType === 'codex_oauth') {
      // ChatGPT Plus OAuth → Pi backend
      migrated = {
        slug: 'codex',
        name: 'ChatGPT Plus (via Pi)',
        providerType: 'pi',
        authType: 'oauth',
        piAuthProvider: 'openai-codex',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        models: getDefaultModelsForConnection('pi', 'openai-codex'),
        createdAt: Date.now(),
      };
    } else if (legacyAuthType === 'codex_api_key') {
      // OpenAI API Key → Pi backend
      migrated = {
        slug: 'codex-api',
        name: 'OpenAI API (via Pi)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openai',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        models: getDefaultModelsForConnection('pi', 'openai'),
        createdAt: Date.now(),
      };
    } else if (legacyAuthType === 'api_key') {
      // Anthropic API Key - check if custom endpoint (compat mode → pi_compat)
      const hasCustomEndpoint = !!legacyBaseUrl;
      if (hasCustomEndpoint) {
        migrated = {
          slug: 'anthropic-api',
          name: 'Custom Anthropic-Compatible',
          providerType: 'pi_compat',
          authType: 'api_key_with_endpoint',
          customEndpoint: { api: 'anthropic-messages' },
          models: getDefaultModelsForConnection('pi_compat'),
          createdAt: Date.now(),
        };
      } else {
        migrated = {
          slug: 'anthropic-api',
          name: 'Anthropic (API Key)',
          providerType: 'pi',
          authType: 'api_key',
          models: getDefaultModelsForConnection('pi'),
          createdAt: Date.now(),
        };
      }
    }

    if (migrated) {
      // Validate the migrated connection has a valid provider/auth combination
      if (!isValidProviderAuthCombination(migrated.providerType, migrated.authType)) {
        console.warn(
          `[config] Legacy migration created invalid provider/auth combination: ` +
          `providerType=${migrated.providerType}, authType=${migrated.authType} ` +
          `(slug: ${migrated.slug}). Skipping migration for this connection.`
        );
      } else {
        // Apply legacy baseUrl if set
        if (legacyBaseUrl) {
          migrated.baseUrl = legacyBaseUrl;
        }

        // Apply legacy customModel if set
        if (legacyCustomModel) {
          migrated.defaultModel = legacyCustomModel;
        }

        config.llmConnections.push(migrated);
        config.defaultLlmConnection = migrated.slug;
      }
    }
  }

  // Delete legacy fields after migration
  delete configAny.authType;
  delete configAny.anthropicBaseUrl;
  delete configAny.customModel;
  delete configAny.model;

  if (legacyModel) {
    const provider = getModelProvider(legacyModel) ?? 'anthropic';
    configAny.modelDefaults = { ...(configAny.modelDefaults ?? {}), [provider]: legacyModel };
  }

  // Run the same backfill and migration on newly created connections
  migrateCodexCopilotToPi(config);
  backfillAllConnectionModels(config);
  migrateModelDefaultsToConnections(config);
  migrateLegacyOpusToDefaultOpus(config);
  migrateWorkspaceLegacyOpusToDefaultOpus(config);

  saveConfig(config);
}

/**
 * Fix defaultLlmConnection references that point to non-existent connections.
 * This can happen when a connection is removed or was never created
 * (e.g. "anthropic-api" is set as default but only "claude-max" exists).
 *
 * Fixes both the global defaultLlmConnection and per-workspace defaults.
 * Called on app startup alongside other migrations.
 */
export function migrateOrphanedDefaultConnections(): void {
  const config = loadStoredConfig();
  if (!config) return;
  if (!config.llmConnections || config.llmConnections.length === 0) return;

  let changed = false;

  // Fix global default if it points to a non-existent connection
  if (ensureDefaultLlmConnection(config)) {
    changed = true;
  }

  // Fix workspace defaults that point to non-existent connections
  try {
    const workspaces = getWorkspaces();
    for (const ws of workspaces) {
      const wsConfig = loadWorkspaceConfig(ws.rootPath);
      if (wsConfig?.defaults?.defaultLlmConnection) {
        const exists = config.llmConnections.some(
          c => c.slug === wsConfig.defaults!.defaultLlmConnection
        );
        if (!exists) {
          delete wsConfig.defaults.defaultLlmConnection;
          saveWorkspaceConfig(ws.rootPath, wsConfig);
        }
      }
    }
  } catch (error) {
    console.error('Failed to clean up workspace default connection references:', error);
  }

  if (changed) {
    saveConfig(config);
  }
}



/**
 * Migrate legacy global credentials to LLM connection-scoped credentials.
 * This ensures that credentials saved before the LLM connections system
 * are available through the new connection-based auth.
 *
 * Called on app startup (async operation, credentials use encrypted storage).
 *
 * Migration mapping:
 * - claude_oauth::global → llm_oauth::claude-max
 * - anthropic_api_key::global → llm_api_key::anthropic-api
 *
 * After successful migration, legacy credentials are deleted to prevent
 * stale data and reduce credential store clutter.
 */
export async function migrateLegacyCredentials(): Promise<void> {
  const manager = getCredentialManager();
  const debug = (await import('../utils/debug.ts')).debug;

  // Migrate Claude OAuth: claude_oauth::global → llm_oauth::claude-max
  const legacyClaudeOAuth = await manager.getClaudeOAuthCredentials();
  if (legacyClaudeOAuth?.accessToken) {
    // Only migrate if llm_oauth::claude-max doesn't exist yet
    const existingLlmOAuth = await manager.getLlmOAuth('claude-max');
    if (!existingLlmOAuth) {
      await manager.setLlmOAuth('claude-max', {
        accessToken: legacyClaudeOAuth.accessToken,
        refreshToken: legacyClaudeOAuth.refreshToken,
        expiresAt: legacyClaudeOAuth.expiresAt,
      });
      debug('[storage] Migrated legacy Claude OAuth to llm_oauth::claude-max');

      // Delete legacy credential after successful migration
      // Global credentials use just the type - the key format is {type}::global
      try {
        await manager.delete({ type: 'claude_oauth' });
        debug('[storage] Deleted legacy claude_oauth::global credential');
      } catch (error) {
        debug('[storage] Failed to delete legacy claude_oauth::global:', error);
      }
    }
  }

  // Migrate Anthropic API key: anthropic_api_key::global → llm_api_key::anthropic-api
  const legacyApiKey = await manager.getApiKey();
  if (legacyApiKey) {
    // Only migrate if llm_api_key::anthropic-api doesn't exist yet
    const existingLlmApiKey = await manager.getLlmApiKey('anthropic-api');
    if (!existingLlmApiKey) {
      await manager.setLlmApiKey('anthropic-api', legacyApiKey);
      debug('[storage] Migrated legacy Anthropic API key to llm_api_key::anthropic-api');

      // Delete legacy credential after successful migration
      // Global credentials use just the type - the key format is {type}::global
      try {
        await manager.delete({ type: 'anthropic_api_key' });
        debug('[storage] Deleted legacy anthropic_api_key::global credential');
      } catch (error) {
        debug('[storage] Failed to delete legacy anthropic_api_key::global:', error);
      }
    }
  }
}
