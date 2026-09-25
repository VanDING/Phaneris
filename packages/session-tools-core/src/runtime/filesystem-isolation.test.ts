/**
 * Sandbox profile path canonicalization.
 *
 * Failure cases first: the profile is matched by the kernel against the path it
 * actually resolved, so any symlink between the caller's path and the real file
 * makes an allow-list entry silently fail to match. On macOS that is not
 * hypothetical — `/var` and `/tmp` are symlinks into `/private`, and
 * `os.tmpdir()` returns the `/var/...` spelling, so a profile built with
 * `path.resolve` (which is purely lexical and keeps symlinks) denies every write
 * inside the session with EPERM.
 *
 * The symlinks below are created explicitly rather than relying on the host's
 * `/tmp` layout, so the expectation is identical on every platform.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDarwinSandboxProfile } from './filesystem-isolation.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { root: string; real: string; link: string } {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-profile-'));
  tempDirs.push(root);
  const real = join(root, 'real');
  const link = join(root, 'link');
  mkdirSync(real, { recursive: true });
  symlinkSync(real, link, 'dir');
  return { root, real, link };
}

describe('buildDarwinSandboxProfile', () => {
  it('includes session subpath write allow', () => {
    const { real } = fixture();
    const session = join(real, 'session');
    mkdirSync(session, { recursive: true });

    const profile = buildDarwinSandboxProfile(session);

    expect(profile).toContain(`(allow file-write* (subpath "${realpathSync.native(session)}"))`);
    expect(profile).not.toContain('(deny network*)');
  });

  it('includes deny network when requested', () => {
    const { real } = fixture();
    const profile = buildDarwinSandboxProfile(join(real, 'session'), { includeNetworkDeny: true });
    expect(profile).toContain('(deny network*)');
  });

  it('canonicalizes a symlinked session path so the kernel can match it', () => {
    const { real, link } = fixture();
    const throughLink = join(link, 'session');
    mkdirSync(throughLink, { recursive: true });

    const profile = buildDarwinSandboxProfile(throughLink);

    // The real path is allowed...
    expect(profile).toContain(`(subpath "${realpathSync.native(throughLink)}")`);
    // ...and the unresolved spelling is not what the kernel compares against.
    expect(profile).not.toContain(`(subpath "${throughLink}")`);
    expect(realpathSync.native(throughLink).startsWith(realpathSync.native(real))).toBe(true);
  });

  it('canonicalizes symlinked writable paths too', () => {
    const { real, link } = fixture();
    const dataThroughLink = join(link, 'data');
    mkdirSync(dataThroughLink, { recursive: true });

    const profile = buildDarwinSandboxProfile(join(real, 'session'), {
      writablePaths: [dataThroughLink],
    });

    expect(profile).toContain(`(subpath "${realpathSync.native(dataThroughLink)}")`);
    expect(profile).not.toContain(`(subpath "${dataThroughLink}")`);
  });

  it('canonicalizes through the deepest existing ancestor when the leaf does not exist yet', () => {
    const { real, link } = fixture();
    // `session/data` is created later by the tool; only `link` exists now.
    const notYet = join(link, 'session', 'data');

    const profile = buildDarwinSandboxProfile(join(real, 'session'), { writablePaths: [notYet] });

    // The symlinked prefix is resolved and the missing remainder is re-appended.
    expect(profile).toContain(`(subpath "${join(realpathSync.native(link), 'session', 'data')}")`);
  });

  it('keeps escaping intact so a crafted path cannot break out of the profile', () => {
    const { real } = fixture();
    /*
     * A quote is the character that actually tears the s-expression, and it is
     * the one this can assert exactly: macOS `realpath(3)` fails on a path whose
     * final component contains a backslash (it raises ENOENT for a directory
     * `mkdir` just created), so an expectation built from `realpathSync` cannot
     * cover backslashes here. `escapeSandboxPath` handles `\` and `"` in the same
     * expression, so this exercises the escaping path itself.
     */
    const crafted = join(real, 'quote"only');
    mkdirSync(crafted, { recursive: true });

    const profile = buildDarwinSandboxProfile(crafted);

    expect(profile).toContain(`(subpath "${realpathSync.native(crafted).replace(/"/g, '\\"')}")`);
    // The raw quote must never reach the profile unescaped.
    expect(profile).not.toContain(`(subpath "${realpathSync.native(crafted)}")`);
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(deny file-write*)');
  });
});
