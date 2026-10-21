/** persisted-types ownership. config.json writes belong exclusively to repository.ts. */

import { type StoredMessage, type Workspace } from '@phaneris/core/types';

import { type ThinkingLevel } from '../agent/thinking-levels.ts';

import { type DecisionLayerStoredSettings } from '../decisions/settings.ts';

import { type LlmConnection } from './llm-connections.ts';

import { type ImageGenerationSettings } from './image-generation.ts';

import { type NetworkProxySettings } from './types.ts';

import { type ServerConfig } from './server-config.ts';

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  // LLM Connections (authoritative source for auth and model config)
  llmConnections?: LlmConnection[];
  defaultLlmConnection?: string;  // Slug of default connection for new sessions
  defaultThinkingLevel?: ThinkingLevel;  // App-level default thinking level for new sessions
  imageGeneration?: ImageGenerationSettings;

  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  // Notifications
  notificationsEnabled?: boolean;  // Desktop notifications for task completion (default: true)
  // Appearance
  colorTheme?: string;  // ID of selected preset theme (e.g., 'dracula', 'nord'). Default: 'default'
  themeMode?: 'light' | 'dark' | 'system';
  themeFont?: 'theme' | 'inter' | 'system';
  // Auto-update
  dismissedUpdateVersion?: string;  // Version that user dismissed (skip notifications for this version)
  // Input settings
  autoCapitalisation?: boolean;  // Auto-capitalize first letter when typing (default: true)
  sendMessageKey?: 'enter' | 'cmd-enter';  // Key to send messages (default: 'enter')
  spellCheck?: boolean;  // Enable spell check in input (default: false)
  // Power settings
  keepAwakeWhileRunning?: boolean;  // Prevent screen sleep while sessions are running (default: false)
  // Tool metadata
  richToolDescriptions?: boolean;  // Add intent/action metadata to all tool calls (default: true)
  // Tools
  browserToolEnabled?: boolean;  // Enable built-in browser tool (default: true). Disable for Playwright/Puppeteer.
  allowRemoteEvaluate?: boolean;  // Allow remote agents to call `browser_tool evaluate` on local browser (default: true).
  // Prompt caching & context
  contextPolicy?: import('../agent/context-policy').ContextPolicy;
  compactionThresholdTokens?: number;
  promptCacheWarming?: boolean; // Cost-aware warming during active tool runs (default: false)
  extendedPromptCache?: boolean;  // Use long-lived prompt cache retention where supported (default: false)
  // Token optimization
  rtkExcludeCommands?: string[];
  rtkEnabled?: boolean;  // Route Bash commands through rtk to compress tool output (default: false). https://github.com/rtk-ai/rtk
  // Decision layer (Jev / TypeSafe System One) — opt-in, off by default. See src/decisions/.
  decisionLayer?: DecisionLayerStoredSettings;
  // Network proxy
  networkProxy?: import('./types.ts').NetworkProxySettings;
  // Windows: path to Git Bash (bash.exe) for the SDK subprocess
  gitBashPath?: string;
  // User chose "Setup later" during onboarding — skip showing onboarding on next launch
  setupDeferred?: boolean;
  // Server mode — embedded remote server settings
  serverConfig?: import('./server-config.ts').ServerConfig;
  // One-shot migration markers. Used by migrations that should run at most
  // once per user (e.g. restoring a previously-removed model to connection
  // lists without re-adding it if the user later removes it deliberately).
  migrationsApplied?: string[];
}

/** Remote-server metadata persisted in config.json (never contains the token). */
export type PersistedRemoteServer = {
  url: string
  remoteWorkspaceId: string
  allowInsecureTls?: boolean
}

export interface WorkspaceConversation {
  messages: StoredMessage[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextTokens: number;
    costUsd: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  savedAt: number;
}

export interface DraftAttachmentContent {
  type: 'image' | 'pdf' | 'text' | 'office' | 'audio' | 'unknown';
  mimeType: string;
  size: number;
  base64?: string;
  text?: string;
  thumbnailBase64?: string;
}

export interface DraftAttachmentRef {
  path: string;
  name: string;
  /** Inline content for attachments without a real filesystem path (paste, web-drag).
   *  When present, hydrate reconstructs from these bytes and skips any disk read. */
  content?: DraftAttachmentContent;
}

export interface SessionDraft {
  text: string;
  attachments?: DraftAttachmentRef[];
}

export interface DraftsData {
  drafts: Record<string, SessionDraft>;
  updatedAt: number;
}
