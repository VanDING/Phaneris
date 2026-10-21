# Rendered accessibility audit — recorded run (2026-10-20)

Status: **accepted**. Six scenes, all green, plus two real defects found and fixed
by the touch-target sweep.

```bash
bun run test:a11y --output-dir=docs/verification/results/a11y-audit-2026-10-20
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/a11y-audit-2026-10-20
```

## What it audits

`axe-core` 4.13.0 (declared devDependency, loaded from its dist file) with the
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `best-practice` tags, over one
surface that mounts the shipped primitives: the session search field, the
button/input/select family, an icon-only action, status chips, a Radix dialog
with a form, and a Radix dropdown menu.

| Scene | What it proves |
| --- | --- |
| `A11Y1-base-surface` | No serious/critical violation on the resting page |
| `A11Y2-open-dialog` | Same with the dialog open; focus lands **inside** the dialog; Esc returns it to the trigger |
| `A11Y3-open-menu` | Same with a modal menu open; Tab stays inside the menu for twelve presses |
| `A11Y4-narrow-reflow` | Same at 390px, where the layout is allowed to reflow |
| `A11Y5-touch-targets` | Every visible control is ≥44×44 under `hasTouch` / `pointer: coarse` |
| `A11Y6-no-page-errors` | No console or page errors |

Blocking threshold is axe impact `serious` or `critical`. `moderate` and `minor`
stay informational on purpose: the product already carries registered debt for
those rules (`scripts/visual-debt-ledger.json`), and failing the audit on them
would duplicate the ledger without a path to fix them here.

## What the sweep found

| Finding | Cause | Fix |
| --- | --- | --- |
| The search field was **30px tall** on a coarse pointer | `.craft-field-shell` is a composite field: the `craft-control` 44px rule targets the inner control, and the bare `<input>` inside the shell was not a `craft-control` | `@media (pointer: coarse)` now gives the shell **and** its input a 44px minimum |
| The close button was **19×19** | A plain `<button>` with `h-5 w-5`, outside the `craft-icon-button` family | It is a `craft-icon-button` now: 44×44 and the shared focus ring |

## The one finding that is not a defect, measured rather than assumed

With a modal menu open, axe reports `aria-hidden-focus` (serious): Radix marks
the rest of the document `aria-hidden` but does not add `inert`, so background
controls remain programmatically focusable. The audit does not just exclude the
rule — it **presses Tab twelve times** and requires focus to stay inside
`[role="menu"]`. Only then is the finding treated as contained, and the trap
result is recorded in `a11y-audit.json → samples[id=menu-focus-trap]`. If a
future Radix change leaks the trap, `A11Y3` fails.

## Artifacts

| File | Contents |
| --- | --- |
| `manifest.json` | Run identity, changed-file hashes, per-artifact sha256, untested scope |
| `a11y-audit.json` | Six check results, every axe violation per state with node targets, the focus-trap result, the touch-target sweep |
| `axe-version.json` | The exact axe build used |
| `a11y-surface-390.png` | The surface at 390px |
| `source-hashes.json` | sha256 of the fixture, the workflow and the five primitives under test |

## Untested here

Recorded in `manifest.json → untested`:

- The **full application surfaces** (shell, settings, kanban, file tree). Each
  needs real workspace data; their unresolved findings are tracked per node in
  the visual-debt ledger and are the remaining work of wave 3.
- Screen-reader announcement order — axe checks markup, not speech.
- Native OS accessibility bridges.
- Scenic and non-Default palettes.
