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
import { basename, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspacePluginsPath, getWorkspaceSkillsPath, getWorkspaceSourcesPath } from '../workspaces/storage.ts';
import { cleanupSourceApiKeyCredential, loadSourceConfig, saveSourceConfig } from '../sources/storage.ts';
import type { FolderSourceConfig, McpSourceConfig } from '../sources/types.ts';
import { debug } from '../utils/debug.ts';
import { validateSourceConfig } from '../config/source-validation.ts';
import { appendPluginAuditEntry } from './audit.ts';
import { pluginResourcePath } from './paths.ts';
import { normalizePluginCommand } from './resolve.ts';
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
  /** Validated once before any resource write; also used by the confirmation DTO. */
  sources: CompiledPluginSource[];
}

export interface CompiledPluginSource {
  slug: string;
  type: 'mcp' | 'api' | 'local';
  mcp?: McpSourceConfig;
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
  pluginRoot: string,
  warn: (message: string) => void,
): { config: McpSourceConfig } | { skip: string } {
  const type = entry.type;
  if (entry.authType !== undefined && !['none', 'bearer', 'oauth'].includes(entry.authType as string)) return { skip: 'authType must be none, bearer or oauth' };
  if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(value => typeof value !== 'string'))) return { skip: 'args must be an array of strings' };
  for (const field of ['env', 'headers'] as const) {
    const value = entry[field];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string'))) return { skip: `${field} must contain string values` };
  }

  if (type === 'stdio') {
    const command = entry.command;
    if (typeof command !== 'string' || !command) {
      return { skip: 'stdio server requires a string "command"' };
    }

    try {
      normalizePluginCommand(command, { pluginRoot });
    } catch (error) {
      return { skip: String(error) };
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
    // kept as request metadata. Only an explicit authType requests credentials;
    // the mere existence of a header is not evidence of bearer authentication.
    return {
      config: {
        transport: type === 'sse' ? 'sse' : 'http',
        url,
        headers,
        authType: (entry.authType ?? 'none') as McpSourceConfig['authType'],
      },
    };
  }

  return { skip: `unsupported transport ${JSON.stringify(type)}` };
}

/** The same contribution compilation feeds preview, materialization and health. */
export function compilePluginSources(plugin: LoadedPlugin): { sources: CompiledPluginSource[]; warnings: PluginLoadWarning[] } {
  const sources: CompiledPluginSource[] = [];
  const warnings: PluginLoadWarning[] = [];
  const seen = new Set<string>();
  const raw = readRawMcpEntries(plugin.path);
  const add = (source: CompiledPluginSource) => {
    const config = makeSourceConfig(plugin.workspaceRootPath, plugin.path, source.slug, source.slug, plugin.name, source);
    const validation = validateSourceConfig(config);
    if (!validation.valid) {
      warnings.push({ path: source.slug, message: `Invalid source config: ${validation.errors.map(error => `${error.path}: ${error.message}`).join('; ')}; skipped (requires configuration)` });
      return;
    }
    sources.push(source);
  };
  for (const declared of [...plugin.resources.mcpServers, ...plugin.resources.extensionSources]) {
    pluginResourcePath(getWorkspaceSourcesPath(plugin.workspaceRootPath), declared.slug);
    if (seen.has(declared.slug)) throw new PluginInstallError(`Duplicate source slug "${declared.slug}"`);
    seen.add(declared.slug);
  }
  for (const server of plugin.resources.mcpServers) {
    const entry = raw.entries[server.slug];
    if (!entry) continue;
    const built = buildMcpSourceConfig(server.slug, entry, plugin.name, plugin.path, message => warnings.push({ path: server.slug, message }));
    if ('skip' in built) warnings.push({ path: server.slug, message: `${built.skip}; skipped` });
    else add({ slug: server.slug, type: 'mcp', mcp: built.config });
  }
  for (const source of plugin.resources.extensionSources) add(source);
  return { sources, warnings };
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
  const compiled = compilePluginSources(plugin);
  warnings.push(...compiled.warnings);
  if (plugin.resources.skills.length === 0 && compiled.sources.length === 0) throw new PluginInstallError(`Plugin "${pluginName}" has no materializable contributions`, warnings.map(warning => warning.message).join('\n'));

  // --- skills ---
  for (const skill of plugin.resources.skills) {
    const target = pluginResourcePath(getWorkspaceSkillsPath(workspaceRootPath), skill.slug);
    const entry: PluginOverwriteEntry = {
      kind: 'skill',
      slug: skill.slug,
      existing: target,
    };
    if (existsSync(target)) overwrites.push(entry);
    else creates.push(entry);
  }

  // --- MCP servers ---
  for (const server of compiled.sources) {
    if (server.mcp?.transport === 'stdio') {
      // Shown verbatim so the user sees exactly what will execute (P5-5).
      stdioCommands.push({
        slug: server.slug,
        command: server.mcp.command!,
        args: server.mcp.args ?? [],
      });
    }

    const target = pluginResourcePath(getWorkspaceSourcesPath(workspaceRootPath), server.slug);
    const overwriteEntry: PluginOverwriteEntry = {
      kind: 'source',
      slug: server.slug,
      existing: target,
    };
    if (existsSync(target)) overwrites.push(overwriteEntry);
    else creates.push(overwriteEntry);
  }

  return {
    plugin,
    overwrites,
    creates,
    stdioCommands,
    warnings,
    packageRoot,
    targetRoot: pluginResourcePath(getWorkspacePluginsPath(workspaceRootPath), pluginName),
    sources: compiled.sources,
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
  committed?: boolean;
}

interface SourceBackup {
  targetDir: string;
  backupDir?: string;
  backupReady: boolean;
  touched: boolean;
}

/**
 * Install a plugin into a workspace.
 *
 * Directory-level replace, never a file merge (P5-1): a merge would leave files
 * the new version deleted in place, where the skill loader would keep reading
 * them. The plugin's mutable `data/` directory is the single exception (§5.4.7).
 *
 * @throws {PluginInstallError} on a pre-commit failure, with rollback failures reported in detail.
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
  const sourceBackups: SourceBackup[] = [];
  const packageTarget = pluginResourcePath(getWorkspacePluginsPath(workspaceRootPath), plugin.name);
  const packageBackup = `${packageTarget}.replaced-${randomUUID().slice(0, 8)}`;
  const packageExisted = existsSync(packageTarget) && plan.packageRoot !== packageTarget;
  const packageStaging = `${packageTarget}.staging-${randomUUID().slice(0, 8)}`;
  let packageBackupReady = false;
  let packageTouched = false;

  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(getWorkspacePluginsPath(workspaceRootPath), { recursive: true });

  try {
    // --- stage every skill first, so a failure aborts before any swap ---
    for (const skill of plugin.resources.skills) {
      const targetDir = pluginResourcePath(skillsDir, skill.slug);
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
      record.committed = true;
      installedSkillSlugs.push(record.slug);
    }

    for (const source of plan.sources) {
      const backup = backupSource(source.slug);
      backup.touched = true;
      writeSourceConfig(workspaceRootPath, plan.targetRoot, source.slug, source.slug, plugin.name, source);
      createdSourceSlugs.push(source.slug);
    }

    // --- place the package itself ---
    if (packageExisted) {
      cpSync(packageTarget, packageBackup, { recursive: true });
      packageBackupReady = true;
    }
    packageTouched = plan.packageRoot !== packageTarget;
    placePackage(plan.packageRoot, plan.targetRoot, packageStaging);

    // --- derived reverse index + audit ---
    const index = rebuildPluginIndex(workspaceRootPath, (error) => warn('plugins/_index.json', 'Plugin index write failed', error));
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
    }, (error) => warn('audit', 'Plugin audit write failed', error));

    debug(
      `[PluginInstall] Installed "${plugin.name}": ${installedSkillSlugs.length} skills, ` +
        `${createdSourceSlugs.length} sources, ${plan.overwrites.length} replaced, ` +
        `${Object.keys(index.resources.skills).length} tracked skills`,
    );

  } catch (error) {
    // Each recovery is independent. Only a completed, still-present backup may
    // authorize deleting the target; an incomplete copy is never a restore source.
    const rollbackFailures: string[] = [];
    const attempt = (path: string, action: () => void) => {
      try { action(); } catch (failure) { rollbackFailures.push(`${path}: ${String(failure)}`); }
    };
    const restore = (target: string, backup: string | undefined) => {
      if (backup) {
        if (!existsSync(backup)) throw new Error(`Backup missing; retained current target ${target}`);
        if (existsSync(target)) rmSync(target, { recursive: true, force: true });
        renameSync(backup, target);
      } else if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    };
    for (const record of [...staged].reverse()) {
      attempt(record.tmpDir, () => rmSync(record.tmpDir, { recursive: true, force: true }));
      if (record.backupDir || record.committed) attempt(record.targetDir, () => restore(record.targetDir, record.backupDir));
    }
    for (const backup of [...sourceBackups].reverse()) {
      if (backup.touched) attempt(backup.targetDir, () => restore(backup.targetDir, backup.backupDir));
      else if (backup.backupDir && !backup.backupReady) attempt(backup.backupDir, () => rmSync(backup.backupDir!, { recursive: true, force: true }));
    }
    if (packageTouched) attempt(packageTarget, () => restore(packageTarget, packageExisted ? packageBackup : undefined));
    else if (!packageBackupReady) attempt(packageBackup, () => rmSync(packageBackup, { recursive: true, force: true }));
    attempt(packageStaging, () => rmSync(packageStaging, { recursive: true, force: true }));
    // A failed install cannot leave an index of partially swapped resources.
    rebuildPluginIndex(workspaceRootPath, failure => rollbackFailures.push(`index: ${String(failure)}`));

    if (error instanceof PluginInstallError && !rollbackFailures.length) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PluginInstallError(`Failed to install plugin "${plugin.name}": ${message}` +
      (rollbackFailures.length ? '; rollback incomplete; retained recovery copies' : ''), rollbackFailures.join('\n') || undefined);
  }

  // Commit point: all resource/package swaps succeeded. Cleanup failures are
  // warnings from here on and can never re-enter the pre-commit rollback path.
  for (const backup of [...staged, ...sourceBackups]) {
    if (backup.backupDir) cleanup(backup.backupDir, () => rmSync(backup.backupDir!, { recursive: true, force: true }));
  }
  if (packageBackupReady) cleanup(packageBackup, () => rmSync(packageBackup, { recursive: true, force: true }));
  for (const slug of createdSourceSlugs) {
    cleanup(`sources/${slug}`, () => {
      const config = loadSourceConfig(workspaceRootPath, slug);
      if (config) cleanupSourceApiKeyCredential(workspaceRootPath, config);
    }, 'Post-commit credential cleanup failed');
  }
  return { name: plugin.name, skills: installedSkillSlugs, sources: createdSourceSlugs,
    replaced: plan.overwrites, warnings: skippedWarnings };

  function warn(path: string, message: string, error: unknown): void {
    skippedWarnings.push({ path, message: `${message}: ${error instanceof Error ? error.message : String(error)}` });
  }
  function cleanup(path: string, action: () => void, message = 'Post-commit backup cleanup failed'): void {
    try { action(); } catch (error) { warn(path, message, error); }
  }
  function backupSource(slug: string): SourceBackup {
    const targetDir = pluginResourcePath(getWorkspaceSourcesPath(workspaceRootPath), slug);
    const backupDir = existsSync(targetDir)
      ? `${targetDir}.replaced-${randomUUID().slice(0, 8)}`
      : undefined;
    const record: SourceBackup = { targetDir, backupDir, backupReady: false, touched: false };
    sourceBackups.push(record);
    if (backupDir) cpSync(targetDir, backupDir, { recursive: true });
    record.backupReady = true;
    return record;
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
  saveSourceConfig(workspaceRootPath, makeSourceConfig(workspaceRootPath, targetRoot, slug, displayName, pluginName, body), { deferCredentialCleanup: true });
}

function makeSourceConfig(
  workspaceRootPath: string, targetRoot: string, slug: string, displayName: string,
  pluginName: string, body: { type: 'mcp' | 'api' | 'local'; mcp?: McpSourceConfig },
): FolderSourceConfig {
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
    config.api = { baseUrl: existing?.type === 'api' ? existing.api?.baseUrl ?? '' : '', authType: 'none' };
  } else if (body.type === 'local') {
    config.local = existing?.type === 'local' ? existing.local : { path: '', format: 'filesystem' };
  }

  return config;
}

/** Move a package into the workspace plugins directory (directory-level replace). */
function placePackage(packageRoot: string, targetRoot: string, stagingDir: string): void {
  if (packageRoot === targetRoot) return; // already in place (a placed/edited plugin)

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
export function rebuildPluginIndex(workspaceRootPath: string, onError?: (error: unknown) => void): PluginIndex {
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
    // Do not leave the old cache claiming a successful but different install.
    try { rmSync(getPluginIndexPath(workspaceRootPath), { force: true }); }
    catch (cleanupError) { onError?.(cleanupError); }
    onError?.(error);
  }

  return index;
}

/** Read current claims from packages. The persisted index is an output cache,
 * never authority: it may be stale when a previous write/invalidation failed. */
export function readPluginIndex(workspaceRootPath: string): PluginIndex {
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
      existing: pluginResourcePath(getWorkspaceSkillsPath(workspaceRootPath), skill.slug),
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
      existing: pluginResourcePath(getWorkspaceSourcesPath(workspaceRootPath), slug),
    };
    const current = loadSourceConfig(workspaceRootPath, slug);
    if (
      claims.sources.has(slug) &&
      current?.pluginRoot &&
      resolve(workspaceRootPath, current.pluginRoot) === resolve(pluginResourcePath(getWorkspacePluginsPath(workspaceRootPath), name))
    ) {
      throw new PluginInstallError(
        `Cannot uninstall "${name}": shared source "${slug}" still executes from this plugin. Migrate its provider first.`,
      );
    }
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
  const targetRoot = pluginResourcePath(getWorkspacePluginsPath(workspaceRootPath), name);

  // 1. Remove the package first (see ordering note above).
  if (existsSync(targetRoot)) {
    rmSync(targetRoot, { recursive: true, force: true });
  }

  const removedSkills: string[] = [];
  const removedSources: string[] = [];

  // 2. Drop the resources nobody else claims.
  for (const entry of plan.removes) {
    const dir = entry.kind === 'skill'
      ? pluginResourcePath(getWorkspaceSkillsPath(workspaceRootPath), entry.slug)
      : pluginResourcePath(getWorkspaceSourcesPath(workspaceRootPath), entry.slug);

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
    if (!loaded.ok) {
      throw new PluginInstallError(
        `Cannot determine resource ownership: plugin "${other}" is invalid. Repair it before uninstalling.`,
      );
    }

    for (const skill of loaded.plugin.resources.skills) skills.add(skill.slug);
    for (const server of loaded.plugin.resources.mcpServers) sources.add(server.slug);
    for (const source of loaded.plugin.resources.extensionSources) sources.add(source.slug);
  }

  return { skills, sources };
}
