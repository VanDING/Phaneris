#!/usr/bin/env bun
/**
 * Post-packaging release artifact manifest.
 *
 * Writes SHA256SUMS and release-manifest.json next to the built installers so a
 * downloaded artifact can be verified before installation. This is deliberately
 * provider-neutral: signing/notarization and publishing remain release-workflow
 * steps, but the checksum manifest is generated from the actual bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dir, '..');
const RELEASE_DIR = join(ROOT, 'apps', 'electron', 'release');
const OUTPUT_DIR = process.env.PHANERIS_RELEASE_OUTPUT ?? RELEASE_DIR;

if (!existsSync(RELEASE_DIR)) {
  console.error(`Release directory not found: ${RELEASE_DIR}`);
  process.exit(1);
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Whether a walk entry is really a directory on disk.
 *
 * `readdirSync(withFileTypes)` reports a symlink as a symlink, not as whatever
 * it points at, while `statSync` follows it. macOS `.app` bundles are full of
 * directory symlinks (`Versions/Current`, `*.framework/Resources`,
 * `Electron Framework`), and hashing one throws EISDIR — so the decision has to
 * come from `statSync`, not from the dirent.
 */
function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // A dangling symlink (or a file that vanished mid-walk) is not a directory.
    return false;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'win-unpacked' || entry.name === 'mac' || entry.name === 'linux-unpacked') {
        out.push(...walk(full));
      } else {
        walk(full, out);
      }
    } else if (isDirectoryPath(full)) {
      // Symlinked directory: its targets are hashed under their real paths.
      continue;
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Manifest outputs, excluded from their own file list. The `.txt` spelling is
 * the published one (what a user downloads alongside the installers); the bare
 * name is kept in the exclusion set so an older run's file is neither hashed
 * nor left behind next to a fresh manifest.
 */
const MANIFEST_FILES = ['SHA256SUMS.txt', 'SHA256SUMS', 'release-manifest.json'] as const;
const CHECKSUMS_FILE = 'SHA256SUMS.txt';

const files = walk(RELEASE_DIR)
  .filter((file) => !(MANIFEST_FILES as readonly string[]).includes(relative(RELEASE_DIR, file)))
  .sort();

const entries = files.map((file) => {
  const stats = statSync(file);
  return {
    path: relative(RELEASE_DIR, file).replaceAll('\\', '/'),
    size: stats.size,
    sha256: sha256(file),
  };
});

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  // Source archives without git metadata still produce a usable manifest.
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
const manifest = {
  generatedAt: new Date().toISOString(),
  version: pkg.version ?? '0.0.0',
  commit,
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  files: entries,
};

writeFileSync(join(OUTPUT_DIR, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(OUTPUT_DIR, CHECKSUMS_FILE),
  entries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n') + '\n',
);
// One manifest directory must not carry two checksum files with different
// contents (a previous run wrote the bare name before it was unified).
const legacyChecksums = join(OUTPUT_DIR, 'SHA256SUMS');
if (legacyChecksums !== join(OUTPUT_DIR, CHECKSUMS_FILE) && existsSync(legacyChecksums)) {
  rmSync(legacyChecksums);
}
console.log(`Release manifest written: ${entries.length} files, ${manifest.totalBytes} bytes`);
