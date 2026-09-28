/**
 * Centralized path configuration for Phaneris.
 *
 * Every application-owned path is derived here from one root, so the desktop
 * app, the CLI, the standalone server, workers and the credential store cannot
 * disagree about where state lives. Import these constants instead of joining
 * `homedir()` with a directory literal: a hardcoded root somewhere else is a
 * bug that only surfaces when the root moves.
 *
 * Root resolution:
 *   1. `PHANERIS_CONFIG_DIR` when set to a non-empty value
 *   2. otherwise `~/.phaneris`
 *
 * Multi-instance development sets `PHANERIS_CONFIG_DIR` to `~/.phaneris-1`,
 * `~/.phaneris-2`, … so several instances run side by side with separate state.
 *
 * The upstream `CRAFT_CONFIG_DIR` is deliberately NOT read. Honouring it would
 * silently point the new product at the old application's live data instead of
 * importing it, and two applications writing one state database is exactly the
 * outcome the fork plan forbids. An explicit `PHANERIS_CONFIG_DIR` pointing at
 * the legacy directory is therefore only a transitional bridge and warns
 * loudly; the supported path for that data is the import flow (fork plan §6).
 *
 * The resolver is a pure function of `(env, home)` (OSS #1062). Purity is the
 * point: a resolver that reads `process.env` and emits side effects cannot be
 * tested against a fixed environment, so the contract "one root, derived in one
 * place" would stay unenforced and hardcoded roots would creep back in. The
 * legacy-root warning is therefore emitted once at `CONFIG_DIR` evaluation,
 * not from inside the resolver.
 */

import { homedir } from 'os';
import { join } from 'path';

import { DATA_DIR_NAME, ENV_PREFIX, LEGACY_IDENTITY } from '../identity.generated.ts';

/**
 * Default directory name under the home directory — the fallback that
 * `resolveConfigDir` joins onto `home`. Re-exported (this repo's equivalent of
 * the upstream `DEFAULT_CONFIG_DIR_NAME`) so path consumers can read the default
 * root name from the same module as the resolver.
 */
export { DATA_DIR_NAME };

/** Environment variable that overrides the application data root. */
export const CONFIG_DIR_ENV_VAR = `${ENV_PREFIX}CONFIG_DIR`;

const LEGACY_ROOT = join(homedir(), LEGACY_IDENTITY.dataDirName);

let legacyRootNoticeEmitted = false;

function noticeLegacyRoot(resolved: string, home: string): void {
  if (legacyRootNoticeEmitted) return;
  legacyRootNoticeEmitted = true;
  console.warn(
    `[paths] ${CONFIG_DIR_ENV_VAR} points at ${resolved}, which is the upstream application's ` +
      `data directory. Phaneris will read and write it in place — nothing is imported or copied, ` +
      `and the old application must not run against it at the same time. This is a transitional ` +
      `bridge only; the supported path is to import that data into ${join(home, DATA_DIR_NAME)}.`,
  );
}

/**
 * Resolve the application data root: a non-empty `PHANERIS_CONFIG_DIR` wins
 * (trimmed), otherwise `<home>/.phaneris`.
 *
 * Pure — both inputs are injected — so call sites can be tested without
 * mutating `process.env`, and nothing here can warn, cache or otherwise differ
 * between two evaluations with the same arguments.
 */
export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configured = env[CONFIG_DIR_ENV_VAR];
  const override = configured?.trim();
  return override ? override : join(home, DATA_DIR_NAME);
}

/**
 * Warn once when the root resolves to the upstream application's data directory.
 * Separate from `resolveConfigDir` so resolution stays pure and side-effect free.
 */
export function warnIfLegacyRoot(resolved: string, home: string = homedir()): void {
  if (resolved === LEGACY_ROOT || resolved === LEGACY_IDENTITY.dataDirName) {
    noticeLegacyRoot(resolved, home);
  }
}

/** Root of all application-owned state. Resolved once at module load. */
export const CONFIG_DIR = resolveConfigDir();

// Emitted here rather than inside the resolver: a legacy root must stay loud,
// but resolution itself must not depend on (or cause) observable state.
warnIfLegacyRoot(CONFIG_DIR);

/** App-level configuration (`config.json`). */
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/** App-level user preferences (`preferences.json`). */
export const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

/** AES-256-GCM encrypted credential vault. */
export const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.enc');

/** Optional key file used when no OS keychain provider is available. */
export const CREDENTIALS_KEY_FILE = join(CONFIG_DIR, 'credentials.key');

/** Workspace tree: `workspaces/{workspaceId}/…` for every workspace. */
export const WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');

/** Synced bundled documentation. */
export const DOCS_DIR = join(CONFIG_DIR, 'docs');

/** Synced bundled release notes. */
export const RELEASE_NOTES_DIR = join(CONFIG_DIR, 'release-notes');

/** App-level default permission sets. */
export const PERMISSIONS_DIR = join(CONFIG_DIR, 'permissions');

/** User-owned themes. The app ensures this directory exists and never writes into it. */
export const THEMES_DIR = join(CONFIG_DIR, 'themes');

/** Synced tool icon assets and their mapping file. */
export const TOOL_ICONS_DIR = join(CONFIG_DIR, 'tool-icons');

/** Log directory for main-process, server and audit logs. */
export const LOGS_DIR = join(CONFIG_DIR, 'logs');

/** Workspace-scoped root for one workspace. */
export function workspaceDir(workspaceId: string): string {
  return join(WORKSPACES_DIR, workspaceId);
}
