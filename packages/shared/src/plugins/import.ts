/**
 * Plugin import from a local archive or a URL (design §5.1.1).
 *
 * Import is AI-driven, not a front-end flow (P1-1): the operator is the agent,
 * so this module exposes plain operations and the conversational steps live in
 * `docs/plugins.md`. That is also why tar(.gz) is the only supported archive
 * format — it needs no new dependency, whereas zip would, and there is no human
 * user whose habits the format should cater to (P1-8).
 *
 * Every failure path here is a containment concern:
 *
 *  - **Archive traversal**: an entry named `../x` or an absolute path would write
 *    outside the extraction root, so each entry is checked before extraction.
 *  - **Symlinks**: `createWorkspaceBackup` throws on any entry that is neither a
 *    directory nor a regular file, so a package containing one would make the
 *    whole workspace backup fail (D11).
 *  - **Unbounded size**: a hostile or accidental archive must not be able to fill
 *    the disk, so a byte ceiling is enforced before and after extraction.
 */

import { createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isPathWithin } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { PLUGIN_MANIFEST_FILE } from './types.ts';

/** Maximum archive size accepted for import. */
export const PLUGIN_ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;

/** Maximum total size of an extracted package. */
export const PLUGIN_EXTRACTED_MAX_BYTES = 256 * 1024 * 1024;

/** Maximum redirects followed when fetching a plugin archive. */
const MAX_REDIRECTS = 5;

/** Raised when an import cannot be completed safely. */
export class PluginImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginImportError';
  }
}

/** A package extracted into a temporary directory, awaiting installation. */
export interface ExtractedPluginPackage {
  /** Absolute path of the package root (the directory containing plugin.json). */
  root: string;
  /** Temporary directory to remove once installation finishes. */
  tempDir: string;
  /** Where the archive came from, for the audit record. */
  origin: string;
  /** Remove the temporary extraction directory. Safe to call more than once. */
  cleanup: () => void;
}

/**
 * Reject any entry that could write outside the extraction root.
 *
 * Called for every archive entry before extraction, because a traversal entry
 * must be refused as a whole rather than sanitized — silently rewriting a
 * malicious path would hide that the package is malformed.
 */
function assertArchiveEntryIsContained(entryPath: string, extractionRoot: string): void {
  const normalized = entryPath.replace(/\\/g, '/');

  if (!normalized || normalized === '.') return;

  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new PluginImportError(`Archive entry "${entryPath}" uses an absolute path`);
  }

  const segments = normalized.split('/');
  if (segments.includes('..')) {
    throw new PluginImportError(`Archive entry "${entryPath}" escapes the archive root`);
  }

  const resolved = resolve(extractionRoot, normalized);
  if (!isPathWithin(extractionRoot, resolved)) {
    throw new PluginImportError(`Archive entry "${entryPath}" escapes the extraction directory`);
  }
}

/** Total bytes of every regular file under `root`, and any symlinked entries. */
function measureExtractedTree(root: string): { bytes: number; symlinks: string[] } {
  let bytes = 0;
  const symlinks: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      const stat = lstatSync(entryPath);

      if (stat.isSymbolicLink()) {
        symlinks.push(entryPath);
        continue;
      }
      if (stat.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (stat.isFile()) {
        bytes += stat.size;
      }
    }
  };

  walk(root);
  return { bytes, symlinks };
}

/**
 * Validate an extracted tree and locate the package root.
 *
 * Accepts either a manifest at the extraction root or a single top-level
 * directory containing one, because `tar czf plugin.tar.gz plugin/` is the
 * natural way to build a package and produces the latter.
 */
function locatePackageRoot(extractionRoot: string): string {
  if (existsSync(join(extractionRoot, PLUGIN_MANIFEST_FILE))) {
    return extractionRoot;
  }

  const entries = readdirSync(extractionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  const candidates = entries.filter((entry) =>
    existsSync(join(extractionRoot, entry.name, PLUGIN_MANIFEST_FILE)),
  );

  if (candidates.length === 1) {
    return join(extractionRoot, candidates[0]!.name);
  }

  if (candidates.length > 1) {
    throw new PluginImportError(
      'Archive contains more than one plugin — it must hold exactly one package',
    );
  }

  throw new PluginImportError(`Archive does not contain a ${PLUGIN_MANIFEST_FILE}`);
}

/**
 * Extract a plugin archive into a temporary directory.
 *
 * @param archivePath - Absolute path to a `.tar` / `.tar.gz` archive.
 * @param origin - Human-readable source, recorded in the install audit entry.
 */
export async function extractPluginArchive(
  archivePath: string,
  origin: string,
): Promise<ExtractedPluginPackage> {
  if (!existsSync(archivePath)) {
    throw new PluginImportError(`Archive not found: ${archivePath}`);
  }

  const archiveStat = statSync(archivePath);
  if (!archiveStat.isFile()) {
    throw new PluginImportError(`Archive path is not a file: ${archivePath}`);
  }
  if (archiveStat.size > PLUGIN_ARCHIVE_MAX_BYTES) {
    throw new PluginImportError(
      `Archive is ${archiveStat.size} bytes, over the ${PLUGIN_ARCHIVE_MAX_BYTES}-byte limit`,
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'phaneris-plugin-import-'));
  const extractionRoot = join(tempDir, 'extracted');

  const cleanup = (): void => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    mkdirSync(extractionRoot, { recursive: true });

    // `tar` resolves its own entry paths; `filter` lets us refuse a traversal
    // entry outright rather than trusting the library's normalization.
    const tar = await import('tar');
    await tar.x({
      file: archivePath,
      cwd: extractionRoot,
      // Do not honour absolute paths or `..` inside the archive.
      preservePaths: false,
      filter: (entryPath) => {
        assertArchiveEntryIsContained(entryPath, extractionRoot);
        return true;
      },
    });

    const { bytes, symlinks } = measureExtractedTree(extractionRoot);

    if (symlinks.length > 0) {
      throw new PluginImportError(
        `Archive contains a symbolic link (${symlinks[0]}) — symlinks break workspace backup ` +
          'and are not allowed in plugins',
      );
    }

    if (bytes > PLUGIN_EXTRACTED_MAX_BYTES) {
      throw new PluginImportError(
        `Extracted package is ${bytes} bytes, over the ${PLUGIN_EXTRACTED_MAX_BYTES}-byte limit`,
      );
    }

    return {
      root: locatePackageRoot(extractionRoot),
      tempDir,
      origin,
      cleanup,
    };
  } catch (error) {
    cleanup();
    if (error instanceof PluginImportError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PluginImportError(`Failed to extract plugin archive: ${message}`);
  }
}

/**
 * Download a plugin archive to a temporary file.
 *
 * @param url - Absolute http(s) URL of a `.tar` / `.tar.gz` archive.
 * @returns the downloaded file path plus a cleanup function.
 */
export async function downloadPluginArchive(
  url: string,
): Promise<{ archivePath: string; cleanup: () => void }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PluginImportError(`Not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new PluginImportError(`Unsupported URL scheme "${parsed.protocol}" — use http or https`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'phaneris-plugin-download-'));
  const archivePath = join(tempDir, 'plugin.tar');
  const cleanup = (): void => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    const response = await fetchWithRedirects(parsed);

    if (!response.ok) {
      throw new PluginImportError(`Download failed: HTTP ${response.status} ${response.statusText}`);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > PLUGIN_ARCHIVE_MAX_BYTES) {
      throw new PluginImportError(
        `Remote archive reports ${declaredLength} bytes, over the ${PLUGIN_ARCHIVE_MAX_BYTES}-byte limit`,
      );
    }

    if (!response.body) {
      throw new PluginImportError('Download failed: response has no body');
    }

    // Stream with a live byte ceiling rather than buffering the whole archive: a
    // declared Content-Length is a hint, not a guarantee (chunked responses omit
    // it entirely), so the limit must be enforced as bytes actually arrive.
    const reader = response.body.getReader();
    const sink = createWriteStream(archivePath);
    let received = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        received += value.byteLength;
        if (received > PLUGIN_ARCHIVE_MAX_BYTES) {
          throw new PluginImportError(
            `Download exceeded the ${PLUGIN_ARCHIVE_MAX_BYTES}-byte limit`,
          );
        }

        if (!sink.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => sink.once('drain', () => resolve()));
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        sink.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    }

    debug(`[PluginImport] Downloaded ${received} bytes from ${url}`);
    return { archivePath, cleanup };
  } catch (error) {
    cleanup();
    if (error instanceof PluginImportError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PluginImportError(`Failed to download plugin archive: ${message}`);
  }
}

/** Follow redirects manually so each hop is re-validated and counted. */
async function fetchWithRedirects(initialUrl: URL): Promise<Response> {
  let current = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, { redirect: 'manual' });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) return response;

    const next = new URL(location, current);
    if (next.protocol !== 'https:' && next.protocol !== 'http:') {
      throw new PluginImportError(`Redirect to unsupported scheme "${next.protocol}"`);
    }
    current = next;
  }

  throw new PluginImportError(`Too many redirects (over ${MAX_REDIRECTS})`);
}
