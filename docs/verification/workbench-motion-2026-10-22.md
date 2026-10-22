# Workbench motion verification — 2026-10-22

Starting point: `b367293244f9a29fa16a771d06a88fe00918c387` (`v0.4.0`).
Branch: `codex/workbench-motion`. Release tags are unchanged.

## Cause and change

The original native recording jumped from 0 to 360px at 27ms, held 360px through
163ms, then grew to 522px. Closing jumped directly from 522px to zero. The
Workbench minimum and the transcript's percentage basis constrained flex layout
until the animated basis crossed the available content width. Giving the CSS
transition a starting frame still delayed movement and did not provide an exit.

Desktop panels now share explicit complementary widths from `workbenchWidths`.
The persistent dock uses `motionTween(reduceMotion, 'spatial', 'move')`, retains
its content through closing, and removes the separate body entrance. The width
budget excludes navigation and includes the 6px seam. The sash's measured ceiling
also overrides the old 1600px fallback when the window is wider.

ResizeObserver commits new dimensions and jumps the motion values before paint;
it also writes their DOM dimensions immediately, avoiding Motion's next-frame
render scheduling. Pointer drag and reduced motion use the same snap path.

## Native acceptance

The [portable evidence manifest](results/workbench-motion-2026-10-22/manifest.json)
records 30 passing checks, source fingerprints and runtime identity. The
[report](results/workbench-motion-2026-10-22/workbench-motion.json) links outcomes
to measurements; raw open, close and window-resize frame arrays accompany it.
Screenshots were inspected in the running Windows Electron app.

| Case | Observed behavior |
| --- | --- |
| Single session + Files / Run / Terminal | Open widths increase; close widths decrease. No floor plateau, reversal or content fade. |
| Two / three foreground conversations | Equal columns remain; Workbench presents the active conversation and collapse restores the foreground group. |
| Compact, 600px window | Full-width replacement layers remain; no desktop row width calculation is mounted. |
| Expanded Workbench | Fills the available content row; Escape restores the companion layout. |
| Sash | Home reaches 380px; End leaves 360px for Workbench. Arrow keys and dragging match the rendered boundary, including beyond half the row. |
| Wide window, 2640px | End reaches the measured ceiling beyond the 1600px fallback. |
| Window resize | Dimensions snap to the new budget without a tween tail. |
| Reduced motion | Open and close have only endpoint widths. |

The four layout cases retain the existing presentation rules. Physical touch
hardware and native macOS/Linux compositors were not exercised.

Final sampling at 1640px: open has 33 frames from 0 to 522px; close has 34 frames
from 522px to zero. Neither sequence has any reverse width movement.

## Repository gates

| Command | Result |
| --- | --- |
| `bun run typecheck:all` | Passed |
| `bun run lint` | Passed; 504 visual ledger entries, no count growth or file budget changes |
| `bun run test` | Passed; 6263 tests. The earlier concurrent run timed out two unrelated isolation tests; the full serial rerun passed. |
| `bun run test:ui:chrome` | Passed; 9 scenes |
| `bun run check:docs` | Passed |
| `bun run test:shell-visual` | Passed; 77 checks, including the new Workbench open/close guard |
| `verification-artifacts.ts --verify=…` | Passed; all 26 portable artifacts match their hashes |

## Repeat

```sh
bun run electron:build
bun run scripts/verification/workbench-motion-workflow.ts --output-dir=.cache/verification/workbench-motion --replace
bun run test:shell-visual --output-dir=.cache/verification/shell-workbench-motion --replace
```

The focused workflow uses a disposable profile and seeded conversations. It
produces JSON frame samples, PNG screenshots and a hashed manifest. Video stays
in the temporary profile and is excluded from the portable manifest and Git.
The shell suite also runs the open/close assertions by default.
