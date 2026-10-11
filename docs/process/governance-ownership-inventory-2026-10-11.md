# 治理职责全量对照

Status: accepted

本表对应 [实施计划](architecture-code-governance-implementation-plan-2026-10-11.md) 的 G3–G7；基线为 `8e5bf13b3f393dc776f6c17057eb5d0fb05f2dda`，保留历史口径，逐项给出当前 owner。完整调用文件、行号和输入 SHA 在收口证据的 `ownership-inventory.json` 中。与 [领域裁定](../architecture/governance-domain-ownership.md) 配合使用。

## 配置入口

基线是 121 条 export AST 声明，对应 129 个公开名称，不能混用声明数与符号数。116 个本地声明迁入明确领域；已有类型和路径 re-export 保留。无生产内部消费者的符号仍可被外部旧客户端使用，维持兼容，不凭一次库内扫描删除。

| 公开名称 | 当前 owner | 生产导入文件数 |
| --- | --- | ---: |
| `CONFIG_DIR` | `./paths.ts` | 15 |
| `WorkspaceInfo` | `@phaneris/core/types` | 1 |
| `Workspace` | `@phaneris/core/types` | 8 |
| `McpAuthType` | `@phaneris/core/types` | 0 |
| `AuthType` | `@phaneris/core/types` | 4 |
| `OAuthCredentials` | `@phaneris/core/types` | 0 |
| `StoredConfig` | `persisted-types` | 1 |
| `FALLBACK_CONFIG_DEFAULTS` | `defaults` | 0 |
| `loadConfigDefaults` | `defaults` | 2 |
| `ensureConfigDefaults` | `defaults` | 0 |
| `backupConfigFile` | `repository` | 0 |
| `ensureConfigDir` | `repository` | 1 |
| `loadStoredConfig` | `repository` | 5 |
| `saveConfig` | `repository` | 2 |
| `getNotificationsEnabled` | `appearance` | 0 |
| `setNotificationsEnabled` | `appearance` | 0 |
| `getAutoCapitalisation` | `appearance` | 0 |
| `setAutoCapitalisation` | `appearance` | 0 |
| `getSendMessageKey` | `appearance` | 0 |
| `setSendMessageKey` | `appearance` | 0 |
| `getSpellCheck` | `appearance` | 0 |
| `setSpellCheck` | `appearance` | 0 |
| `getKeepAwakeWhileRunning` | `appearance` | 0 |
| `setKeepAwakeWhileRunning` | `appearance` | 0 |
| `getRichToolDescriptions` | `appearance` | 0 |
| `setRichToolDescriptions` | `appearance` | 0 |
| `getExtendedPromptCache` | `appearance` | 1 |
| `setExtendedPromptCache` | `appearance` | 0 |
| `getPromptCacheWarming` | `appearance` | 1 |
| `setPromptCacheWarming` | `appearance` | 0 |
| `getBrowserToolEnabled` | `appearance` | 3 |
| `setBrowserToolEnabled` | `appearance` | 0 |
| `getAllowRemoteEvaluate` | `appearance` | 1 |
| `setAllowRemoteEvaluate` | `appearance` | 0 |
| `getRtkEnabled` | `appearance` | 1 |
| `getRtkExcludeCommands` | `appearance` | 1 |
| `setRtkEnabled` | `appearance` | 0 |
| `setDecisionLayerSettings` | `appearance` | 0 |
| `getImageGenerationSettings` | `appearance` | 1 |
| `setImageGenerationSettings` | `appearance` | 0 |
| `getGitBashPath` | `appearance` | 2 |
| `setGitBashPath` | `appearance` | 2 |
| `clearGitBashPath` | `appearance` | 2 |
| `getConfigPath` | `repository` | 0 |
| `clearAllConfig` | `repository` | 0 |
| `generateWorkspaceId` | `workspace-selection` | 0 |
| `findWorkspaceIcon` | `workspace-selection` | 0 |
| `getWorkspaces` | `workspace-selection` | 4 |
| `getActiveWorkspace` | `workspace-selection` | 1 |
| `getWorkspaceByNameOrId` | `workspace-selection` | 22 |
| `getRemoteServerTokenSync` | `workspace-selection` | 3 |
| `getRemoteServerToken` | `workspace-selection` | 0 |
| `setRemoteServerToken` | `workspace-selection` | 1 |
| `deleteRemoteServerToken` | `workspace-selection` | 0 |
| `hydrateRemoteServerTokenCache` | `workspace-selection` | 2 |
| `migrateRemoteServerTokens` | `workspace-selection` | 1 |
| `updateWorkspaceRemoteServer` | `workspace-selection` | 1 |
| `setActiveWorkspace` | `workspace-selection` | 2 |
| `switchWorkspaceAtomic` | `workspace-selection` | 0 |
| `addWorkspace` | `workspace-selection` | 3 |
| `syncWorkspaces` | `workspace-selection` | 0 |
| `removeWorkspace` | `workspace-selection` | 0 |
| `StoredAttachment` | `@phaneris/core/types` | 0 |
| `StoredMessage` | `@phaneris/core/types` | 0 |
| `WorkspaceConversation` | `persisted-types` | 0 |
| `saveWorkspaceConversation` | `workspace-selection` | 0 |
| `loadWorkspaceConversation` | `workspace-selection` | 0 |
| `getWorkspaceDataPath` | `workspace-selection` | 0 |
| `clearWorkspaceConversation` | `workspace-selection` | 0 |
| `saveWorkspacePlan` | `workspace-selection` | 0 |
| `loadWorkspacePlan` | `workspace-selection` | 0 |
| `clearWorkspacePlan` | `workspace-selection` | 0 |
| `DraftAttachmentContent` | `persisted-types` | 1 |
| `DraftAttachmentRef` | `persisted-types` | 2 |
| `SessionDraft` | `persisted-types` | 1 |
| `getSessionDraft` | `drafts` | 1 |
| `setSessionDraft` | `drafts` | 1 |
| `deleteSessionDraft` | `drafts` | 1 |
| `getAllSessionDrafts` | `drafts` | 2 |
| `getAppThemePath` | `appearance` | 0 |
| `getAppThemesDir` | `appearance` | 0 |
| `loadAppTheme` | `appearance` | 0 |
| `saveAppTheme` | `appearance` | 0 |
| `ensureUserThemesDir` | `appearance` | 0 |
| `migrateLegacyAppTheme` | `appearance` | 0 |
| `initializeThemeStorage` | `appearance` | 2 |
| `isValidUserThemeId` | `./theme.ts` | 2 |
| `ensurePresetThemes` | `appearance` | 0 |
| `loadPresetThemes` | `appearance` | 0 |
| `loadPresetTheme` | `appearance` | 1 |
| `getPresetThemesDir` | `appearance` | 0 |
| `resetPresetTheme` | `appearance` | 0 |
| `getThemePreferences` | `appearance` | 1 |
| `setThemePreferences` | `appearance` | 0 |
| `getColorTheme` | `appearance` | 0 |
| `setColorTheme` | `appearance` | 0 |
| `getDismissedUpdateVersion` | `appearance` | 1 |
| `setDismissedUpdateVersion` | `appearance` | 0 |
| `clearDismissedUpdateVersion` | `appearance` | 1 |
| `LlmConnection` | `./llm-connections.ts` | 11 |
| `LlmProviderType` | `./llm-connections.ts` | 9 |
| `LlmAuthType` | `./llm-connections.ts` | 4 |
| `LlmConnectionWithStatus` | `./llm-connections.ts` | 7 |
| `shouldMigratePiOpenAiProvider` | `migrations` | 0 |
| `shouldRepairPiApiKeyCodexProvider` | `migrations` | 0 |
| `inferModelSelectionMode` | `migrations` | 0 |
| `migrateLegacyLlmConnectionsConfig` | `migrations` | 1 |
| `migrateOrphanedDefaultConnections` | `migrations` | 1 |
| `migrateLegacyCredentials` | `migrations` | 1 |
| `getLlmConnections` | `connections` | 6 |
| `getLlmConnection` | `connections` | 8 |
| `addLlmConnection` | `connections` | 1 |
| `updateLlmConnection` | `connections` | 2 |
| `deleteLlmConnection` | `connections` | 1 |
| `getDefaultLlmConnection` | `connections` | 7 |
| `setDefaultLlmConnection` | `connections` | 1 |
| `getDefaultThinkingLevel` | `connections` | 2 |
| `setDefaultThinkingLevel` | `connections` | 1 |
| `touchLlmConnection` | `connections` | 1 |
| `getNetworkProxySettings` | `appearance` | 1 |
| `setNetworkProxySettings` | `appearance` | 1 |
| `isSetupDeferred` | `appearance` | 2 |
| `setSetupDeferred` | `appearance` | 3 |
| `getToolIconsDir` | `bundled-assets` | 1 |
| `ensureToolIcons` | `bundled-assets` | 1 |
| `getServerConfig` | `appearance` | 0 |
| `setServerConfig` | `appearance` | 0 |
| `getContextPolicy` | `appearance` | 1 |
| `setContextPolicy` | `appearance` | 0 |

config.json 的唯一写入在 repository；defaults 的同步标记、workspace token 缓存和迁移标记分别由原状态域保有。纯 schema/DTO/归一化/权限内容验证不经过 IO facade。storage.ts 只 re-export 同一实现；源码图门禁禁止领域回引该 facade。

## SessionManager 方法与字段

基线 206 个方法和 40 个字段全部列出。当前类仍承担产品 API 和宿主调用编排；不以类长度或方法个数判定解耦完成。agent-assembly 不接受 Manager/ManagedSession/Host 内部；source-resources 持有 HTTP/MCP lease；product-repository 持有唯一产品 snapshot/JSONL 队列。Host 的权威事实与执行队列没有迁入这些产品 owner。

| 基线成员 | 种类 | 当前职责归属 | 当前适配入口 |
| --- | --- | --- | --- |
| `sessions` | 字段 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `imageRequests` | 字段 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `taskRuntimeFacts` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `execution` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `decisionRecordingSince` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `decisionLegacy` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `unregisterDecisionObservation` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `unregisterDecisionAccounting` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `idleSessionTimer` | 字段 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `idleSweepRunning` | 字段 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `shuttingDown` | 字段 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `constructor` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `pendingDeltas` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `deltaFlushTimers` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `configWatchers` | 字段 | 现有 ConfigWatcher + 配置 domain owner | 保留产品调用端 |
| `userThemeWatcher` | 字段 | 现有 ConfigWatcher + 配置 domain owner | 保留产品调用端 |
| `automationSystems` | 字段 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `pendingCredentialResolvers` | 字段 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `pendingPermissionRequests` | 字段 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `automationLoopGuard` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `runPromptAutomations` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `pendingAskUserRequests` | 字段 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `privilegedExecutionBroker` | 字段 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `adminRememberApprovals` | 字段 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `messageLoadingPromises` | 字段 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `activeViewingSession` | 字段 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `initGate` | 字段 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `taskOutputIndex` | 字段 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `keepBackgroundTasksAlive` | 字段 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `agentRefreshLocks` | 字段 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `lastTimestamp` | 字段 | SessionManager 产品事件时钟 | 保留产品调用端 |
| `automationBinder` | 字段 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `registerManagedSession` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `pauseSessionExecution` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `waitForInit` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `setAutomationBinder` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `browserPaneManager` | 字段 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `terminalReader` | 字段 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `enqueuePageThumbnailFn` | 字段 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `rpcServer` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `remoteBpms` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `browserHostByCanvas` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `eventSink` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `pendingPlanningChanged` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `setEventSink` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `setBrowserPaneManager` | 方法 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `setTerminalReader` | 方法 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `setPageThumbnailer` | 方法 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `enqueuePageThumbnail` | 方法 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `setRpcServer` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `getBrowserPaneManagerForSession` | 方法 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `setLastMessageClientId` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `onClientDisconnected` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `getBrowserHostClient` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `monotonic` | 方法 | SessionManager 产品事件时钟 | 保留产品调用端 |
| `getAdminRememberKey` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `hasActiveAdminRememberApproval` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `storeAdminRememberApproval` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `clearAdminRememberApprovalsForSession` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `clearPendingPermissionRequestsForSession` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `clearPendingAskUserRequestsForSession` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `applyExternalSessionMetadata` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setupConfigWatcher` | 方法 | 现有 ConfigWatcher + 配置 domain owner | 保留产品调用端 |
| `notifyConfigFileChange` | 方法 | 现有 ConfigWatcher + 配置 domain owner | 保留产品调用端 |
| `reloadSourcesForWorkspace` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `broadcastSourcesChanged` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `broadcastStatusesChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastLabelsChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastWorkItemsChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastArtifactsChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastPlanningChanged` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `syncPrimaryWorkItem` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `ensurePrimaryWorkItem` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `detachSessionWorkItems` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastAutomationsChanged` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `broadcastUserThemesChanged` | 方法 | 现有 ConfigWatcher + 配置 domain owner | 保留产品调用端 |
| `broadcastLlmConnectionsChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastSkillsChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastPagesChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `broadcastPluginsChanged` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `broadcastDefaultPermissionsChanged` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `reloadSessionSources` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `reinitializeAuth` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `initialize` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `loadSessionsFromDisk` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `setMetadataWriteGuard` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `persistSession` | 方法 | product-repository.ts | 保留产品调用端 |
| `hydrateMessagesForColdPersist` | 方法 | product-repository.ts | 保留产品调用端 |
| `enqueuePersist` | 方法 | product-repository.ts | 保留产品调用端 |
| `flushSession` | 方法 | product-repository.ts | 保留产品调用端 |
| `flushAllSessions` | 方法 | product-repository.ts | 保留产品调用端 |
| `getAuthRequestDescription` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `formatAuthResultMessage` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `completeAuthRequest` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `handleCredentialInput` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `getWorkspaces` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getWorkspacesInfo` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getActiveSessionCount` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getWorkspaceAutomationSummary` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `getActiveSessionsInfo` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `reloadSessions` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getSessions` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getUnreadSummary` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `refreshBadge` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `emitUnreadSummaryChanged` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `imageRecoveryStarts` | 字段 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `recoverImageContext` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `createImageRecoverySession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getSessionTokenUsage` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `ensureMessagesLoaded` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `loadMessagesFromDisk` | 方法 | product-repository.ts | 保留产品调用端 |
| `applyDurableRecoveryStatus` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `shouldUseCanonicalSessionRead` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `applyDurableUsageProjection` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getSessionDecisions` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `getRecoveryEvidence` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `reconcileTool` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `queryAndReconcileTool` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `reconcileModel` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `applyToolReconciliation` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `prepareTaskNodeDispatch` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `commitTaskRunFact` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `listTaskRunFacts` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `commitTaskNodeDispatch` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `getSessionPath` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `createSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `notifySessionCreated` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getSessionWorkingDirectory` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `releaseIdleSessions` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `disposeManagedAgentRuntime` | 方法 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `tryRefreshAgentRuntime` | 方法 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `runAgentRuntimeRefresh` | 方法 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `refreshConnectionRuntime` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `refreshBrowserToolAvailability` | 方法 | 已注册客户端/宿主 capability port | 保留产品调用端 |
| `refreshExtendedPromptCache` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `refreshContextPolicy` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setSessionContextPolicy` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `handoffStarts` | 字段 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `updateContextHandoff` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `recordContextHandoff` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `finishContextHandoffTurn` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `startContextSuccessor` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `retryContextHandoff` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `recoverContextHandoffs` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `refreshPromptCacheWarming` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getOrCreateAgent` | 方法 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `buildSessionAgent` | 方法 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `flagSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `unflagSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `archiveSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `unarchiveSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setSessionStatus` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setSessionConnection` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setPendingPlanExecution` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `markCompactionComplete` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `markPendingPlanExecutionDispatched` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `clearPendingPlanExecution` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `getPendingPlanExecution` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `acceptPlan` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `shareToViewer` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `updateShare` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `revokeShare` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setSessionSources` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `getSessionSources` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `getLastFinalAssistantMessageId` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `getSessionFinalText` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setActiveViewingSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `clearActiveViewingSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `isSessionBeingViewed` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `markSessionRead` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `markSessionUnread` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `markAllSessionsRead` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `renameSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `refreshTitle` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `updateWorkingDirectory` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `updateSessionModel` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `updateMessageContent` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `addMessageAnnotation` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `updateMessageAnnotation` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `removeMessageAnnotation` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `deleteSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `sendMessage` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `admitSessionInput` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `runSessionTurn` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `cancelProcessing` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `attemptAuthRetry` | 方法 | agent-product-context / agent-product-callbacks / agent-assembly + Runtime Host 调用端 | 保留产品调用端 |
| `sessionCompletionListeners` | 字段 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `onSessionComplete` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `emitSessionComplete` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `notifyRuntimeCompletion` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `applyRuntimeSettlement` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `processNextQueuedMessage` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `replayQueuedMessage` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `killShell` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `evictStaleBackgroundTasks` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `markOrphanedBackgroundTasks` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `listBackgroundTasks` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `getTaskOutput` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `respondToPermission` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `respondToAskUser` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `respondToCredential` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `setSessionPermissionMode` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `getSessionPermissionModeState` | 方法 | SessionManager 授权/凭据适配 + broker | 保留产品调用端 |
| `setSessionLabels` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `applyTaskLabel` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `setSessionProjectId` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setKanbanColumn` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `updateSessionPlanning` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setTaskNodeCount` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `adoptGeneratedTaskOrchestrator` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `bindExistingSessionToTask` | 方法 | 现有 TaskRunner/后台任务资源 + 产品适配 | 保留产品调用端 |
| `setSessionThinkingLevel` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `setSessionActivePlugin` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `applyActivePluginToAgent` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `preEnableActivePluginSources` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `preEnableSkillSources` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `enableContributedSources` | 方法 | source-resources.ts + SessionManager 产品适配 | 保留产品调用端 |
| `generateTitle` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `processEvent` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `sendEvent` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `queueDelta` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `discardDelta` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `flushDelta` | 方法 | SessionManager 客户端事件投影 | 保留产品调用端 |
| `executePromptAutomation` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `resolveAutomationMentions` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `generateRemoteTransferSummary` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `exportRemoteSessionTransfer` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `importRemoteSessionTransfer` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `exportSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `importSession` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `findCompatibleLlmConnection` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `cleanup` | 方法 | SessionManager 生命周期和产品缓存 | 保留产品调用端 |
| `startPreTurnDecisions` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `decisionFeatureActive` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `finishSuggestionTrace` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `noteSuggestionUse` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `decideMidTurnDelivery` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `refreshTitleIfDrifted` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `generateTitleUnlessSmallTalk` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `shouldRunPromptAutomation` | 方法 | 现有 workspace AutomationSystem + 产品适配 | 保留产品调用端 |
| `applyTurnOutcome` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `applySemanticAutoLabels` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `applyAutoLabelMatches` | 方法 | SessionManager 产品 API/metadata 适配 | 保留产品调用端 |
| `steerQueuedIfDecided` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |
| `markQueuedContinuation` | 方法 | 既有 Runtime Host + SessionManager 产品适配 | 保留产品调用端 |

每个成员的裁定理由在机器可读清单中。保留的产品 request registry、展示缓存和事件 coalescing 不构成新的执行 authority；Runtime Host 的准入、暂停、T1/T2、effect_unknown、canonical context、终态和 driver 生命周期仍由原 owner 管理。

## 依赖直接消费归属

原 39 对根清单借用和在完整解析时补出的 8 对传递/peer 借用均已声明到消费成员，总计 47 对。保留既有版本范围，无新增版本升级。UI 框架和编辑器由 peer 声明、开发宿主提供；类型包由 devDependency 持有；可选 Electron peer 不使浏览器路径获得 native capability。

| 消费成员 | 依赖 | 成员声明 | 原有版本范围 |
| --- | --- | --- | --- |
| `apps/electron` | `@dnd-kit/dom` | `dependencies` | `0.5.0` |
| `apps/electron` | `@radix-ui/react-avatar` | `dependencies` | `^1.2.6` |
| `apps/electron` | `@radix-ui/react-scroll-area` | `dependencies` | `^1.2.18` |
| `apps/electron` | `@radix-ui/react-select` | `dependencies` | `^2.3.7` |
| `apps/electron` | `@radix-ui/react-separator` | `dependencies` | `^1.1.15` |
| `apps/electron` | `@radix-ui/react-slot` | `dependencies` | `^1.3.3` |
| `apps/electron` | `@radix-ui/react-tabs` | `dependencies` | `^1.1.21` |
| `apps/electron` | `@sentry/electron` | `dependencies` | `7.20.0` |
| `apps/electron` | `@sentry/react` | `dependencies` | `10.75.0` |
| `apps/electron` | `class-variance-authority` | `dependencies` | `^0.7.1` |
| `apps/electron` | `clsx` | `dependencies` | `^2.1.1` |
| `apps/electron` | `date-fns` | `dependencies` | `^4.4.0` |
| `apps/electron` | `electron` | `devDependencies` | `^44.5.1` |
| `apps/electron` | `jotai` | `dependencies` | `^3.0.1` |
| `apps/electron` | `lucide-react` | `dependencies` | `^1.51.0` |
| `apps/electron` | `react-resizable-panels` | `dependencies` | `4.14.2` |
| `apps/electron` | `shiki` | `dependencies` | `^4.5.0` |
| `apps/electron` | `tailwind-merge` | `dependencies` | `^3.7.0` |
| `apps/webui` | `motion` | `dependencies` | `^14.0.0` |
| `packages/shared` | `electron` | `peerDependencies` | `^44.5.1` |
| `packages/shared` | `gray-matter` | `dependencies` | `^4.0.3` |
| `packages/shared` | `marked` | `dependencies` | `^18.0.14` |
| `packages/shared` | `open` | `dependencies` | `^11.0.4` |
| `packages/shared` | `tar` | `dependencies` | `^7.5.22` |
| `packages/ui` | `@radix-ui/react-tooltip` | `peerDependencies` | `^1.2.16` |
| `packages/ui` | `@tiptap/extension-file-handler` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/extension-image` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/extension-mathematics` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/extension-placeholder` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/extension-task-item` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/extension-task-list` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/markdown` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/react` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/starter-kit` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `@tiptap/suggestion` | `peerDependencies` | `^3.31.4` |
| `packages/ui` | `linkify-it` | `peerDependencies` | `6.1.0` |
| `packages/ui` | `rehype-sanitize` | `peerDependencies` | `^6.0.0` |
| `packages/ui` | `tiptap-extension-code-block-shiki` | `peerDependencies` | `^1.2.0` |
| `packages/ui` | `tiptap-markdown` | `peerDependencies` | `^0.9.0` |
| `apps/electron` | `@svar-ui/react-grid` | `dependencies` | `2.7.4` |
| `apps/electron` | `@uiw/react-json-view` | `dependencies` | `^2.0.0-alpha.43` |
| `apps/electron` | `croner` | `dependencies` | `^10.0.1` |
| `apps/electron` | `i18next` | `dependencies` | `^26.4.2` |
| `packages/shared` | `electron-log` | `dependencies` | `^5.4.4` |
| `packages/ui` | `@tiptap/core` | `peerDependencies` | `3.31.4` |
| `packages/ui` | `@tiptap/pm` | `peerDependencies` | `3.31.4` |
| `packages/ui` | `pdfjs-dist` | `peerDependencies` | `6.3.289` |

## 原 16 组循环候选

原扫描包含 type-only 的 16 组候选，其中 6 组为值引用 SCC。当前解析图还有 17 组含类型候选、3 组值 SCC；类型互引经编译擦除，不当作启动递归。值 SCC 使用成员和边的精确清单，缺理由、新增、扩大、变边和已消失的旧 exception 均会失败。

| 原组 | 基线涉及文件 | 当前裁定 |
| --- | --- | --- |
| 1 | `packages/shared/src/agent/mode-manager.ts`<br>`packages/shared/src/agent/permissions-config.ts`<br>`packages/shared/src/agent/plan-types.ts`<br>`packages/shared/src/automations/automation-system.ts`<br>`packages/shared/src/automations/handlers/index.ts`<br>`packages/shared/src/automations/handlers/script-handler.ts`<br>`packages/shared/src/automations/index.ts`<br>`packages/shared/src/automations/schemas.ts`<br>`packages/shared/src/automations/script-executor.ts`<br>`packages/shared/src/automations/validation.ts`<br>`packages/shared/src/config/config-defaults-schema.ts`<br>`packages/shared/src/config/storage.ts`<br>`packages/shared/src/config/validators.ts`<br>`packages/shared/src/credentials/index.ts`<br>`packages/shared/src/credentials/manager.ts`<br>`packages/shared/src/pages/refresh.ts`<br>`packages/shared/src/pages/storage.ts`<br>`packages/shared/src/pages/validation.ts`<br>`packages/shared/src/plugins/storage.ts`<br>`packages/shared/src/sessions/bundle.ts`<br>`packages/shared/src/sessions/index.ts`<br>`packages/shared/src/sessions/jsonl.ts`<br>`packages/shared/src/sessions/persistence-queue.ts`<br>`packages/shared/src/sessions/storage.ts`<br>`packages/shared/src/sessions/types.ts`<br>`packages/shared/src/sessions/utils.ts`<br>`packages/shared/src/sources/api-tools.ts`<br>`packages/shared/src/sources/credential-manager.ts`<br>`packages/shared/src/sources/storage.ts`<br>`packages/shared/src/workspaces/storage.ts`<br>`packages/shared/src/workspaces/types.ts` | 保留显式组合（见精确 SCC owner）：1 组；其余回引已切断或仅类型 |
| 2 | `apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx`<br>`apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`<br>`apps/electron/src/renderer/components/app-shell/SessionInfoPopover.tsx`<br>`apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx`<br>`apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx`<br>`apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`<br>`apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx`<br>`apps/electron/src/renderer/components/app-shell/input/ToolbarStatusSlot.tsx`<br>`apps/electron/src/renderer/components/app-shell/input/index.ts`<br>`apps/electron/src/renderer/components/app-shell/input/useModelVisionToggle.ts`<br>`apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx`<br>`apps/electron/src/renderer/components/ui/EditPopover.tsx`<br>`apps/electron/src/renderer/context/AppShellContext.tsx` | 保留显式组合（见精确 SCC owner）：1 组；其余回引已切断或仅类型 |
| 3 | `packages/shared/src/agent/backend/types.ts`<br>`packages/shared/src/agent/base-agent.ts`<br>`packages/shared/src/agent/session-scoped-tool-callback-registry.ts`<br>`packages/shared/src/agent/session-scoped-tools.ts`<br>`packages/shared/src/agent/spawn-session-tool.ts`<br>`packages/shared/src/mcp/mcp-pool.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 4 | `packages/ui/src/components/chat/TurnCard.tsx`<br>`packages/ui/src/components/chat/recovery-policy.ts`<br>`packages/ui/src/components/chat/turn-utils.ts`<br>`packages/ui/src/components/overlay/ActivityCardsOverlay.tsx`<br>`packages/ui/src/components/overlay/index.ts`<br>`packages/ui/src/lib/tool-parsers.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 5 | `packages/messaging-whatsapp-worker/src/media.ts`<br>`packages/messaging-whatsapp-worker/src/upsert.ts`<br>`packages/messaging-whatsapp-worker/src/worker.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 6 | `packages/ui/src/components/chat/InlineExecution.tsx`<br>`packages/ui/src/components/chat/index.ts`<br>`packages/ui/src/index.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 7 | `apps/electron/src/main/auto-update.ts`<br>`apps/electron/src/main/menu.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 8 | `apps/electron/src/main/deep-link.ts`<br>`apps/electron/src/main/window-manager.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 9 | `apps/electron/src/renderer/actions/keybinding-context.ts`<br>`apps/electron/src/renderer/context/FocusContext.tsx` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 10 | `apps/electron/src/renderer/components/app-shell/ActiveTasksBar.tsx`<br>`apps/electron/src/renderer/components/app-shell/TaskActionMenu.tsx` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 11 | `apps/electron/src/renderer/components/messaging/access/TelegramAccessSection.tsx`<br>`apps/electron/src/renderer/components/messaging/access/index.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 12 | `packages/server-core/src/bootstrap/headless-start.ts`<br>`packages/server-core/src/handlers/rpc/server.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 13 | `packages/session-tools-core/src/runtime/resolve-script-runtime.ts`<br>`packages/session-tools-core/src/runtime/sandbox-env.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 14 | `packages/shared/src/agent/browser-tool-runtime.ts`<br>`packages/shared/src/agent/browser-tools.ts` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |
| 15 | `packages/ui/src/components/markdown/Markdown.tsx`<br>`packages/ui/src/components/markdown/MarkdownDocBlock.tsx` | 保留显式组合（见精确 SCC owner）：1 组；其余回引已切断或仅类型 |
| 16 | `packages/ui/src/components/trajectory/TrajectoryOverview.tsx`<br>`packages/ui/src/components/trajectory/TrajectoryView.tsx` | 无保留运行值 SCC；barrel 回引已切断或仅类型擦除 |

3 个保留值组合分别为：compact EditPopover 嵌入 ChatDisplay 的显式组件递归；MarkdownDocBlock 的禁用再次预览 guard；SourceStorage 与 CredentialManager 的同一源事务清理边界。它们没有模块求值时调用彼此，也没有第二个 credential writer。调用单元、条件和 owner 固定在 [cycle-ownership.json](../../scripts/cycle-ownership.json)。

## 17 个 localStorage 警告

| 文件 | 数量 | 分类与保留理由 |
| --- | ---: | --- |
| `apps/electron/src/renderer/lib/local-storage.ts` | 5 | 设备/窗口展示偏好缓存；不能持有 credential、RPC auth 或 canonical runtime 事实 |
| `apps/electron/src/renderer/playground/ComponentPreview.tsx` | 3 | 开发 playground 的设备展示状态；不进入生产 workspace/Host 事实 |
| `apps/electron/src/renderer/playground/MotionToggle.tsx` | 2 | 开发 playground 的设备展示状态；不进入生产 workspace/Host 事实 |
| `apps/electron/src/renderer/playground/PlaygroundApp.tsx` | 5 | 开发 playground 的设备展示状态；不进入生产 workspace/Host 事实 |
| `apps/electron/src/renderer/playground/Sidebar.tsx` | 2 | 开发 playground 的设备展示状态；不进入生产 workspace/Host 事实 |

12 个属于开发 playground，5 个属于集中展示缓存 helper。这是已分类的展示状态例外；不把它们写成“警告已归零”。其余 Hooks 存量也继续受精确 warning baseline 的防新增门禁。重点 AppShell、FreeFormInput、ChatDisplay 的 31 个 Hooks 警告已清偿，全库 warning 从 120 降至 89。

## 浏览器与平台边界

业务 renderer 在 authenticated transport 已连接、initializeClient 完成后挂载。Electron contextBridge 的只读入口保持原句柄；Web 安装自己的兼容 facade。会话、连接、文件、导航、偏好、草稿、通知、clipboard 分为有限 ports；不可用 native 能力抛出明确 capability error。

46 个 alias/shim 缩减至 4 个：ws 的浏览器 WebSocket 实现、主进程日志的不可达占位、renderer console 日志、可选 Sentry observer。Node builtin、文件系统、open/stream 等替身和 3 个历史 browser closure exception 均移除。4 个保留项有能力/观察边界，不模拟成功的 native 文件写入。

快速工作区切换先销毁旧会话监听、flush composer 和产品持久化 timer，再变更连接绑定并加载目标草稿。Web 与 preload RoutedClient 在 ACK 后更新 reconnect 使用的 workspaceId。失败时恢复旧产品选择；跨工作区旧消息页面不会挂载。

use-draft-persistence 拥有 pending 草稿版本与写入 promise；断线期间的绝对快照保留，连接恢复后只保存最新值。Web 设置页使用 platform kind 显式隐藏原生专用控制项，并且不发送对应 native RPC。真实场景及最终证据见[完整实施台账](governance-completion-2026-10-11.md)。

## Pi 的 shared 公开端口

基线的“30 个引用”指 import/export 声明；补上 3 个 TS import type 表达式后为 33 个 AST 位置。拆出 message/event owner 后当前为 37 个位置，均通过已声明 public export。全部当前位置逐项列在下面，旧位置与当前位置的完整对照在 `pi-reference-census.json`。

| 消费模块 | 公开端口 | 编译类型/运行值 | 有限用途 |
| --- | --- | --- | --- |
| `packages/pi-agent-server/src/messages.ts` | `@phaneris/shared/agent/context-policy` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/messages.ts` | `@phaneris/shared/agent/llm-tool` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/messages.ts` | `@phaneris/shared/agent/backend/pi/protocol` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/messages.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/messages.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/messages.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/canonical-model-context.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/context-policy-stream.ts` | `@phaneris/shared/agent/context-policy` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/context-usage.ts` | `@phaneris/shared/agent/backend/pi/protocol` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/custom-endpoint-models.ts` | `@phaneris/shared/config/models` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/durable-model-stream.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/durable-tool-context.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/agent/context-policy` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/config/pi-provider-compat` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/utils/large-response` | 值 | 指定 session 目录下的工具响应 IO；无 Host 存储 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/sessions/paths` | 值 | 指定 session 目录下的工具响应 IO；无 Host 存储 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/agent/llm-tool` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/agent/llm-tool` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/agent/backend/pi/constants` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/config/models` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/agent/backend/pi/protocol` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/index.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/large-result-filter.ts` | `@phaneris/shared/utils/large-response` | 值 | 指定 session 目录下的工具响应 IO；无 Host 存储 |
| `packages/pi-agent-server/src/large-result-filter.ts` | `@phaneris/shared/agent/backend/pi/protocol` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/large-result-gate.ts` | `@phaneris/shared/utils/large-response` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/large-result-gate.ts` | `@phaneris/shared/agent/backend/pi/protocol` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/large-result-gate.ts` | `@phaneris/shared/decisions/types` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/mini-model-query.ts` | `@phaneris/shared/agent/llm-tool` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/mini-model-query.ts` | `@phaneris/shared/config/models` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/mini-model-query.ts` | `@phaneris/shared/config/llm-connections` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/model-resolution.ts` | `@phaneris/shared/config/pi-provider-compat` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/model-resolution.ts` | `@phaneris/shared/config/llm-connections` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/native-request-observation.ts` | `@phaneris/shared/durable-runtime/types` | 类型 | DTO/协议，编译擦除 |
| `packages/pi-agent-server/src/pick-mini-model.ts` | `@phaneris/shared/config/llm-connections` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/session-settings.ts` | `@phaneris/shared/agent/llm-tool` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |
| `packages/pi-agent-server/src/tools/search/providers/chatgpt.ts` | `@phaneris/shared/config/llm-connections` | 值 | 模型/策略/工具纯配置计算；无 Runtime Host 或产品队列 |

SDK registration 由进程启动显式调用；session-lifecycle 合并并发创建和失效的 generation；model-runtime-owner 唯一持有 AuthStorage/ModelRegistry 创建 promise；pending-replies 的 registry 在回调前删除并在 abort/断管/退出统一取消；tool-composition 构建首轮工具 snapshot；session-event-adapter 仅接收 emit/current-session/诊断/context 等有限 ports。JSONL transport 持有标准输入和 protocol-only stdout，不导入产品 SessionManager，不提供自动重启执行。

SessionManager 内部 facade 方法继续适配产品 mutation、projection 和注册 port。独立 Pi/SQLite/Host E2E 使用相同 agent-assembly，在无 SessionManager 条件下完成两轮、首轮工具一致性、真实 read T1/T2、canonical context、usage 和 driver 关闭。这是装配边界独立性的实际验证。

## 独立审计后的 owner 补充

最新逐行清单在 [收口归档](../verification/results/governance-closeout-2026-10-11/README.md) 的 analysis/ownership-inventory.json。基线 129 个配置公开名称保持；repository 另外提供只删除根 config 的 deleteConfigFile，auth/logout 直接委托此 owner。CredentialManager 的严格删除选项用于需要事务失败传播的 remote token/workspace/logout 路径，旧 boolean 兼容调用保持。

agent-product-context 仅塑形产品配置；agent-product-callbacks 仅经 read/patch/persist/flush/thinkingChanged/log/error 处理分支、SDK 标识、thinking 与上下文转移。Pi durable-tool-accounting 私有持有两个 Map；index 和 session-event-adapter 只调用其有限方法。入口保留 prompt/control 的进程状态，未声称变成纯启动文件。

input-draft-flush 管理 mounted composer lease，use-input-draft 管理 300ms 文本同步，use-draft-persistence 管理 500ms 保存与版本确认。切换前同时排空两个层次；失败不卸载 composer，重连后继续保存。文件树的真实消费者使用有限 files port/capability；其余历史 electronAPI 按兼容接口保留。
