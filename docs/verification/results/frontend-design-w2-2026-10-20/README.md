# Frontend design wave 2 — recorded verification (2026-10-20)

Status: **accepted**. Produced by `bun run test:design-w2`; every number is read
from the rendered page.

```bash
bun run test:design-w2 --output-dir=docs/verification/results/frontend-design-w2-2026-10-20
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/frontend-design-w2-2026-10-20
```

## What this run proves

Wave 2 replaced three parallel systems with one each. All three are resolved by
the cascade, so no static gate can see them — this fixture renders the real
`Button` and `Input` under the real host stylesheet and measures the result.

| Scene | Assertion | Measured |
| --- | --- | --- |
| `DW2-type-scale-aliases-contract-tiers` | `text-meta` = 11, `text-body` = 13, `text-reading` = 14, and a leftover `text-sm` paints exactly what `text-body` paints | 11 / 13 / 14, `text-sm` = 13 |
| `DW2-control-geometry-uses-tiers` | Button, Input and icon button are the `lg` tier | 34 / 34 / 34 px |
| `DW2-icon-stroke-from-one-token` | Lucide **and** a hand-written `stroke="currentColor"` glyph both read `--icon-stroke-width` | 1.65 / 1.65 |
| `DW2-status-tokens-clear-aa` | Status chips at `bg-<role>/10` + `text-<role>-text` clear 4.5:1 after compositing; `text-on-accent` on `bg-accent` too | success **8.53:1**, info **8.35:1**, danger **8.38:1**, solid accent **7.30:1** |
| `DW2-ui-scale-110-…` / `DW2-ui-scale-125-…` | `--ui-scale` multiplies control geometry and type, and leaves the reading tier alone | 34 → **37.39** (110%) → **42.5** (125%); meta 11 → 12.1 → 13.75; reading stays **14.0001** |
| `DW2-no-page-errors` | No console or page errors | 0 (Vite's dev-server notice filtered by name) |

The reading column is deliberately excluded from `--ui-scale`: enlarging the
interface must not reflow prose, which is why `text-reading` follows
`--reading-scale` instead.

## Artifacts

| File | Contents |
| --- | --- |
| `manifest.json` | Run identity, changed-file hashes, per-artifact sha256, untested scope |
| `design-w2.json` | Seven check results plus every raw sample (font sizes, box sizes, computed colours, ratios) |
| `design-w2-scale-100.png` · `-110.png` · `-125.png` | The same probe page at each interface scale |
| `source-hashes.json` | sha256 of the stylesheets and primitives under test |
| `index.html`, `host.css` | The exact fixture entry and host stylesheet |

## Before → after

| Property | Before wave 2 | After |
| --- | --- | --- |
| Type scale | Two live systems; `text-sm` = 13.125px beside `text-body` = 13px, `text-xs` = 11.25px beside `text-meta` = 11px | One system: the adapter aliases the default scale onto the tiers, and all 832 sites were renamed (`scripts/migrate-default-type-scale.ts`) |
| Control geometry | `h-control-*` fixed px beside `h-8`/`h-9` rem heights; no way to scale the UI | `tier × --ui-scale` everywhere, exposed as Appearance → Interface scale 100/110/125% |
| Status colour | 172 raw palette classes with hand-picked light/dark twins | `info` / `success` / `destructive` / `accent` roles, zero palette hues outside the brand mark (`scripts/migrate-state-colours.ts`) |
| Icon weight | 113 numeric `strokeWidth` values (dead on Lucide, live on 7 hand-written glyphs) | One token for Lucide and for `svg[stroke="currentColor"]`; brand glyphs may author in viewBox units |
| File icons | Three hand-copied glyph sets plus the colour asset set | `FileKindIcon` for name-keyed mono glyphs, `FileTypeIcon` for colour, no hand-written paths |

## Untested here

- Non-Default palettes in a browser (covered statically by `check:contrast-floor`
  and visually by `docs/verification/visual-baselines/`).
- Persisted preference round-trip across an app restart (the value is written by
  the theme provider through the existing `setThemePreferences` RPC; the storage
  path is unit-tested in `packages/shared/src/config/__tests__`).
- Native OS materials, scenic mode, physical touch.
- The `fileIcons: color | mono` theme switch is **not** implemented; see the
  wave-2 failure matrix for the reasoning.
