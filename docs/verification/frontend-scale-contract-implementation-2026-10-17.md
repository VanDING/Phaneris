# Frontend scale & theme system implementation — 2026-10-17

Branch: `frontimprove`. This report records what the four-wave plan actually
changed, the measured deltas, and the commands that prove the contract holds.

## Wave 0 — baseline and drift control

| Artifact | Path |
| --- | --- |
| Drift measurement (report mode, safe in CI) | `scripts/measure-scale-drift.ts`, `bun run audit:scale` |
| Pre-migration baseline (from `git HEAD`) | `docs/verification/scale-drift-baseline-2026-10-17.json` |
| Frozen allowlist (contract ∪ legacy) | `scripts/scale-allowlist.snapshot.json` |
| Workbench ledger | `apps/electron/src/renderer/playground/registry/scale-drift.tsx` (+ generated data) |

Measured baseline before migration (767 files, tests and playground excluded):

| Family | Sites | Values |
| --- | --- | --- |
| Font size literals | 500 | 15 |
| Radius literals | 281 | 14 |
| Control-height literals | 123 | 31 |

## Wave 1 — constitution and enforcement

- `PRODUCT.md` — object model, plain-language terms, core flows, copy rules.
- `DESIGN.md` — machine-readable frontmatter (colors, 6 type tiers, 5 radius
  tiers, 6 control heights) plus the eight prose sections and four named rules
  (Scale-Is-Spoken, Single-Border, Quiet-Stream, Accent-Is-For-Intent).
- `.impeccable/design.json` — sidecar: tonal ramps, shadow/motion tokens,
  breakpoints, narrative, six component snippets.
- `packages/ui/src/lib/scale-contract.ts` — single source for tiers and class
  names; `visual-roles.ts` derives `--type-*-size`, `--shape-xs…xl`,
  `--control-height-*`; `roles.css` exports `text-*`, `rounded-shape-*`,
  `h-control-*`, `size-control-*`.
- `packages/ui/eslint-rules/no-arbitrary-scale.cjs` — rejects any literal outside
  contract ∪ snapshot; message names the nearest tier and the DESIGN.md anchor.
  Registered as `theme-contracts/scale`; disabled only inside the playground.
- `scripts/check-scale-contract.ts` — four-way check: DESIGN.md ↔
  `scale-contract.ts` ↔ allowlist ↔ role tokens, plus tree-vs-snapshot freshness
  (stale legacy entries fail). Wired into `lint`.
- `scripts/migrate-scale-literals.ts` — exact-tier codemod (dry run by default).

Migration batch 1 (pixel-identical by construction) and batch 2 (near-miss
convergence, 1–4px, screenshot-reviewed surfaces):

| Batch | Mapping | Sites |
| --- | --- | --- |
| 1 | `text-[10/11/12/13/14/16px]` → `text-*` tiers | 434 |
| 1 | `rounded-[2/4/6/8/12px]` (incl. directional) → `rounded-shape-*` | 228 |
| 1 | `h-[18/22/26/30px]` / `size-[18px]` → `h-control-*` / `size-control-*` | 59 |
| 2 | `8/9/10.5/11.5/12.5/13.5/15/17px` → nearest type tier | 62 |
| 2 | `1/3/5/7/9/10/14/16/20px` → nearest radius tier | 50 |
| 2 | `h-[28/40px]` → `h-control-sm/xl` | 6 |
| 2 | `text-[20px]` → new `text-display` tier | 1 |
| 3 | CSS `font-size: Npx` → `var(--type-*-size)` | 70 |
| 3 | CSS `border-radius: Npx` → `var(--shape-*)` | 60 |
| **Total** | | **970 sites** |

Final measured state:

| Family | Before | After | Remaining |
| --- | --- | --- | --- |
| Font size literals | 500 | **0** | 0 |
| Radius literals | 281 | **0** | 0 |
| Control-height literals | 123 | 57 | 19 in the control band (≤38px); 38 are layout heights (headers, titlebars, avatars) |
| CSS font-size literals | 71 | **1** | only the documented 16px iOS focus-zoom guard |
| CSS border-radius literals | 60 | **0** | all use `var(--shape-*)` |

The font contract now has seven tiers (`micro` 10 → `display` 20); the display
tier exists so the landing invitation stops being an exception. Layout heights
above 38px are intentionally outside the control contract; they describe space,
not hit targets, and remain frozen in the snapshot.

## Wave 2 — primitives

- **Menu** — `packages/ui/src/components/ui/Menu.tsx`: declarative `MenuEntry[]`
  (item/separator/label/submenu, checked, shortcut, danger, disabled) over the
  shared StyledDropdown primitives. `MenuEntries` in the renderer renders the
  same model through the dropdown/context-menu context. Migrated content menus:
  `SourceMenu`, `SkillMenu`, `PluginMenu`, `SidebarMenu`; `TaskActionMenu` uses
  the `Menu` shell. `SessionMenu` remains a content adapter because its submenus
  are stateful components (`StatusMenuItems`, `LabelMenuItems`, `ShareMenuItems`)
  that must keep their hooks/atoms; it already renders through the same shared
  primitives. `EditPopover` is an inline agent-execution surface (chat, drag,
  resize, permissions), not a field editor, so the planned FieldRow/ValueEditor
  split does not apply; it consumes the shared composer instead.
- **State** — `packages/ui/src/components/state/StateSurface.tsx` (`empty`,
  `loading`, `error`, `partial`, `denied`; `role=status/alert`), `EmptyState`,
  `ErrorState`, and `ErrorBanner` (tone error/warning/info, wrapped diagnostics,
  action slot). `PanelEmptyState` wraps `EmptyState`; the sources, skills,
  automations and session empty states all route through it. `TransportConnectionBanner`
  and `OverlayErrorBanner` render `ErrorBanner`. `BrowserEmptyStateCard` remains a
  content-specific card (prompt list + safety footer) composed from the same
  tokens; the matrix documents it as such. Matrix:
  `docs/verification/state-matrix.md`.
- **Roving focus** — `packages/ui/src/lib/roving-focus.ts`:
  `resolveRovingIndex` + `useRovingFocus` (arrows, Home/End, PageUp/Down, loop,
  RTL, typeahead, Tab release). The renderer's `useRovingTabIndex` now delegates
  its navigation math to the shared rule, so the item-based and id-based APIs
  cannot drift.
- **Shapes** — contract tiers plus role shapes (`--shape-bubble: 16px`,
  `--shape-composer: theme-radius × 1.5`). `UserMessageBubble` → `rounded-bubble`;
  standalone `FreeFormInput` → `rounded-composer`; `InputContainer` keeps the
  theme-derived `rounded-xl` (same 9px).
- **Control heights** — Button gains `xs` (22px) and `compact` (26px) tiers;
  existing sizes keep their heights.

## Wave 3 — optics and physics

- **Scroll fade** — 7-stop non-linear 28px mask with `@property` length
  interpolation and `animation-timeline: scroll(self)`; edges zero themselves at
  rest. Added the missing `mask-fade-top-short` (was referenced but undefined).
- **Hairline** — `--edge-hairline` halves at 2dppx and thirds at 3dppx; every
  generated shadow ring now consumes it instead of `--theme-border-width`.
- **Composer** — resting/hover/focus-within three-state shadow, accent drag glow
  (`composer-drag-glow`), standalone focus ring (`composer-standalone`).
- **Focus** — controls use the triple ring (1px surface spacer + 1.5px accent +
  glow) with a forced-colors fallback; dark popovers gain the inset 1px chamfer
  highlight.
- **Detector cleanup** — removed the calendar chip's 3px left color strip (single
  closed border remains), replaced the session-row `width/margin` transition
  with opacity only, and converted the RTK progress bar from `width` to
  `transform: scaleX()` so progress no longer animates layout.
- **Single-border audit** — three nested closed borders were downgraded: selected
  composer chips now use a fill, the task-tile edit action is ghost, and the
  composer error card is a tinted fill. No new nested border was introduced.
- **Composer container ladder** — the composer surface is a query container;
  `<480px` drops badge labels and tightens gaps, `<384px` drops the model label,
  `<320px` hides the source badge. Labels remain in `aria-label`/tooltips.
- **Dark surfaces** — `DEFAULT_THEME.dark` re-stepped in the blue-graphite family
  (`#17191E → #191C21 → #1C1F26 → #20242B → #22262E → #262A32 → #2A2F38`).
- **Typography** — dark Inter weight compensation via `font-weight`
  (360/460/550/660, only under `data-font="inter"`); `text-wrap: balance` for
  headings and `pretty` for prose; `.align-icon` utility; `tabular-nums` on the
  context/token counters.
- **Motion** — durations `snap 120 / sheet 300 / slow 450`; eases
  `overshoot / pop / expand`; springs `snappy / gentle / bouncy / heavySnap`;
  keyframes `message-enter`, `bubble-enter`, `thinking-dot`, `check-decay`,
  `skeleton-sweep`; both reduced-motion blocks collapse the new durations.
  Applied: bubble entrance, copy check decay with timer cleanup.
- **Interaction guards** — IME `isComposing || keyCode 229` plus the WebKit 500ms
  post-composition latch (`isImeSubmitBlocked`, wired into all three send paths);
  scroll pinning constants named (20px stick threshold, 250ms cooldown — stricter
  than the 150ms reference); sash 4px dead zone + `body[data-pane-dragging]`
  iframe pointer shield.

## Enforcement wiring

`lint` now runs `check:scale-contract` and the report-only `audit:scale` in
addition to `check:themes` and `check:visual-contracts`. The visual-debt ledger
was pruned and re-registered through the reviewed `--register` mode: 675 entries,
0 new debt.

## Verification evidence

| Check | Result |
| --- | --- |
| `bun run check:scale-contract` | pass |
| `bun run check:themes` | pass |
| `bun run check:visual-contracts` | pass (675 legacy findings, no new debt) |
| `cd apps/electron && bun run typecheck` | pass |
| `cd packages/ui && bun run tsc --noEmit` | pass |
| `bun run lint:ui` / `bun run lint:electron` | 0 errors |
| Playground render | `text-body` = 13px, `h-control-md` = 30px, `rounded-shape-lg` = 8px; Scale Drift page shows 3 tables / 51 rows; dark mode switches correctly |
| Real Electron app (built) | `text-body` 13px, `h-control-md` 30px, `rounded-shape-lg` 8px, `--shape-bubble` 16px; user bubble renders 16px; composer renders 9px |
| Composer focus (real app) | Heights before/after focus both **137.75px** (no reflow); shadow changes from `4px 20px + inset 1px border` to `inset 1px ring + 1.5px ring + 6px glow` |
| Dark composer shadow | `inset 0 0 0 1px rgba(255,255,255,0.1)`, 1.5px ring, 35% accent glow |
| 7-stop mask (computed) | 28px fade with alpha `0.05 / 0.15 / 0.30 / 0.50 / 0.70 / 0.85 / 1` at `4.2 / 8.4 / 12.6 / 16.8 / 21 / 24.36 / 28px` |
| `theme-contract` workflow | TC01–TC18 all pass: 4 hosts × 4 themes × light/dark; schema/radius/alpha/cycle/shiki/scenic/overlay cases |
| Scale gate rejects new values | `text-[18px]` → nearest `text-title`; `rounded-[11px]` → nearest `rounded-shape-xl`; `h-[23px]` → nearest `h-control-xs`; all three are `theme-contracts/scale` errors |
| Derived theme values | TC03-valid-0 accepts `color-mix(in oklab, …)` background and `calc()` radius through `compileThemeInBrowser` (no compiler change needed; it validates via `CSS.supports` + computed style) |
| Composer container ladder (real app) | 700/520px: all labels; 460px (container 438): badge labels hidden; 380px (358): model label hidden; 330px (308): source badge hidden; `container-type: inline-size` active |
| Density matrix (real app) | 3 densities × light/dark captured; session row height 38 / 42 / 46px for compact / comfortable / cozy, identical in both modes (density changes padding, not type or control height) |
| Packaged Windows client | `apps/electron/release/Phaneris-0.3.2-win-x64.exe` (184.8 MiB, SHA256 `b29a7fe8…c278bf`); packaged launch loaded the workspace, opened at the restored default **1600×1000**, and rendered `text-body` 13px / `h-control-md` 30px / `rounded-shape-lg` 8px |
| CSS contract | CSS font-size literals 71 → 1 (iOS 16px guard); CSS radius literals 60 → 0; enforced by `check:scale-contract` |
| Visual debt ledger | 589 entries after retirement (was 1,195 at branch start), no new debt |
| Theme browser workflows | `test:theme-contract` executed (see `docs/verification/results/` artifacts) |

Screenshots: `docs/verification/results/scale-contract-2026-10-17/`
(`app-session-light.png`, `app-composer-focused.png`, `app-session-dark.png`,
`app-composer-narrow-380.png`, plus `density-{light,dark}-{compact,comfortable,cozy}.png` and
`packaged-client-light.png`).

## Explicitly assessed deviations

1. **`SessionMenu`** keeps its JSX content adapter: its submenus are stateful
   components with hooks/atoms (`StatusMenuItems`, `LabelMenuItems`,
   `ShareMenuItems`), so a data-only `MenuEntry[]` conversion would drop
   behavior. It already shares the shell, styling, keyboard and z-index.
2. **`EditPopover`** is an inline execution surface (streamed chat, drag/resize,
   permission cards), not a field editor; the FieldRow/ValueEditor split would
   be a redesign, not a mechanical convergence.
3. **`BrowserEmptyStateCard`** is a content-specific card (prompt list, safety
   footer); it composes the same tokens rather than a second generic primitive.

## Verification limits

- Density × light/dark screenshots are captured for the three product densities
  (`compact`, `comfortable`, `cozy`); the plan's "four densities" referred to
  the reference system, while this product defines three.
- WebKit IME timing, workbench sash drag and streamed-scroll latching are
  implemented but need a WebKit device, an open workbench surface and a live
  streaming turn respectively; they remain the manual release checks. The
  failure matrix records them as such rather than claiming coverage.
