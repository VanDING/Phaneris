# Run context accounting and palette regression

The proportional category-allocation rules below are historical. They are
superseded by [content and metering integrity](run-context-integrity-failure-matrix-2026-10-27.md):
provider input owns totals; attribution preserves unchanged content and exposes
an unattributed remainder. The palette,
axis geometry and cache-accounting requirements still apply.

## Failure cases recorded before implementation

| Case | Expected behavior |
| --- | --- |
| A request has 184,900 provider input tokens but serialized content suggests about 2.9M | Context history, request total, category sum, Overview trend and occupancy use 184,900. Categories remain explicitly approximate allocations, never measured category usage. |
| Provider usage contains cache reads or writes | Include input + cacheRead + cacheWrite exactly once; exclude output. |
| Allocation produces fractional tokens | Nonnegative integer categories sum exactly to the request total; deterministic rounding. |
| Provider reports zero input | Preserve zero; do not fall back to the content estimate. |
| Provider usage is missing | Keep the content estimate, label it as approximate, and say provider input is missing in Context and Overview. |
| Retained item previews differ from request manifest | Keep retained content and character counts intact; item rows use the category allocation scale. |
| User changes request or opens it from Overview | History, content, categories, signed deltas and occupancy retain the same accounting rule. |
| Seven category colors are crowded into similar hue families | System uses violet, assistant blue, schemas gold, skill pink, user green, injected context slate, tool results teal. Shared identities across Context, Overview and Trajectory. |
| Light/dark theme changes | Match the user-approved A palette exactly in each mode. Category names and positions identify the data; badges retain >= 4.5:1 text contrast. Record fill contrast as evidence rather than recoloring the approved palette. Error red remains a separate status. |
| Short histories (1/3/5/12 requests) | Columns occupy equal time-axis slots; their visible stacks are at most 32px wide and centered. Selection outlines follow the visible mark, not the whole wide slot. Apply the same width limit in net-change mode. |
| Overview activity strip contains tool records | Tool results use the tool category, not the tool definition category. |
| Long histories bucket request ranges into narrow bars | X labels occupy exactly one dedicated row below the plot, never wrap, overlap each other, or enter the plotted area. Check Overview and Context at wide and narrow panel widths. |
| Cache reads, writes and fresh input coexist | Per-request hit rate is cacheRead / (input + cacheRead + cacheWrite). Cache writes are not hits; output is excluded. Both chart footers show the selected request's rate as text. |
| Zero or absent input usage | Cache hit rate is unknown, not 0% or 100%. |
| A recorded request has no cache reads | Cache hit rate is 0%. |
| Request selection changes | The displayed cache hit rate follows the selected request in both views. |

## Repeatable evidence

- `bun run scripts/verification/run-context-accounting-workflow.ts`
- Optional real-session replay: set `PHANERIS_RUN_CONTEXT_SESSION` to the absolute `session.jsonl` path before running. The script reads through the normal snapshot decoder and only writes screenshots and numeric evidence into its verification directory.
- Existing broad regression: `bun run scripts/verification/run-redesign-workflow.ts`.

## Verified result

Approved on 2026-10-26: **A / 清透原色** and **等距细柱**, from `docs/prototypes/run-colors-2026-10-26/`. The implementation preserves both mode palettes exactly and caps short-history marks at 32px in equal time-axis slots. The prior verification paths below record the earlier draft; final approval evidence is recorded separately after verification.

- Focused browser workflow: 8 checks passed, including the real 113-request session, both theme modes, request selection, zero/missing usage, and 300-request axis geometry at 1440/600/390px.
- Existing Run workflow: 36 checks passed.
- Real last request: 184,900 input tokens = 196 fresh input + 184,704 cache reads; cache hit rate 99.9%. Category allocations sum to 184,900 and remain explicitly approximate.
- `typecheck:all`, UI/script ESLint, i18n parity/sorting/coverage/dead-key gates, design drift, visual contracts, and `git diff --check` passed.
- Local evidence: `.cache/verification/run-context-accounting-LChQxt/` (`checks.json`, hashed `manifest.json`, screenshots); broad regression: `.cache/verification/run-redesign-Fq7b3A/`.
- These are browser runs mounting the production Run panel. Installed Electron IPC and live provider requests were not exercised.

## Final approval verification

- The approved A palette matches the reviewed light/dark hex values exactly in Context, Overview and Trajectory. Badge text passes 4.5:1; named categories and stable positions accompany all fills.
- Short-history geometry passed for 1/3/5/12 requests at 1440/600/390px in both Overview and Context, including centered marks <=32px, equal spacing, selection outlines, click selection and net-change widths.
- Final focused workflow: **9 checks passed**, including real-session replay, single-row axes over 300 requests, cache hit rates and missing/zero usage. Evidence: `.cache/verification/run-context-accounting-PnmY26/`.
- Broad Run workflow: **36 checks passed**. Evidence: `.cache/verification/run-redesign-MviOWb/`.
- Final `typecheck:all`, UI/script ESLint, design drift, visual contracts, file-size gate and `git diff --check` passed.
