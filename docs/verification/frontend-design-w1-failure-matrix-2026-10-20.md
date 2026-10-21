# Frontend design wave 1 — failure matrix (2026-10-20)

Status: **accepted**. Input: the read-only design audit in
`phaneris-frontend-design-review-2026-10-20.html`. Scope: wave W1 ("止血") of its
roadmap — focus visibility, text contrast, drift gates, motion vocabulary.

Each row below was enumerated *before* the migration ran, because a mechanical
class substitution is exactly the kind of change that looks safe and silently
breaks a state. The "Verified by" column names the artifact that proves the row
was handled; rows with no mechanical proof say so instead of implying one.

## F1 — Text contrast (`text-<role>/NN` → `text-text-secondary`)

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F1.1 | Class replaced inside a non-class context (comment, string of JS, snapshot) | Migration skips comment lines and only rewrites the colour token, never the variant prefix | `scripts/migrate-low-contrast-text.ts` dry run: 391 sites across three passes, no `.snap`/`.md` touched |
| F1.2 | Alpha text sits on an **inverted** surface, so the replacement token paints a dark-on-dark result | Every `/25–/60` site was scanned for a co-located `bg-foreground`, `bg-primary`, `bg-accent`; the 27 hits are all faint neutral tints (`bg-foreground/5`) on a light canvas, not inversions | Ad-hoc scan (`grep` over the 278 original sites) recorded in the change description |
| F1.3 | A **state pair** (`on ? '/70' : '/30'`) collapses to one tone, removing the state | Five toggles were rewritten to `text-foreground` vs `text-text-secondary` by hand | `DW1-toggle-states-distinguishable-{light,dark}` (15.69 vs 5.68) |
| F1.4 | Genuinely **disabled** copy becomes as dark as enabled copy | Disabled copy keeps `--text-disabled`; the migration never touches it | `DW1-text-contrast-*` samples the exemption; `DESIGN.md` documents it |
| F1.5 | The replacement token does not exist / is not generated | `text-text-secondary` already had 318 call sites before this change | `DW1-text-contrast-*` measures the rendered colour |
| F1.6 | Status text loses its semantic hue when "fixed" | `text-destructive/50–80` maps to `--destructive-text` (the 50% mix that already cleared AA), not to neutral grey | `DW1-text-contrast-*` status pair = 9.73:1 |
| F1.7 | A theme's palette has no AA headroom, so the token itself is unsafe | New gate resolves every built-in pair; it found Ink dark secondary-on-secondary at 4.36:1 | `bun run check:contrast-floor` (Ink dark `mutedForeground` `#938A7B` → `#968D7E`, now 4.53:1) |
| F1.8 | A gate is satisfied by shrinking the floor instead of fixing the colour | Thresholds are WCAG constants in the script; there is no flag to lower them | `scripts/check-contrast-floor.ts` |

## F2 — Focus visibility

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F2.1 | Removing `outline-none` lets the *inner input's* outline paint outside the rounded frame | A dedicated `.craft-field-shell` role draws the ring on the frame and suppresses the inner control's | `DW1-focus-ring-*`: outline on the shell, 2px solid |
| F2.2 | The ring shows on **mouse** focus, which the design forbids | `:focus-visible` only, never `:focus` | `DW1-close-button-keyboard-and-pointer-*`: pointer click → `box-shadow: none` |
| F2.3 | `focus-visible:ring-0` silently cancels the `craft-control` three-layer ring | Three settings inputs dropped the suppressing utility so `craft-control`'s ring applies | Typecheck + `theme-contracts/roles` ledger re-synced (total 589 → 584, no growth) |
| F2.4 | A 1px separator cannot show a ring | The keyboard-resizable divider colours its own line with the accent on `group-focus-visible` | Visual review of `gradient-resize-handle.tsx`; **not** covered by an automated scene |
| F2.5 | New focus suppressions appear later | `check:design-drift` counts `focus-visible:ring-0` (baseline 2, both justified) | `bun run check:design-drift` |
| F2.6 | Forced-colors mode loses the ring | `@media (forced-colors: active)` maps both field roles to `Highlight` | CSS review only — no forced-colors scene in this run |

## F3 — Drift gates

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F3.1 | A gate that reports but never fails | `check:design-drift` asserts on growth and is wired into `lint` | `lint` order: `check:scale-contract → audit:scale → check:design-drift → check:contrast-floor` |
| F3.2 | A ratchet that permits whack-a-mole (fix one, add one) | Counts are global *and* per-file, so a failure names the file that grew | `scripts/verify…` — see `check-design-drift.ts` growth message |
| F3.3 | The baseline is regenerated carelessly to hide growth | Lowering requires `bun run design:drift`, whose diff is the review record; growth fails first | `check-design-drift.ts` |
| F3.4 | Heuristic counters miss the common case | The `title`-on-a-button counter scans full JSX opening tags (tracking `{}` depth and quotes), which lifted it from 5 to 91 sites | `scripts/measure-design-drift.ts` report |
| F3.5 | The gate's own scanning breaks on a file it cannot parse | Measurement is regex-over-lines with explicit comment skipping, so a malformed file cannot crash the gate | 770 files scanned without error |

## F4 — Motion vocabulary

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F4.1 | Deleting a utility that *is* used | Consumer scan runs over every product source outside `motion.css` before deletion | `DW1-motion-vocabulary-*`; `check:design-drift` reports 2 declared / 2 consumed / 0 orphaned |
| F4.2 | Orphaned **keyframes** survive the class deletion | `craft-message-enter`, `craft-skeleton-sweep`, `craft-thinking-dot` removed with their classes | `grep` clean; `check:themes` motion parity passes |
| F4.3 | Reduced motion regresses while touching the file | Unchanged contract; re-asserted | `DW1-reduced-motion-collapses-entrance` |

## F5 — Whole-tree regressions

| ID | Failure mode | Handling | Verified by |
| --- | --- | --- | --- |
| F5.1 | Class churn re-fingerprints accessibility debt and the ledger passes anyway | Ledger re-registered with counts held constant | 46 re-fingerprinted (46 retired / 46 added), then 5 role findings genuinely retired: **589 → 584**, `check:visual-contracts` OK |
| F5.2 | Scale contract drifts from DESIGN.md after the new chapters | Frontmatter untouched; rule names preserved | `check:scale-contract` OK |
| F5.3 | Type errors from removed classes | `tsc --noEmit` on `packages/ui` and `apps/electron` | both clean |
| F5.4 | Documentation gate rejects unregistered docs | Both new documents indexed from `docs/README.md` | `check:docs` OK |
| F5.5 | A theme palette edit desynchronises the packaged resource copy | `theme:generate` republished `apps/electron/resources/themes/*.json` | `check:themes` OK |

## Not covered by this wave

- Axe/assistive-technology runs, the 97 production accessibility ledger entries
  (wave W3).
- Font-size migration away from Tailwind's default scale (835 sites, wave W2).
- Status-colour theming for the 172 palette classes (wave W2).
- Visual screenshot baselines across themes × density × host (wave W4).
- Scenic-mode contrast, native materials, physical touch.

The full evidence set for the rows that *are* covered lives in
[`results/frontend-design-w1-2026-10-20/`](results/frontend-design-w1-2026-10-20/manifest.json).
