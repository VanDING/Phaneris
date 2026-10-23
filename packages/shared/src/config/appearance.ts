/** appearance ownership. config.json writes belong exclusively to repository.ts. */

import { existsSync, mkdirSync, readFileSync, statSync, realpathSync } from 'fs';

import { join, dirname, resolve, relative, isAbsolute } from 'path';

import { debug } from '../utils/debug.ts';

import { atomicWriteFileSync, safeJsonParse } from '../utils/files.ts';

import { CONFIG_DIR } from './paths.ts';

import { PresetThemeSchema, ThemeOverrideSchema } from './schemas.ts';

import { mergeDecisionLayerSettings, normalizeDecisionLayerSettings, type DecisionLayerSettings, type DecisionLayerStoredSettings } from '../decisions/settings.ts';

import { normalizeImageGenerationSettings, type ImageGenerationSettings } from './image-generation.ts';

import { BUILTIN_THEMES, DEFAULT_THEME_FILE, isBuiltinThemeId, normalizeBuiltinThemeId, DEFAULT_THEME_PREFERENCES, isValidUserThemeId, resolveTheme, type ThemeOverrides, type ThemeFile, type PresetTheme, type ThemePreferences, type ThemeSummary } from './theme.ts';
import type { ThemeDiagnostic } from './theme-manifest.ts';

import { type NetworkProxySettings } from './types.ts';

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from './server-config.ts';

import { createHash, randomUUID } from 'crypto';

import { ensureConfigDir, loadStoredConfig, saveConfig } from './repository.ts';

import { loadConfigDefaults } from './defaults.ts';

// Legacy updateApiKey() removed - use setupLlmConnection IPC handler instead.

// Legacy getters/setters removed - use LLM connections instead:
// - getAuthType/setAuthType -> derive from getDefaultLlmConnection()/getLlmConnection()
// - getAnthropicBaseUrl/setAnthropicBaseUrl -> use connection.baseUrl
// - getCustomModel/setCustomModel -> use connection.defaultModel


/**
 * Get whether desktop notifications are enabled.
 * Defaults to true if not set.
 */
export function getNotificationsEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.notificationsEnabled !== undefined) {
    return config.notificationsEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.notificationsEnabled;
}

/**
 * Set whether desktop notifications are enabled.
 */
export function setNotificationsEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.notificationsEnabled = enabled;
  saveConfig(config);
}

/**
 * Get whether auto-capitalisation is enabled.
 * Defaults to true if not set.
 */
export function getAutoCapitalisation(): boolean {
  const config = loadStoredConfig();
  if (config?.autoCapitalisation !== undefined) {
    return config.autoCapitalisation;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.autoCapitalisation;
}

/**
 * Set whether auto-capitalisation is enabled.
 */
export function setAutoCapitalisation(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.autoCapitalisation = enabled;
  saveConfig(config);
}

/**
 * Get the key combination used to send messages.
 * Defaults to 'enter' if not set.
 */
export function getSendMessageKey(): 'enter' | 'cmd-enter' {
  const config = loadStoredConfig();
  if (config?.sendMessageKey !== undefined) {
    return config.sendMessageKey;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.sendMessageKey;
}

/**
 * Set the key combination used to send messages.
 */
export function setSendMessageKey(key: 'enter' | 'cmd-enter'): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.sendMessageKey = key;
  saveConfig(config);
}

/**
 * Get whether spell check is enabled in the input.
 */
export function getSpellCheck(): boolean {
  const config = loadStoredConfig();
  if (config?.spellCheck !== undefined) {
    return config.spellCheck;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.spellCheck;
}

/**
 * Set whether spell check is enabled in the input.
 */
export function setSpellCheck(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.spellCheck = enabled;
  saveConfig(config);
}

/**
 * Get whether screen should stay awake while sessions are running.
 * Defaults to false if not set.
 */
export function getKeepAwakeWhileRunning(): boolean {
  const config = loadStoredConfig();
  if (config?.keepAwakeWhileRunning !== undefined) {
    return config.keepAwakeWhileRunning;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.keepAwakeWhileRunning;
}

/**
 * Set whether screen should stay awake while sessions are running.
 */
export function setKeepAwakeWhileRunning(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.keepAwakeWhileRunning = enabled;
  saveConfig(config);
}

/**
 * Get whether rich tool descriptions are enabled.
 * When enabled, all tool calls include intent and display name metadata.
 * Defaults to true if not set.
 */
export function getRichToolDescriptions(): boolean {
  const config = loadStoredConfig();
  if (config?.richToolDescriptions !== undefined) {
    return config.richToolDescriptions;
  }
  return true;
}

/**
 * Set whether rich tool descriptions are enabled.
 */
export function setRichToolDescriptions(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.richToolDescriptions = enabled;
  saveConfig(config);
}

/**
 * Get whether long-lived prompt cache retention is enabled.
 * When enabled, Pi SDK requests use cacheRetention 'long' (provider-dependent:
 * Anthropic 1h, OpenAI-compatible extended retention).
 * Defaults to false if not set.
 */
export function getExtendedPromptCache(): boolean {
  const config = loadStoredConfig();
  return config?.extendedPromptCache ?? false;
}

/**
 * Set whether long-lived prompt cache retention is enabled.
 */
export function setExtendedPromptCache(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.extendedPromptCache = enabled;
  saveConfig(config);
}

/** Cost-aware cache warming during active runs only. Never enables idle warming. */
export function getPromptCacheWarming(): boolean {
  return loadStoredConfig()?.promptCacheWarming === true;
}

export function setPromptCacheWarming(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) throw new Error('Configuration is unavailable');
  config.promptCacheWarming = enabled;
  saveConfig(config);
}

/**
 * Get whether the built-in browser tool is enabled.
 * When disabled, browser_tool is not included in session tools.
 * Defaults to true if not set.
 */
export function getBrowserToolEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.browserToolEnabled !== undefined) {
    return config.browserToolEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.browserToolEnabled;
}

/**
 * Set whether the built-in browser tool is enabled.
 */
export function setBrowserToolEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.browserToolEnabled = enabled;
  saveConfig(config);
}

/**
 * Whether remote agents may call `browser_tool evaluate <expression>` against this
 * desktop client's local browser. The check is enforced inside the local capability
 * dispatcher; the remote server cannot override it.
 *
 * Defaults to true. Users can flip it off in Settings → AI → Advanced if they don't
 * trust the remote workspaces they connect to.
 */
export function getAllowRemoteEvaluate(): boolean {
  const config = loadStoredConfig();
  if (config?.allowRemoteEvaluate !== undefined) {
    return config.allowRemoteEvaluate;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.allowRemoteEvaluate;
}

export function setAllowRemoteEvaluate(allowed: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.allowRemoteEvaluate = allowed;
  saveConfig(config);
}

/**
 * Get whether rtk Bash-output compression is enabled.
 * When enabled, the PreToolUse pipeline rewrites Bash commands to their `rtk` equivalents
 * to reduce token consumption on common dev commands (git, ls, grep, test runners, etc.).
 * Defaults to false — opt-in. Requires the `rtk` binary on PATH or bundled with the app.
 * https://github.com/rtk-ai/rtk
 */
export function getRtkEnabled(): boolean {
  const config = loadStoredConfig();
  return config?.rtkEnabled === true;
}

/** Base commands never routed through RTK. Invalid entries are ignored. */
export function getRtkExcludeCommands(): string[] {
  const value = loadStoredConfig()?.rtkExcludeCommands;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(entry => entry.trim());
}

/**
 * Set whether rtk Bash-output compression is enabled.
 */
export function setRtkEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.rtkEnabled = enabled;
  saveConfig(config);
}

/**
 * Merge a decision-layer settings patch (features merge key-wise; `null` clears
 * an optional string) and persist it. Returns the normalized result so the
 * Settings card can render what was actually stored.
 *
 * This is the only writer of `StoredConfig.decisionLayer`. The matching read
 * path is `@phaneris/shared/decisions` → `readDecisionLayerSettings()` (same
 * `loadStoredConfig()` + same normalizer), which is what `decisions:GET_SETTINGS`
 * and `resolveDecisionClient()` both use.
 *
 * Unlike the void rtk setter, callers display the returned value — do not
 * pretend a write happened when config.json has not been initialized.
 */
export function setDecisionLayerSettings(
  patch: Partial<Record<keyof DecisionLayerStoredSettings, unknown>>,
): DecisionLayerSettings {
  const config = loadStoredConfig();
  if (!config) {
    throw new Error('Cannot save decision model settings: config.json is not initialized');
  }
  config.decisionLayer = mergeDecisionLayerSettings(config.decisionLayer, patch);
  saveConfig(config);
  return normalizeDecisionLayerSettings(config.decisionLayer);
}

export function getImageGenerationSettings(): ImageGenerationSettings {
  return normalizeImageGenerationSettings(loadStoredConfig()?.imageGeneration ?? {});
}

/** Replace both defaults together so switching providers cannot keep a foreign model. */
export function setImageGenerationSettings(settings: ImageGenerationSettings): ImageGenerationSettings {
  const config = loadStoredConfig();
  if (!config) throw new Error('Cannot save image generation settings: config.json is not initialized.');
  config.imageGeneration = normalizeImageGenerationSettings(settings);
  saveConfig(config);
  return config.imageGeneration;
}

/**
 * Get persisted Git Bash path (Windows only).
 * Used to set CLAUDE_CODE_GIT_BASH_PATH for the SDK subprocess.
 */
export function getGitBashPath(): string | undefined {
  const config = loadStoredConfig();
  return config?.gitBashPath;
}

/**
 * Set Git Bash path (Windows only).
 * Persists to config so it survives app restarts.
 * Returns false if the config could not be loaded (path not persisted).
 */
export function setGitBashPath(path: string): boolean {
  const config = loadStoredConfig();
  if (!config) {
    console.warn('[storage] Failed to persist Git Bash path: config could not be loaded');
    return false;
  }
  config.gitBashPath = path;
  saveConfig(config);
  return true;
}

/**
 * Clear persisted Git Bash path (Windows only).
 * Used when the stored path is stale or invalid.
 */
export function clearGitBashPath(): void {
  const config = loadStoredConfig();
  if (!config || !config.gitBashPath) return;
  delete config.gitBashPath;
  saveConfig(config);
}

const APP_THEME_FILE = join(CONFIG_DIR, 'theme.json');

const APP_THEMES_DIR = join(CONFIG_DIR, 'themes');

/** @deprecated Kept so older tooling can locate the legacy file. */
export function getAppThemePath(): string {
  return APP_THEME_FILE;
}

const LEGACY_THEME_MIGRATION_MARKER = join(APP_THEMES_DIR, '.legacy-theme-json-migrated');

const MAX_THEME_FILE_BYTES = 256 * 1024;

const MAX_THEME_BACKGROUND_BYTES = 20 * 1024 * 1024;

const THEME_BACKGROUND_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Get the app-level themes directory.
 * User themes are stored at ~/.phaneris/themes/
 */
export function getAppThemesDir(): string {
  return APP_THEMES_DIR;
}

/** @deprecated Runtime theme resolution no longer consumes theme.json. */
export function loadAppTheme(): ThemeOverrides | null {
  try {
    if (!existsSync(APP_THEME_FILE)) return null;
    const parsed = ThemeOverrideSchema.safeParse(safeJsonParse(readFileSync(APP_THEME_FILE, 'utf-8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** @deprecated Write a user theme in ~/.phaneris/themes instead. */
export function saveAppTheme(theme: ThemeOverrides): void {
  ensureConfigDir();
  atomicWriteFileSync(APP_THEME_FILE, JSON.stringify(theme, null, 2), { mode: 0o600 });
}

// ============================================
// User Themes (app-level)
// ============================================

/** Ensure the user-owned theme directory exists; never seed bundled presets. */
export function ensureUserThemesDir(): void {
  if (!existsSync(APP_THEMES_DIR)) {
    mkdirSync(APP_THEMES_DIR, { recursive: true });
  }
}

/**
 * Non-destructively migrate the deprecated theme.json override into a complete
 * user theme. A marker prevents duplicate migrations and the source is retained.
 */
export function migrateLegacyAppTheme(): string | null {
  ensureUserThemesDir();
  if (!existsSync(APP_THEME_FILE) || existsSync(LEGACY_THEME_MIGRATION_MARKER)) return null;

  try {
    const parsed = ThemeOverrideSchema.safeParse(safeJsonParse(readFileSync(APP_THEME_FILE, 'utf-8')));
    if (!parsed.success) {
      debug('[ThemeStorage] Legacy theme.json is invalid; leaving it untouched');
      return null;
    }

    let suffix = 0;
    let id = 'migrated-custom';
    let destination = join(APP_THEMES_DIR, `${id}.json`);
    while (existsSync(destination)) {
      suffix += 1;
      id = `migrated-custom-${suffix}`;
      destination = join(APP_THEMES_DIR, `${id}.json`);
    }

    const migrated: ThemeFile = {
      name: 'Migrated Custom Theme',
      description: 'Migrated from the deprecated ~/.phaneris/theme.json override.',
      ...resolveTheme(parsed.data),
    };
    atomicWriteFileSync(destination, `${JSON.stringify(migrated, null, 2)}\n`);
    atomicWriteFileSync(LEGACY_THEME_MIGRATION_MARKER, `${id}\n`);
    debug(`[ThemeStorage] Migrated legacy theme.json to themes/${id}.json`);
    return id;
  } catch (error) {
    debug('[ThemeStorage] Failed to migrate legacy theme.json', error);
    return null;
  }
}

/** Initialize theme storage once during application startup. */
export function initializeThemeStorage(): void {
  ensureUserThemesDir();
  migrateLegacyAppTheme();
}

function isPathWithin(parentDir: string, candidatePath: string): boolean {
  const child = relative(parentDir, candidatePath);
  return child !== '' && child !== '..' && !child.startsWith('../') && !child.startsWith('..\\') && !isAbsolute(child);
}

function readValidatedThemeFile(path: string, id: string, diagnostics?: ThemeDiagnostic[]): ThemeFile | null {
  try {
    if (statSync(path).size > MAX_THEME_FILE_BYTES) {
      debug(`[ThemeStorage] Ignoring theme "${id}" because its JSON exceeds 256 KiB`);
      diagnostics?.push({ path: id, code: 'load', severity: 'error', message: 'Theme JSON exceeds 256 KiB' });
      return null;
    }
    const parsed = PresetThemeSchema.safeParse(safeJsonParse(readFileSync(path, 'utf-8')));
    if (!parsed.success) {
      debug(`[ThemeStorage] Ignoring invalid theme "${id}"`, parsed.error.issues);
      diagnostics?.push(...parsed.error.issues.map(issue => ({ path: issue.path.join('.'), code: 'structure' as const, severity: 'error' as const, message: issue.message })));
      return null;
    }
    return parsed.data as ThemeFile;
  } catch (error) {
    debug(`[ThemeStorage] Failed to load theme "${id}"`, error);
    diagnostics?.push({ path: id, code: 'load', severity: 'error', message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** @deprecated Use initializeThemeStorage(). */
export function ensurePresetThemes(): void {
  initializeThemeStorage();
}

/**
 * List the single product theme. Never modify or expose user-owned theme files.
 */
export function loadPresetThemes(): ThemeSummary[] {
  // Product selection is intentionally Default-only. User files remain owned
  // by the user; internal tooling may still validate them through the engine.
  return [{ id: 'default', name: DEFAULT_THEME_FILE.name,
    description: DEFAULT_THEME_FILE.description, author: DEFAULT_THEME_FILE.author,
    supportedModes: DEFAULT_THEME_FILE.supportedModes }];
}

/**
 * Resolve relative backgroundImage paths to data URLs.
 * If the backgroundImage is a relative path (no protocol), resolve it relative to the theme's directory,
 * read the file, and convert it to a data URL. This is necessary because the renderer process
 * cannot access file:// URLs directly when running on localhost in dev mode.
 * @param theme - Theme object to process
 * @param themePath - Absolute path to the theme's JSON file
 */
function resolveThemeBackgroundImage(theme: ThemeFile, themePath: string, diagnostics: ThemeDiagnostic[]): ThemeFile {
  const fail = (message: string): ThemeFile => {
    diagnostics.push({ path: 'backgroundImage', code: 'image', severity: 'error', message });
    return { ...theme, backgroundImage: undefined };
  };
  if (!theme.backgroundImage) {
    return theme;
  }

  // Preserve explicit HTTP(S) URLs. Other URL schemes are rejected; local
  // assets are validated and confined to the user themes directory below.
  const hasProtocol = !isAbsolute(theme.backgroundImage)
    && /^[a-z][a-z0-9+.-]*:/i.test(theme.backgroundImage);
  if (hasProtocol) {
    try {
      const protocol = new URL(theme.backgroundImage).protocol;
      if (protocol === 'https:' || protocol === 'http:') return theme;
    } catch {
      // Invalid URL falls through to the warning below.
    }
    console.warn(`Unsupported theme background URL: ${theme.backgroundImage}`);
    return fail('Unsupported theme background URL; use HTTP(S) or a confined local asset');
  }

  const themeDir = dirname(themePath);
  const absoluteImagePath = resolve(themeDir, theme.backgroundImage);

  // Read the file and convert to data URL so renderer can use it
  // (file:// URLs are blocked in renderer when running on localhost)
  try {
    if (!existsSync(absoluteImagePath)) {
      console.warn(`Theme background image not found: ${absoluteImagePath}`);
      return fail('Theme background image was not found');
    }

    const themesRoot = realpathSync(APP_THEMES_DIR);
    const realImagePath = realpathSync(absoluteImagePath);
    if (!isPathWithin(themesRoot, realImagePath)) {
      console.warn(`Theme background image must stay inside ${APP_THEMES_DIR}`);
      return fail('Theme background image must stay inside the themes directory');
    }

    const extension = realImagePath.toLowerCase().split('.').pop() ?? '';
    const mimeType = THEME_BACKGROUND_MIME_TYPES[extension];
    if (!mimeType) {
      console.warn(`Unsupported theme background image type: ${realImagePath}`);
      return fail('Unsupported theme background image type');
    }
    if (statSync(realImagePath).size > MAX_THEME_BACKGROUND_BYTES) {
      console.warn(`Theme background image exceeds 20 MiB: ${realImagePath}`);
      return fail('Theme background image exceeds 20 MiB');
    }

    const imageBuffer = readFileSync(realImagePath);
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      ...theme,
      backgroundImage: dataUrl,
    };
  } catch (error) {
    console.warn(`Failed to read theme background image: ${absoluteImagePath}`, error);
    return fail(`Failed to read theme background image: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load a specific preset theme by ID.
 * @param id - Theme ID (filename without .json)
 */
export function loadPresetTheme(id: string): PresetTheme | null {
  const builtinId = normalizeBuiltinThemeId(id);
  if (isBuiltinThemeId(builtinId)) {
    return { id: builtinId, path: `builtin:${builtinId}`, theme: BUILTIN_THEMES[builtinId]! };
  }
  if (!isValidUserThemeId(id)) return null;

  ensureUserThemesDir();
  const path = join(APP_THEMES_DIR, `${id}.json`);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const themesRoot = realpathSync(APP_THEMES_DIR);
    const realThemePath = realpathSync(path);
    if (!isPathWithin(themesRoot, realThemePath)) return null;
    const diagnostics: ThemeDiagnostic[] = [];
    const theme = readValidatedThemeFile(realThemePath, id, diagnostics);
    if (!theme) return { id, path, theme: DEFAULT_THEME_FILE, diagnostics };
    const materialized = resolveThemeBackgroundImage(theme, realThemePath, diagnostics);
    const revision = createHash('sha256').update(JSON.stringify(materialized)).digest('hex');
    return { id, path, theme: materialized, revision, diagnostics };
  } catch {
    return null;
  }
}

/**
 * Get the path to the app-level user themes directory.
 */
export function getPresetThemesDir(): string {
  return getAppThemesDir();
}

/**
 * User themes have no bundled copy to reset to; default is immutable.
 */
export function resetPresetTheme(_id: string): boolean {
  return false;
}

// ============================================
// Color Theme Selection (stored in config)
// ============================================

/**
 * Get the currently selected color theme ID.
 * Returns 'default' if not set.
 */
function normalizeThemeSelectionId(_value: unknown): string {
  return 'default';
}

/** Load the authoritative app-level theme preferences from config.json. */
export function getThemePreferences(): ThemePreferences {
  const config = loadStoredConfig();
  const configuredDefault = loadConfigDefaults().defaults.colorTheme;
  return {
    mode: config?.themeMode === 'light' || config?.themeMode === 'dark' || config?.themeMode === 'system'
      ? config.themeMode
      : DEFAULT_THEME_PREFERENCES.mode,
    colorTheme: normalizeThemeSelectionId(config?.colorTheme ?? configuredDefault),
    font: config?.themeFont === 'theme' || config?.themeFont === 'inter' || config?.themeFont === 'system'
      ? config.themeFont
      : DEFAULT_THEME_PREFERENCES.font,
  };
}

/** Persist all theme preferences as one atomic config update. */
export function setThemePreferences(preferences: ThemePreferences): ThemePreferences {
  const normalized: ThemePreferences = {
    mode: preferences.mode === 'light' || preferences.mode === 'dark' || preferences.mode === 'system'
      ? preferences.mode
      : DEFAULT_THEME_PREFERENCES.mode,
    colorTheme: normalizeThemeSelectionId(preferences.colorTheme),
    font: preferences.font === 'theme' || preferences.font === 'inter' || preferences.font === 'system'
      ? preferences.font
      : DEFAULT_THEME_PREFERENCES.font,
  };

  const config = loadStoredConfig();
  if (!config) return normalized;
  config.themeMode = normalized.mode;
  config.colorTheme = normalized.colorTheme;
  config.themeFont = normalized.font;
  saveConfig(config);
  return normalized;
}

export function getColorTheme(): string {
  return getThemePreferences().colorTheme;
}

/**
 * Set the color theme ID.
 */
export function setColorTheme(themeId: string): void {
  setThemePreferences({ ...getThemePreferences(), colorTheme: themeId });
}

// ============================================
// Auto-Update Dismissed Version
// ============================================

/**
 * Get the dismissed update version.
 * Returns null if no version is dismissed.
 */
export function getDismissedUpdateVersion(): string | null {
  const config = loadStoredConfig();
  return config?.dismissedUpdateVersion ?? null;
}

/**
 * Set the dismissed update version.
 * Pass the version string to dismiss notifications for that version.
 */
export function setDismissedUpdateVersion(version: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.dismissedUpdateVersion = version;
  saveConfig(config);
}

/**
 * Clear the dismissed update version.
 * Call this when a new version is released (or on successful update).
 */
export function clearDismissedUpdateVersion(): void {
  const config = loadStoredConfig();
  if (!config) return;
  delete config.dismissedUpdateVersion;
  saveConfig(config);
}

function normalizeProxyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeNetworkProxySettings(
  settings: NetworkProxySettings,
): NetworkProxySettings {
  return {
    enabled: Boolean(settings.enabled),
    httpProxy: normalizeProxyString(settings.httpProxy),
    httpsProxy: normalizeProxyString(settings.httpsProxy),
    noProxy: normalizeProxyString(settings.noProxy),
  };
}

/**
 * Get the current network proxy settings.
 * Returns undefined if not configured.
 */
export function getNetworkProxySettings(): NetworkProxySettings | undefined {
  const config = loadStoredConfig();
  return config?.networkProxy;
}

/**
 * Persist network proxy settings.
 * Deletes the key when disabled and all proxy fields are empty.
 */
export function setNetworkProxySettings(settings: NetworkProxySettings): void {
  const config = loadStoredConfig();
  if (!config) return;

  const normalized = normalizeNetworkProxySettings(settings);

  // Remove the key entirely when proxy is disabled and all fields are blank
  if (!normalized.enabled && !normalized.httpProxy && !normalized.httpsProxy && !normalized.noProxy) {
    delete config.networkProxy;
  } else {
    config.networkProxy = normalized;
  }

  saveConfig(config);
}

// ============================================
// Setup Deferred (user skipped onboarding)
// ============================================

export function isSetupDeferred(): boolean {
  return loadStoredConfig()?.setupDeferred === true;
}

export function setSetupDeferred(deferred: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  if (deferred) {
    config.setupDeferred = true;
  } else {
    delete config.setupDeferred;
  }
  saveConfig(config);
}

/**
 * Get the current server configuration.
 * Returns defaults if not yet configured.
 */
export function getServerConfig(): ServerConfig {
  const config = loadStoredConfig();
  return config?.serverConfig ?? { ...DEFAULT_SERVER_CONFIG };
}

/**
 * Persist server configuration.
 * Auto-generates a stable auth token on first enable if none exists.
 */
export function setServerConfig(serverConfig: ServerConfig): void {
  const config = loadStoredConfig();
  if (!config) return;

  // Generate a stable token when first enabled (or if token is missing)
  if (serverConfig.enabled && !serverConfig.token) {
    serverConfig.token = randomUUID();
  }

  config.serverConfig = serverConfig;
  saveConfig(config);
}

/** New sessions inherit the app default; existing explicit overrides are retained. */
export function getContextPolicy(): import('../agent/context-policy').ContextPolicy {
  const policy = loadStoredConfig()?.contextPolicy
  return policy === 'handoff' || policy === 'manual' ? policy : 'compact'
}

export function getCompactionThreshold(): number | null {
  const value = loadStoredConfig()?.compactionThresholdTokens;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 4096 ? value : null;
}

export function setCompactionThreshold(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 4096)) throw new Error('Invalid compaction threshold');
  const config = loadStoredConfig();
  if (!config) throw new Error('Configuration unavailable');
  if (value === null) delete config.compactionThresholdTokens;
  else config.compactionThresholdTokens = value;
  saveConfig(config);
}

export function setContextPolicy(policy: import('../agent/context-policy').ContextPolicy): void {
  if (!['compact', 'handoff', 'manual'].includes(policy)) throw new Error('Invalid context policy')
  const config = loadStoredConfig()
  if (!config) throw new Error('Configuration unavailable')
  config.contextPolicy = policy
  saveConfig(config)
}
