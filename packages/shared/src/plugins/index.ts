/**
 * Plugins Module
 *
 * Public exports for plugin bundle management (Agent Plugins 1.0.0).
 *
 * A plugin is a workspace-owned package whose skills and MCP servers
 * materialize into the native tiers, plus its own identity file, prompt
 * fragment, and client extension namespace.
 *
 * Design: docs/plugin-bundles-design.md
 * Decisions (all closed): docs/plugin-bundles-decisions.md
 */

export {
  PLUGIN_MANIFEST_SCHEMA,
  PLUGIN_MCP_SCHEMA,
  PLUGINS_DIR_NAME,
  PLUGIN_EXTENSION_NAMESPACE,
  PLUGIN_EXTENSION_SOURCES_FILE,
  PLUGIN_PROMPT_FILE,
  PLUGIN_MCP_FILE,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_SKILLS_DIR_NAME,
  PLUGIN_DATA_DIR_NAME,
  PLUGIN_ROOT_PLACEHOLDER,
  PLUGIN_DATA_PLACEHOLDER,
} from './types.ts';

export type {
  PluginAuthor,
  PluginManifest,
  PluginSkillEntry,
  PluginMcpServerEntry,
  PluginSourceEntry,
  PluginResources,
  PluginLoadWarning,
  PluginLoadError,
  LoadedPlugin,
} from './types.ts';

export { validatePluginManifest, isValidPluginName } from './validation.ts';
export type { ManifestValidationResult } from './validation.ts';

export {
  loadPlugin,
  loadPluginAt,
  loadAllPlugins,
  loadPluginByName,
  listPluginNames,
  pluginExists,
  readPluginSkills,
  readPluginMcpServers,
  readPluginExtensionSources,
  resolveWithinPlugin,
  getPluginDataPath,
  pluginNameFromPath,
} from './storage.ts';
export type { PluginLoadResult } from './storage.ts';

// Placeholder resolution (design section 5.4)
export {
  expandPluginPlaceholders,
  expandPluginPlaceholdersInList,
  expandPluginPlaceholdersInEnv,
  normalizePluginCommand,
  validatePluginCwd,
  resolvePluginStdioFields,
  PluginPathError,
} from './resolve.ts';
export type { PluginPathContext, ResolvedStdioFields } from './resolve.ts';

// Installation and materialization (module B)
export {
  analyzePluginInstall,
  installPlugin,
  installPluginFrom,
  analyzePluginUninstall,
  uninstallPlugin,
  rebuildPluginIndex,
  readPluginIndex,
  getPluginIndexPath,
  PluginInstallError,
} from './install.ts';
export type {
  PluginInstallPlan,
  PluginInstallResult,
  PluginOverwriteEntry,
  PluginStdioCommand,
  PluginUninstallPlan,
  PluginUninstallResult,
  PluginIndex,
} from './install.ts';

// Import from archive / URL (design section 5.1.1)
export {
  extractPluginArchive,
  downloadPluginArchive,
  PluginImportError,
  PLUGIN_ARCHIVE_MAX_BYTES,
  PLUGIN_EXTRACTED_MAX_BYTES,
} from './import.ts';
export type { ExtractedPluginPackage } from './import.ts';

// Active-plugin prompt context (module D)
export {
  PLUGIN_CONTEXT_TAG,
  defangPluginContextTag,
  stripDangerousControlChars,
  sanitizePluginPromptText,
  buildPluginRoster,
  formatPluginContextBlock,
  formatActivePluginContext,
} from './plugin-context.ts';
export type { PluginRosterEntry } from './plugin-context.ts';

// Audit trail (P5-4)
export {
  appendPluginAuditEntry,
  readPluginAuditLog,
  PLUGIN_AUDIT_LOG,
} from './audit.ts';
export type { PluginAuditEntry, PluginAuditStdioCommand } from './audit.ts';

// Renderer-facing projection — the single shape both the list RPC and the
// `plugins:changed` push use.
export { summarizePluginForRenderer, summarizePluginsForRenderer } from './dto.ts';
export type { PluginSummaryDto } from './dto.ts';
