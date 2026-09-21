/**
 * PromptBuilder - System Prompt and Context Building
 *
 * Provides utilities for building system prompts and context blocks used by
 * PiAgent. Handles workspace capabilities, recovery
 * context, and user preferences formatting.
 *
 * Key responsibilities:
 * - Build workspace capabilities context
 * - Format recovery context for session resume failures
 * - Build session state context blocks
 * - Format user preferences for prompt injection
 */

import { isLocalMcpEnabled } from '../../workspaces/storage.ts';
import { formatPreferencesForPrompt } from '../../config/preferences.ts';
import { formatSessionState } from '../mode-manager.ts';
import { getDateTimeContext, getWorkingDirectoryContext } from '../../prompts/system.ts';
import {
  formatStableGitDeveloperContext,
  formatVolatileGitDeveloperContext,
} from '../../prompts/developer-context.ts';
import { getSessionPlansPath, getSessionDataPath, getSessionPath } from '../../sessions/storage.ts';
import type {
  PromptBuilderConfig,
  ContextBlockOptions,
  RecoveryMessage,
} from './types.ts';

/**
 * PromptBuilder provides utilities for building prompts and context blocks.
 *
 * Usage:
 * ```typescript
 * const promptBuilder = new PromptBuilder({
 *   workspace,
 *   session,
 *   debugMode: { enabled: true },
 * });
 *
 * // Build context blocks for a user message
 * const contextParts = promptBuilder.buildContextParts({
 *   permissionMode: 'explore',
 *   plansFolderPath: '/path/to/plans',
 * });
 * ```
 */
export class PromptBuilder {
  private config: PromptBuilderConfig;
  private workspaceRootPath: string;
  private pinnedPreferencesPrompt: string | null = null;
  private stableDeveloperContextCache: { workingDirectory: string | undefined; value: string | null } | null = null;

  constructor(config: PromptBuilderConfig) {
    this.config = config;
    this.workspaceRootPath = config.workspace?.rootPath ?? '';
  }

  // ============================================================
  // Context Building
  // ============================================================

  /**
   * Build all context parts for a user message (volatile blocks first, then
   * stable blocks). Returns an array of strings that should be prepended to the
   * user message.
   *
   * This composes {@link buildVolatileContextParts} and
   * {@link buildStableContextParts} so the output is byte-identical to the
   * pre-split version (same 5 blocks, same order) AND the one-shot mode-change
   * signal is consumed exactly once per turn (only the volatile builder consumes
   * it). Callers that place volatile vs stable context in different locations
   * (to preserve prompt caching — issue #862) should call
   * the two halves directly instead of this method.
   *
   * @param options - Context building options
   * @param sourceStateBlock - Pre-formatted source state (from SourceManager)
   * @returns Array of context strings
   */
  buildContextParts(
    options: ContextBlockOptions,
    sourceStateBlock?: string,
    pluginContextBlock?: string
  ): string[] {
    return [
      ...this.buildVolatileContextParts(options, sourceStateBlock, pluginContextBlock),
      ...this.buildStableContextParts(),
    ];
  }

  /**
   * Volatile context blocks — content that can change every turn, so it must
   * ride the user-message tail rather than the cached system prefix (issue
   * #862). Folding these into the system prompt re-stamps the cache prefix each
   * turn and kills prompt-cache reuse for all downstream history.
   *
   * Blocks (in order):
   *  1. date/time (minute precision)
   *  2. session_state (permission mode + plans/data paths; carries
   *     modeChangedAt/modeVersion and **consumes** the one-shot mode-change user
   *     signal — see {@link formatSessionState})
   *  3. source state (auth/connection status), when provided
   *  4. active plugin context (prompt fragment + skill roster), when provided
   *
   * MUST be called exactly once per turn, because it consumes one-shot mode
   * state. Never call it a second time to compute a cache-debug hash — hash the
   * already-produced string instead.
   *
   * @param options - Context building options
   * @param sourceStateBlock - Pre-formatted source state (from SourceManager)
   * @param pluginContextBlock - Pre-formatted active-plugin block. Volatile
   *   because the active plugin is session state, and the fragment is untrusted
   *   input that must not enter the cached prefix (design section 4.2).
   */
  buildVolatileContextParts(
    options: ContextBlockOptions,
    sourceStateBlock?: string,
    pluginContextBlock?: string
  ): string[] {
    const parts: string[] = [];

    // Date/time first (kept on the user tail to preserve prompt caching)
    parts.push(getDateTimeContext());

    // Session state (permission mode, plans folder path, data folder path).
    // Only this volatile builder may consume the one-shot mode-change signal.
    const sessionId = this.config.session?.id ?? `temp-${Date.now()}`;
    const plansFolderPath = options.plansFolderPath ??
      getSessionPlansPath(this.workspaceRootPath, sessionId);
    const dataFolderPath = options.dataFolderPath ??
      getSessionDataPath(this.workspaceRootPath, sessionId);
    parts.push(formatSessionState(sessionId, {
      plansFolderPath,
      dataFolderPath,
      consumeModeChangeUserSignal: true,
    }));

    // Source state if provided
    if (sourceStateBlock) {
      parts.push(sourceStateBlock);
    }

    // Volatile git developer context (branch, worktree state, changed-file sample).
    const volatileDeveloperContext = this.getVolatileDeveloperContext();
    if (volatileDeveloperContext) {
      parts.push(volatileDeveloperContext);
    }

    // Active plugin context if provided
    if (pluginContextBlock) {
      parts.push(pluginContextBlock);
    }

    return parts;
  }

  /**
   * Stable context blocks — content that is invariant across a session, so it
   * can safely live in the cached system prefix (issue #862).
   *
   * Blocks (in order):
   *  1. workspace capabilities
   *  2. working directory, when available
   *
   * Pure and idempotent: holds no one-shot state, so it is safe to call any
   * number of times per turn.
   */
  buildStableContextParts(): string[] {
    const parts: string[] = [];

    // Workspace capabilities
    parts.push(this.formatWorkspaceCapabilities());

    // Working directory context
    const workingDirContext = this.getWorkingDirectoryContext();
    if (workingDirContext) {
      parts.push(workingDirContext);
    }

    // Stable git developer context (repository identity + standing guidance).
    const stableDeveloperContext = this.getStableDeveloperContext();
    if (stableDeveloperContext) {
      parts.push(stableDeveloperContext);
    }

    return parts;
  }

  /**
   * Repository identity for the selected working directory, cached per directory.
   *
   * The value is invariant while the working directory stays put, so it is read
   * once per session (or per directory switch) instead of spawning git on every
   * turn — this block sits in the cached system prefix, where churn would also
   * cost prompt-cache reuse.
   */
  private getStableDeveloperContext(): string | null {
    const workingDirectory = this.getSelectedWorkingDirectory();
    const cached = this.stableDeveloperContextCache;
    if (cached && cached.workingDirectory === workingDirectory) {
      return cached.value;
    }

    const value = formatStableGitDeveloperContext(workingDirectory);
    this.stableDeveloperContextCache = { workingDirectory, value };
    return value;
  }

  /** Branch/status snapshot for this turn; recomputed because it changes per turn. */
  private getVolatileDeveloperContext(): string | null {
    return formatVolatileGitDeveloperContext(this.getSelectedWorkingDirectory());
  }

  /**
   * The directory the session actually works in: an explicit session working
   * directory, otherwise the session's own folder.
   */
  getSelectedWorkingDirectory(): string | undefined {
    const sessionId = this.config.session?.id;
    return this.config.session?.workingDirectory ??
      (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : undefined);
  }

  /**
   * Format workspace capabilities for prompt injection.
   * Informs the agent about what features are available in this workspace.
   */
  formatWorkspaceCapabilities(): string {
    const capabilities: string[] = [];

    // Check local MCP server capability
    const localMcpEnabled = isLocalMcpEnabled(this.workspaceRootPath);
    if (localMcpEnabled) {
      capabilities.push('local-mcp: enabled (stdio subprocess servers supported)');
    } else {
      capabilities.push('local-mcp: disabled (only HTTP/SSE servers)');
    }

    return `<workspace_capabilities>\n${capabilities.join('\n')}\n</workspace_capabilities>`;
  }

  /**
   * Get working directory context for prompt injection.
   */
  getWorkingDirectoryContext(): string | null {
    const sessionId = this.config.session?.id;
    const isSessionRoot = !this.config.session?.workingDirectory && !!sessionId;

    return getWorkingDirectoryContext(
      this.getSelectedWorkingDirectory(),
      isSessionRoot,
      this.config.session?.sdkCwd
    );
  }

  // ============================================================
  // Recovery Context
  // ============================================================

  /**
   * Build recovery context from previous messages when SDK resume fails.
   * Called when we detect an empty response during resume.
   *
   * @param messages - Previous messages to include in recovery context
   * @returns Formatted recovery context string, or null if no messages
   */
  buildRecoveryContext(messages?: RecoveryMessage[]): string | null {
    if (!messages || messages.length === 0) {
      return null;
    }

    // Format messages as a conversation block
    const formattedMessages = messages.map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      // Truncate very long messages to avoid bloating context
      const content = m.content.length > 1000
        ? m.content.slice(0, 1000) + '...[truncated]'
        : m.content;
      return `[${role}]: ${content}`;
    }).join('\n\n');

    return `<conversation_recovery>
This session was interrupted and is being restored. Here is the recent conversation context:

${formattedMessages}

Please continue the conversation naturally from where we left off.
</conversation_recovery>

`;
  }

  // ============================================================
  // User Preferences
  // ============================================================

  /**
   * Format user preferences for prompt injection.
   * Preferences are pinned on first call to ensure consistency within a session.
   *
   * @param forceRefresh - Force refresh of cached preferences
   * @returns Formatted preferences string
   */
  formatPreferences(forceRefresh = false): string {
    // Return pinned preferences if available (ensures session consistency)
    if (this.pinnedPreferencesPrompt && !forceRefresh) {
      return this.pinnedPreferencesPrompt;
    }

    // Load and format preferences (function loads internally)
    this.pinnedPreferencesPrompt = formatPreferencesForPrompt();
    return this.pinnedPreferencesPrompt;
  }

  /**
   * Clear pinned preferences (called on session clear).
   */
  clearPinnedPreferences(): void {
    this.pinnedPreferencesPrompt = null;
  }

  // ============================================================
  // Configuration Accessors
  // ============================================================

  /**
   * Update the workspace configuration.
   */
  setWorkspace(workspace: PromptBuilderConfig['workspace']): void {
    this.config.workspace = workspace;
    this.workspaceRootPath = workspace?.rootPath ?? '';
  }

  /**
   * Update the session configuration.
   */
  setSession(session: PromptBuilderConfig['session']): void {
    this.config.session = session;
  }

  /**
   * Get the workspace root path.
   */
  getWorkspaceRootPath(): string {
    return this.workspaceRootPath;
  }

  /**
   * Check if debug mode is enabled.
   */
  isDebugMode(): boolean {
    return this.config.debugMode?.enabled ?? false;
  }

  /**
   * Get the system prompt preset.
   */
  getSystemPromptPreset(): string {
    return this.config.systemPromptPreset ?? 'default';
  }
}
