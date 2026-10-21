# Long-session draw-cost budget — recorded run (2026-10-20)

Status: **accepted** — the experiment passes, and it found one real defect.

```bash
bun run test:long-session-budget --output-dir=docs/verification/results/long-session-budget-2026-10-20
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/long-session-budget-2026-10-20
```

## Numbers

Real `SessionViewer`, real host stylesheet, 200 synthetic turns (400 messages,
markdown tables and a shiki code block each), desktop Chromium, Default palette,
1280×900, headless software rasterisation. Frame deltas sampled with
`requestAnimationFrame` around each action.

| Scene | Result | Budget |
| --- | --- | --- |
| Initial render (cold, incl. Vite module load) | **7.2–9.8 s** | < 20 s ✅ |
| Scroll · p50 / p95 / max | **16.7 / 16.7 / 16.8 ms** | p95 ≤ 40 ms ✅ |
| Append one turn · p50 / p95 / max | **133 / 300 / 300 ms** | median ≤ 350 ms ✅, target 40 ms ❌ |
| Glass panel over the transcript · p95 delta | **0 ms** | ≤ 8 ms ✅ |

## What the append number means

Streaming a turn onto a 200-turn transcript costs one long task of 100–280 ms at
the median. That is not a dropped frame in the compositor — the main thread is
blocked, so the message arrives in a burst rather than incrementally. Scrolling
is a perfect 16.7 ms, so the cost is specific to the append path: every append
re-renders the whole transcript instead of reusing the memoised rows.

This is exactly the "no published budget" risk the 2026-10-20 review named. The
experiment freezes a ceiling so the cost cannot get worse while the fix is
scheduled; the follow-up is to memoise turn grouping by message id so an append
touches one row.

## Why the gate watches the median

Ten appends produce about twelve frames, so a "p95" here is effectively the
single worst append, and one GC pause or OS hiccup owns it. Four runs of the
same tree produced p95 283 → 417 → 386 → 566 ms while the median moved
100 → 183 → 117 → 283 ms. p95 and max are recorded for the follow-up; the
assertion uses the median, which is the number that tracks the product rather
than the host. Two warm-up appends run outside the sampling window for the same
reason.

## Deferring the glass cost was correct

The review asked "200 turns × glass theme: what is the frame cost". The answer
is zero for a panel over the transcript: `backdrop-filter` is only painted where
it is used, and the transcript uses none. The degradation policy therefore
targets *panels*, not rows.

## Degradation policy (DESIGN.md → Perceived performance)

1. Never put `backdrop-filter` on a repeating row. It belongs to floating
   panels, and a panel that is not focused may drop it (the repository already
   models this with `isFocusedPanel` for shadows; extend the same switch to blur
   and to non-essential entrance animations).
2. An append must touch one row. Grouping is memoised per turn; a message list
   that re-derives every row on each delta is the defect this budget measures.
3. Scrolling is the hard floor: stay at one frame per scroll step. Anything that
   animates during scroll (parallax, reveal, sticky transitions) is cut first.
4. These numbers are the before-value for any optimisation, and
   `test:long-session-budget` re-measures them.

## Artifacts

| File | Contents |
| --- | --- |
| `manifest.json` | Run identity, changed-file hashes, per-artifact sha256, untested scope |
| `long-session-budget.json` | The five scenes, every frame-delta summary (p50/p95/max) and the budget each is asserted against |
| `long-session-top.png` | The transcript at rest |
| `long-session-scrolled.png` | After a 60-step scripted scroll |
| `long-session-glass.png` | With a `backdrop-blur-xl` panel over the transcript |
| `source-hashes.json` | sha256 of the fixture, the workflow and the two components under test |

## Untested

Recorded in `manifest.json → untested`:

- **GPU variance.** Headless Chromium rasterises in software; a desktop
  compositor will differ, in both directions.
- Tool output with deeply nested activity rows, image-heavy turns, and a live
  streaming markdown block (the fixture appends completed turns).
- Physical scrolling devices and touch momentum.
- Multi-window sessions and the WebSocket transport.
