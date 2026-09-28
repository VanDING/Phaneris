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
import { buildDarwinSandboxProfile, escapeSandboxPath } from './filesystem-isolation.ts';

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

    expect(profile).toContain(`(allow file-write* (subpath "${escapeSandboxPath(realpathSync.native(session))}"))`);
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
    expect(profile).toContain(`(subpath "${escapeSandboxPath(realpathSync.native(throughLink))}")`);
    // ...and the unresolved spelling is not what the kernel compares against.
    expect(profile).not.toContain(`(subpath "${escapeSandboxPath(throughLink)}")`);
    expect(realpathSync.native(throughLink).startsWith(realpathSync.native(real))).toBe(true);
  });

  it('canonicalizes symlinked writable paths too', () => {
    const { real, link } = fixture();
    const dataThroughLink = join(link, 'data');
    mkdirSync(dataThroughLink, { recursive: true });

    const profile = buildDarwinSandboxProfile(join(real, 'session'), {
      writablePaths: [dataThroughLink],
    });

    expect(profile).toContain(`(subpath "${escapeSandboxPath(realpathSync.native(dataThroughLink))}")`);
    expect(profile).not.toContain(`(subpath "${escapeSandboxPath(dataThroughLink)}")`);
  });

  it('canonicalizes through the deepest existing ancestor when the leaf does not exist yet', () => {
    const { real, link } = fixture();
    // `session/data` is created later by the tool; only `link` exists now.
    const notYet = join(link, 'session', 'data');

    const profile = buildDarwinSandboxProfile(join(real, 'session'), { writablePaths: [notYet] });

    // The symlinked prefix is resolved and the missing remainder is re-appended.
    expect(profile).toContain(`(subpath "${escapeSandboxPath(join(realpathSync.native(link), 'session', 'data'))}")`);
  });

  it('escapes a crafted quote in a not-yet-existing path so it cannot break out of the profile', () => {
    const { real } = fixture();
    /*
     * A quote is the character that tears the s-expression. The crafted leaf is
     * deliberately left non-existent: the profile builder resolves the deepest
     * existing ancestor and re-appends the remainder, which is exactly the code
     * path that has to escape it — and it keeps the fixture portable, because
     * Windows cannot create a file whose name contains `"` at all.
     */
    const crafted = join(real, 'quote"only');
    const resolvedRemainder = join(realpathSync.native(real), 'quote"only');

    const profile = buildDarwinSandboxProfile(crafted);

    expect(profile).toContain(`(subpath "${escapeSandboxPath(resolvedRemainder)}")`);
    // The unescaped spelling must never reach the profile.
    expect(profile).not.toContain(`(subpath "${resolvedRemainder}")`);
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(deny file-write*)');
  });

  it('escapes backslashes, which are the profile format\'s own escape character', () => {
    /*
     * Asserted on the exported helper rather than through a fixture: Windows
     * cannot create a path component containing `\` (it is the separator) and
     * macOS `realpath(3)` raises ENOENT for one, so no portable fixture exists.
     * The helper is the single place this escaping is defined, and the profile
     * builder calls it for every embedded path.
     */
    expect(escapeSandboxPath('C:\\Users\\x')).toBe('C:\\\\Users\\\\x');
    expect(escapeSandboxPath('a"b')).toBe('a\\"b');
    expect(escapeSandboxPath('plain/path')).toBe('plain/path');
    // Order matters: doubling first, then quoting, or the quote escape would be doubled too.
    expect(escapeSandboxPath('\\"')).toBe('\\\\\\"');
  });
});
