---
name: Phaneris
description: Local-first agent workspace with a cool-neutral, ink-on-paper identity.
colors:
  background: "#FFFFFF"
  background-elevated: "#FFFFFF"
  foreground: "#20232C"
  foreground-dimmed: "#606775"
  card: "#FFFFFF"
  secondary: "#F2F3F8"
  muted: "#F7F8FB"
  border: "#E5E5E6"
  user-message-bubble: "#F3F3F3"
  accent-violet: "#7851A9"
  accent-violet-dark: "#A577E2"
  info-amber: "#94601C"
  success-green: "#267454"
  danger-red: "#B63E4C"
typography:
  micro: { fontSize: "10px", lineHeight: "1.4" }
  meta: { fontSize: "11px", lineHeight: "1.45" }
  label: { fontSize: "12px", lineHeight: "1.5" }
  body: { fontSize: "13px", lineHeight: "1.5" }
  reading: { fontSize: "14px", lineHeight: "1.7" }
  title: { fontSize: "16px", lineHeight: "1.45" }
  display: { fontSize: "20px", lineHeight: "1.3" }
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
components:
  control-2xs: { height: "18px" }
  control-xs: { height: "22px" }
  control-sm: { height: "26px" }
  control-md: { height: "30px" }
  control-lg: { height: "34px" }
  control-xl: { height: "38px" }
---

# Phaneris Design System

This file is the design constitution. The YAML frontmatter is machine-readable
and validated by `bun run check:scale-contract`; the prose is binding for review.
Values in the frontmatter are the single source for scale tiers. The palette is a
snapshot of `DEFAULT_THEME` in `packages/shared/src/config/theme.ts`; changing a
color requires changing that file (the theme engine owns runtime values).

## Overview

Phaneris is an operator's console: a cool, quiet workspace where agent sessions,
files and tools share one continuous surface. The visual language is ink on
paper, not chrome on glass. Three characteristics define it:

- **Cool neutrality.** Backgrounds are white or blue-graphite; the only
  saturated color is the violet accent, reserved for focus and selection.
- **Micro-contrast over borders.** Space, surface luminance and a single hairline
  separate things. Boxes inside boxes are the exception, not the default.
- **Physical restraint.** Motion describes causality (what changed and where it
  went), never decoration. Radii stay small; the interface reads as a tool, not
  a toy.

## Colors

Roles, not hues:

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#FFFFFF` | `#17191E` | App ground |
| Raised | `#FFFFFF` | `#1C1F26` | Cards, panels |
| Sunken | `#F7F8FB` | `#222630` | Wells, toolbars, inactive rows |
| Ink | `#20232C` | `#EEF0F6` | Primary text |
| Dimmed ink | `#606775` | `#AAB1C1` | Secondary text |
| Border | `#E5E5E6` | `#343946` | Hairlines and control outlines |
| Accent | `#7851A9` | `oklch(0.660 0.160 302.3)` | Focus, selection, active state |
| User bubble | `#F3F3F3` | `#2B2B2B` | User message surface (neutral, not accent) |

Rules:

- `The Accent-Is-For-Intent Rule` — the accent marks focus, selection and the
  active control. It never fills large surfaces or decorates text.
- Status colors (`info`, `success`, `destructive`) are semantic; each has a
  `*-text` variant mixed 50% toward the foreground for AA text contrast.
- Never introduce a new hex in a component. Author it in the theme engine
  (`DEFAULT_THEME` or a theme file) so every host and mode receives it.
- **One accent hue, two mode values.** Light ships the brand value verbatim
  (`#7851A9`); dark ships the same hue lifted to `oklch(0.660 0.160 302.3)`.
  The literal value cannot serve dark: on `#17191E` the focus ring measures
  2.97:1 (floor 3) and black `--on-accent` text 3.55:1 (floor 4.5).
  `check:contrast-floor` is the authority — never paste the light hex into the
  dark override.

### Status and state colours

The product's status language is the four semantic roles plus the neutral ink.
There is no fifth hue: a state either means "waiting / in flight", "good",
"broken" or "identity", and those are `info`, `success`, `destructive` and
`accent`. The 2026-10-20 review found 172 raw palette classes in their place —
`text-amber-600 dark:text-amber-300` next to `text-emerald-600 dark:…` — each
pair hand-picked per mode, which is why Ink and Cyberpunk 2077 could not govern
state at all. They now resolve through the theme.

| Meaning | Surface / icon | Text | Was |
| --- | --- | --- | --- |
| Pending, running, needs review | `bg-info/10`, `border-info/30` | `text-info-text` | `amber-*`, `orange-*`, `yellow-*` |
| Done, accepted, added | `bg-success/10`, `border-success/30`, `bg-success` | `text-success-text` | `emerald-*`, `green-*`, `teal-*`, `lime-*` |
| Failed, blocked, removed | `bg-destructive/10`, `border-destructive/30`, `bg-destructive` | `text-destructive-text` | `red-*`, `rose-*` |
| Identity: author, source, "informational" | `bg-accent/10`, `bg-accent` | `text-accent-text` | `sky-*`, `blue-*`, `cyan-*`, `indigo-*`, `violet-*`, `purple-*` |
| Neutral, injected, skipped | `bg-muted` | `text-text-secondary` | `slate-*`, `gray-*`, `zinc-*`, `stone-*` |

Rules:

- **Never write a raw palette class** (`bg-amber-500`, `text-emerald-600`) and
  never pair a `dark:` twin with one: the role already resolves per mode.
  `check:design-drift` counts them; the only exemption is a brand mark
  (`ConnectionIcon`), because a vendor logo owns its colour.
- A solid role surface takes `text-on-accent`, never `text-white`: the token
  flips with the mode, and the contrast gate asserts it per theme.
- Text on a role *surface* uses the `*-text` mix; the raw role is only for
  borders, fills and icons.

## Typography

Families: Inter Variable (UI), JetBrains Mono (code), Noto Sans SC (CJK), with
system fallbacks. All faces are bundled; no CDN. The root is 15px
(`--font-size-base`), so `1rem = 15px`.

| Tier | Size | Line height | Class | Typical use |
| --- | --- | --- | --- | --- |
| micro | 10px | 1.4 | `text-micro` | Timestamps, badges, keycaps |
| meta | 11px | 1.45 | `text-meta` | Counts, tertiary labels |
| label | 12px | 1.5 | `text-label` | Buttons, menu items, tabs |
| body | 13px | 1.5 | `text-body` | Conversation text, settings |
| reading | 14px | 1.7 | `text-reading` | Markdown prose, documents |
| title | 16px | 1.45 | `text-title` | Panel titles, dialogs |
| display | 20px | 1.3 | `text-display` | Landing and empty-state invitations (one per view) |

Rules:

- `The Scale-Is-Spoken Rule` — any font size, control height or radius comes
  from the contract tiers (or a semantic role token). Adding a value starts in
  this file and `scale-contract.ts`, never in a component.
- Weights stay explicit at the call site. A size tier never implies weight.
- Counters, timers, token totals and diff line numbers use `tabular-nums`.
- Body copy uses `text-wrap: pretty`; headings use `text-wrap: balance`.
- Inline icons align optically with `vertical-align: -0.125em` at body sizes.
- Tailwind's own type scale (`text-xs`, `text-sm`, `text-base`, `text-lg`, …) is
  **not** part of this contract. It resolves in rem, so it lands between tiers
  (11.25 / 13.125 / 16.875px at a 15px root). The 832 historical sites were
  renamed to tiers by `scripts/migrate-default-type-scale.ts`, and
  `theme-adapter.css` now aliases the scale onto the tiers, so a leftover — in
  the playground or a future branch — still renders on-contract instead of
  0.125px off it. `check:design-drift` holds the count at zero.
- Two object-scale glyph roles exist for text that is *sized by the object it
  sits in*, not by the reading hierarchy: `glyph-watermark` (36px monogram
  watermark) and `glyph-avatar` (48px avatar initials). They are deliberately
  outside `--ui-scale`; do not add a third without a real object behind it.

## Contrast

Text and informative graphics have floors, not preferences. Both are WCAG 2.1
values and both are enforced by `bun run check:contrast-floor` against every
built-in palette (Default, Geek, Cyberpunk 2077, Ink) in every supported mode:

| Content | Floor | Applies to |
| --- | --- | --- |
| Text | **4.5:1** | Body copy, labels, hints, placeholders, timestamps, counts |
| Large text (≥18.66px, or ≥14px bold) | 3:1 | `text-title` / `text-display` only |
| Non-text graphics | **3:1** | Focus rings, icons that carry state, control boundaries |
| Disabled controls | exempt | WCAG 1.4.3 exemption — use `--text-disabled`, nothing else |

Rules:

- **Two text tones.** Hierarchy is `--text-primary` (ink) then
  `--text-secondary` (dimmed ink, the AA-safe token; `--text-tertiary` resolves
  to the same value on purpose). Below that there is no legible third tone:
  measured across the shipped palettes, a third step between 4.5:1 and the
  secondary tone is under 0.5:1 apart and therefore invisible. Express the
  faintest tier with **size and weight** (`text-micro` / `text-meta`), never by
  lowering contrast.
- **Alpha text is not a tone.** `text-foreground/40` composites against whatever
  is behind it: on the Default canvas that is 2.40:1, and `/60` is still only
  4.24:1. Never put an opacity modifier on a text colour. `check:design-drift`
  counts the survivors; the count may only fall.
- **States stay distinguishable.** A toggle or selected row must not encode its
  state as two dim tones — after the AA floor they read as identical. Use
  `text-foreground` for the active state and `--text-secondary` for the
  inactive one (see `CompactModelSelector`'s vision toggle).
- **Status text uses the `*-text` variant.** `--info-text`, `--success-text`,
  `--destructive-text` and `--accent-text` are the raw status colour mixed 50%
  toward the foreground, which is what clears 4.5:1. Never dim a status colour.
- **Scenic mode is the author's risk, with a checklist.** When `--background`
  is a background image, contrast depends on the picture and no gate here can
  measure it. A scenic theme ships nothing unless it answers all four:
  1. **Panel opacity floor.** Every text-bearing surface is at least 55% opaque
     over the image; `--popover-solid` stays 100%.
  2. **Protective gradient.** A text column sits on a scrim — the dark scenic
     has a 40% black gradient, and a light scenic needs an equivalent wash. No
     scrim, no scenic theme.
  3. **Blur budget.** `backdrop-filter` is for floating panels only (never a
     repeating row — see Perceived performance), and `glassBlur` above 24px
     is a performance decision, not a taste one.
  4. **Picture audit.** At least three of the shipped images, measured where the
     text actually lands: body text ≥4.5:1 and secondary text ≥4.5:1.

## Interaction States

Every interactive element must answer the same six questions. Missing answers
are the most common defect in review, because a default that is invisible looks
like a design choice.

| State | Default answer | Notes |
| --- | --- | --- |
| Hover | `bg-foreground/5` on ghost controls; never a colour change alone | Pointer devices only |
| Active / pressed | `bg-foreground/10`, plus `--motion-scale-pressed` where motion is welcome | |
| Focus | 2px accent ring at 2px offset, or the `craft-*` three-layer ring | **Keyboard only** — `:focus-visible`, never `:focus` |
| Selected | `--action-selected` surface plus primary text; the accent is allowed here | Accent-Is-For-Intent |
| Disabled | `--text-disabled` text, `disabled:opacity-*`, `pointer-events-none` | WCAG exempts it; never fake it with a dim tone |
| Invalid | `--destructive` ring or border, `aria-invalid="true"` | Paired with a message, never colour alone |

Rules:

- `The Focus-Is-Never-Optional Rule` — a focusable element must show focus. An
  `outline-none` / `focus-visible:ring-0` is only legal when the same element or
  its declared shell supplies the ring. `focus-visible:ring-0` also cancels the
  `craft-control` ring, so pairing the two is a silent regression.
- **Composite fields own the ring on the shell.** An icon + input + trailing
  action inside one frame uses `.craft-field-shell`; the shell draws the ring and
  the inner control drops its own. A ring on the inner input sits inside the
  padding and reads as a stray rectangle.
- **Focus on open is declared, never inherited.** utoFocus cannot tell a
  dialog the user just opened from a page that just loaded, which is why the
  rule exists. A surface that takes focus does it through
  `useInitialFocus()` (`@phaneris/ui`): a stable callback ref that focuses on
  the next frame, so it wins its race with a Radix focus scope deterministically
  instead of stealing focus at mount. Policy: a surface the user opened may take
  focus and returns it to the trigger on close; nothing on initial load takes
  focus; a list field opts in with `useInitialFocus(index === 0)`.
- **Background brightening is never the only cue.** `bg-muted/50` →
  `bg-background` is 1.01:1.
- **Separators are focusable too.** A keyboard-resizable divider colours its own
  1px line with the accent on `:focus-visible`; a ring is unusable at that width.
- **Touch targets.** Under `pointer: coarse` every `craft-control`,
  `craft-icon-button` and `craft-row-actions` reaches 44×44px, and row actions
  stay visible instead of revealing on hover.

## Icons

- Stroke weight has exactly one source: `--icon-stroke-width` (1.65 Default,
  theme-adjustable — Ink uses 1.4). Three rules carry it:
  `.lucide` for Lucide, `svg[stroke="currentColor"]` for hand-written product
  glyphs, and nothing at all for injected third-party SVG (Mermaid, Shiki, PDF),
  which brings its own stroke intent.
- Never write a numeric `strokeWidth` under 4 on a component or an `<svg>`. On a
  Lucide icon it was already dead — a CSS declaration beats the presentation
  attribute, so `strokeWidth={2}` on a 1.65 theme painted 1.65. On a hand-written
  glyph it was live and wrong. All 113 were removed; `check:design-drift` holds
  the count at zero, and it also counts a number hidden in an expression
  (`strokeWidth={active ? 2.2 : 1.8}`) — a ternary is not an exemption, it is the
  same second vocabulary with worse visibility. A value ≥4 is a brand glyph
  authored in viewBox units (the MCP mark is 12 in a 150×170 box) and is left
  alone.
- Exceptions, all deliberate: the loading spinner ring (1.75–2),
  `EmptyMedia variant="icon"` (1.5) and the composer's `thinking-blocks`. These
  are *loading* and *illustration* semantics, not icon semantics.
- File identity has one component per input shape, and no hand-written SVG paths:
  `FileTypeIcon` (Electron, colour assets, keyed by name) for file trees and
  attachment cards, `FileKindIcon` (`@phaneris/ui`, three mono kinds) for inline
  badges and menus, and `attachment-helpers.FileTypeIcon` (keyed by MIME type)
  for attachment chips. Adding a fourth is the defect the 2026-10-20 review
  found three times over.
- An icon that carries state also carries `aria-label` and a tooltip; an icon
  that decorates adjacent text is `aria-hidden`.

## Tooltips

- Interactive affordances — icon buttons, menu triggers, toolbar actions — use
  the shared `Tooltip` primitive. It is themable, keyboard-reachable, dismissible
  with Esc, and works on touch after a long press.
- The native `title` attribute is **only** for `text-overflow: ellipsis`
  fallback: when a filename, path or label is truncated and the full string has
  nowhere else to go.
- A `title` on a button is a defect: it appears after ~1s, cannot be styled,
  never appears on touch, and is unreliable for assistive technology.
  `check:design-drift` counts the 91 historical sites.
- `aria-label` is independent of both. A tooltip is not a name.

## Layout

- Shell topology is content-driven, not percentage-driven: the navigator panel is
  resizable, the primary surface takes the remaining width, and beside an open
  workbench the primary keeps a **fixed basis** (600px by default, dragged through
  the sash) with a **380px** reading floor while the workbench takes everything
  left, floored at 360px. The primary must not `flex-grow`: sharing the free space
  makes the rendered boundary disagree with the sash value *and* makes the opening
  animation start from half the row and shrink into place. The workbench carries
  no `max-width` for the same reason — the drag's ceiling is measured from the row
  (`rowWidth − 360`), not baked into the layout. There is no `defaultLayout` array
  — the old `[20, 32, 48]` prop was passed and never read.
- Chat reading column is `--reading-width: 840px` with `--reading-gutter`.
- Panel-relative responsiveness uses container queries, not viewport queries:
  `@panel-compact` (448px), `@panel-medium` (640px), `@mobile` (768px).
- Spacing follows a 4px rhythm (`spacing.1–6`).
- Control heights are contract tiers `18/22/26/30/34/38px`. Heights above the
  control band describe layout space, not hit targets, and are not tiered.
- One `h1` per screen: the primary surface title. Navigator, workbench and
  artifact sub-panel headers are `h2` (`PanelHeader headingLevel={2}`), and the
  panel title is `text-title` (16px), not body size.

### One scaling model

There used to be two: contract tiers painted fixed pixels while Tailwind's rem
heights (`h-8`, `h-9`) followed the root font size, so a theme with a 18px root
grew half the toolbar and left the other half alone.

Now every control dimension is `tier × --ui-scale`:

- `.h-control-*` and `.size-control-*` are `calc(var(--control-height-*) *
  var(--ui-scale))`; `craft-control`'s min-height points at the same tiers
  instead of a hard-coded `2.25rem`.
- The settled primitives consume tiers directly — Button (`h-control-lg` /
  `-md` / `-xl` by size), Input, Select trigger, Command input, header icon
  buttons (`size-control-sm`). At `--ui-scale: 1` that is 33.75→34px, i.e. the
  sub-pixel change the review allowed.
- `--ui-scale` is a user preference (`ThemePreferences.uiScale`), surfaced in
  Appearance as **Interface scale 100 / 110 / 125%**, applied by the theme
  provider on `:root`.
- Type tiers multiply by the same variable, so text and controls grow together.
  The reading column does **not**: `text-reading` and `--reading-width` follow
  `--reading-scale`, because enlarging the interface must not reflow prose.
- A style written with a bare rem height (`h-8`) still resolves, but it is not
  part of the model and will not follow the preference. New controls use a tier.

## Elevation & Depth

Four shadow steps: `shadow-minimal` (resting panel), `shadow-middle` (hover /
raised), `shadow-strong` (modal), `shadow-modal-small` (popover). Every step is a
border ring plus a soft blur composite, so elevation reads as light rather than a
black drop. Dark mode uses `depth=flat`: borders carry the separation.

Rules:

- `The Single-Border Rule` — along any sight line into a surface, at most one
  closed border. Controls inside a bordered container drop to ghost/filled.
- Use `box-shadow` rings instead of CSS `border` when a state toggles the
  outline: borders participate in layout and cause 1px reflow.
- Focus uses the accent ring with a 1px surface spacer; never the OS default.

## Shapes

| Tier | Value | Class |
| --- | --- | --- |
| xs | 2px | `rounded-shape-xs` |
| sm | 4px | `rounded-shape-sm` |
| md | 6px | `rounded-shape-md` |
| lg | 8px | `rounded-shape-lg` |
| xl | 12px | `rounded-shape-xl` |

Role shapes derive from the theme radius: `--shape-card` (×1.333),
`--shape-control` (×0.75), `--shape-chip`, `--shape-panel`, plus
`--shape-bubble` (16px, neutral message object) and `--shape-composer`
(theme radius ×1.5). Changing `--theme-radius` must move every role shape.

**Two axes, one letter apart.** `rounded-md` and `rounded-shape-md` are not the
same tier. Read the prefix: `rounded-{sm,md,lg,…}` is *theme-derived*, and
`rounded-shape-*` is a *fixed contract tier*. At the default 6px radius the
same-looking names differ by 1.5–3px, which is exactly enough to make a silent
visual change look like a refactor.

| Utility family | Source | Example | Renames with the theme? |
| --- | --- | --- | --- |
| `rounded-{sm,md,lg,xl,2xl,3xl,4xl}` | `--theme-radius` × {0.5, 0.75, 1, 1.5, 2, 3, 4} | `rounded-md` = 4.5px | Yes |
| `rounded-{panel,inner,card,control,chip}` | role shapes above | `rounded-card` | Yes |
| `rounded-shape-{xs,sm,md,lg,xl}` | fixed contract tiers | `rounded-shape-md` = 6px | No |
| `rounded-{bubble,composer,round}` | fixed role shapes | `rounded-bubble` = 16px | No |

The same dual axis exists for type: `text-{micro…display}` are contract tiers,
`text-{xs,sm,base,lg,…}` are Tailwind rem defaults that are **not** in the
contract. When in doubt, grep for the prefix: `text-` + a tier name is the
contract, `text-` + a Tailwind scale word is drift.

## Components

- **Buttons** — existing size variants keep their heights; new compact controls
  use `h-control-2xs/xs/sm`. Inner toolbar buttons are ghost: transparent at
  rest, foreground/5 hover, foreground/10 pressed.
- **Tabs** — one primitive, `SegmentedTabs`: selection follows focus, the strip
  keeps a single `tabIndex=0`, Arrow/Home/End work. Appearance is a prop
  (`underline` for panel views, `segment` for filters); never hand-roll a
  `role="tablist"`. A tab is not a button, so `.craft-segment` owns its contract
  height and focus ring and does **not** inherit `craft-control`'s min-height.
- **Board columns** — progress, not decoration: neutral until started, `info`
  while active, `success` when done; identity is a 2px dot/bar, never a filled
  header or a whole-column tint. A finished column above a screenful starts
  collapsed with an explicit toggle that keeps the count. An empty column states
  that it is empty and offers the new-task action.
- **List rows** — one identity channel (a 2px project stripe) and one state
  channel (the status icon). Never paint a project colour as text; group headers
  always report their count.
- **Composer** — role shape `rounded-composer`, resting/hover/focus-within
  shadow states; focus adds the accent ring. Drop targets get an inset accent
  glow, not a border.
- **User bubble** — `rounded-bubble`, neutral grey, no border; reading tier.
- **Thinking / activity rows** — no closed border; disclosure uses a grid
  `0fr → 1fr` transition.
- **Code blocks** — one closed border, `rounded-shape-lg`, mono at `code` size,
  horizontal scroll with edge fade.
- **Dialogs / popovers** — `rounded-shape-xl`, modal shadow, focus trap; the
  scroll container fades at the top and bottom.
- **Composite fields** — `.craft-field-shell` around icon + input + action; the
  shell owns the focus ring and the inner control drops its own.
- **Toasts** — Sonner, themed; never a bespoke banner for a transient result.
- **Panel chrome** — one chrome row per panel, ≤75px from the panel top to its
  content. Filters share the view-tab row; a second bar has to earn its height.

## Rules and their gates

Every rule above that can be checked mechanically is checked. This table is the
map: if a rule is not in the right column, it is review-only, and review-only
rules drift.

| Rule | Gate |
| --- | --- |
| Scale tiers, radius tiers, control heights | `check:scale-contract`, `lint` (`theme-contracts/scale`) |
| No arbitrary `text-[Npx]` / `rounded-[Npx]` / `h-[Npx]` | `theme-contracts/scale` ESLint rule |
| Shadows, z-index, `transition: all` | `theme-contracts/shadows`, `/z-index`, `/motion` |
| Contrast floors for built-in palettes | `check:contrast-floor` |
| No alpha text, no Tailwind default type scale, no numeric `strokeWidth`, no raw palette hue, no button `title` | `check:design-drift` (ratcheted by `scripts/design-drift-baseline.json`) |
| Motion vocabulary has no orphaned animation class | `check:design-drift` (zero tolerance) |
| Theme field parity, motion TS/CSS parity | `check:themes` |
| Accessibility findings never grow | `check:visual-contracts` + `scripts/visual-debt-ledger.json` |
| Bundled fonts, no CDN | `check:fonts` |
| A class literal keeps its contract font-size tier through `cn()` | `audit:ui-merge` (part of `lint`; 0 losses over the whole tree) |
| A control paints its contract tier, height and label contrast | `test:ui:primitives` (6 scenes: 2 modes × 3 widths) |
| One chrome row per panel, ≤75px to content | `test:ui:chrome` (rendered; also asserts the tablist keyboard contract) |
| An append touches one row on a 200-turn transcript | `test:long-session-budget` (p50 ≤60ms, p95 ≤120ms; runs in `validate.yml`) |
| A file over 1,200 lines only gets smaller | check:file-size + scripts/file-size-budget.json (each budget note says what remains and what blocks it) |
| Evidence runs regenerate in place | --replace on a verification workflow (mkdir claims a directory atomically, so replacing is an explicit opt-in) |
| An append or a chrome row never regresses silently | `test:ui:chrome`, `test:long-session-budget` and `test:ui:primitives` run in `validate.yml`, not only on request |
| Warning debt never grows | `lint:workspace` + `scripts/lint-warning-baseline.json` (each warning carries an owner and a reason; a new warning and a stale allowance both fail) |
| Initial renderer graph stays lean | `bundle:report --check` (1.2MB raw ratchet) |

Lowering a frozen count after a migration batch: `bun run design:drift`. It
rewrites the baseline; the diff is the review record.

## Perceived performance

A long transcript is the product's worst case, so it has a budget instead of an
opinion. `bun run test:long-session-budget` renders 200 real turns and measures
frame deltas; the 2026-10-20 baseline is in
`docs/verification/results/long-session-budget-2026-10-20/`, and the post-fix run
is in `docs/verification/results/long-session-budget-w1/`.

| Action (200 turns) | Measured | Budget |
| --- | --- | --- |
| Scroll, p95 frame | 16.7 ms | ≤ 40 ms |
| Append one turn, p95 | 33.4 ms (p50 16.7) | ≤ 40 ms target, 120 ms ceiling |
| Glass panel over the transcript, p95 delta | 0 ms | ≤ 8 ms |

Rules:

- **Never put `backdrop-filter` on a repeating row.** Blur belongs to floating
  panels; a panel that is not focused may drop it, exactly like the shadow
  level (isFocusedPanel). Sticky headers that scroll with a list are opaque
  surfaces, not glass.
- **An append touches one row.** Four mechanisms keep it true, and removing any
  one re-opens the 83–300 ms regression: `storedToMessage` preserves message
  identity (`WeakMap`), `reuseStableTurns` reuses every completed turn whose
  signature did not move, viewer rows are memoised, and TurnCard renders its
  body through `MemoizedMarkdown`.
- **Scrolling is the hard floor.** Anything that animates during scroll is cut
  before anything else.
- Measure before optimising, and leave the number in an artifact.

## Do's and Don'ts

- **Do** route every visual value through a token or a contract tier.
- **Do** keep the accent for intent; use neutral surfaces for content.
- **Do** verify both modes and all three hosts (Electron, WebUI, Viewer).
- **Do** express the faintest text with `text-micro` / `text-meta`, not with a
  lower-contrast colour.
- **Don't** nest bordered containers (Russian dolls).
- **Don't** introduce per-character or blur streaming effects. `The Quiet-Stream
  Rule`: streamed text appears directly; the reading position stays stable.
- **Don't** write `text-[13px]`, `rounded-[8px]`, `h-[30px]` or inline colors.
  The lint contract rejects new values.
- **Don't** put an opacity modifier on a text colour (`text-foreground/50`), use
  `text-text-secondary`.
- **Don't** cancel a focus ring (`focus-visible:ring-0`, `outline-none`) without
  supplying one on the same element or its declared shell.
- **Don't** add a second implementation of a menu, empty state or roving-focus
  protocol. Extend the shared primitive.
- **Don't** change the settled identity decisions: white paper and ink, violet
  accent, neutral user bubble, 6px base radius, small radii overall.
