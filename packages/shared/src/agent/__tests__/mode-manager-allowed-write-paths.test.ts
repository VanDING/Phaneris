import { describe, it, expect } from 'bun:test';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { matchesAllowedWritePath } from '../../agent/mode-manager.ts';

// The matcher is shared by Explore mode (shouldAllowToolInMode) and Ask mode
// (core/pre-tool-use.ts:shouldPromptInAskMode) since OSS #1065; both modes must
// agree on what "inside the allowlist" means.
//
// NOTE (deviation from the upstream test): the matcher runs `resolve()` on the
// *path* but leaves the *pattern* verbatim, so absolute POSIX literals only line
// up on POSIX hosts — on Windows `resolve('/tmp/out/a/b.txt')` is drive-relative
// (`E:\tmp\out\a\b.txt`) and can never match the literal pattern `/tmp/out/**`.
// Both sides are therefore derived from one resolved root, keeping the upstream
// assertions (and their semantics) intact on every platform.
const outDir = resolve('/tmp/out');
const outGlob = join(outDir, '**');

describe('matchesAllowedWritePath', () => {
  it('matches nested paths under a /** glob', () => {
    expect(matchesAllowedWritePath(join(outDir, 'a', 'b.txt'), [outGlob])).toBe(true);
    expect(matchesAllowedWritePath(join(outDir, 'a.txt'), [outGlob])).toBe(true);
  });

  it('does not match a sibling directory that shares the prefix', () => {
    expect(matchesAllowedWritePath(join(resolve('/tmp/output'), 'a.txt'), [outGlob])).toBe(false);
  });

  it('expands ~ in patterns', () => {
    expect(matchesAllowedWritePath(join(homedir(), '.phaneris', 'x.json'), ['~/.phaneris/**'])).toBe(true);
  });

  it('checks every pattern and ignores invalid ones', () => {
    const siteDir = resolve('/srv/site');
    const tmpGlob = join(resolve('/tmp'), '**');
    const siteGlob = join(siteDir, '**');
    expect(matchesAllowedWritePath(join(siteDir, 'index.html'), [tmpGlob, siteGlob])).toBe(true);
    expect(matchesAllowedWritePath(join(siteDir, 'index.html'), [tmpGlob])).toBe(false);
    expect(matchesAllowedWritePath(join(siteDir, 'index.html'), [])).toBe(false);
  });
});
