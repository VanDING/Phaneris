/**
 * Plugin installation and materialization (design §5, module B).
 *
 * Installing a plugin bundle does three things:
 *
 *  1. **Materializes** its skills into `<ws>/skills/` and its MCP servers into
 *     `<ws>/sources/`. From that moment they are ordinary workspace resources —
 *     same loaders, same resolution, same credential and policy paths (D4).
 *  2. Records **provenance** on each materialized source (`pluginRoot`), and
 *     rebuilds the **derived** reverse index `<ws>/plugins/_index.json` (D10).
 *  3. Writes a one-line **audit record** (P5-4), because installation
 *     overwrites existing resources without asking again (D6) and the user
 *     needs to be able to find out afterwards what happened.
 *
 * Two-phase by design: `analyzePluginInstall` computes the overwrite list the
 * user approves (D9) and `installPlugin` performs the requested work. Both are
 * transactional — a failure part-way leaves the workspace as it was (P5-3).
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspacePluginsPath, getWorkspaceSkillsPath, getWorkspaceSourcesPath } from '../workspaces/storage.ts';
import { getSourcePath, loadSourceConfig, saveSourceConfig } from '../sources/storage.ts';
import type { FolderSourceConfig, McpSourceConfig } from '../sources/types.ts';
import { debug } from '../utils/debug.ts';
import { appendPluginAuditEntry } from './audit.ts';
import { loadPlugin, loadPluginAt, readPluginExtensionSources, readPluginMcpServers, readPluginSkills } from './storage.ts';
import {
  PLUGIN_DATA_DIR_NAME,
  PLUGIN_MCP_FILE,
  PLUGIN_ROOT_PLACEHOLDER,
  type LoadedPlugin,
  type PluginLoadWarning,
} from './types.ts';

/** One workspace resource that installing this plugin will replace. */
export interface PluginOverwriteEntry {
  kind: 'skill' | 'source';
  slug: string;
  /** What currently exists, for the confirmation prompt. */
  existing: string;
}

/** The stdio command a package will execute, shown in full at confirmation (P5-5). */
export interface PluginStdioCommand {
  slug: string;
  command: string;
  args: string[];
}

/** Everything the user needs to approve before anything is written (D9). */
export interface PluginInstallPlan {
  plugin: LoadedPlugin;
  /** Existing resources this install replaces (D6: replace, do not merge). */
  overwrites: PluginOverwriteEntry[];
  /** Sources that will be created (no existing resource). */
  creates: PluginOverwriteEntry[];
  /** Stdio servers this package would execute — shown verbatim (P5-5). */
  stdioCommands: PluginStdioCommand[];
  /** Per-entry problems that will cause that entry to be skipped, not the install. */
  warnings: PluginLoadWarning[];
  /** Absolute path of the package that will be installed. */
  packageRoot: string;
  /** Absolute destination for the package inside the workspace. */
  targetRoot: string;
}

/** Result of a completed install. */
export interface PluginInstallResult {
  name: string;
  skills: string[];
  sources: string[];
  replaced: PluginOverwriteEntry[];
  warnings: PluginLoadWarning[];
}

/** Raised when a plugin package cannot be installed at all. */
export class PluginInstallError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'PluginInstallError';
  }
}

// ============================================================================
// Source config construction
// ============================================================================

/**
 * Read a package's `mcp.json` entries verbatim.
 *
 * The install plan and the materializer both need the raw entry, because the
 * stored config keeps placeholders unexpanded (design §5.4.3) and the plan must
 * show the user the command as written.
 */
function readRawMcpEntries(
  pluginRoot: string,
): { entries: Record<string, Record<string, unknown>>; warnings: PluginLoadWarning[] } {
  const entries: Record<string, Record<string, unknown>> = {};
  const warnings: PluginLoadWarning[] = [];
  const mcpPath = join(pluginRoot, PLUGIN_MCP_FILE);

  if (!existsSync(mcpPath)) return { entries, warnings };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(mcpPath, 'utf-8'));
  } catch {
    return { entries, warnings };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { entries, warnings };

  const servers = (raw as Record<string, unknown>).mcpServers;
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
    return { entries, warnings };
  }

  for (const [slug, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      entries[slug] = entry as Record<string, unknown>;
    }
  }
  return { entries, warnings };
}

/**
 * Convert one Agent Plugins MCP entry into Phaneris source config.
 *
 * @returns the config, or a skip reason when the entry is unusable.
 */
function buildMcpSourceConfig(
  slug: string,
  entry: Record<string, unknown>,
  pluginName: string,
  warn: (message: string) => void,
): { config: McpSourceConfig } | { skip: string } {
  const type = entry.type;

  if (type === 'stdio') {
    const command = entry.command;
    if (typeof command !== 'string' || !command) {
      return { skip: 'stdio server requires a string "command"' };
    }

    // `cwd` is only supported rooted at the plugin (design §5.4.1); anything else
    // is rejected loudly rather than silently ignored.
    if (entry.cwd !== undefined) {
      const cwd = entry.cwd;
      const isPluginRooted =
        typeof cwd === 'string' &&
        (cwd === PLUGIN_ROOT_PLACEHOLDER ||
          cwd.startsWith(`${PLUGIN_ROOT_PLACEHOLDER}/`) ||
          cwd.startsWith(`${PLUGIN_ROOT_PLACEHOLDER}\\`));
      if (!isPluginRooted) {
        return {
          skip:
            `"cwd" is not supported in plugins (got ${JSON.stringify(cwd)}) — a server always runs ` +
            'from the plugin root; pass the data directory as an argument instead',
        };
      }
      warn('"cwd" is redundant: a plugin server already runs from the plugin root');
    }

    return {
      config: {
        transport: 'stdio',
        command,
        args: Array.isArray(entry.args) ? (entry.args as string[]) : undefined,
        env:
          entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
            ? (entry.env as Record<string, string>)
            : undefined,
      },
    };
  }

  if (type === 'streamable-http' || type === 'sse') {
    const url = entry.url;
    if (typeof url !== 'string' || !url) {
      return { skip: `${type} server requires a string "url"` };
    }
    const headers =
      entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
        ? (entry.headers as Record<string, string>)
        : undefined;

    // Credentials are client-managed: the spec forbids embedding secrets in
    // headers (section 7.2.1). A package that ships fixed non-secret headers is
    // treated as header-authenticated so the user can supply the value through
    // the credential store after install; otherwise the source is public.
    return {
      config: {
        transport: type === 'sse' ? 'sse' : 'http',
        url,
        headers,
        authType: headers ? 'bearer' : 'none',
      },
    };
  }

  return { skip: `unsupported transport ${JSON.stringify(type)}` };
}

// ============================================================================
// Phase 1 — analyze
// ============================================================================

/**
 * Compute what an install would do, without writing anything.
 *
 * @param workspaceRootPath - Absolute workspace root.
 * @param packageRoot - Absolute path to the package to install. When it already
 *   lives at the target location this is a reinstall/refresh of a placed plugin.
 */
export function analyzePluginInstall(
  workspaceRootPath: string,
  packageRoot: string,
): PluginInstallPlan {
  const pluginName = basename(packageRoot);

  if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory()) {
    throw new PluginInstallError(`Plugin directory not found: ${packageRoot}`);
  }

  // Validate the package by loading it from its own location. The loader already
  // enforces the fatal boundaries (manifest, name identity, symlinks).
  const loaded = loadPluginAt(packageRoot, pluginName, workspaceRootPath);
  if (!loaded.ok) {
    throw new PluginInstallError(
      `Plugin "${pluginName}" is not installable: ${loaded.error.message}`,
      loaded.error.path,
    );
  }
  const plugin = loaded.plugin;

  // A plugin must contribute at least one skill or MCP server (D3): a bundle with
  // only metadata is functionally empty.
  if (
    plugin.resources.skills.length === 0 &&
    plugin.resources.mcpServers.length === 0 &&
    plugin.resources.extensionSources.length === 0
  ) {
    throw new PluginInstallError(
      `Plugin "${pluginName}" contributes nothing — it must contain at least one skill or MCP server`,
    );
  }

  const warnings: PluginLoadWarning[] = [...plugin.warnings];
  const overwrites: PluginOverwriteEntry[] = [];
  const creates: PluginOverwriteEntry[] = [];
  const stdioCommands: PluginStdioCommand[] = [];

  // --- skills ---
  for (const skill of plugin.resources.skills) {
    const target = join(getWorkspaceSkillsPath(workspaceRootPath), skill.slug);
    const entry: PluginOverwriteEntry = {
      kind: 'skill',
      slug: skill.slug,
      existing: target,
    };
    if (existsSync(target)) overwrites.push(entry);
    else creates.push(entry);
  }

  // --- MCP servers ---
  const rawMcp = readRawMcpEntries(plugin.path);
  warnings.push(...rawMcp.warnings);

  for (const server of plugin.resources.mcpServers) {
    const entry = rawMcp.entries[server.slug];
    if (!entry) continue;

    const built = buildMcpSourceConfig(server.slug, entry, pluginName, (message) =>
      warnings.push({ path: `${PLUGIN_MCP_FILE}#${server.slug}`, message }),
    );
    if ('skip' in built) {
      warnings.push({ path: `${PLUGIN_MCP_FILE}#${server.slug}`, message: `${built.skip}; skipped` });
      continue;
    }

    if (server.transport === 'stdio') {
      // Shown verbatim so the user sees exactly what will execute (P5-5).
      stdioCommands.push({
        slug: server.slug,
        command: String(entry.command),
        args: Array.isArray(entry.args) ? (entry.args as string[]) : [],
      });
    }

    const target = getSourcePath(workspaceRootPath, server.slug);
    const overwriteEntry: PluginOverwriteEntry = {
      kind: 'source',
      slug: server.slug,
      existing: target,
    };
    if (existsSync(target)) overwrites.push(overwriteEntry);
    else creates.push(overwriteEntry);
  }

  // --- extension sources (api / local) ---
  for (const source of plugin.resources.extensionSources) {
    const target = getSourcePath(workspaceRootPath, source.slug);
    const entry: PluginOverwriteEntry = {
      kind: 'source',
      slug: source.slug,
      existing: target,
    };
    if (existsSync(target)) overwrites.push(entry);
    else creates.push(entry);
  }

  return {
    plugin,
    overwrites,
    creates,
    stdioCommands,
    warnings,
    packageRoot,
    targetRoot: join(getWorkspacePluginsPath(workspaceRootPath), pluginName),
  };
}

// ============================================================================
// Phase 2 — install
// ============================================================================

/** A staged skill directory awaiting its atomic swap. */
interface StagedSkill {
  slug: string;
  tmpDir: string;
  targetDir: string;
  /** Set when an existing directory was moved aside for rollback. */
  backupDir?: string;
}

/**
 * Install a plugin into a workspace.
 *
 * Directory-level replace, never a file merge (P5-1): a merge would leave files
 * the new version deleted in place, where the skill loader would keep reading
 * them. The plugin's mutable `data/` directory is the single exception (§5.4.7).
 *
 * @throws {PluginInstallError} when nothing was written.
 */
export function installPlugin(
  workspaceRootPath: string,
  plan: PluginInstallPlan,
): PluginInstallResult {
  const { plugin } = plan;
  const skippedWarnings: PluginLoadWarning[] = [...plan.warnings];
  const skillsDir = getWorkspaceSkillsPath(workspaceRootPath);
  const staged: StagedSkill[] = [];
  const createdSourceSlugs: string[] = [];
  const installedSkillSlugs: string[] = [];

  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(getWorkspacePluginsPath(workspaceRootPath), { recursive: true });

  try {
    // --- stage every skill first, so a failure aborts before any swap ---
    for (const skill of plugin.resources.skills) {
      const targetDir = join(skillsDir, skill.slug);
      const tmpDir = join(skillsDir, `.tmp-plugin-${skill.slug}-${randomUUID().slice(0, 8)}`);

      const record: StagedSkill = { slug: skill.slug, tmpDir, targetDir };
      staged.push(record);

      // Copy the whole skill directory: SKILL.md may reference scripts/,
      // references/, and assets/ (Agent Skills optional directories).
      cpSync(skill.path, tmpDir, { recursive: true });
      if (!existsSync(join(tmpDir, 'SKILL.md'))) {
        throw new PluginInstallError(
          `Skill "${skill.slug}" lost its SKILL.md while staging`,
        );
      }
    }

    // --- commit skills: move existing aside, swap in the staged copy ---
    for (const record of staged) {
      if (existsSync(record.targetDir)) {
        const backupDir = `${record.targetDir}.replaced-${randomUUID().slice(0, 8)}`;
        renameSync(record.targetDir, backupDir);
        record.backupDir = backupDir;
      }
      renameSync(record.tmpDir, record.targetDir);
      installedSkillSlugs.push(record.slug);
    }

    // --- materialize MCP servers ---
    const rawMcp = readRawMcpEntries(plugin.path);
    for (const server of plugin.resources.mcpServers) {
      const rawEntry = rawMcp.entries[server.slug];
      if (!rawEntry) continue;

      const built = buildMcpSourceConfig(server.slug, rawEntry, plugin.name, () => {});
      if ('skip' in built) {
        // Already reported during analyze; the entry stays out of the install.
        continue;
      }

      writeSourceConfig(workspaceRootPath, plan.targetRoot, server.slug, server.slug, plugin.name, {
        type: 'mcp',
        mcp: built.config,
      });
      createdSourceSlugs.push(server.slug);
    }

    // --- materialize extension sources (api / local) ---
    const extension = readPluginExtensionSources(plugin.path);
    for (const source of extension.sources) {
      writeSourceConfig(workspaceRootPath, plan.targetRoot, source.slug, source.slug, plugin.name, {
        type: source.type,
      });
      createdSourceSlugs.push(source.slug);
    }

    // --- place the package itself ---
    placePackage(plan.packageRoot, plan.targetRoot);

    // --- derived reverse index + audit ---
    const index = rebuildPluginIndex(workspaceRootPath);
    appendPluginAuditEntry({
      action: 'install',
      plugin: plugin.name,
      version: plugin.manifest.version ?? null,
      packageRoot: plan.packageRoot,
      skills: installedSkillSlugs,
      sources: createdSourceSlugs,
      replaced: plan.overwrites.map((o) => `${o.kind}:${o.slug}`),
      stdioCommands: plan.stdioCommands.map((c) => ({
        slug: c.slug,
        command: c.command,
        args: c.args,
      })),
    });

    debug(
      `[PluginInstall] Installed "${plugin.name}": ${installedSkillSlugs.length} skills, ` +
        `${createdSourceSlugs.length} sources, ${plan.overwrites.length} replaced, ` +
        `${Object.keys(index.resources.skills).length} tracked skills`,
    );

    // --- drop the backups now that the swap succeeded ---
    for (const record of staged) {
      if (record.backupDir) rmSync(record.backupDir, { recursive: true, force: true });
    }

    return {
      name: plugin.name,
      skills: installedSkillSlugs,
      sources: createdSourceSlugs,
      replaced: plan.overwrites,
      warnings: skippedWarnings,
    };
  } catch (error) {
    // Roll back: remove anything already swapped in, restore what was moved aside.
    for (const record of staged) {
      if (existsSync(record.tmpDir)) rmSync(record.tmpDir, { recursive: true, force: true });
      if (record.backupDir && record.backupDir.length > 0) {
        if (existsSync(record.targetDir)) rmSync(record.targetDir, { recursive: true, force: true });
        if (existsSync(record.backupDir)) renameSync(record.backupDir, record.targetDir);
      }
    }
    for (const slug of createdSourceSlugs) {
      const dir = getSourcePath(workspaceRootPath, slug);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }

    if (error instanceof PluginInstallError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PluginInstallError(`Failed to install plugin "${plugin.name}": ${message}`);
  }
}

/**
 * Write a source `config.json` for a plugin-contributed resource.
 *
 * For stdio MCP servers the placeholders stay in the stored config and the
 * plugin root is recorded alongside them, so paths resolve at load time and the
 * workspace stays movable (design §5.4.3 / §5.4.4).
 *
 * `pluginRoot` is derived from the plugin's **final** location inside the
 * workspace — not from wherever the package was read — because that is the
 * directory the runtime will resolve placeholders against.
 */
function writeSourceConfig(
  workspaceRootPath: string,
  targetRoot: string,
  slug: string,
  displayName: string,
  pluginName: string,
  body: { type: 'mcp' | 'api' | 'local'; mcp?: McpSourceConfig },
): void {
  const existing = loadSourceConfig(workspaceRootPath, slug);
  const now = Date.now();

  // Reuse the existing id so credential lookups keyed by slug stay stable
  // across reinstalls; otherwise mint one in the same shape createSource uses.
  const id = existing?.id ?? `${slug}_${randomUUID().slice(0, 8)}`;

  const config: FolderSourceConfig = {
    id,
    name: existing?.name ?? displayName,
    slug,
    enabled: true,
    provider: pluginName,
    type: body.type,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    pluginRoot: relative(workspaceRootPath, targetRoot).replace(/\\/g, '/'),
  };

  if (body.type === 'mcp' && body.mcp) {
    config.mcp = body.mcp;
  } else if (body.type === 'api') {
    // An api source declared by a plugin carries no endpoints of its own: the
    // package author configures it through the normal conversational flow after
    // install, because credentials are client-managed (P6-5).
    config.api = { baseUrl: '', authType: 'none' };
  } else if (body.type === 'local') {
    config.local = { path: '', format: 'filesystem' };
  }

  saveSourceConfig(workspaceRootPath, config);
}

/** Move a package into the workspace plugins directory (directory-level replace). */
function placePackage(packageRoot: string, targetRoot: string): void {
  if (packageRoot === targetRoot) return; // already in place (a placed/edited plugin)

  const stagingDir = `${targetRoot}.staging-${randomUUID().slice(0, 8)}`;
  cpSync(packageRoot, stagingDir, { recursive: true });

  // Preserve the plugin's mutable data directory across a replace (§5.4.7).
  const existingData = join(targetRoot, PLUGIN_DATA_DIR_NAME);
  if (existsSync(existingData)) {
    cpSync(existingData, join(stagingDir, PLUGIN_DATA_DIR_NAME), { recursive: true });
  }

  if (existsSync(targetRoot)) rmSync(targetRoot, { recursive: true, force: true });
  renameSync(stagingDir, targetRoot);
}

// ============================================================================
// Derived reverse index (D10)
// ============================================================================

/** Reverse index state: which plugins reference which materialized resource. */
export interface PluginIndex {
  version: 1;
  resources: {
    skills: Record<string, string[]>;
    sources: Record<string, string[]>;
  };
}

/** Path of the derived reverse index inside a workspace. */
export function getPluginIndexPath(workspaceRootPath: string): string {
  return join(getWorkspacePluginsPath(workspaceRootPath), '_index.json');
}

/**
 * Rebuild the reverse index from the installed packages.
 *
 * Deliberately **derived**: it records only which plugins reference which
 * resources — no versions, timestamps, or content hashes — so deleting the file
 * loses nothing and it can never drift into being a second source of truth
 * (D10). Its single consumer is uninstall, which deletes a resource only when
 * the last referencing plugin goes away.
 */
export function rebuildPluginIndex(workspaceRootPath: string): PluginIndex {
  const index: PluginIndex = { version: 1, resources: { skills: {}, sources: {} } };
  const pluginsDir = getWorkspacePluginsPath(workspaceRootPath);

  if (!existsSync(pluginsDir)) return index;

  for (const name of listPluginDirs(pluginsDir)) {
    const loaded = loadPlugin(workspaceRootPath, name);
    if (!loaded.ok) continue;

    for (const skill of loaded.plugin.resources.skills) {
      (index.resources.skills[skill.slug] ??= []).push(name);
    }
    for (const server of loaded.plugin.resources.mcpServers) {
      (index.resources.sources[server.slug] ??= []).push(name);
    }
    for (const source of loaded.plugin.resources.extensionSources) {
      (index.resources.sources[source.slug] ??= []).push(name);
    }
  }

  for (const bucket of [index.resources.skills, index.resources.sources]) {
    for (const slugs of Object.values(bucket)) slugs.sort();
  }

  try {
    writeFileSync(getPluginIndexPath(workspaceRootPath), `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
  } catch (error) {
    // The index is derived: failing to persist it must not fail the install.
    debug('[PluginInstall] Failed to write plugin index:', error);
  }

  return index;
}

/** Read the derived reverse index, rebuilding it when missing or unreadable. */
export function readPluginIndex(workspaceRootPath: string): PluginIndex {
  const indexPath = getPluginIndexPath(workspaceRootPath);
  if (existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as PluginIndex;
      if (parsed?.version === 1 && parsed.resources) return parsed;
    } catch {
      debug('[PluginInstall] Plugin index unreadable; rebuilding');
    }
  }
  return rebuildPluginIndex(workspaceRootPath);
}

/** Directories under the plugins root (the derived index file is not one). */
function listPluginDirs(pluginsDir: string): string[] {
  try {
    return readdirNames(pluginsDir).filter((name) => {
      try {
        return lstatSync(join(pluginsDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

// ============================================================================
// Convenience: analyze + install in one step
// ============================================================================

/**
 * Install a package that the user has already approved.
 *
 * Callers that need the D9 confirmation prompt must call
 * `analyzePluginInstall` first, present the plan, then call this.
 */
export function installPluginFrom(
  workspaceRootPath: string,
  packageRoot: string,
): PluginInstallResult {
  return installPlugin(workspaceRootPath, analyzePluginInstall(workspaceRootPath, packageRoot));
}

/** Re-export for callers that need the skill/MCP readers without the loader. */
export { readPluginSkills, readPluginMcpServers, readPluginExtensionSources };

// ============================================================================
// Uninstall (D10 reference counting)
// ============================================================================

/** What an uninstall will do, computed before anything is removed. */
export interface PluginUninstallPlan {
  name: string;
  /** Resources only this plugin provided — these are deleted. */
  removes: PluginOverwriteEntry[];
  /** Resources another installed plugin still references — these are kept. */
  retains: PluginOverwriteEntry[];
}

/** Result of a completed uninstall. */
export interface PluginUninstallResult {
  name: string;
  removedSkills: string[];
  removedSources: string[];
  /** Kept because another plugin still claims them. */
  retained: PluginOverwriteEntry[];
}

/**
 * Compute the resources an uninstall would remove, by asking the *remaining*
 * packages rather than trusting the derived index.
 *
 * Owning it this way keeps the decision self-consistent: the index is a cache of
 * exactly this computation, so reading the packages directly can never disagree
 * with reality the way a stale file could.
 */
export function analyzePluginUninstall(
  workspaceRootPath: string,
  name: string,
): PluginUninstallPlan {
  const target = loadPlugin(workspaceRootPath, name);
  if (!target.ok) {
    throw new PluginInstallError(`Plugin "${name}" is not installed: ${target.error.message}`);
  }

  const claims = collectClaimsExcluding(workspaceRootPath, name);

  const removes: PluginOverwriteEntry[] = [];
  const retains: PluginOverwriteEntry[] = [];

  for (const skill of target.plugin.resources.skills) {
    const entry: PluginOverwriteEntry = {
      kind: 'skill',
      slug: skill.slug,
      existing: join(getWorkspaceSkillsPath(workspaceRootPath), skill.slug),
    };
    (claims.skills.has(skill.slug) ? retains : removes).push(entry);
  }

  const sourceSlugs = [
    ...target.plugin.resources.mcpServers.map((s) => s.slug),
    ...target.plugin.resources.extensionSources.map((s) => s.slug),
  ];
  for (const slug of sourceSlugs) {
    const entry: PluginOverwriteEntry = {
      kind: 'source',
      slug,
      existing: getSourcePath(workspaceRootPath, slug),
    };
    (claims.sources.has(slug) ? retains : removes).push(entry);
  }

  return { name, removes, retains };
}

/**
 * Remove a plugin and the resources no other plugin still claims.
 *
 * Order matters (P5-9): the package is removed first, so if a later step fails
 * the workspace is left with *orphaned resources* — still working, just no longer
 * attributed — rather than with an installed plugin whose resources are missing.
 *
 * A resource that no remaining plugin claims is only deleted when the plugin
 * being removed did claim it. Anything else in the workspace is left alone: the
 * system never promised to track hand-made resources, and inventing that
 * ownership here would delete things the user created.
 */
export function uninstallPlugin(
  workspaceRootPath: string,
  name: string,
): PluginUninstallResult {
  const plan = analyzePluginUninstall(workspaceRootPath, name);
  const targetRoot = join(getWorkspacePluginsPath(workspaceRootPath), name);

  // 1. Remove the package first (see ordering note above).
  if (existsSync(targetRoot)) {
    rmSync(targetRoot, { recursive: true, force: true });
  }

  const removedSkills: string[] = [];
  const removedSources: string[] = [];

  // 2. Drop the resources nobody else claims.
  for (const entry of plan.removes) {
    const dir = entry.kind === 'skill'
      ? join(getWorkspaceSkillsPath(workspaceRootPath), entry.slug)
      : getSourcePath(workspaceRootPath, entry.slug);

    if (!existsSync(dir)) continue;

    rmSync(dir, { recursive: true, force: true });
    if (entry.kind === 'skill') removedSkills.push(entry.slug);
    else removedSources.push(entry.slug);
  }

  // 3. Rebuild the derived index so it reflects only what remains.
  rebuildPluginIndex(workspaceRootPath);

  appendPluginAuditEntry({
    action: 'uninstall',
    plugin: name,
    packageRoot: targetRoot,
    removed: [
      ...removedSkills.map((slug) => `skill:${slug}`),
      ...removedSources.map((slug) => `source:${slug}`),
    ],
    retained: plan.retains.map((entry) => `${entry.kind}:${entry.slug}`),
  });

  debug(
    `[PluginUninstall] Removed "${name}": ${removedSkills.length} skills, ` +
      `${removedSources.length} sources; retained ${plan.retains.length}`,
  );

  return {
    name,
    removedSkills,
    removedSources,
    retained: plan.retains,
  };
}

/** Resource slugs claimed by every installed plugin except `exclude`. */
function collectClaimsExcluding(
  workspaceRootPath: string,
  exclude: string,
): { skills: Set<string>; sources: Set<string> } {
  const skills = new Set<string>();
  const sources = new Set<string>();
  const pluginsDir = getWorkspacePluginsPath(workspaceRootPath);

  if (!existsSync(pluginsDir)) return { skills, sources };

  for (const other of listPluginDirs(pluginsDir)) {
    if (other === exclude) continue;

    const loaded = loadPlugin(workspaceRootPath, other);
    if (!loaded.ok) continue;

    for (const skill of loaded.plugin.resources.skills) skills.add(skill.slug);
    for (const server of loaded.plugin.resources.mcpServers) sources.add(server.slug);
    for (const source of loaded.plugin.resources.extensionSources) sources.add(source.slug);
  }

  return { skills, sources };
}
