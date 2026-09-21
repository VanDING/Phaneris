/**
 * Plugin placeholder resolution (design §5.4).
 *
 * Agent Plugins §7.2.1 gives stdio servers two placeholders — `${PLUGIN_ROOT}`
 * and `${PLUGIN_DATA}` — and requires `args` and `env` to support them.
 *
 * Two decisions shape this module:
 *
 *  1. **Resolution happens at runtime, not install time** (§5.4.3). A source's
 *     `config.json` keeps the placeholders verbatim and records its plugin via
 *     the workspace-relative `pluginRoot` field, so moving the workspace — or the
 *     package — keeps everything resolvable. Writing absolute paths at install
 *     time would break the moment either moved.
 *
 *  2. **`cwd` is not supported** (§5.4.1). Omitting it leaves the server running
 *     from the plugin root, which anchors its relative-path view inside the
 *     plugin — the stronger containment position. A non-`${PLUGIN_ROOT}` `cwd`
 *     therefore makes that server entry invalid rather than being silently
 *     ignored, so the package author is told instead of being misled.
 */

import { isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';
import { isPathWithin } from '../utils/paths.ts';
import { PLUGIN_DATA_DIR_NAME } from './types.ts';

/** The two placeholders a plugin package may use, and what they resolve to. */
export interface PluginPathContext {
  /** Absolute path to the plugin root. */
  pluginRoot: string;
}

/** Outcome of resolving one server entry. */
export interface ResolvedStdioFields {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Warnings for values that were accepted but are worth surfacing. */
  warnings: string[];
}

/** Raised when a package's stdio entry cannot be used as written. */
export class PluginPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginPathError';
  }
}

/**
 * Expand `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in a single opaque string.
 *
 * Both placeholders are plain string substitutions: `${PLUGIN_DATA}` resolves to
 * `<pluginRoot>/data`, so a server receives its data directory as an explicit
 * argument (`args: ["--data", "${PLUGIN_DATA}"]`) rather than relying on a
 * working directory — which is what lets `cwd` stay unsupported (§5.4.2).
 *
 * The result is separator-normalized so a template's literal `/` and the
 * platform's `\` cannot mix in one path.
 */
export function expandPluginPlaceholders(value: string, context: PluginPathContext): string {
  const dataRoot = join(context.pluginRoot, PLUGIN_DATA_DIR_NAME);

  // Only path fragments introduced by placeholders are normalized. The rest of
  // the value is opaque plugin data and may be a URL, JSON, or another argument.
  return replacePathPlaceholder(
    replacePathPlaceholder(value, '${PLUGIN_ROOT}', context.pluginRoot),
    '${PLUGIN_DATA}',
    dataRoot,
  );
}

function replacePathPlaceholder(value: string, token: string, replacement: string): string {
  const parts = value.split(token);
  if (parts.length === 1) return value;
  return parts
    .map((part, index) => index === 0 || process.platform !== 'win32' ? part : part.replace(/\//g, '\\'))
    .join(replacement);
}

/** Expand placeholders across a list of opaque arguments. */
export function expandPluginPlaceholdersInList(
  values: readonly string[] | undefined,
  context: PluginPathContext,
): string[] {
  if (!values) return [];
  return values.map((value) => expandPluginPlaceholders(value, context));
}

/** Expand placeholders across environment values. */
export function expandPluginPlaceholdersInEnv(
  env: Record<string, string> | undefined,
  context: PluginPathContext,
): Record<string, string> {
  if (!env) return {};
  const expanded: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    expanded[key] = expandPluginPlaceholders(value, context);
  }
  return expanded;
}

/**
 * Normalize a stdio `command` to an absolute path inside the plugin.
 *
 * Rejected forms (each is a silent-failure source otherwise):
 *
 *  - **bare names** (`node`, `npx`): spec §7.2.1 says a conforming plugin must not
 *    depend on PATH behavior, and the pre-flight check in `mcp/validation.ts`
 *    tests an existing path with `existsSync`, so a relative or bare command
 *    would be judged against an unpredictable `process.cwd()`.
 *  - **escapes** (`../bin/server`): the resolved path must stay inside the plugin
 *    root (§4.1).
 *
 * @returns the absolute command path.
 * @throws {PluginPathError} when the command cannot be used.
 */
export function normalizePluginCommand(rawCommand: string, context: PluginPathContext): string {
  const expanded = expandPluginPlaceholders(rawCommand, context);
  const trimmed = expanded.trim();
  if (!trimmed) {
    throw new PluginPathError('stdio server requires a non-empty "command"');
  }

  const looksLikePath = trimmed.includes('/') || trimmed.includes('\\');
  const wasPlaceholder = rawCommand.includes('${PLUGIN_ROOT}') || rawCommand.includes('${PLUGIN_DATA}');

  if (!looksLikePath && !wasPlaceholder) {
    throw new PluginPathError(
      `stdio command "${rawCommand}" is a bare executable name — plugins must use a plugin-relative ` +
        'path such as "./bin/server" or "${PLUGIN_ROOT}/bin/server"',
    );
  }

  // `${PLUGIN_ROOT}/bin/...` already expanded to an absolute path; `./bin/...` is
  // relative to the plugin root by definition (§7.2.1). Only the latter is
  // joined — joining an absolute path onto the root would duplicate it.
  const absolute = isAbsolute(trimmed) ? trimmed : join(context.pluginRoot, trimmed);

  if (!isPathWithin(context.pluginRoot, absolute)) {
    throw new PluginPathError(
      `stdio command "${rawCommand}" resolves outside the plugin root`,
    );
  }

  return absolute;
}

/**
 * Validate a stdio entry's `cwd` (design §5.4.1).
 *
 * Only `${PLUGIN_ROOT}`-rooted values are accepted, because anything else would
 * move the server's relative-path view outside the plugin. Absent, `"."`, and
 * `${PLUGIN_ROOT}` are all equivalent to "run from the plugin root" and pass.
 *
 * @throws {PluginPathError} when `cwd` is unsupported or escapes the plugin.
 */
export function validatePluginCwd(rawCwd: string | undefined, context: PluginPathContext): void {
  if (rawCwd === undefined || rawCwd === '' || rawCwd === '.') return;

  const allowed =
    rawCwd === '${PLUGIN_ROOT}' ||
    rawCwd.startsWith('${PLUGIN_ROOT}/') ||
    rawCwd.startsWith('${PLUGIN_ROOT}\\');

  if (!allowed) {
    throw new PluginPathError(
      `stdio "cwd" is not supported in plugins (got "${rawCwd}") — a server always runs from the ` +
        'plugin root; pass a data directory as an argument instead, e.g. ' +
        'args: ["--data", "${PLUGIN_DATA}"]',
    );
  }

  const resolved = expandPluginPlaceholders(rawCwd, context);
  if (!isPathWithin(context.pluginRoot, resolved)) {
    throw new PluginPathError(`stdio "cwd" "${rawCwd}" resolves outside the plugin root`);
  }
}

/**
 * Resolve a stdio server's command, args, and env against its plugin root.
 *
 * @throws {PluginPathError} for an unusable command or an unsupported `cwd`.
 */
export function resolvePluginStdioFields(
  entry: { command: unknown; args?: unknown; env?: unknown; cwd?: unknown },
  context: PluginPathContext,
): ResolvedStdioFields {
  if (typeof entry.command !== 'string' || !entry.command) {
    throw new PluginPathError('stdio server requires a string "command"');
  }

  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
    throw new PluginPathError('stdio "cwd" must be a string when present');
  }
  validatePluginCwd(entry.cwd as string | undefined, context);

  const warnings: string[] = [];

  if (entry.args !== undefined && !Array.isArray(entry.args)) {
    throw new PluginPathError('stdio "args" must be an array of strings');
  }
  if (Array.isArray(entry.args) && entry.args.some((a) => typeof a !== 'string')) {
    throw new PluginPathError('stdio "args" must contain only strings');
  }

  let env: Record<string, string> = {};
  if (entry.env !== undefined) {
    if (entry.env === null || typeof entry.env !== 'object' || Array.isArray(entry.env)) {
      throw new PluginPathError('stdio "env" must be an object of strings');
    }
    for (const [key, value] of Object.entries(entry.env as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new PluginPathError(`stdio env "${key}" must be a string`);
      }
    }
    env = expandPluginPlaceholdersInEnv(entry.env as Record<string, string>, context);
  }

  const command = normalizePluginCommand(entry.command, context);
  if (!existsSync(command)) {
    // Not fatal: the executable may legitimately appear later (installed by the
    // server's own setup step), and `source_test` reports it clearly at use time.
    warnings.push(`stdio command does not exist yet: ${command}`);
  }

  return {
    command,
    args: expandPluginPlaceholdersInList(entry.args as string[] | undefined, context),
    env,
    warnings,
  };
}
