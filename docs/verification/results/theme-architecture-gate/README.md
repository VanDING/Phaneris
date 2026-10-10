# Theme declaration invariant and architecture gate — evidence

Baseline commit: `61970997` (plus the two uncommitted `packaged-client-*.json` files present when the work started).
Date: 2026-10-10.

Requirements: [theme and architecture gate failure matrix](../../theme-and-architecture-gate-failure-matrix.md).
Plan: [system cleanup and optimization plan](../../../process/system-cleanup-optimization-plan-2026-10-10.md) batches A and B.

## What was wrong

`theme.test.ts` runs in `test:critical`, which `.github/workflows/validate.yml` runs at `:58` (ubuntu) and
`:118` (windows). **CI was red on `main`.** Three assertions failed:

| Assertion | Cause |
| --- | --- |
| `keeps the bundled default resource synchronized with the canonical snapshot` | `apps/electron/resources/themes/default.json` still carried the pre-0.3.1 short font stacks |
| `bundles exactly the four canonical, valid themes` | same drift, checked per built-in |
| `keeps static CSS palettes, typography and material tokens synchronized with Default` | the assertion demanded the font tokens appear in each app stylesheet's `:root`, but `0.3.1` moved them to `packages/ui/src/styles/typography.css`, which both stylesheets import |

Only the first two were a product defect. The third was an obsolete assertion: it required a second static
source for the font stacks, which is the opposite of what the `0.3.1` refactor established and of what both
stylesheets document ("Font stacks live in ./typography.css (single source of truth)"). `typography.css`
factored the Han families into `--font-cjk` and spliced them in, so `theme.ts`'s comment claiming the values
were byte-identical to that file was false as well.

## What changed

| Change | File |
| --- | --- |
| Regenerated the two drifted keys | `apps/electron/resources/themes/default.json` (`fontSans`, `fontMono`) |
| Corrected the assertion to the real invariant: fonts are owned by `typography.css` and compared in expanded `var(--font-cjk)` form; every other token is still compared against each app's own `:root`; the two `data-font` overrides are pinned in both directions | `packages/shared/src/config/__tests__/theme.test.ts` |
| Replaced the false "byte-identical" comment with the actual relationship | `packages/shared/src/config/theme.ts` |
| Put the theme invariant where contributors feel it — `test:shared:config` is on `validate:ci` and the pre-push hook, `test:critical` is not | `package.json` |
| Added the architecture gate and wired it into `lint` and `test:critical` | `scripts/check-architecture.ts`, `package.json`, `scripts/test-critical.ts` |
| Extracted the resolver both gates share | `scripts/lib/import-graph.ts`, `scripts/check-runtime-boundary.ts` |

Resource hash: `2cba0310…` → `80ed5893…` (`theme-resource.sha256`). The older `b14cf0a3…` in
`results/default-theme-application/validation.json` is that run's own point-in-time value; both historical
records are left untouched.

## Files here

| File | Contents |
| --- | --- |
| `gate-mutations.json` | 16 reversible mutations, one per failure mode, with the gate's reaction and a byte-for-byte restore check |
| `theme-test-after.log` | `bun test ./src/config/__tests__/theme.test.ts` — 16 pass, 0 fail |
| `architecture-gate.json` | Gate result: 1462 files scanned, 1011-module WebUI closure, 46 shims, inspected counts, 0 failures |
| `runtime-boundary-equivalence.json` | Proof the resolver extraction did not move the runtime gate: sha256 of its `--baseline` output, before and after |
| `theme-resource.sha256` | Hash of the regenerated resource |

## Reproduce

```sh
cd packages/shared && bun test ./src/config/__tests__/theme.test.ts
bun run lint:architecture
bun run lint:runtime-boundary
bun run scripts/verification/theme-architecture-gate-mutations.ts
bun run test:critical
bun run validate:ci
```

`bun run lint:architecture --update` rewrites `scripts/architecture-baseline.json`. That is for paying debt
down, never for making a build pass.

## Coverage limits

- The three `webui-unshimmed-node` baseline entries are real but currently harmless: WebUI's build survives
  because Vite externalises rather than fails on `node:*`/`electron`. They are recorded, not fixed — shimming
  them changes build configuration and belongs in its own change.
- The 26 `undeclared-subpath-import` entries all resolve through Bun's hoisted linker plus each consumer's
  tsconfig aliases. The gate now fails on a 27th.
- Rule 1 is keyed per module, not per specifier, so a new module importing an already-known builtin still
  fails. The first version keyed by specifier alone and silently accepted one; the mutation suite is what
  caught it.
- `apps/electron/src/renderer/playground/registry/generate-icons.ts` imports `fs`, `path` and `url` and lives
  inside the tree WebUI type-checks, but it is a standalone script that nothing imports, so it is outside the
  reachable closure and outside this gate's scope.
- Not measured: how many of the WebUI closure's 1011 modules the production bundle actually ships. The
  closure follows every resolved edge, including dynamic imports and type-only imports, which is stricter
  than Vite's eager graph.
