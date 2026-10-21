# Frontend design waves 3–4 — failure matrix (2026-10-20)

Status: **accepted for the delivered scope**; the rows marked *deferred* below
are still open. Input: the read-only design audit in
`phaneris-frontend-design-review-2026-10-20.html` (findings 5, 7, 9, 10, 11).

Wave 1 (focus, contrast, drift gates, motion vocabulary) and wave 2 (type scale,
control geometry, status colours, icons) have their own matrices and are not
repeated here.

## Delivered

### Dialog focus policy — 22 `autoFocus` attributes → 0

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| FA1 | The swap changes behaviour: a `useEffect` focus is stolen by Radix's focus scope | `useInitialFocus()` focuses on the next frame, i.e. after the scope has placed focus, so the field wins deterministically | Manual: every converted dialog opens with its primary field focused |
| FA2 | A callback ref re-created per render re-focuses the field on every keystroke | The hook returns a `useCallback` with `[active, cancel]` deps, so identity is stable while those inputs are stable | Code review + `tsc` |
| FA3 | A field already owning a ref gets a second one (duplicate attribute) | Three such sites (a command filter, a server path field, two credential fields) were resolved individually: keep the existing ref, or use it as the focus target | `tsc --noEmit` (a duplicate JSX attribute is a hard TS error) |
| FA4 | A field with `autoFocus={index === 0}` becomes an unconditional focus | Rewritten as `ref={index === 0 ? initialFocusRef : undefined}` | Reviewed per site |
| FA5 | Focus on **page load** is reintroduced | No remaining `autoFocus` in product code; the hook only runs on an element that mounts with its surface | `grep autoFocus` in `apps/electron/src` + `packages/ui/src` finds only prose |
| FA6 | Deleting the attribute silently drops the behaviour | Five sites intentionally have no focus (a Radix dropdown filter, a command-palette filter): their container's focus scope owns first focus | Ledger count for `jsx-a11y/no-autofocus`: **0** |

### Semantics and gates

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| FS1 | A `<label>` wrapping a switch names nothing | Both `SharePageDialog` switches carry `aria-label`; the four onboarding fields got `htmlFor` + `id` | Ledger `label-has-associated-control` 3 → 2 |
| FS2 | A click handler on an `<img>` is invisible to the keyboard | The image lightbox trigger is a real `<button type="button">` with `craft-focus` and a name | Ledger `interactive-supports-focus` → 0 |
| FS3 | A `role="button"` div is reachable but not operable | The session filter row answers Enter and Space and exposes `aria-pressed` | Ledger `click-events-have-key-events` 30 → 28 |
| FS4 | A focusable `role="separator"` has no keyboard path | The inspector's separator handles arrow keys (it already did); both separators remain ledger-visible because the rules model the role as static — the rationale lives in the component | Ledger entries carry the reason |
| FS5 | A media finding is "fixed" by adding an empty `<track>` | Waived with the real reason (user-provided media has no caption track) and documented in the component | Ledger entry, `media-has-caption` = 2 |
| FS6 | A waiver added as an ESLint directive suppresses the ledger report and becomes an *unused directive* | Directives were removed where the ledger owns the finding; `lint:workspace` treats a new unused directive as an error | `lint:workspace` |

### Author tooling and budget

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| FT1 | The compiler's contrast check only covered body text | It now names each authored pair that fails (`foreground` / `mutedForeground` / `foregroundDimmed` × the surface it paints on), as a warning that never blocks | `packages/ui` typecheck; the derived `--*-text` mixes are untouched |
| FT2 | A gate samples a dark-only theme as "light" and reports a fictional pair | `check:contrast-floor` resolves the rendered mode with `resolveThemeMode`, the same rule the runtime uses | `check:contrast-floor` (84 pairs) |
| FT3 | A budget experiment measures the harness instead of the product | The fixture mounts the real `SessionViewer` with 400 synthetic messages and the real stylesheet; only the message data is synthetic | `test:long-session-budget`, artifact archived |
| FT4 | A timing assertion is flaky on shared CI | Scroll is asserted at 40 ms p95 (measured 16.7) and the append against a frozen 300 ms ceiling, with the 40 ms target recorded separately | `long-session-budget.json` |
| FT5 | The experiment's numbers rot | The frozen ceiling fails on regression and the artifact keeps the before-value | same |

## Found by the budget (open follow-up)

**Appending one turn to a 200-turn transcript costs p50 100 ms / p95 283 ms.**
Scrolling is a clean 16.7 ms, so the cost is in the append path: every delta
re-renders the transcript instead of reusing the memoised rows. The review's
"no published budget" note predicted exactly this. A glass panel over the
transcript costs 0 ms, so blur is not the problem.

The fix (memoise turn grouping by message id so an append touches one row) is
not part of this wave; the ceiling pins the current cost in the meantime.

### Rendered audit, baselines and the first keyboard batch

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| FR1 | axe reports a violation that no user can hit, and the report is "fixed" by suppressing the rule | The modal-menu `aria-hidden-focus` finding is only excluded after **pressing Tab twelve times** and requiring focus to stay inside the menu; the trap result is recorded in the artifact and the check fails if it ever leaks | `A11Y3-open-menu` |
| FR2 | A touch-target sweep passes because the field is a wrapper, not the control | The sweep measures the real elements; it found the search field at **30px** (the shell's inner input was not a `craft-control`) and the close button at **19×19** | `A11Y5-touch-targets`, fixed in `controls.css` + `SessionSearchHeader` |
| FR3 | A visual baseline is frozen from a non-deterministic fixture | Density is only observable where a component consumes the density tokens; the first freeze made `compact` byte-identical to `comfortable`, and a one-frame-late style swap made it drift. Fixed by a `density` specimen **and** by waiting for `--theme-density` to reach its target before screenshotting | freeze → compare → compare again: 6/6 stable |
| FR4 | A screenshot baseline tolerates "1% difference" and hides a 0.5px type change | Comparison is byte-exact; an intentional change is one `--update` and shows up in review as a new PNG | `test:visual-baselines` |
| FR5 | A clickable badge is fixed with a JSX spread that the linter cannot see | `role`/`tabIndex`/`onKeyDown` are written literally on the two badge spans; the `pressable()` helper exists for future surfaces but is not used where static analysis is the point | `check:visual-contracts` (4 findings retired) |
| FR6 | A `pressable()` spread would still be flagged, so the ledger would disagree with the code | The spread is documented as a runtime helper only; the two migrated sites carry literal attributes | same |

## Found by the audit (fixed in this wave)

| Finding | Cause | Fix |
| --- | --- | --- |
| Search field 30px tall on a coarse pointer | `.craft-field-shell` is a composite field; the `craft-control` 44px rule targets the inner control, and a bare `<input>` inside the shell is not one | `@media (pointer: coarse)` gives the shell and its input a 44px minimum |
| Close button 19×19 | A plain `<button>` with `h-5 w-5`, outside the icon-button family | It is a `craft-icon-button` now: 44×44 and the shared focus ring |

## Deferred (still open)

| ID | Item | Why deferred |
| --- | --- | --- |
| D1 | **Core-surface keyboard reachability** — 16 product findings left, all in the "not an interaction" or "pointer-only" category: the four `role="separator"` false positives (sash + inspector, waived in code), the AppShell focus scope, four drag surfaces (column resize, panel anchors, two resize handles), a container-level Escape shortcut, and the three text-selection handlers already waived in code | Nine batches are delivered (ledger 584 → 507 across wave 3): clickable badges; **label**, **slash-command**, **mention** and **skill-mention** menus; two click-shield wrappers; the **collapsible section heading**; all **three TurnCard activity rows**; the **AppShell filter rows** (which now also join the menu's own `[role="menuitem"]` arrow traversal); the **sidebar and file-tree chevrons**; the **attachment thumbnail** and the **inline file badge**; the **viewer drop zone**; and four **scrims / pan canvases / blockers** marked `role="presentation"`. Every clickable *control* on a core surface is now keyboard-operable; what is left is drag plumbing. |
| D1b | **Keyboard path for pointer-only resizing** (column widths, panel anchors, image/mermaid pan) | These surfaces have no keyboard equivalent at all, which is why they are waived in code with a reason rather than given a fake `role`. A real fix is the window-splitter pattern already used by the sash and the inspector: arrow keys plus `aria-valuenow`. Tracked here so the waiver is not mistaken for a solution. |
| D2 | **Touch-target rule for *all* native buttons** | The audit now enforces 44px for every visible control on the audited surface; extending it to surfaces that need real workspace data depends on D1. |
| D3 | `fileIcons: "color" \| "mono"` theme switch | Would add a 40th authoring field for one boolean; `FileKindIcon` already covers the mono path. Recorded in the wave-2 matrix. |

## Evidence

- Focus policy: `useInitialFocus` in `packages/ui/src/lib/use-initial-focus.ts`,
  policy text in `DESIGN.md` → Interaction States. Keyboard helper:
  `packages/ui/src/lib/pressable.ts`.
- Rendered audit: [`results/a11y-audit-2026-10-20/`](results/a11y-audit-2026-10-20/README.md).
- Visual baselines: [`visual-baselines/`](visual-baselines/README.md) (6 cells +
  `index.json`), produced by `bun run test:visual-baselines`.
- Budget: [`results/long-session-budget-2026-10-20/`](results/long-session-budget-2026-10-20/README.md)
  (manifest + frame samples + three screenshots).
- Gates: `bun run lint` (13 checks), `typecheck:all`, `check:docs`,
  `check:visual-contracts`, `check:design-drift`, `check:contrast-floor`.
