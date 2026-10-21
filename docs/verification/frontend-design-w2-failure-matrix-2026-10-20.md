# Frontend design wave 2 — failure matrix (2026-10-20)

Status: **accepted**. Input: the read-only design audit in
`phaneris-frontend-design-review-2026-10-20.html` (findings 1, 2, 6; roadmap W2).
Wave 1 — focus, contrast, drift gates, motion vocabulary — is recorded in
[its own matrix](frontend-design-w1-failure-matrix-2026-10-20.md) and is not
repeated here.

The rows were written while planning the four migrations, because each is a
mechanical rewrite whose failure modes are silent.

## F1 — Type scale (832 sites, `text-xs/sm/base/lg/xl/2xl/3xl` → tiers)

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F1.1 | A rename changes the rendered size more than the 0.125px the review allowed | `theme-adapter.css` aliases the default scale onto the tiers *first*, so the rename is a pure vocabulary change | `DW2-type-scale-aliases-contract-tiers` |
| F1.2 | A leftover default-scale class (playground, next branch) lands between tiers again | The adapter stays in place as the backstop; the drift counter pins product code at zero | `check:design-drift` (`defaultFontSize: 0`) |
| F1.3 | `text-base` (15px) is dragged to 13px and shrinks form fields | `base` maps to the `reading` tier (14px); the four field/selector sites were then set to `text-body` by hand so they match their own `md:` variant | `DW2-control-geometry-uses-tiers` (Input renders at the tier height) |
| F1.4 | A `dark:` twin survived a rename and re-pins a hue | Not applicable to type; handled for colour in F3 | — |
| F1.5 | An oversized decorative glyph collapses into a tier | Two object-scale glyphs were given roles instead: `glyph-watermark` (36px) and `glyph-avatar` (48px) | Screenshot review of `PageTile` / `SidebarProfile` |
| F1.6 | Comment prose keeps asserting the retired names | The five comment references were updated; the drift counter now skips multi-line block comments so prose cannot masquerade as a class | `check:design-drift` measures 0 |

## F2 — Control geometry and `--ui-scale`

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F2.1 | Tiers stop being pixels: `h-control-md` starts scaling and every shipped layout shifts at scale 1 | `calc(tier × var(--ui-scale))` with `--ui-scale: 1` by default is identity | `DW2-control-geometry-uses-tiers`: 34px at 100% |
| F2.2 | Raising the scale reflows the reading column | `text-reading` follows `--reading-scale`, not `--ui-scale` | `DW2-ui-scale-110/125`: reading stays 14.0001px |
| F2.3 | The preference exists but nothing applies it | Theme provider writes `--ui-scale` on `:root` in the same effect that applies the palette, with `uiScale` in its dependency list | `DW2-ui-scale-*` observes the variable and the geometry |
| F2.4 | A user value outside the allowlist produces an unusable UI | `normalizeUiScale` accepts only 1 / 1.1 / 1.25 and falls back to 1; the schema rejects anything else | `normalizeUiScale` + `StrictConfigSchema` |
| F2.5 | Adding the field breaks every existing preference literal and fixture | `uiScale` is optional in `ThemePreferences`; normalization fills it in | `bun run test:shared:config` (51 pass) |
| F2.6 | The new setting ships untranslated | One key added to all seven locale files | `lint:i18n:sorted`, `lint:i18n:parity`, `lint:i18n:coverage` |
| F2.7 | Scale changes the hit target below 44px on touch | Geometry only grows; the coarse-pointer rules still apply on top | Not re-measured this wave (wave 3 owns touch targets) |

## F3 — Status colours (172 raw palette classes)

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F3.1 | A brand mark loses its identity colour | `ConnectionIcon` is exempted by path and documented; it keeps its vendor hues | `check:design-drift` (`paletteHue: 0` outside the exemption) |
| F3.2 | A `dark:` twin survives and re-pins the hue the theme owns | The codemod drops `dark:<variant>-<palette>-NNN` in the same pass | `DW2-status-tokens-clear-aa` measures the resolved colour |
| F3.3 | Text on a solid role surface becomes unreadable in one mode | The three solid sites take `text-on-accent`, and the contrast gate asserts that pair per theme | `check:contrast-floor` (`foreground on accent`) |
| F3.4 | A 10% status wash makes its own chip text fall below AA | Measurement composites the alpha stack before computing the ratio, so the chip is judged as painted | `DW2-status-tokens-clear-aa`: 8.35–8.53:1 |
| F3.5 | A `hover:`/`group-hover:` variant is skipped by the codemod's lookbehind | First pass had exactly that bug (6 sites); the lookbehind was fixed and the pass re-run until the palette count was zero | `check:design-drift` reports 0 |
| F3.6 | Non-status categorical hues are force-fitted and lose meaning | The five roles are documented in `DESIGN.md` with the palette each replaces; identity categories map to `accent`, neutrals to `muted` | Review of the migration diff (39 files) |
| F3.7 | A theme's status colours fail AA against its own canvas | The static gate now samples all four roles per built-in theme *in the mode the theme actually renders* | `check:contrast-floor` (84 pairs) |
| F3.8 | The gate samples a dark-only theme as "light" and reports a fictional failure — or worse, hides a real one | `resolveThemeMode` is used to pick the rendered mode, the same rule the runtime uses | Found and fixed while adding the accent pair |

## F4 — Icons

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F4.1 | Removing `strokeWidth` from a Lucide icon changes its weight | It cannot: a CSS declaration (`.lucide`) already beat the presentation attribute, so those 106 numbers were dead | `DW2-icon-stroke-from-one-token` (1.65 = token) |
| F4.2 | Removing it from a hand-written glyph leaves stroke 1 (SVG default) | `svg[stroke="currentColor"]` now paints `--icon-stroke-width`, scoped by attribute so Mermaid/Shiki/PDF keep their own stroke | Same scene, `-inline` probe |
| F4.3 | A brand glyph drawn in viewBox units is flattened to 1.65 | Values ≥4 are treated as viewBox units and never migrated; the counter ignores them | `McpIcon` unchanged, `strokeWidthLiteral: 0` |
| F4.4 | A second mono file-glyph implementation appears again | `FileKindIcon` is the shared one; the two hand-copied sets (12 SVGs + two extension maps) were deleted, and `DESIGN.md` names the three components and their input shape | `UserMessageBubble` and `mention-menu` contain zero `<svg>` |
| F4.5 | The new component is unreachable from the shared package | Exported through `components/icons/index.ts` and the `@phaneris/ui` barrel | `tsc --noEmit` on `packages/ui` and `apps/electron` |

## F5 — Whole-tree

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F5.1 | Class churn re-fingerprints accessibility debt | Ledger re-registered twice (46 + 97 entries), totals held at 584 | `check:visual-contracts`, `lint:workspace` |
| F5.2 | A browser-only change breaks the packaged renderer | No packaging input changed; `check:distribution` unaffected | `bun run lint` |
| F5.3 | The verification fixture stops loading after the CSS edits | Both wave workflows re-run against the final tree | `test:design-w1` (14/14), `test:design-w2` (7/7) |

## Deliberately not done in this wave

- **`fileIcons: "color" | "mono"` theme switch.** It needs a 40th theme-authoring
  field (manifest, resolver, generated docs, compiler) to express one boolean;
  the mono path already exists (`FileKindIcon`) and the colour path is
  Electron-only. Recorded here rather than half-built: a theme that wants mono
  can be added when a second theme actually asks for it.
- **Migrating every remaining rem height** (`h-7`…`h-10` outside the shared
  primitives). The settled primitives and the tier classes follow the scale;
  bespoke panel chrome does not yet, and pretending a `h-8` spacer is a hit
  target would be wrong.
- **Touch targets** — wave 3.
