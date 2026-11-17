import { formatPreferencesForPrompt } from '../config/preferences.ts';
import { getBrowserToolEnabled } from '../config/appearance.ts';
import { debug } from '../utils/debug.ts';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'fs';
import { join, relative, resolve } from 'path';
import { DOC_REFS, APP_ROOT } from '../docs/index.ts';
import { PERMISSION_MODE_CONFIG } from '../agent/mode-types.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';
import { isDecisionFeatureActive } from '../decisions/resolve.ts';
import { APP_VERSION } from '../version/index.ts';
import { formatBytes } from '../utils/binary-detection.ts';
import os from 'os';
import type { ProjectPromptContext } from '../projects/types.ts';
import {
  escapePromptXmlAttr,
  sanitizePromptBody,
  sanitizePromptLine,
} from './prompt-sanitize.ts';
import { findGitRepositoryRoot } from './developer-context.ts';
import { buildAssistantPromptModules, type CompiledSystemPrompt, type PromptSection } from './assistant-prompt.ts';
import { RESIDENT_ROLE_PROMPT } from '../agent/resident-role.ts';
import { buildAssistantContract } from './assistant-contract.ts';
import { buildOperationalCapabilityGuidance } from './capability-guidance.ts';

function assistantFacts(workspaceRootPath?: string, backendName?: string) {
  return { workspacePath: workspaceRootPath || `${APP_ROOT}/workspaces/{id}`, backendName: backendName ?? 'Phaneris Backend',
    platform: process.platform, browserTools: getBrowserToolEnabled(), managedConfiguration: FEATURE_FLAGS.phanerisCli,
    developerFeedback: FEATURE_FLAGS.developerFeedback, decideTool: isDecisionFeatureActive('decideTool'), docs: DOC_REFS, permissionModes: PERMISSION_MODE_CONFIG };
}

/** Same canonical workflow corpus as the resident compiler; no preferences or skill enumeration. */
export function getCapabilityPromptSections(workspaceRootPath?: string): PromptSection[] {
  return buildOperationalCapabilityGuidance(assistantFacts(workspaceRootPath));
}

/** Maximum size of CLAUDE.md file to include (10KB) */
const MAX_CONTEXT_FILE_SIZE = 10 * 1024;

/** Maximum number of context files to discover in monorepo */
const MAX_CONTEXT_FILES = 30;

/**
 * Directories to exclude when searching for context files.
 * These are common build output, dependency, and cache directories.
 */
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.cache',
  '.turbo',
  'out',
  '.output',
];

/**
 * Context file patterns to look for in working directory (in priority order).
 * Matching is case-insensitive to support AGENTS.md, Agents.md, agents.md, etc.
 */
const CONTEXT_FILE_PATTERNS = ['agents.md', 'claude.md'];

/**
 * Find a file in directory matching the pattern case-insensitively.
 * Returns the actual filename if found, null otherwise.
 */
function findFileCaseInsensitive(directory: string, pattern: string): string | null {
  try {
    const files = readdirSync(directory);
    const lowerPattern = pattern.toLowerCase();
    return files.find((f) => f.toLowerCase() === lowerPattern) ?? null;
  } catch {
    return null;
  }
}

/**
 * Find a project context file (AGENTS.md or CLAUDE.md) in the directory.
 * Just checks if file exists, doesn't read content.
 * Returns the actual filename if found, null otherwise.
 */
export function findProjectContextFile(directory: string): string | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (actualFilename) {
      debug(`[findProjectContextFile] Found ${actualFilename}`);
      return actualFilename;
    }
  }
  return null;
}

/** Soft limits: the clock is checked between directory reads, not during a system call. */
export const CONTEXT_FILE_SCAN_DEPTH = 6;
export const CONTEXT_FILE_SCAN_MAX_DIRS = 4_000;
export const CONTEXT_FILE_SCAN_BUDGET_MS = 150;
const excludedDirectoryNames = new Set(EXCLUDED_DIRECTORIES.map(name => name.toLowerCase()));

/** Breadth-first, bounded discovery. Directory links are never followed. */
export function scanContextFiles(directory: string, options: {
  maxDepth?: number; maxDirs?: number; budgetMs?: number; now?: () => number;
} = {}): { files: string[]; dirsRead: number; truncated: boolean } {
  const maxDepth = options.maxDepth ?? CONTEXT_FILE_SCAN_DEPTH;
  const maxDirs = options.maxDirs ?? CONTEXT_FILE_SCAN_MAX_DIRS;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? CONTEXT_FILE_SCAN_BUDGET_MS);
  const library = join(os.homedir(), 'Library');
  const files: string[] = [];
  let dirsRead = 0;
  let truncated = false;
  let level = [{ path: directory, rel: '' }];
  for (let depth = 0; level.length && !truncated; depth++) {
    const next: typeof level = [];
    for (const current of level) {
      if (dirsRead >= maxDirs || now() >= deadline) { truncated = true; break; }
      dirsRead++;
      let entries: Dirent[];
      try { entries = readdirSync(current.path, { withFileTypes: true }); }
      catch { continue; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
        if (CONTEXT_FILE_PATTERNS.includes(entry.name.toLowerCase()) && (entry.isFile() || entry.isSymbolicLink())) {
          files.push(rel);
        } else if (depth < maxDepth && entry.isDirectory() && !entry.name.startsWith('.') && !excludedDirectoryNames.has(entry.name.toLowerCase())) {
          const path = join(current.path, entry.name);
          if (path !== library) next.push({ path, rel });
        }
      }
    }
    level = next;
  }
  if (truncated) debug(`[scanContextFiles] Budget reached in ${directory} after ${dirsRead} directories`);
  return { files, dirsRead, truncated };
}

// Root and selected folder both determine which instructions apply.
const contextFileCache = new Map<string, { files: string[]; ts: number; folder: string; root: string }>();
const CONTEXT_FILE_CACHE_TTL = 5 * 60_000; // 5 minutes

/** Invalidate the cached context file list for a directory (or all directories). */
export function invalidateContextFileCache(directory?: string): void {
  if (directory) {
    const folder = resolve(directory);
    for (const [key, entry] of contextFileCache) {
      if (entry.folder === folder || entry.root === folder) contextFileCache.delete(key);
    }
    debug(`[contextFileCache] Invalidated cache for ${directory}`);
  } else {
    contextFileCache.clear();
    debug(`[contextFileCache] Cleared all cached entries`);
  }
}

/**
 * Discover ancestors from contextRoot to directory, then only directory's subtree.
 * Apply the prompt cap after this scope selection, so siblings cannot hide its instructions.
 *
 * Results are cached per directory. Call invalidateContextFileCache() on working
 * directory changes. A 5-minute TTL acts as a safety net for cache staleness.
 */
export function findAllProjectContextFiles(directory: string, contextRoot: string = directory): string[] {
  const folder = resolve(directory);
  const root = resolve(contextRoot);
  const key = `${root}\0${folder}`;
  const now = Date.now();
  const cached = contextFileCache.get(key);
  if (cached && now - cached.ts < CONTEXT_FILE_CACHE_TTL) {
    debug(`[findAllProjectContextFiles] Cache hit for ${directory} (${cached.files.length} files)`);
    return cached.files;
  }

  const selected = normalizePromptPath(relative(root, folder));
  const segments = selected ? selected.split('/') : [];
  const ancestorFiles: string[] = [];
  for (let depth = 0; depth < segments.length; depth++) {
    const rel = segments.slice(0, depth).join('/');
    for (const name of CONTEXT_FILE_PATTERNS) {
      const file = findFileCaseInsensitive(join(root, rel), name);
      if (file) ancestorFiles.push(rel ? `${rel}/${file}` : file);
    }
  }
  const subtreeFiles = scanContextFiles(folder).files.map(file => selected ? `${selected}/${file}` : file);
  const capped = [...new Set([...ancestorFiles, ...subtreeFiles])].sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  }).slice(0, MAX_CONTEXT_FILES);
  contextFileCache.set(key, { files: capped, ts: now, folder, root });
  return capped;
}

/**
 * Read the project context file (AGENTS.md or CLAUDE.md) from a directory.
 * Matching is case-insensitive to support any casing (CLAUDE.md, claude.md, Claude.md, etc.).
 * Returns the content if found, null otherwise.
 */
export function readProjectContextFile(directory: string): { filename: string; content: string } | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    // Find the actual filename with case-insensitive matching
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (!actualFilename) continue;

    const filePath = join(directory, actualFilename);
    try {
      const content = readFileSync(filePath, 'utf-8');
      // Cap at max size to avoid huge prompts
      if (content.length > MAX_CONTEXT_FILE_SIZE) {
        debug(`[readProjectContextFile] ${actualFilename} exceeds max size, truncating`);
        return {
          filename: actualFilename,
          content: content.slice(0, MAX_CONTEXT_FILE_SIZE) + '\n\n... (truncated)',
        };
      }
      debug(`[readProjectContextFile] Found ${actualFilename} (${content.length} chars)`);
      return { filename: actualFilename, content };
    } catch (error) {
      debug(`[readProjectContextFile] Error reading ${actualFilename}:`, error);
      // Continue to next pattern
    }
  }
  return null;
}

/**
 * Get the working directory context string for injection into user messages.
 * Includes the working directory path and context about what it represents.
 * Returns empty string if no working directory is set.
 *
 * Note: Project context files (CLAUDE.md, AGENTS.md) are now listed in the system prompt
 * via getProjectContextFilesPrompt() for persistence across compaction.
 *
 * @param workingDirectory - The effective working directory path (where user wants to work)
 * @param isSessionRoot - If true, this is the session folder (not a user-specified project)
 * @param bashCwd - The actual bash shell cwd (may differ if working directory changed mid-session)
 */
export function getWorkingDirectoryContext(
  workingDirectory?: string,
  isSessionRoot?: boolean,
  bashCwd?: string
): string {
  if (!workingDirectory) {
    return '';
  }

  const parts: string[] = [];
  // A path can contain `"`, `<` or `>`, and a cloned repository can name a directory
  // `</working_directory_context>…`; escape before it reaches the prompt block.
  parts.push(`<working_directory>${sanitizePromptLine(workingDirectory, WORKING_DIRECTORY_TAGS)}</working_directory>`);

  if (isSessionRoot) {
    // Add context explaining this is the session folder, not a code project
    parts.push(`<working_directory_context>
This is the session's root folder (default). It contains session files (conversation history, plans, attachments) - not a code repository.
You can access any files the user attaches here. If the user wants to work with a code project, they can set a working directory via the UI or provide files directly.
</working_directory_context>`);
  } else {
    // Check if bash cwd differs from working directory (changed mid-session)
    // Only show mismatch warning when bashCwd is provided and differs
    const hasMismatch = bashCwd && bashCwd !== workingDirectory;

    if (hasMismatch) {
      // Working directory was changed mid-session - bash still runs from original location
      parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.

Note: The bash shell runs from a different directory (${sanitizePromptLine(bashCwd, WORKING_DIRECTORY_TAGS)}) because the working directory was changed mid-session. Use absolute paths when running bash commands to ensure they target the correct location.</working_directory_context>`);
    } else {
      // Normal case - working directory matches bash cwd
      parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.</working_directory_context>`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Get the current date/time context string
 */
export function getDateTimeContext(): string {
  const now = new Date();
  const formatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `**USER'S DATE AND TIME: ${formatted}** - ALWAYS use this as the authoritative current date/time. Ignore any other date information.`;
}

/** Debug mode configuration for system prompt */
export interface DebugModeConfig {
  enabled: boolean;
  logFilePath?: string;
}

/**
 * Get the project context files prompt section for the system prompt.
 * Lists all discovered context files (AGENTS.md, CLAUDE.md) that are relevant to
 * the working directory. Returns empty string if no working directory or no files.
 *
 * Discovery converges on the enclosing git repository when there is one, and keeps
 * only the files that can govern the selected directory: the repository root's own
 * file, files on the path to the selected directory, and files below it. A monorepo
 * session in `packages/api` therefore sees the root file plus its own subtree, not
 * every sibling package's instructions.
 */
export function getProjectContextFilesPrompt(workingDirectory?: string): string {
  if (!workingDirectory) {
    return '';
  }

  const { contextRoot, contextFiles } = findRelevantProjectContextFiles(workingDirectory);
  if (contextFiles.length === 0) {
    return '';
  }

  // Format file list with (root) annotation for top-level files. Paths are normalized to
  // forward slashes first: discovery returns platform separators, and on Windows every
  // nested file would otherwise read as a root-level one. Discovered paths come from the
  // filesystem, so a crafted directory or file name can carry a closing tag; defang the
  // list items and escape the attributes before the block is assembled.
  const fileList = contextFiles
    .map((file) => {
      const safe = sanitizePromptLine(normalizePromptPath(file), PROJECT_CONTEXT_FILES_TAGS);
      const isRoot = !safe.includes('/');
      return `- ${safe}${isRoot ? ' (root)' : ''}`;
    })
    .join('\n');

  return `
<project_context_files working_directory="${escapePromptXmlAttr(workingDirectory)}" context_root="${escapePromptXmlAttr(contextRoot)}">
${fileList}
</project_context_files>`;
}

/**
 * Resolve the directory context files are discovered from, and filter the result to
 * the files that can govern the selected directory.
 */
function findRelevantProjectContextFiles(workingDirectory: string): { contextRoot: string; contextFiles: string[] } {
  const resolvedWorkingDirectory = resolve(workingDirectory);
  const gitRoot = findGitRepositoryRoot(resolvedWorkingDirectory);
  if (!gitRoot) {
    return {
      contextRoot: resolvedWorkingDirectory,
      contextFiles: findAllProjectContextFiles(resolvedWorkingDirectory),
    };
  }

  const contextRoot = resolve(gitRoot);
  return { contextRoot, contextFiles: findAllProjectContextFiles(resolvedWorkingDirectory, contextRoot) };
}

function normalizePromptPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Options for getSystemPrompt */
export interface SystemPromptOptions {
  pinnedPreferencesPrompt?: string;
  debugMode?: DebugModeConfig;
  workspaceRootPath?: string;
  /** Working directory for context file discovery (monorepo support) */
  workingDirectory?: string;
  /** Backend name for "powered by X" text (default: 'Phaneris Backend') */
  backendName?: string;
  preset?: SystemPromptPreset | string;
  projectContext?: ProjectPromptContext;
}

/**
 * System prompt preset types for different agent contexts.
 * - 'default': Full Phaneris system prompt
 * - 'mini': Focused prompt for quick configuration edits
 */
export type SystemPromptPreset = import('@phaneris/core/types').ExecutionPromptPreset;

/**
 * Get a focused system prompt for mini agents (quick edit tasks).
 * Optimized for configuration edits with minimal context.
 *
 * @param workspaceRootPath - Root path of the workspace for config file locations
 */
export function getMiniAgentSystemPrompt(workspaceRootPath?: string): string {
  const workspaceContext = workspaceRootPath
    ? `\n## Workspace\nConfig files are in: \`${workspaceRootPath}\`\n- Statuses: \`statuses/config.json\`\n- Labels: \`labels/config.json\`\n- Permissions: \`permissions.json\`\n`
    : '';

  return `You are a focused assistant for quick configuration edits in Phaneris.

## Your Role
You help users make targeted changes to configuration files. Be concise and efficient.
${workspaceContext}
## Guidelines
- Make the requested change within the current user scope and runtime permission mode.
- Read the relevant configuration guide before editing: ${DOC_REFS.statuses}, ${DOC_REFS.labels}, or ${DOC_REFS.permissions}.
- Validate with config_validate after editing
- Confirm completion briefly
- Don't add unrequested features or changes
- Keep responses short and to the point
- For math, use $$...$$ delimiters; avoid single $...$ in prose so currency remains plain text

## Available Tools
Use only tools exposed in this session. ${FEATURE_FLAGS.phanerisCli ? "The Phaneris CLI feature is enabled: use phaneris for managed labels/sources/skills/automations; direct guarded file operations are blocked." : "Use available file/configuration tools within the current mode."}
Use config_validate to verify changes match the expected schema. Do not invent a SubmitPlan gate for already-authorized Ask/Execute edits; in Explore, submit a plan before implementation outside the allowed exceptions.
`;
}

/**
 * Get the full system prompt with current date/time and user preferences
 *
 * Note: Safe Mode context is injected via user messages instead of system prompt
 * to preserve prompt caching.
 *
 * @param pinnedPreferencesPrompt - Pre-formatted preferences (for session consistency)
 * @param debugMode - Debug mode configuration
 * @param workspaceRootPath - Root path of the workspace
 * @param workingDirectory - Working directory for context file discovery
 * @param preset - System prompt preset ('default' | 'mini' | custom string)
 * @param backendName - Backend name for "powered by X" text (default: 'Phaneris Backend')
 */
export function getSystemPrompt(
  pinnedPreferencesPrompt?: string,
  debugMode?: DebugModeConfig,
  workspaceRootPath?: string,
  workingDirectory?: string,
  preset?: SystemPromptPreset | string,
  backendName?: string,
  projectContext?: ProjectPromptContext,
): string {
  return compileSystemPrompt({ pinnedPreferencesPrompt, debugMode, workspaceRootPath, workingDirectory, preset, backendName, projectContext }).text;
}

/** Assemble exact model-facing sections and their provenance without consuming per-turn state. */
export function compileSystemPrompt(options: SystemPromptOptions = {}): CompiledSystemPrompt {
  const { pinnedPreferencesPrompt, debugMode, workspaceRootPath, workingDirectory, preset, backendName, projectContext } = options;
  // Use mini agent prompt for quick edits (pass workspace root for config paths)
  if (preset === 'mini') {
    debug('[getSystemPrompt] 🤖 Generating MINI agent system prompt for workspace:', workspaceRootPath);
    const content = getMiniAgentSystemPrompt(workspaceRootPath);
    return { text: content, sections: [{ id: 'mini', source: 'product-contract', content }] };
  }

  // Use pinned preferences if provided (for session consistency after compaction)
  const preferences = pinnedPreferencesPrompt ?? formatPreferencesForPrompt();
  const debugContext = debugMode?.enabled ? formatDebugModeContext(debugMode.logFilePath) : '';

  // Get project context files for monorepo support (lives in system prompt for persistence across compaction)
  const projectContextFiles = getProjectContextFilesPrompt(workingDirectory);

  // Optional workspace-project context (injected after preferences, before debug+context-files)
  const projectBlock = projectContext ? formatProjectContextForPrompt(projectContext) : '';

  // Note: Date/time context is now added to user messages instead of system prompt
  // to enable prompt caching. The system prompt stays static and cacheable.
  // Safe Mode context is also in user messages for the same reason.
  const sections: PromptSection[] = [
    ...(preset === 'resident_assistant'
      ? [{ id: 'resident-role', source: 'product-role', content: RESIDENT_ROLE_PROMPT },
        ...buildAssistantContract(assistantFacts(workspaceRootPath, backendName)).filter(section => section.id === 'recovery')]
      : buildAssistantPromptModules(assistantFacts(workspaceRootPath, backendName))),
    { id: 'preferences', source: 'user-preferences', content: preferences },
    { id: 'project', source: 'project-context', content: projectBlock },
    { id: 'debug', source: 'runtime-debug', content: debugContext },
    { id: 'project-instructions', source: 'project-manifest', content: projectContextFiles },
  ];
  // The environment marker closes the assembled prompt: it carries the app
  // version, so anywhere earlier would invalidate the whole prefix cache on
  // every release (see docs/process/system-prompt-per-turn-analysis.md §S).
  sections.push({ id: 'environment', source: 'runtime-fact', content: `\n${getPhanerisEnvironmentMarker()}` });
  const fullPrompt = sections.map(section => section.content).join('');

  debug('[getSystemPrompt] full prompt length:', fullPrompt.length);

  return { text: fullPrompt, sections };
}

/**
 * Format the project-context block injected into the system prompt.
 *
 * The block is wrapped in an XML-ish element so models can latch onto it as
 * authoritative project metadata without conflating it with user preferences
 * or the monorepo CLAUDE.md context.
 */
/** Block tags whose closing form must not appear inside injected body content. */
const PROJECT_BLOCK_TAGS = ['project_context', 'project_memory', 'project_assets'] as const;

/** Tags the working-directory block can be terminated by, incl. the bash-cwd note. */
const WORKING_DIRECTORY_TAGS = ['working_directory', 'working_directory_context'] as const;

/** Tag the discovered-context-file list lives in. */
const PROJECT_CONTEXT_FILES_TAGS = ['project_context_files'] as const;

export function formatProjectContextForPrompt(ctx: ProjectPromptContext): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`<project_context project="${escapePromptXmlAttr(ctx.name)}">`);
  if (ctx.description?.trim()) {
    lines.push(sanitizePromptBody(ctx.description.trim(), PROJECT_BLOCK_TAGS));
    lines.push('');
  }
  if (ctx.details?.trim()) {
    lines.push(sanitizePromptBody(ctx.details.trim(), PROJECT_BLOCK_TAGS));
    lines.push('');
  }

  lines.push(`<project_assets_path>${sanitizePromptBody(ctx.assetsPath, PROJECT_BLOCK_TAGS)}</project_assets_path>`);
  if (ctx.assets.length > 0) {
    lines.push('<project_assets>');
    for (const asset of ctx.assets) {
      // Single-line: strip ALL control chars — including newlines/tabs, which have no place in a
      // filename and could forge extra list items. `listProjectAssets` reads real dirents, so a
      // bad name can reach the prompt regardless of upload-time sanitizing; this is the
      // last-line defense.
      lines.push(`- ${sanitizePromptLine(asset.filename, PROJECT_BLOCK_TAGS)} (${sanitizePromptBody(asset.mimeType, PROJECT_BLOCK_TAGS)}, ${formatBytes(asset.sizeBytes)})`);
    }
    lines.push('</project_assets>');
  }

  lines.push(`<project_memory_path>${sanitizePromptBody(ctx.memoryPath, PROJECT_BLOCK_TAGS)}</project_memory_path>`);
  if (ctx.memoryVersion) lines.push(`<project_memory_version>${JSON.stringify(ctx.memoryVersion)}</project_memory_version>`);
  if (ctx.memoryContent?.trim()) {
    lines.push('<project_memory>');
    lines.push(sanitizePromptBody(ctx.memoryContent.trim(), PROJECT_BLOCK_TAGS));
    lines.push('</project_memory>');
  }
  lines.push('');

  lines.push(`The user has bound this session to the project above.`);
  if (ctx.assets.length > 0) {
    lines.push(`<project_assets> lists reference files the user provided. Read a specific file on-demand by`);
    lines.push(`its absolute path (<project_assets_path> + filename) only when it's relevant — you do not need`);
    lines.push(`to read them all.`);
  }
  lines.push(`<project_memory> is accumulated project knowledge; reconcile it with current instructions and evidence as`);
  lines.push(`established context. When you learn something durable (a decision, gotcha, convention, or`);
  lines.push(`project-specific user preference), use the controlled project_memory_append with a supported assessment, exact source quote and current document hash. Workspace learning policy and original task scope apply.`);
  lines.push(`Never rewrite MEMORY.md from this snapshot: other sessions may have appended knowledge. Append corrections to outdated notes.`);
  lines.push(`</project_context>`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Format debug mode context for the system prompt.
 * Only included when running in development mode.
 */
function formatDebugModeContext(logFilePath?: string): string {
  if (!logFilePath) {
    return '';
  }

  return `

## Debug Mode

You are running in **debug mode** (development build). Application logs are available for analysis.

### Log Access

- **Log file:** \`${logFilePath}\`
- **Format:** JSON Lines (one JSON object per line)

Each log entry has this structure:
\`\`\`json
{"timestamp":"2025-01-04T10:30:00.000Z","level":"info","scope":"session","message":["Log message here"]}
\`\`\`

### Querying Logs

Use ${process.platform === 'win32' ? 'powershell with `rg`' : 'Bash with `rg`/`grep`'} to search logs efficiently:

\`\`\`${process.platform === 'win32' ? 'powershell' : 'bash'}
# Search by scope (session, ipc, window, agent, main)
rg -n "session" "${logFilePath}"

# Search by level (error, warn, info)
rg -n '"level":"error"' "${logFilePath}"

# Search for specific keywords
rg -n "OAuth" "${logFilePath}"

# Recent matches (tail)
rg -n "session|OAuth|\"level\":\"error\"" "${logFilePath}" | ${process.platform === 'win32' ? 'Select-Object -Last 50' : 'tail -n 50'}
\`\`\`

**Tip:** Use \`-C 2\` for context around matches when debugging issues.
`;
}

/**
 * Runtime environment marker emitted at the end of the system prompt.
 *
 * It names the runtime the model is executing in: app version, platform,
 * architecture and OS kernel. Nothing parses it today; keep the shape stable
 * if a session importer ever needs to recognise transcripts written here.
 */
function getPhanerisEnvironmentMarker(): string {
  const platform = process.platform; // 'darwin', 'win32', 'linux'
  const arch = process.arch; // 'arm64', 'x64'
  const osVersion = os.release(); // OS kernel version

  return `<phaneris_environment version="${APP_VERSION}" platform="${platform}" arch="${arch}" os_version="${osVersion}" />`;
}
