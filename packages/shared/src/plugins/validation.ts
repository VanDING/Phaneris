/**
 * Plugin manifest validation (Agent Plugins 1.0.0 §5).
 *
 * The spec defines a closed manifest schema with precisely-specified failure
 * boundaries, which this module implements literally:
 *
 *  - Unknown top-level field  → report and IGNORE, keep loading (spec §5.2)
 *  - Non-object `extensions`  → treat as absent (spec §8.1)
 *  - Any other violation      → FATAL: reject the plugin, load nothing (spec §5.3)
 *
 * Metadata fields are validated by JSON type only. The spec explicitly forbids
 * rejecting a manifest merely because `version` is not valid SemVer, or because
 * `homepage` / `repository` / `author.url` is not a recognised URL, or because
 * `license` is not an SPDX identifier — so this module deliberately does not.
 */

import {
  PLUGIN_MANIFEST_SCHEMA,
  type PluginAuthor,
  type PluginManifest,
} from './types.ts';

/** Result of validating a raw `plugin.json` payload. */
export interface ManifestValidationResult {
  /** Parsed manifest when valid; null when fatal. */
  manifest: PluginManifest | null
  /** Fatal problems — a non-empty list means the plugin must be rejected. */
  errors: string[]
  /** Non-fatal problems — reported, then ignored (spec §5.2 / §8.1). */
  warnings: string[]
}

/** Every top-level field the spec's manifest schema permits (spec §5.2). */
const ALLOWED_MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'icon',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
]);

/** Fields permitted inside the `author` object (spec §5.4). */
const ALLOWED_AUTHOR_FIELDS = new Set(['name', 'email', 'url']);

/**
 * Plugin name constraints (spec §5.5).
 *
 * 1-64 characters; `a-z`, `0-9`, `-`, `.` only; must start and end
 * alphanumeric; no consecutive hyphens or consecutive periods.
 */
const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** True when `name` satisfies the spec §5.5 plugin name constraints. */
export function isValidPluginName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (!PLUGIN_NAME_PATTERN.test(name)) return false;
  if (name.includes('--') || name.includes('..')) return false;
  return true;
}

/**
 * Validate a parsed `plugin.json` payload.
 *
 * @param raw - The JSON-decoded manifest, of unknown shape.
 * @returns Parsed manifest plus fatal errors and ignorable warnings.
 */
export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { manifest: null, errors: ['plugin.json must contain a JSON object'], warnings };
  }

  const record = raw as Record<string, unknown>;

  // Unknown top-level fields are reported and ignored — never fatal (spec §5.2).
  for (const key of Object.keys(record)) {
    if (!ALLOWED_MANIFEST_FIELDS.has(key)) {
      warnings.push(`unknown top-level field "${key}" ignored`);
    }
  }

  // --- $schema: required, and must name a version we implement (spec §5.2) ---
  const schema = record.$schema;
  if (typeof schema !== 'string' || schema.length === 0) {
    errors.push('missing required field "$schema"');
  } else if (schema !== PLUGIN_MANIFEST_SCHEMA) {
    // Unsupported version: reject rather than guess (spec §5.2).
    errors.push(
      `unsupported $schema "${schema}" — this client implements ${PLUGIN_MANIFEST_SCHEMA}`,
    );
  }

  // --- name: required, constrained (spec §5.3 / §5.5) ---
  const name = record.name;
  if (typeof name !== 'string' || name.length === 0) {
    errors.push('missing required field "name"');
  } else if (!isValidPluginName(name)) {
    errors.push(
      `invalid plugin name "${name}" — must be 1-64 characters of a-z, 0-9, "-" or ".", ` +
        'start and end alphanumeric, and contain no "--" or ".."',
    );
  }

  // --- optional metadata: JSON types only, never URL/SemVer/SPDX checks (§5.4) ---
  for (const field of ['version', 'description', 'icon', 'homepage', 'repository', 'license'] as const) {
    const value = record[field];
    if (value !== undefined && typeof value !== 'string') {
      errors.push(`field "${field}" must be a string`);
    }
  }

  const keywords = record.keywords;
  if (keywords !== undefined) {
    if (!Array.isArray(keywords) || keywords.some((k) => typeof k !== 'string')) {
      errors.push('field "keywords" must be an array of strings');
    }
  }

  const author = validateAuthor(record.author, warnings);
  if (author === 'invalid') {
    errors.push('field "author" must be an object containing only name, email, and url strings');
  }

  // Non-object `extensions` is treated as absent, not fatal (spec §8.1).
  let extensions: Record<string, unknown> | undefined;
  if (record.extensions !== undefined) {
    if (record.extensions === null || typeof record.extensions !== 'object' || Array.isArray(record.extensions)) {
      warnings.push('field "extensions" is not an object; ignored');
    } else {
      extensions = record.extensions as Record<string, unknown>;
    }
  }

  if (errors.length > 0) {
    return { manifest: null, errors, warnings };
  }

  return {
    manifest: {
      $schema: schema as string,
      name: name as string,
      version: record.version as string | undefined,
      description: record.description as string | undefined,
      icon: record.icon as string | undefined,
      author: author === 'invalid' || author === undefined ? undefined : author,
      homepage: record.homepage as string | undefined,
      repository: record.repository as string | undefined,
      license: record.license as string | undefined,
      keywords: keywords as string[] | undefined,
      extensions,
    },
    errors,
    warnings,
  };
}

/**
 * Validate the `author` object (spec §5.4).
 *
 * @returns the author, `undefined` when absent, or `'invalid'` when malformed.
 */
function validateAuthor(value: unknown, warnings: string[]): PluginAuthor | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'invalid';

  const record = value as Record<string, unknown>;
  const author: PluginAuthor = {};

  for (const [key, entry] of Object.entries(record)) {
    if (!ALLOWED_AUTHOR_FIELDS.has(key)) {
      // The author object is closed: any other field makes the manifest invalid.
      warnings.push(`unknown author field "${key}"`);
      return 'invalid';
    }
    if (typeof entry !== 'string') return 'invalid';
    author[key as keyof PluginAuthor] = entry;
  }

  return author;
}
