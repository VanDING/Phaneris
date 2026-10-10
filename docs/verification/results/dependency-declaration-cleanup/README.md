# Dependency and declaration cleanup — evidence

Baseline commit: `61970997` (with batches A and B uncommitted on top).
Date: 2026-10-10.

Requirements: [dependency and declaration cleanup failure matrix](../../dependency-declaration-cleanup-failure-matrix.md).
Plan: [system cleanup and optimization plan](../../../process/system-cleanup-optimization-plan-2026-10-10.md) batch C.

## What changed

| Change | Files |
| --- | --- |
| Removed 16 declarations the audit listed as zero-reference | `package.json`, `packages/shared`, `packages/pi-agent-server`, `packages/session-tools-core` |
| Replaced `incr-regex-package` with a local expectation matcher before removing it | `packages/shared/src/agent/mode-manager.ts`, `mode-types.ts`, deleted `packages/shared/src/types/incr-regex-package.d.ts` |
| Declared two internal edges that existed in source only | `packages/server-core` (`@phaneris/session-tools-core`), `apps/viewer` (`@phaneris/shared`) |
| Moved `vite` from `dependencies` to `devDependencies` | `apps/webui` |
| Aligned the exact-pin drift | `packages/server` (`ws`), `apps/viewer` (`react-markdown`, `tailwind-merge`) |
| Converted three unrunnable `vitest` tests to `bun:test` | `packages/ui` annotations / overlay tests |
| Declared 26 cross-package subpaths in `exports` | `packages/shared/package.json` (74 → 100 entries) |
| Shrank the architecture baseline: rule 2 from 26 to 0 | `scripts/architecture-baseline.json` |

**Two candidates were deliberately retained**, because the audit misclassified them as plain
zero-reference declarations: `temporal-polyfill` and `@tiptap/extension-text-style` are required
*peer providers*. Reasons and evidence are in `declarations.json`. Similarly, `packages/ui`'s `>=`
peer ranges were left alone: `packages/ui` is publishable, so narrowing a peer range is a contract
change rather than alignment.

## Files here

| File | Contents |
| --- | --- |
| `declarations.json` | The 16 removed and 2 retained declarations, with the reason for each retention |
| `lock-and-bundle.json` | Lock entry counts and the before/after bundle report |
| `mode-manager-after.log` | `bun test tests/mode-manager.test.ts` — 433 pass, 0 fail, after removing the library |
| `critical.log` | Full `test:critical` run, exit 0 |
| `README.md` | This file |

## Reproduce

```sh
bun install --frozen-lockfile
(cd packages/shared && bun test tests/mode-manager.test.ts)
bun run lint:architecture
bun run lint
bun run typecheck:all
bun run electron:build:renderer && bun run bundle:report
bun run test:critical
```

## The `incr-regex-package` replacement

The library was used only by `analyzePatternMismatch`, and `DONE` / `MORE` / `FAILED` were imported
but never used. It implemented character-by-character incremental regex matching to report where a
command diverged from the closest read-only pattern. It also pulled a 47-node chain behind it
(`eslint_d` → ESLint 7).

The replacement reads each pattern's **stated expectations** — leading literal, whether whitespace
follows, and the alternatives it accepts — and walks the command against them
(`readPatternExpectation` / `matchExpectation`). That is a token-level comparison, not an NFA
simulation; the read-only patterns are all written as `literal command [\s+ (a|b|c)]`, which is the
shape it reads. A pattern it cannot reduce is skipped, which costs a less specific message and can
never produce a wrong one.

The behaviour contract is pinned by existing tests and unchanged: `git -C /path status` still yields
`matchedPrefix` starting `git` with `failedToken === '-C'` and a suggestion containing `flag`;
`git push origin` still fails at `push`; `unknowncmd arg` still produces no analysis.

## Coverage limits

- **The lock's orphaned package entries were not pruned** (2066 → 2066). Pruning happens during a
  real resolve, and resolution cannot complete in this environment: the root `overrides.xlsx` points
  at `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, which measured 6–17 KB/s here (8 s for
  49 KB of 2.4 MB), so `bun install` stalls indefinitely on that fetch. `bun install --frozen-lockfile`
  completes in 0.5 s because it skips resolution entirely, which is how the lock was validated. The
  audit's estimated 101-node reduction is therefore **not realised yet**; a plain `bun install` with
  normal access to that CDN will prune the orphans. CI runs `--frozen-lockfile`, so it will not.
- **`@rollup/rollup-win32-arm64-msvc` was never installed before this change either**, so removing
  its declaration cannot be verified by a local build; the audit handed this one back as an open
  decision and this batch removes the declaration only.
- **The hiding experiment is not valid for transitive dependencies.** Moving `postcss` out of
  `node_modules` breaks the renderer build, but that is an artefact: `vite@8.3.2` declares
  `postcss: ^8.5.28` and the lock keeps `postcss@8.5.28`, so a real install always provides it. The
  experiment is valid for the *directly imported* packages, which is where it was used.
- Not exercised: a Windows or Linux install, and the packaged client.
- `validate:ci` now passes in full, including `test:doc-tools`, once the file sandbox stopped
  blocking `uv`'s cache directory.
