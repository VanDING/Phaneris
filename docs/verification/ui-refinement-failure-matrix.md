# Twilight, Gantt and installer verification

Scope: preserve scheduling behavior; ship Twilight (default), Geek, Cyberpunk 2077 and Ink as read-only built-ins. User-created theme files remain user-owned.

Before changing product code, verify these failure cases:

| Area | Failure | Verification |
| --- | --- | --- |
| Themes | Fresh installation offers only the old Default | Empty-profile storage workflow lists exactly the four built-ins |
| Themes | Twilight palette differs from the supplied design | Canonical snapshot and packaged JSON comparison; browser light/dark screenshots |
| Themes | Existing `default`/`twilight` selections break or duplicate Twilight | Both IDs resolve to the canonical default; preferences normalize the alias |
| Themes | Bundled themes need files copied into the user's profile | Empty-profile workflow loads every built-in and checks the themes directory remains empty |
| Themes | A legacy file shadows a built-in or is overwritten | Conflicting fixture files remain byte-for-byte unchanged; built-ins resolve consistently |
| Themes | A custom theme, invalid theme or escaping symlink changes behavior | Existing storage confinement and migration checks |
| Themes | A dark-only theme renders against a light application surface | Browser switching verifies supported mode resolution |
| Themes | Renderer flashes the previous default at startup | Static CSS and native startup background synchronization checks |
| Gantt | Timeline grid remains black or disappears | Rendered timeline borders compared with Calendar's quiet rule in all four themes |
| Gantt | Bars lose legible text or progress | Real fixture, progress values and light/dark screenshots |
| Gantt | Header becomes translucent when scrolling | Existing long-plan rendered-header check |
| Gantt | Dates, ISO weeks, task width, drag and editing regress | Existing Calendar/Gantt browser workflow |
| Gantt | Narrow windows overflow or task controls lose focus affordance | Wide/narrow screenshots and keyboard-focused control checks |
| Installer | `WM_NCCALCSIZE` with either parameter form leaves a frame | Native preview workflow compares resulting client/window rectangles |
| Installer | Activation, non-client repaint or restore paints a beveled edge | Preview lifecycle capture and edge-pixel observations |
| Installer | Removing the native edge loses dragging, minimize or close | Preview workflow moves, minimizes, restores and closes the real window |
| Installer | Reapplying the frame or entering progress adds chrome | Synthetic preview install section exercises actual page hooks without installing an application |
| Packaging | Old themes or stale plugin survive rebuilding | Packaged theme manifest, installer verification and clean resource staging |

Artifacts: JSON observations and PNG screenshots under `docs/verification/results/ui-refinement/`; packaged structure/launch reports retain their existing locations. Native observations apply to the local Windows version and DPI, not untested operating systems.
