/** Compatibility facade; all state and I/O belong to domain owners. */
// Re-export CONFIG_DIR for convenience (centralized in paths.ts)
export { CONFIG_DIR } from './paths.ts';
// Re-export base types from core (single source of truth)
export type {
  WorkspaceInfo,
  Workspace,
  McpAuthType,
  AuthType,
  OAuthCredentials,
} from '@phaneris/core/types';
// Re-export types from core for convenience
export type { StoredAttachment, StoredMessage } from '@phaneris/core/types';
export { isValidUserThemeId } from './theme.ts';
// ============================================
// LLM Connections
// ============================================

// Re-export types for convenience (imports are at top of file)
export type {
  LlmConnection,
  LlmProviderType,
  LlmAuthType,
  LlmConnectionWithStatus,
} from './llm-connections.ts';
export { type StoredConfig, type WorkspaceConversation, type DraftAttachmentContent, type DraftAttachmentRef, type SessionDraft } from './persisted-types.ts';
export { backupConfigFile, ensureConfigDir, loadStoredConfig, saveConfig, getConfigPath, clearAllConfig } from './repository.ts';
export { FALLBACK_CONFIG_DEFAULTS, loadConfigDefaults, ensureConfigDefaults } from './defaults.ts';
export { getNotificationsEnabled, setNotificationsEnabled, getAutoCapitalisation, setAutoCapitalisation, getSendMessageKey, setSendMessageKey, getSpellCheck, setSpellCheck, getKeepAwakeWhileRunning, setKeepAwakeWhileRunning, getRichToolDescriptions, setRichToolDescriptions, getExtendedPromptCache, setExtendedPromptCache, getPromptCacheWarming, setPromptCacheWarming, getBrowserToolEnabled, setBrowserToolEnabled, getAllowRemoteEvaluate, setAllowRemoteEvaluate, getRtkEnabled, getRtkExcludeCommands, setRtkEnabled, setDecisionLayerSettings, getImageGenerationSettings, setImageGenerationSettings, getGitBashPath, setGitBashPath, clearGitBashPath, getAppThemePath, getAppThemesDir, loadAppTheme, saveAppTheme, ensureUserThemesDir, migrateLegacyAppTheme, initializeThemeStorage, ensurePresetThemes, loadPresetThemes, loadPresetTheme, getPresetThemesDir, resetPresetTheme, getThemePreferences, setThemePreferences, getColorTheme, setColorTheme, getDismissedUpdateVersion, setDismissedUpdateVersion, clearDismissedUpdateVersion, getNetworkProxySettings, setNetworkProxySettings, isSetupDeferred, setSetupDeferred, getServerConfig, setServerConfig, getContextPolicy, setContextPolicy } from './appearance.ts';
export { generateWorkspaceId, findWorkspaceIcon, getWorkspaces, getActiveWorkspace, getWorkspaceByNameOrId, getRemoteServerTokenSync, getRemoteServerToken, setRemoteServerToken, deleteRemoteServerToken, hydrateRemoteServerTokenCache, migrateRemoteServerTokens, updateWorkspaceRemoteServer, setActiveWorkspace, switchWorkspaceAtomic, addWorkspace, syncWorkspaces, removeWorkspace, saveWorkspaceConversation, loadWorkspaceConversation, getWorkspaceDataPath, clearWorkspaceConversation, saveWorkspacePlan, loadWorkspacePlan, clearWorkspacePlan } from './workspace-selection.ts';
export { getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts } from './drafts.ts';
export { shouldMigratePiOpenAiProvider, shouldRepairPiApiKeyCodexProvider, inferModelSelectionMode, migrateLegacyLlmConnectionsConfig, migrateOrphanedDefaultConnections, migrateLegacyCredentials } from './migrations.ts';
export { getLlmConnections, getLlmConnection, addLlmConnection, updateLlmConnection, deleteLlmConnection, getDefaultLlmConnection, setDefaultLlmConnection, getDefaultThinkingLevel, setDefaultThinkingLevel, touchLlmConnection } from './connections.ts';
export { getToolIconsDir, ensureToolIcons } from './bundled-assets.ts';
export { getCompactionThreshold, setCompactionThreshold } from './appearance.ts';
