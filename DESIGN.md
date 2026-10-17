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
  accent-violet: "oklch(0.488 0.275 280.3)"
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
| Accent | `oklch(0.488 0.275 280.3)` | `oklch(0.626 0.221 291.7)` | Focus, selection, active state |
| User bubble | `#F3F3F3` | `#2B2B2B` | User message surface (neutral, not accent) |

Rules:

- `The Accent-Is-For-Intent Rule` — the accent marks focus, selection and the
  active control. It never fills large surfaces or decorates text.
- Status colors (`info`, `success`, `destructive`) are semantic; each has a
  `*-text` variant mixed 50% toward the foreground for AA text contrast.
- Never introduce a new hex in a component. Author it in the theme engine
  (`DEFAULT_THEME` or a theme file) so every host and mode receives it.

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

## Layout

- Shell topology: `[LeftSidebar 20%] [NavigatorPanel 32%] [MainContent 48%]`,
  driven by `defaultLayout = [20, 32, 48]` in `App.tsx`.
- Chat reading column is `--reading-width: 840px` with `--reading-gutter`.
- Panel-relative responsiveness uses container queries, not viewport queries:
  `@panel-compact` (448px), `@panel-medium` (640px), `@mobile` (768px).
- Spacing follows a 4px rhythm (`spacing.1–6`).
- Control heights are contract tiers `18/22/26/30/34/38px`. Heights above the
  control band describe layout space, not hit targets, and are not tiered.

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

## Components

- **Buttons** — existing size variants keep their heights; new compact controls
  use `h-control-2xs/xs/sm`. Inner toolbar buttons are ghost: transparent at
  rest, foreground/5 hover, foreground/10 pressed.
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

## Do's and Don'ts

- **Do** route every visual value through a token or a contract tier.
- **Do** keep the accent for intent; use neutral surfaces for content.
- **Do** verify both modes and all three hosts (Electron, WebUI, Viewer).
- **Don't** nest bordered containers (Russian dolls).
- **Don't** introduce per-character or blur streaming effects. `The Quiet-Stream
  Rule`: streamed text appears directly; the reading position stays stable.
- **Don't** write `text-[13px]`, `rounded-[8px]`, `h-[30px]` or inline colors.
  The lint contract rejects new values.
- **Don't** add a second implementation of a menu, empty state or roving-focus
  protocol. Extend the shared primitive.
- **Don't** change the settled identity decisions: white paper and ink, violet
  accent, neutral user bubble, 6px base radius, small radii overall.
