/** defaults ownership. config.json writes belong exclusively to repository.ts. */

import { existsSync, readFileSync } from 'fs';

import { join } from 'path';

import { getBundledAssetsDir } from '../utils/paths.ts';

import { debug } from '../utils/debug.ts';

import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';

import { CONFIG_DIR } from './paths.ts';

import { type PermissionMode } from '../agent/mode-types.ts';

import { parsePermissionMode, DEFAULT_PERMISSION_MODES } from '../agent/mode-types.ts';

import { type ConfigDefaults } from './config-defaults-schema.ts';

const CONFIG_DEFAULTS_FILE = join(CONFIG_DIR, 'config-defaults.json');

// Track if config-defaults have been synced this session (prevents re-sync on hot reload)
let configDefaultsSynced = false;

/**
 * Sync config-defaults.json from bundled assets.
 * Always writes on launch to ensure defaults are up-to-date with the running version.
 * Follows the same pattern as docs and other sync-enabled bundled assets.
 *
 * Source of truth: apps/electron/resources/config-defaults.json
 */
/**
 * Minimal config-defaults used when bundled assets aren't available (CI,
 * standalone server).
 *
 * MUST stay identical to `apps/electron/resources/config-defaults.json`, which
 * is the declared source of truth. The two had drifted: this copy asked before
 * editing (`permissionMode: 'ask'`, all three modes cyclable) while the shipped
 * file defaulted to Explore and skipped `ask` when cycling, so a headless run
 * started sessions with a different posture than the desktop app.
 * `config-defaults-parity.test.ts` now pins the two together.
 */
export const FALLBACK_CONFIG_DEFAULTS: ConfigDefaults = {
  version: '1.0',
  description: 'Default configuration values for Phaneris',
  defaults: {
    notificationsEnabled: true,
    colorTheme: 'default',
    autoCapitalisation: true,
    sendMessageKey: 'enter',
    spellCheck: false,
    keepAwakeWhileRunning: false,
    richToolDescriptions: true,
    extendedPromptCache: false,
    promptCacheWarming: false,
    browserToolEnabled: true,
    allowRemoteEvaluate: true,
  },
  workspaceDefaults: {
    thinkingLevel: 'medium',
    permissionMode: 'safe',
    cyclablePermissionModes: ['safe', 'allow-all'],
    localMcpServers: { enabled: true },
  },
};

function syncConfigDefaults(): void {
  if (configDefaultsSynced) return;
  configDefaultsSynced = true;

  // Get bundled config-defaults.json from resources folder
  const bundledDir = getBundledAssetsDir('.');
  if (!bundledDir) {
    debug('[config] No bundled assets dir found - using fallback config-defaults');
    if (!existsSync(CONFIG_DEFAULTS_FILE)) {
      atomicWriteFileSync(CONFIG_DEFAULTS_FILE, JSON.stringify(FALLBACK_CONFIG_DEFAULTS, null, 2), { mode: 0o600 });
    }
    return;
  }

  const bundledFile = join(bundledDir, 'config-defaults.json');
  if (!existsSync(bundledFile)) {
    debug('[config] Bundled config-defaults.json not found at: ' + bundledFile + ' - using fallback');
    if (!existsSync(CONFIG_DEFAULTS_FILE)) {
      atomicWriteFileSync(CONFIG_DEFAULTS_FILE, JSON.stringify(FALLBACK_CONFIG_DEFAULTS, null, 2), { mode: 0o600 });
    }
    return;
  }

  // Sync from bundled file (same pattern as docs)
  const content = readFileSync(bundledFile, 'utf-8');
  atomicWriteFileSync(CONFIG_DEFAULTS_FILE, content, { mode: 0o600 });
  debug('[config] Synced config-defaults.json from bundled assets');
}

/**
 * Load config defaults from ~/.phaneris/config-defaults.json.
 * Desktop startup syncs this file from bundled assets. Library consumers,
 * tests and standalone servers may call this before that startup boundary, so
 * use the in-code defaults instead of coupling core behavior to a home file.
 */
export function loadConfigDefaults(): ConfigDefaults {
  const defaults = existsSync(CONFIG_DEFAULTS_FILE)
    ? readJsonFileSync<ConfigDefaults>(CONFIG_DEFAULTS_FILE)
    : structuredClone(FALLBACK_CONFIG_DEFAULTS);

  const parsedPermissionMode =
    typeof defaults.workspaceDefaults?.permissionMode === 'string'
      ? parsePermissionMode(defaults.workspaceDefaults.permissionMode)
      : null;
  defaults.workspaceDefaults.permissionMode = parsedPermissionMode ?? 'ask';

  const rawCyclable = Array.isArray(defaults.workspaceDefaults?.cyclablePermissionModes)
    ? defaults.workspaceDefaults.cyclablePermissionModes
    : [];

  const normalizedCyclable: PermissionMode[] = [];
  for (const mode of rawCyclable) {
    if (typeof mode !== 'string') continue;
    const parsed = parsePermissionMode(mode);
    if (!parsed) continue;
    if (!normalizedCyclable.includes(parsed)) {
      normalizedCyclable.push(parsed);
    }
  }

  defaults.workspaceDefaults.cyclablePermissionModes =
    normalizedCyclable.length >= 2 ? normalizedCyclable : [...DEFAULT_PERMISSION_MODES];

  return defaults;
}

/**
 * Ensure config-defaults.json exists and is up-to-date.
 * Syncs from bundled assets on every launch (like docs and permissions).
 */
export function ensureConfigDefaults(): void {
  syncConfigDefaults();
}
