# Scale & theme consistency failure matrix

Written before implementation, per the repository's failure-matrix convention.
Each row states a failure mode, the condition that must hold, and how it is
checked. A row without evidence is an open defect.

| # | Failure mode | Required behavior | Check |
| --- | --- | --- | --- |
| F1 | `--theme-radius` changes but cards/controls/chips stay square | Role shapes (`--shape-card`, `--shape-control`, `--shape-chip`, `--shape-panel`, `--shape-composer`) derive from the theme radius | Switch the theme radius in the playground appearance switch; screenshot matrix must change every role surface |
| F2 | Contract tiers drift with the theme radius | `--shape-xs…xl` stay fixed (`2/4/6/8/12px`); only role shapes move | `bun run check:scale-contract` + screenshot of a card and a control under two radii |
| F3 | Density changes text size | Density changes row/menu padding only; type tiers and control heights stay put | Toggle compact/comfortable; `text-*` and `h-control-*` boxes keep their measured height |
| F4 | Dark mode loses the hairline | Ring shadows resolve to `--edge-hairline`; at 2× it is half a physical pixel | DevTools computed style of `--edge-hairline` at dpr 1 / 2 / 3 |
| F5 | Dark popover gets a fluorescent white outline | Dark popovers use the inset 1px highlight, not an outer white ring | Toggle dark; open a dropdown over a dark panel |
| F6 | Composer focus reflows or shows two rings | Resting/hover/focus-within are shadow-only states; the wrapped composer shows one ring, the standalone one shows its own | Type in the composer; measure the container height before/after focus; screenshot both hosts |
| F7 | Scroll fade bands on retina | 7-stop alpha ramp; fades zero at the list edges | Scroll a settings page from top to bottom; inspect the top/bottom edges at dpr 2 |
| F8 | `mask-fade-top-short` is undefined | Session list top fade resolves | Inspect the computed `mask-image` on the session list scroller |
| F9 | Reduced motion still animates new durations/keyframes | `snap/sheet/slow` and all new keyframes collapse to 1ms, one iteration | Toggle `data-reduce-motion=true` in the playground; bubble/check/thinking animations must not move |
| F10 | Typography compensation breaks bold text | Dark Inter lowers regular/medium/semibold weights only; `strong`, headings and `font-bold` stay bold | Dark mode + `data-font=inter`: inspect computed `font-weight` of body, `font-semibold`, `strong` |
| F11 | Scale contract accepts a new arbitrary literal | ESLint `theme-contracts/scale` rejects any value outside contract ∪ snapshot | Add `text-[13.5px]` to a scratch file; lint must fail with the nearest tier |
| F12 | Stale legacy values linger | Every legacy value is still used; unused entries fail | `bun run check:scale-contract` |
| F13 | ESLint ledger hides new debt | Counts must match; stale entries fail | `bun run check:visual-contracts` |
| F14 | Hosts diverge | Electron, WebUI and Viewer import the same token layer | Screenshot the same surface in all three hosts (light/dark) |
| F15 | IME Enter sends right after candidate confirmation | `isComposing`, keyCode 229 and the WebKit 500ms latch all block submit | macOS WebKit + Chinese IME: confirm a candidate with Enter; message must not send |
| F16 | Sash micro-drag resizes a panel | <4px travel does nothing; the first 4px are subtracted | Drag 2px and release; width unchanged. Drag 40px; width moves by 36px |
| F17 | Iframe swallows the drag | `body[data-pane-dragging]` disables iframe pointer events | Drag a sash across a browser/artifact preview |
| F18 | Streamed output steals the viewport | User gesture latches the viewport for 250ms (stricter than the 150ms reference) | Scroll up while a response streams; position must not snap back |
| F19 | Contract artifacts drift | DESIGN.md, `scale-contract.ts`, allowlist and role tokens agree; playground ledger regenerated | `bun run check:scale-contract` and `bun run theme:generate --check` |
| F20 | New state surfaces lack semantics | Loading is `role=status`; error/denied are `role=alert`; empty is silent | Inspect the rendered DOM of each migrated state |

## Evidence status

- F1, F2, F19: covered by `check:scale-contract` and the generated token files.
- F3: density sweep captured (3 densities × light/dark; row height 38/42/46px).
- F4, F5, F6, F7, F9, F10: implemented in CSS; visual confirmation pending a desktop screenshot pass (see Wave 0.4).
- F8: `mask-fade-top-short` now defined and computed (7-stop).
- F11, F12, F13: covered by ESLint and the two check scripts; CSS declarations are now enforced too (font-size/radius must use tokens).
- F15: helper implemented; WebKit device verification pending.
- F16, F17, F18: implemented; interaction verification pending.
- F14: same token imports confirmed; host screenshots captured by the theme workflow (4 hosts × 4 themes × light/dark).
