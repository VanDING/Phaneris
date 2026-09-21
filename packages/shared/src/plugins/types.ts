/**
 * Plugin Types
 *
 * A plugin bundle is a workspace-owned directory that follows the Agent Plugins
 * 1.0.0 package format:
 *
 *   <workspaceRoot>/plugins/<name>/
 *   ├── plugin.json              Agent Plugins manifest (required)
 *   ├── skills/<slug>/SKILL.md   materialized into <ws>/skills/<slug>/
 *   ├── mcp.json                 materialized into <ws>/sources/<slug>/
 *   ├── PROMPT.md                resident prompt fragment (injected per turn)
 *   └── phaneris/sources.json    client extension: api / local source declarations
 *
 * Design contract lives in docs/plugin-bundles-design.md; every decision
 * referenced below as D<n> / P<n> is closed in docs/plugin-bundles-decisions.md.
 */

/** Agent Plugins 1.0.0 canonical manifest schema identifier. */
export const PLUGIN_MANIFEST_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

/** Agent Plugins 1.0.0 canonical MCP configuration schema identifier. */
export const PLUGIN_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

/** Plugin directory name inside a workspace root. */
export const PLUGINS_DIR_NAME = 'plugins';

/**
 * Client extension namespace (design §3.4).
 *
 * Deviates from the spec's SHOULD (reverse-domain) because this project owns no
 * domain — `phaneris.identity.json`'s `services` block is entirely null and the
 * only reverse-domain-shaped identifier is the GitHub-based appId. The spec
 * assigns no portable semantics to client extension content, so the
 * interoperability cost is zero.
 */
export const PLUGIN_EXTENSION_NAMESPACE = 'phaneris';

/** Extension declaration file, relative to the plugin root. */
export const PLUGIN_EXTENSION_SOURCES_FILE = `${PLUGIN_EXTENSION_NAMESPACE}/sources.json`;

/** Resident prompt fragment file, relative to the plugin root. */
export const PLUGIN_PROMPT_FILE = 'PROMPT.md';

/** MCP server configuration file, relative to the plugin root (spec §7.2.1). */
export const PLUGIN_MCP_FILE = 'mcp.json';

/** Manifest file, relative to the plugin root (spec §5.1). */
export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/** Skill discovery directory, relative to the plugin root (spec §7.1). */
export const PLUGIN_SKILLS_DIR_NAME = 'skills';

/** Plugin-owned mutable data directory name (design §5.4.7). */
export const PLUGIN_DATA_DIR_NAME = 'data';

/** Placeholder for the plugin root, in stdio command/args/env (spec §7.2.1). */
export const PLUGIN_ROOT_PLACEHOLDER = '${PLUGIN_ROOT}';

/** Placeholder for the plugin's mutable data directory (design §5.4.2). */
export const PLUGIN_DATA_PLACEHOLDER = '${PLUGIN_DATA}';

/**
 * Plugin author metadata (spec §5.4).
 * The spec permits only these three string fields; anything else is invalid.
 */
export interface PluginAuthor {
  name?: string;
  email?: string;
  url?: string;
}

/**
 * Parsed `plugin.json` (spec §5.2).
 *
 * `$schema` and `name` are required by the spec. The schema is closed: unknown
 * top-level fields are reported and ignored, never fatal (spec §5.2).
 */
export interface PluginManifest {
  /** Canonical manifest schema identifier. Required. */
  $schema: string;
  /** Human-readable plugin name. Required; also the directory name (P2-2). */
  name: string;
  version?: string;
  description?: string;
  /** Emoji or URL icon, matching source and skill icon conventions. */
  icon?: string;
  author?: PluginAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  /** Client-specific manifest data, keyed by extension namespace (spec §8.1). */
  extensions?: Record<string, unknown>;
}

/** A skill contributed by a plugin, before materialization. */
export interface PluginSkillEntry {
  /** Directory name under `skills/`; must equal the SKILL.md `name` (P2-3). */
  slug: string;
  /** Display name from SKILL.md frontmatter. */
  name: string;
  /** Description from SKILL.md frontmatter; feeds the `/plugin` roster. */
  description: string;
  /** Absolute path to the skill directory inside the plugin. */
  path: string;
}

/** An MCP server contributed by a plugin (from `mcp.json`). */
export interface PluginMcpServerEntry {
  /** `mcpServers` key; becomes the workspace source slug. */
  slug: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
}

/** An api / local source contributed by a plugin (from the extension namespace). */
export interface PluginSourceEntry {
  slug: string;
  type: 'api' | 'local';
}

/** Everything a plugin contributes, derived from its files (design §3.2). */
export interface PluginResources {
  skills: PluginSkillEntry[];
  mcpServers: PluginMcpServerEntry[];
  /** api / local sources declared in the extension namespace. */
  extensionSources: PluginSourceEntry[];
}

/** Non-fatal issues found while loading (spec §6.2 / §7.1 / §7.2.2 failure boundaries). */
export interface PluginLoadWarning {
  /** Plugin-relative path the warning concerns. */
  path: string;
  message: string;
}

/** A fully loaded plugin. */
export interface LoadedPlugin {
  /** Directory name; equals `manifest.name` (P2-2). */
  name: string;
  manifest: PluginManifest;
  /** Absolute path to the plugin root. */
  path: string;
  /** Absolute path to the workspace root that owns this plugin. */
  workspaceRootPath: string;
  resources: PluginResources;
  /** Workspace-relative plugin root, e.g. `plugins/my-plugin` (§5.4.4). */
  workspaceRelativePath: string;
  /** Resident prompt fragment contents, or null when `PROMPT.md` is absent (P3-1). */
  promptFragment: string | null;
  warnings: PluginLoadWarning[];
}

/** Why a plugin directory could not be loaded. Fatal — the plugin is unusable. */
export interface PluginLoadError {
  pluginName?: string;
  /** Plugin-relative path or the manifest path. */
  path: string;
  message: string;
}
