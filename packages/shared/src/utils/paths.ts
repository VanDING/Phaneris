/**
 * Path Portability Utilities
 *
 * Functions for making filesystem paths portable across machines.
 * Supports ~ and ${HOME} path variables for cross-machine compatibility.
 */

import { homedir } from 'os';
import { resolve, join, normalize, isAbsolute, dirname, relative } from 'path';
import { existsSync, lstatSync, realpathSync } from 'fs';

/**
 * Expand path variables (~, ${HOME}, $HOME) to absolute paths.
 *
 * @param inputPath - Path that may contain variables
 * @param basePath - Base path for relative path resolution (defaults to cwd)
 * @returns Absolute path with all variables expanded
 *
 * @example
 * expandPath('~')                    // '/Users/alice'
 * expandPath('~/Documents')          // '/Users/alice/Documents'
 * expandPath('${HOME}/projects')     // '/Users/alice/projects'
 * expandPath('/absolute/path')       // '/absolute/path' (unchanged)
 */
export function expandPath(inputPath: string, basePath?: string): string {
  if (!inputPath) return inputPath;

  let expanded = inputPath;
  const home = homedir();

  // Handle ~ alone
  if (expanded === '~') {
    return home;
  }

  // Handle ~/ prefix
  if (expanded.startsWith('~/')) {
    expanded = join(home, expanded.slice(2));
  }

  // Handle ~\ prefix (win32 portable paths persisted with mixed separators)
  if (expanded.startsWith('~\\')) {
    expanded = join(home, expanded.slice(2));
  }

  // Handle ${HOME} and $HOME variables
  expanded = expanded.replace(/\$\{HOME\}/g, home);
  expanded = expanded.replace(/\$HOME(?=\/|$)/g, home);

  // If still not absolute, resolve from base path
  if (!isAbsolute(expanded)) {
    const base = basePath || process.cwd();
    expanded = resolve(base, expanded);
  }

  return normalize(expanded);
}

/**
 * Convert absolute path to portable form.
 * If path is within home directory, converts to ~ prefix.
 *
 * @param absolutePath - Absolute path to convert
 * @returns Portable path (with ~ prefix if in home) or original if outside home
 *
 * @example
 * toPortablePath('/Users/alice')           // '~'
 * toPortablePath('/Users/alice/Documents') // '~/Documents'
 * toPortablePath('/var/log')               // '/var/log' (unchanged)
 */
export function toPortablePath(absolutePath: string): string {
  if (!absolutePath) return absolutePath;

  // Idempotency: already-portable paths pass through untouched. Double
  // application would otherwise re-normalize mixed separators (e.g.
  // '~/AppData\Local' → '~\AppData\Local'), producing phantom paths.
  if (absolutePath.startsWith('~') || absolutePath.startsWith('${HOME}')) {
    return absolutePath;
  }

  const home = homedir();
  const normalized = normalize(absolutePath);

  // Exact match with home directory
  if (normalized === home) {
    return '~';
  }

  // Path within home directory (handle both Unix and Windows separators)
  const homePrefix = home + '/';
  const homePrefixWin = home + '\\';

  if (normalized.startsWith(homePrefix)) {
    return '~/' + normalized.slice(homePrefix.length);
  }

  if (normalized.startsWith(homePrefixWin)) {
    return '~/' + normalized.slice(homePrefixWin.length);
  }

  // Path is outside home directory, keep as absolute
  return normalized;
}

/**
 * Check if a path contains unexpanded variables.
 */
export function hasPathVariables(path: string): boolean {
  if (!path) return false;
  return (
    path.startsWith('~') ||
    path.includes('${HOME}') ||
    path.includes('$HOME/')
  );
}

/**
 * Check if a path is already portable (has ~ prefix or is relative).
 */
export function isPortablePath(path: string): boolean {
  if (!path) return false;
  return path.startsWith('~') || path.startsWith('./') || !isAbsolute(path);
}

// ============================================================
// Cross-Platform Path Utilities
// ============================================================

/**
 * Normalize a path to use forward slashes for consistent cross-platform comparison.
 * Use this before comparing paths or using regex patterns on paths.
 *
 * @example
 * normalizePath('C:\\Users\\foo\\bar') // 'C:/Users/foo/bar'
 * normalizePath('/Users/foo/bar')      // '/Users/foo/bar' (unchanged)
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Normalize a path for cross-platform comparison.
 * - Resolve to absolute
 * - Convert backslashes to forward slashes
 * - Lowercase on Windows
 */
export function normalizePathForComparison(path: string): string {
  const normalized = normalizePath(resolve(path));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Check if a file path starts with a directory path (cross-platform).
 * Handles both Windows backslashes and Unix forward slashes.
 *
 * @example
 * pathStartsWith('C:\\Users\\foo\\file.txt', 'C:\\Users\\foo') // true
 * pathStartsWith('/home/user/file.txt', '/home/user')          // true
 * pathStartsWith('/home/user2/file.txt', '/home/user')         // false
 */
export function pathStartsWith(filePath: string, dirPath: string): boolean {
  const normalizedFile = normalizePathForComparison(filePath);
  const normalizedDir = normalizePathForComparison(dirPath);
  return normalizedFile.startsWith(normalizedDir + '/') || normalizedFile === normalizedDir;
}

/**
 * Strip a directory prefix from a path (cross-platform).
 * Returns the relative path portion after the prefix.
 *
 * @example
 * stripPathPrefix('/home/user/docs/file.txt', '/home/user') // 'docs/file.txt'
 * stripPathPrefix('C:\\foo\\bar\\baz.txt', 'C:\\foo')       // 'bar/baz.txt'
 */
export function stripPathPrefix(filePath: string, prefix: string): string {
  const normalizedFile = normalizePathForComparison(filePath);
  const normalizedPrefix = normalizePathForComparison(prefix);
  if (normalizedFile.startsWith(normalizedPrefix + '/')) {
    return normalizedFile.slice(normalizedPrefix.length + 1);
  }
  return filePath;
}

/**
 * Containment check for paths that may not exist yet, resistant to symlink escapes.
 *
 * Resolves the nearest existing ancestor and compares real paths, so a symlink
 * anywhere along the chain cannot smuggle a write outside `dirPath`. Used by the
 * plugin installer, which must reject package paths escaping the plugin root
 * (Agent Plugins §4.1) both at read and at materialization time.
 *
 * Uses `relative` rather than the exported `pathStartsWith`, because a caller may
 * hand in a path with mixed separators — plugin placeholders expand as
 * `<root>/bin/server`, whose forward slash survives on Windows. `pathStartsWith`
 * compares normalized strings and would wrongly report such a path as outside.
 *
 * @example
 * isPathWithin(pluginRoot, join(pluginRoot, 'bin/server'))  // true
 * isPathWithin(pluginRoot, '../outside')                    // false
 */
export function isPathWithin(dirPath: string, candidatePath: string): boolean {
  const resolvedDir = resolve(dirPath);
  const resolvedCandidate = resolve(candidatePath);

  // Lexical check first — cheap, and catches the common `..` escape.
  if (!isWithinResolved(resolvedDir, resolvedCandidate)) return false;

  // Then confirm real paths. Neither side may resolve through a symlink out of
  // the base, so both are compared via their nearest *existing* ancestor.
  const realDir = existingRealPath(resolvedDir);
  const realCandidate = existingRealPath(resolvedCandidate);

  // An existing ancestor that cannot be resolved (drive root, permission error)
  // means containment cannot be established; refuse rather than assume.
  if (realDir === null || realCandidate === null) return false;

  return isWithinResolved(realDir, realCandidate);
}

/**
 * Real path of `targetPath`, or of its nearest existing ancestor.
 *
 * Used because an install writes paths that do not exist yet; resolving the
 * nearest existing ancestor is what makes the check symlink-aware for those.
 *
 * @returns the resolved path, or null when no ancestor could be resolved.
 */
function existingRealPath(targetPath: string): string | null {
  let current = targetPath;

  for (;;) {
    if (existsSync(current)) {
      try {
        return realpathSync.native(current);
      } catch {
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Separator- and case-tolerant containment test between two resolved paths. */
function isWithinResolved(resolvedBase: string, resolvedTarget: string): boolean {
  const rel = relative(resolvedBase, resolvedTarget);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * True when `targetPath` is a symbolic link.
 *
 * The plugin installer rejects symlinked package entries: `createWorkspaceBackup`
 * walks the whole workspace and throws on non-file entries, so one symlink inside
 * a plugin would make the entire workspace backup fail.
 */
export function isSymbolicLink(targetPath: string): boolean {
  try {
    return lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

// ============================================================
// Bundled Assets Resolution
// ============================================================

/**
 * Module-level base directory for bundled assets.
 * Set once at Electron startup via setBundledAssetsRoot(__dirname).
 * In non-Electron contexts (tests, dev mode), process.cwd() candidates are used.
 */
let _assetsRoot: string | undefined;

/**
 * Register the Electron main process directory as the root for bundled assets.
 * Call this once at app startup: setBundledAssetsRoot(__dirname)
 *
 * After this, getBundledAssetsDir('docs') will resolve to `<__dirname>/resources/docs/`
 * in the packaged app, or fall back to dev paths if that doesn't exist.
 */
export function setBundledAssetsRoot(dir: string): void {
  _assetsRoot = dir;
}

/**
 * Resolve the path to a bundled assets subdirectory.
 *
 * All bundled assets now live in resources/ which electron-builder handles natively.
 * Tries candidates in order:
 * 1. Electron packaged app: <assetsRoot>/resources/<subfolder>
 * 2. Dev: electron app resources folder (when running from apps/electron)
 * 3. Dev: dist output (after build:copy)
 *
 * Returns the first candidate that exists on disk, or undefined if none found.
 *
 * @param subfolder - Name of the assets subdirectory (e.g. 'docs', 'tool-icons', 'themes', 'permissions')
 */
export function getBundledAssetsDir(subfolder: string): string | undefined {
  const candidates = [
    // Electron packaged app (set via setBundledAssetsRoot at startup)
    ...(_assetsRoot ? [join(_assetsRoot, 'resources', subfolder)] : []),
    // Dev: electron app resources folder (when cwd is apps/electron)
    join(process.cwd(), 'resources', subfolder),
    // Dev: dist output (after build:copy)
    join(process.cwd(), 'dist', 'resources', subfolder),
  ];
  return candidates.find(p => existsSync(p));
}
