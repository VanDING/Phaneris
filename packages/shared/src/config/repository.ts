/** repository ownership. config.json writes belong exclusively to repository.ts. */

import { existsSync, mkdirSync, rmSync } from 'fs';

import { join } from 'path';

import { createWorkspaceAtPath, isValidWorkspace } from '../workspaces/storage.ts';

import { initializeDocs } from '../docs/index.ts';

import { expandPath, toPortablePath } from '../utils/paths.ts';

import { debug } from '../utils/debug.ts';

import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';

import { CONFIG_DIR } from './paths.ts';

import { ensureConfigDefaults } from './defaults.ts';

import { ensureToolIcons } from './bundled-assets.ts';

import { type PersistedRemoteServer, type StoredConfig } from './persisted-types.ts';

import { stripRemoteServerToken } from './persisted-normalize.ts';

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

let configDirInitialized = false;

export function ensureConfigDir(): void {
  if (configDirInitialized) return;

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Initialize bundled docs (creates ~/.phaneris/docs/ with sources.md, agents.md, permissions.md)
  initializeDocs();

  // Initialize config defaults
  ensureConfigDefaults();

  // Initialize tool icons (CLI tool icons for turn card display)
  ensureToolIcons();

  configDirInitialized = true;
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const config = readJsonFileSync<StoredConfig>(CONFIG_FILE);

    // Must have workspaces array
    if (!Array.isArray(config.workspaces)) {
      return null;
    }

    // Expand path variables (~ and ${HOME}) for portability
    for (const workspace of config.workspaces) {
      workspace.rootPath = expandPath(workspace.rootPath);
    }

    // Validate active workspace exists
    const activeWorkspace = config.workspaces.find(w => w.id === config.activeWorkspaceId);
    if (!activeWorkspace) {
      // Default to first workspace
      config.activeWorkspaceId = config.workspaces[0]?.id || null;
    }

    // Ensure workspace folder structure exists for all workspaces.
    // Failures here are non-fatal — the workspace will be re-created on next access.
    for (const workspace of config.workspaces) {
      if (!isValidWorkspace(workspace.rootPath)) {
        try {
          createWorkspaceAtPath(workspace.rootPath, workspace.name, undefined, workspace.id);
        } catch (wsError) {
          debug('[config] Failed to create workspace at', workspace.rootPath, ':', wsError instanceof Error ? wsError.message : wsError);
        }
      }
    }

    return config;
  } catch (error) {
    debug('[config] loadStoredConfig failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

// Legacy credential helpers removed - use connection-aware credential lookup instead:
// - getAnthropicApiKey() → credentialManager.getLlmApiKey(connectionSlug)
// - getClaudeOAuthToken() → credentialManager.getLlmOAuth(connectionSlug)

export function saveConfig(config: StoredConfig): void {
  ensureConfigDir();

  // Convert paths to portable form (~ prefix) for cross-machine compatibility
  const storageConfig: StoredConfig = {
    ...config,
    workspaces: config.workspaces.map(ws => ({
      ...ws,
      rootPath: toPortablePath(ws.rootPath),
      // Defense in depth: tokens live in the encrypted vault, never config.json.
      ...(ws.remoteServer
        ? { remoteServer: stripRemoteServerToken(ws.remoteServer) as PersistedRemoteServer }
        : {}),
    })),
  };

  atomicWriteFileSync(CONFIG_FILE, JSON.stringify(storageConfig, null, 2), { mode: 0o600 });
}

// Note: getDefaultWorkingDirectory/setDefaultWorkingDirectory removed
// Working directory is now stored per-workspace in workspace config.json (defaults.workingDirectory)
// Note: getDefaultPermissionMode/getEnabledPermissionModes removed
// Permission settings are now stored per-workspace in workspace config.json (defaults.permissionMode, defaults.cyclablePermissionModes)

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/** Delete only the root configuration; absence is idempotent, other I/O failures propagate. */
export function deleteConfigFile(): void {
  rmSync(CONFIG_FILE, { force: true });
}

/**
 * Clear all configuration and credentials (for logout).
 * Deletes config file and credentials file.
 */
export async function clearAllConfig(): Promise<void> {
  // Delete config file
  deleteConfigFile();

  // Delete credentials file
  const credentialsFile = join(CONFIG_DIR, 'credentials.enc');
  if (existsSync(credentialsFile)) {
    rmSync(credentialsFile);
  }

  // Optionally: Delete workspace data (conversations)
  const workspacesDir = join(CONFIG_DIR, 'workspaces');
  if (existsSync(workspacesDir)) {
    rmSync(workspacesDir, { recursive: true });
  }
}
