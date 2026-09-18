/**
 * Plugin Storage
 *
 * Reads plugin bundles from `<workspaceRoot>/plugins/<name>/`.
 *
 * Plugins are workspace-owned resources (D1): each workspace materializes the
 * skills and MCP servers it needs, because source credentials are keyed by
 * workspace (`source_oauth::{workspaceId}::{slug}`), so sharing a global plugin
 * directory across workspaces is not possible.
 *
 * Loading is read-only and never throws: a plugin that violates the spec's
 * fatal rules is reported as a `PluginLoadResult` error so callers can surface
 * it without breaking the rest of the workspace.
 */

import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import matter from 'gray-matter';
import { getWorkspacePluginsPath } from '../workspaces/storage.ts';
import { isPathWithin } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { validatePluginManifest } from './validation.ts';
import {
  PLUGIN_DATA_DIR_NAME,
  PLUGIN_EXTENSION_SOURCES_FILE,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_MCP_FILE,
  PLUGIN_PROMPT_FILE,
  PLUGIN_SKILLS_DIR_NAME,
  type LoadedPlugin,
  type PluginLoadError,
  type PluginLoadWarning,
  type PluginManifest,
  type PluginMcpServerEntry,
  type PluginResources,
  type PluginSkillEntry,
  type PluginSourceEntry,
} from './types.ts';

/** Discriminated result of loading one plugin. */
export type PluginLoadResult =
  | { ok: true; plugin: LoadedPlugin }
  | { ok: false; error: PluginLoadError };

/**
 * Read and validate a plugin's `plugin.json` (spec §5).
 *
 * @param pluginRoot - Absolute path to the plugin root.
 * @param expectedName - Directory name, which the manifest `name` must equal (P2-2).
 */
function readManifest(
  pluginRoot: string,
  expectedName: string,
): { manifest: PluginManifest; warnings: PluginLoadWarning[] } | PluginLoadError {
  const manifestPath = join(pluginRoot, PLUGIN_MANIFEST_FILE);

  if (!existsSync(manifestPath)) {
    return { path: PLUGIN_MANIFEST_FILE, message: 'plugin.json is missing' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path: PLUGIN_MANIFEST_FILE, message: `plugin.json is not valid JSON: ${message}` };
  }

  const result = validatePluginManifest(raw);
  if (!result.manifest) {
    return { path: PLUGIN_MANIFEST_FILE, message: result.errors.join('; ') };
  }

  // P2-2: the directory name is the plugin identity. A mismatch is fatal rather
  // than resolved in either direction, because D10's reference counting treats
  // the slug as the identity — tolerating a mismatch would make uninstall
  // silently delete the wrong resources.
  if (result.manifest.name !== expectedName) {
    return {
      path: PLUGIN_MANIFEST_FILE,
      message:
        `manifest name "${result.manifest.name}" does not match directory name "${expectedName}" — ` +
        'they must be identical',
    };
  }

  const warnings: PluginLoadWarning[] = result.warnings.map((message) => ({
    path: PLUGIN_MANIFEST_FILE,
    message,
  }));

  return { manifest: result.manifest, warnings };
}

/**
 * Parse a skill's SKILL.md frontmatter for the roster (design §4.3.1).
 *
 * @returns name/description, or null when the file is not a valid skill.
 */
function parseSkillFrontmatter(
  skillDir: string,
): { name: string; description: string } | null {
  const skillFile = join(skillDir, 'SKILL.md');
  if (!existsSync(skillFile)) return null;

  try {
    const parsed = matter(readFileSync(skillFile, 'utf-8'));
    const name = parsed.data.name;
    const description = parsed.data.description;
    if (typeof name !== 'string' || !name || typeof description !== 'string' || !description) {
      return null;
    }
    return { name, description };
  } catch {
    return null;
  }
}

/**
 * Enumerate the skills a plugin contributes.
 *
 * The Agent Skills spec requires `name` to match the parent directory name, so a
 * mismatch is reported and the skill skipped rather than materialized under an
 * ambiguous slug (P2-3).
 *
 * @param strict - When true, a mismatch is fatal instead of skipped. Install uses
 *   strict mode so a malformed package is rejected before anything is written.
 */
export function readPluginSkills(
  pluginRoot: string,
  strict = false,
): { skills: PluginSkillEntry[]; warnings: PluginLoadWarning[]; error?: PluginLoadError } {
  const skills: PluginSkillEntry[] = [];
  const warnings: PluginLoadWarning[] = [];
  const skillsDir = join(pluginRoot, PLUGIN_SKILLS_DIR_NAME);

  // A missing fixed location is not an error (spec §6.2).
  if (!existsSync(skillsDir)) return { skills, warnings };

  if (!lstatSync(skillsDir).isDirectory()) {
    // Present but the wrong kind: the component type is invalid, keep loading (§6.2).
    warnings.push({ path: PLUGIN_SKILLS_DIR_NAME, message: '"skills" is not a directory; skills ignored' });
    return { skills, warnings };
  }

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    const entryPath = join(skillsDir, entry.name);
    const relPath = `${PLUGIN_SKILLS_DIR_NAME}/${entry.name}`;

    if (!entry.isDirectory()) continue;

    // Containment: a symlinked skill directory could resolve outside the plugin
    // root, which the spec requires clients to reject (§4.1).
    if (lstatSync(entryPath).isSymbolicLink() || !isPathWithin(pluginRoot, entryPath)) {
      const warning = { path: relPath, message: 'skill directory escapes the plugin root; skipped' };
      if (strict) return { skills, warnings, error: warning };
      warnings.push(warning);
      continue;
    }

    const frontmatter = parseSkillFrontmatter(entryPath);
    if (!frontmatter) {
      // Invalid skill: skip it, keep loading the rest (spec §7.1).
      warnings.push({ path: `${relPath}/SKILL.md`, message: 'missing or invalid SKILL.md; skill skipped' });
      continue;
    }

    // Agent Skills spec: `name` MUST match the parent directory name.
    if (frontmatter.name !== entry.name) {
      const warning = {
        path: `${relPath}/SKILL.md`,
        message: `skill name "${frontmatter.name}" does not match directory "${entry.name}"`,
      };
      if (strict) return { skills, warnings, error: warning };
      warnings.push(warning);
      continue;
    }

    skills.push({
      slug: entry.name,
      name: frontmatter.name,
      description: frontmatter.description,
      path: entryPath,
    });
  }

  // Deterministic order: the `/plugin` roster and the install overwrite list are
  // both presented to the user, and readdir order is filesystem-dependent.
  skills.sort((a, b) => a.slug.localeCompare(b.slug));

  return { skills, warnings };
}

/**
 * Enumerate the MCP servers a plugin contributes from `mcp.json` (spec §7.2.1).
 *
 * An unreadable `mcp.json` disables MCP for this plugin but keeps other
 * component types loading (spec §7.2.2 rule 2).
 */
export function readPluginMcpServers(
  pluginRoot: string,
): { servers: PluginMcpServerEntry[]; warnings: PluginLoadWarning[] } {
  const servers: PluginMcpServerEntry[] = [];
  const warnings: PluginLoadWarning[] = [];
  const mcpPath = join(pluginRoot, PLUGIN_MCP_FILE);

  if (!existsSync(mcpPath)) return { servers, warnings };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(mcpPath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({ path: PLUGIN_MCP_FILE, message: `not valid JSON; MCP disabled for this plugin: ${message}` });
    return { servers, warnings };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push({ path: PLUGIN_MCP_FILE, message: 'must contain a JSON object; MCP disabled for this plugin' });
    return { servers, warnings };
  }

  const mcpServers = (raw as Record<string, unknown>).mcpServers;
  if (mcpServers === null || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    warnings.push({ path: PLUGIN_MCP_FILE, message: '"mcpServers" must be an object; MCP disabled for this plugin' });
    return { servers, warnings };
  }

  for (const [slug, config] of Object.entries(mcpServers as Record<string, unknown>)) {
    const relPath = `${PLUGIN_MCP_FILE}#${slug}`;

    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      // An invalid entry is skipped; other servers and component types continue (§7.2.2 rule 3).
      warnings.push({ path: relPath, message: 'server entry must be an object; skipped' });
      continue;
    }

    const type = (config as Record<string, unknown>).type;
    if (type === 'stdio') {
      // `command` is required for stdio (spec §7.2.1).
      const command = (config as Record<string, unknown>).command;
      if (typeof command !== 'string' || !command) {
        warnings.push({ path: relPath, message: 'stdio server requires a "command"; skipped' });
        continue;
      }
      servers.push({ slug, transport: 'stdio' });
    } else if (type === 'streamable-http' || type === 'sse') {
      const url = (config as Record<string, unknown>).url;
      if (typeof url !== 'string' || !url) {
        warnings.push({ path: relPath, message: `${type} server requires a "url"; skipped` });
        continue;
      }
      servers.push({ slug, transport: type });
    } else {
      // Unsupported or missing transport: skip this server, keep the rest (§7.2.2 rule 4).
      warnings.push({ path: relPath, message: `unsupported transport "${String(type)}"; skipped` });
    }
  }

  return { servers, warnings };
}

/**
 * Enumerate api / local sources a plugin declares in its extension namespace (§3.4).
 *
 * Agent Plugins 1.0.0 has no portable declaration for these, so they live under
 * the client extension namespace. The shape intentionally mirrors a subset of
 * `CreateSourceInput` (P6-3) rather than introducing a second source language.
 */
export function readPluginExtensionSources(
  pluginRoot: string,
): { sources: PluginSourceEntry[]; warnings: PluginLoadWarning[] } {
  const sources: PluginSourceEntry[] = [];
  const warnings: PluginLoadWarning[] = [];
  const filePath = join(pluginRoot, PLUGIN_EXTENSION_SOURCES_FILE);

  if (!existsSync(filePath)) return { sources, warnings };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({ path: PLUGIN_EXTENSION_SOURCES_FILE, message: `not valid JSON; ignored: ${message}` });
    return { sources, warnings };
  }

  if (!Array.isArray(raw)) {
    warnings.push({ path: PLUGIN_EXTENSION_SOURCES_FILE, message: 'must contain a JSON array; ignored' });
    return { sources, warnings };
  }

  for (const [index, entry] of raw.entries()) {
    const relPath = `${PLUGIN_EXTENSION_SOURCES_FILE}[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push({ path: relPath, message: 'entry must be an object; skipped' });
      continue;
    }
    const record = entry as Record<string, unknown>;
    const slug = record.slug;
    const type = record.type;
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
      warnings.push({ path: relPath, message: 'entry requires a lowercase hyphenated "slug"; skipped' });
      continue;
    }
    if (type !== 'api' && type !== 'local') {
      // `mcp` belongs in mcp.json; `cli` is not a source type at all (P6-1).
      warnings.push({
        path: relPath,
        message: `unsupported extension source type "${String(type)}" — only "api" and "local" are supported here`,
      });
      continue;
    }
    sources.push({ slug, type });
  }

  return { sources, warnings };
}

/**
 * Walk a plugin's files and report symlinked entries.
 *
 * `createWorkspaceBackup` walks the entire workspace and throws on any entry that
 * is neither a directory nor a regular file, so a single symlink inside a plugin
 * would make the whole workspace backup fail (D11). The mutable `data/` directory
 * is skipped: it is created at runtime by the plugin's own server.
 */
function findSymlinkedEntries(pluginRoot: string, current = pluginRoot, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const entryPath = join(current, entry.name);
    const relPath = relative(pluginRoot, entryPath).replace(/\\/g, '/');

    if (entry.isSymbolicLink()) {
      out.push(relPath);
      continue;
    }
    if (entry.isDirectory()) {
      // `data/` is plugin runtime state, not package content.
      if (relPath === PLUGIN_DATA_DIR_NAME) continue;
      findSymlinkedEntries(pluginRoot, entryPath, out);
    }
  }

  return out;
}

/** Read `PROMPT.md`, returning null when absent (P3-1: optional). */
function readPromptFragment(pluginRoot: string): string | null {
  const promptPath = join(pluginRoot, PLUGIN_PROMPT_FILE);
  if (!existsSync(promptPath)) return null;
  try {
    const content = readFileSync(promptPath, 'utf-8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

/**
 * Load a plugin bundle from an arbitrary directory.
 *
 * Location-independent on purpose: the installer must validate a package *before*
 * it lands in the workspace (from a temp extraction directory, or a directory the
 * user placed elsewhere), so `pluginRoot` is any absolute path rather than a
 * workspace-relative slug.
 *
 * @param pluginRoot - Absolute path to the plugin root.
 * @param expectedName - Identity the manifest `name` must equal. Defaults to the
 *   directory basename, which is the workspace-layout rule (P2-2).
 * @param workspaceRootPath - Owning workspace, recorded for provenance.
 */
export function loadPluginAt(
  pluginRoot: string,
  expectedName: string = basename(pluginRoot),
  workspaceRootPath: string = '',
): PluginLoadResult {
  if (!existsSync(pluginRoot) || !lstatSync(pluginRoot).isDirectory()) {
    return { ok: false, error: { path: expectedName, message: 'plugin directory does not exist' } };
  }

  if (lstatSync(pluginRoot).isSymbolicLink()) {
    return { ok: false, error: { path: expectedName, message: 'plugin directory is a symbolic link' } };
  }

  const manifestResult = readManifest(pluginRoot, expectedName);
  if ('message' in manifestResult) return { ok: false, error: manifestResult };

  const warnings: PluginLoadWarning[] = [...manifestResult.warnings];

  const skillResult = readPluginSkills(pluginRoot);
  warnings.push(...skillResult.warnings);

  const mcpResult = readPluginMcpServers(pluginRoot);
  warnings.push(...mcpResult.warnings);

  const extensionResult = readPluginExtensionSources(pluginRoot);
  warnings.push(...extensionResult.warnings);

  // D11: reject rather than warn — a symlink here would break workspace backup.
  for (const symlinkPath of findSymlinkedEntries(pluginRoot)) {
    return {
      ok: false,
      error: {
        path: symlinkPath,
        message:
          'contains a symbolic link; symlinks break workspace backup and are not allowed in plugins',
      },
    };
  }

  const resources: PluginResources = {
    skills: skillResult.skills,
    mcpServers: mcpResult.servers,
    extensionSources: extensionResult.sources,
  };

  return {
    ok: true,
    plugin: {
      name: expectedName,
      manifest: manifestResult.manifest,
      path: pluginRoot,
      workspaceRootPath,
      workspaceRelativePath: workspaceRootPath
        ? relative(workspaceRootPath, pluginRoot).replace(/\\/g, '/')
        : expectedName,
      resources,
      promptFragment: readPromptFragment(pluginRoot),
      warnings,
    },
  };
}

/**
 * Load one plugin bundle from a workspace.
 *
 * @param workspaceRootPath - Absolute workspace root.
 * @param name - Plugin directory name.
 */
export function loadPlugin(workspaceRootPath: string, name: string): PluginLoadResult {
  return loadPluginAt(join(getWorkspacePluginsPath(workspaceRootPath), name), name, workspaceRootPath);
}

/**
 * List plugin directory names present in a workspace.
 *
 * Sorted for deterministic presentation.
 */
export function listPluginNames(workspaceRootPath: string): string[] {
  const pluginsDir = getWorkspacePluginsPath(workspaceRootPath);
  if (!existsSync(pluginsDir)) return [];

  try {
    return readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    debug('[PluginStorage] Failed to list plugins:', error);
    return [];
  }
}

/**
 * Load every plugin in a workspace.
 *
 * @returns Loaded plugins plus per-plugin load errors, so a broken bundle is
 *   visible without preventing the rest from loading.
 */
export function loadAllPlugins(workspaceRootPath: string): {
  plugins: LoadedPlugin[];
  errors: PluginLoadError[];
} {
  const plugins: LoadedPlugin[] = [];
  const errors: PluginLoadError[] = [];

  for (const name of listPluginNames(workspaceRootPath)) {
    const result = loadPlugin(workspaceRootPath, name);
    if (result.ok) {
      plugins.push(result.plugin);
    } else {
      errors.push(result.error);
    }
  }

  return { plugins, errors };
}

/**
 * Load one plugin by name, or null when absent or invalid.
 *
 * Uses the same O(1) shape as `loadSkillBySlug`: it reads only the named
 * directory rather than scanning every plugin.
 */
export function loadPluginByName(workspaceRootPath: string, name: string): LoadedPlugin | null {
  const result = loadPlugin(workspaceRootPath, name);
  return result.ok ? result.plugin : null;
}

/** True when a plugin directory exists for `name`. */
export function pluginExists(workspaceRootPath: string, name: string): boolean {
  const pluginRoot = join(getWorkspacePluginsPath(workspaceRootPath), name);
  try {
    return existsSync(pluginRoot) && lstatSync(pluginRoot).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve an absolute path inside a plugin, rejecting escapes.
 *
 * @throws when the resolved path leaves the plugin root (spec §4.1).
 */
export function resolveWithinPlugin(pluginRoot: string, pluginRelativePath: string): string {
  const resolved = resolve(pluginRoot, pluginRelativePath);
  if (!isPathWithin(pluginRoot, resolved)) {
    throw new Error(`Path "${pluginRelativePath}" escapes the plugin root`);
  }
  return resolved;
}

/** Absolute path of a loaded plugin's data directory (design §5.4.7). */
export function getPluginDataPath(plugin: LoadedPlugin): string {
  return join(plugin.path, PLUGIN_DATA_DIR_NAME);
}

/** Basename of a plugin root — the plugin's identity. */
export function pluginNameFromPath(pluginRoot: string): string {
  return basename(pluginRoot);
}
