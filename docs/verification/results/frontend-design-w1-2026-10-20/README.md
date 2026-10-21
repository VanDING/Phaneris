# Frontend design wave 1 — recorded verification (2026-10-20)

Status: **accepted**. Produced by `bun run test:design-w1`; every number below is
read from the rendered page, not restated from the stylesheet.

```bash
bun run test:design-w1 --output-dir=docs/verification/results/frontend-design-w1-2026-10-20
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/frontend-design-w1-2026-10-20
```

The second command re-hashes every artifact in `manifest.json`; it is the check
that this directory has not been edited by hand. The run must target an empty
directory (`VerificationRun` claims it atomically) — delete the old one first.
Re-run after waves 2–4: the scene set and every measured value are unchanged.

## What this run proves

Fourteen scenes across the Default palette in light and dark, plus one
reduced-motion scene. The fixture mounts the **real** `SessionSearchHeader` and
loads the **real** `apps/electron/src/renderer/index.css`, so the colours and
outlines measured here are the ones the product paints.

| Scene | Assertion | Measured |
| --- | --- | --- |
| `DW1-focus-ring-light` | Field shell paints a 2px solid outline at ≥3:1 | 2px solid accent, **7.30:1** on white |
| `DW1-focus-ring-dark` | Same | 2px solid accent, **4.52:1** on `#17191E` |
| `DW1-close-button-keyboard-and-pointer-light` | Keyboard focus paints the ring; pointer focus does not | ring **7.30:1**; `box-shadow: none` after a click |
| `DW1-close-button-keyboard-and-pointer-dark` | Same | ring **14.85:1**; `box-shadow: none` after a click |
| `DW1-text-contrast-light` | Secondary text ≥4.5:1 with alpha = 1 | canvas **5.68:1**, sunken **5.35:1**, placeholder **5.68:1**, status **9.73:1** |
| `DW1-text-contrast-dark` | Same | **8.18 / 7.24 / 7.95 / 10.95:1** |
| `DW1-no-translucent-text-light` | No element carrying a `text-*` class paints an alpha colour | 0 offenders |
| `DW1-no-translucent-text-dark` | Same | 0 offenders |
| `DW1-toggle-states-distinguishable-light` | State survives the AA floor | on **15.69:1** vs off **5.68:1** |
| `DW1-toggle-states-distinguishable-dark` | Same | on **15.43:1** vs off **8.18:1** |
| `DW1-motion-vocabulary-light` | Retired utilities are gone, surviving ones run | `message-enter` / `skeleton-sweep` / `thinking-dot` absent; `check-decay` runs |
| `DW1-motion-vocabulary-dark` | Same | same |
| `DW1-reduced-motion-collapses-entrance` | `prefers-reduced-motion: reduce` stops the entrance | `animation-name: none` |
| `DW1-no-page-errors` | No console or page errors | 0 (Vite's dev-server re-optimization notice is filtered by name) |

### Before → after

The pre-change numbers come from an independent WCAG 2.x calculation over the
composited colour on the Default canvas (they match the 2026-10-20 review):

| Text shade before | Composite contrast | After | Contrast |
| --- | --- | --- | --- |
| `text-foreground/40` | 2.40:1 | `text-text-secondary` | 5.68:1 |
| `text-foreground/50` | 3.15:1 | `text-text-secondary` | 5.68:1 |
| `text-foreground/60` | 4.24:1 | `text-text-secondary` | 5.68:1 |
| `text-destructive/70` | 3.19:1 | `text-destructive-text` | 9.73:1 |

391 substitutions across the renderer and `packages/ui` (see
`scripts/migrate-low-contrast-text.ts` for the exact mapping table and its
exclusions).

## Artifacts

| File | Contents |
| --- | --- |
| `manifest.json` | Run identity: HEAD sha, lockfile sha, dirty paths, changed-file hashes, runtime versions, scene ids, per-artifact sha256, untested scope |
| `design-w1.json` | All 14 check results, every raw sample (colour strings, ratios, box-shadows), console errors, browser version |
| `design-w1-light-focus.png` | The repaired field, keyboard focus, light |
| `design-w1-dark-focus.png` | The repaired field, keyboard focus, dark |
| `design-w1-light.png`, `design-w1-dark.png` | Resting state with the text-tone ladder and toggle probes |
| `design-w1-reduced-motion.png` | Reduced-motion render |
| `source-hashes.json` | sha256 of the component, the stylesheets and the workflow itself |
| `index.html`, `host.css` | The exact fixture entry and host stylesheet the run served |

## Untested here

Recorded in `manifest.json → untested`, repeated because it matters:

- Native OS materials and window chrome.
- **Scenic mode** (background image) contrast — the gate cannot measure a
  photograph; `DESIGN.md` carries the authoring checklist instead.
- Physical touch devices (desktop Chromium emulates `pointer: coarse` only).
- Packaged/signed installer visual identity.
- Geek / Cyberpunk 2077 / Ink palettes **in a browser**. Those are covered
  statically by `bun run check:contrast-floor`, which resolves every pair from
  the theme files; this run covers Default only.
