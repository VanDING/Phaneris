# Run observability acceptance matrix

Written before implementation on 2026-10-13. Scope: the approved Overview additions, request timing/cost repairs, and explanatory fields inside existing inspectors. Trajectory, Decisions, Context and Map retain their existing layout and interaction. Active duration, per-turn filters, retry summaries, cache ratios and new tabs are outside this first increment.

## Failure paths and expected evidence

| ID | Failure / boundary | Required behavior |
|---|---|---|
| R01 | SDK message timestamp is assigned before streaming | Completion is measured at the terminal provider stream event, before the durable commit. Never subtract the message creation time as completion. |
| R02 | Thinking-only or tool-argument-only response | First nonempty provider output is measured; first text stays unavailable. Tokens/s includes the provider's complete output count. |
| R03 | Empty initial delta, role-only chunk or empty response | Empty deltas are ignored. No output is not a measured zero TTFT. |
| R04 | Provider start callback absent | Start is explicitly unobserved; do not substitute SDK message_start or host IPC arrival as a new TTFT. |
| R05 | Multiple native payload / response callbacks | Mark ambiguous internal attempts; exclude incomparable timing from aggregate statistics rather than inventing individual network attempts. |
| R06 | Stop, error, unfinished stream, missing usage, nonfinite/nonpositive interval or sub-millisecond terminal burst | Preserve diagnostics; exclude unfinished/error samples and invalid rate denominators. A generation window under 1 ms cannot supply comparable throughput. Do not display NaN, Infinity, or a fabricated zero. |
| R07 | Wall clock changes while streaming, or durable commit is slow | Duration comes from one process's monotonic clock. Storage/IPC work is outside the measured generation interval. |
| R08 | JSONL transport, SessionManager persistence, reload and browser projection | New timing fields survive each boundary; stable request display ordinals are retained even when provider sequences restart. |
| R09 | Legacy / mixed new and old timing; first sample is missing | Legacy intervals remain explicitly old. P50/P95 use only valid v2 samples; show independent TTFT/rate coverage over recorded requests. |
| R10 | OpenRouter usage.cost is 0 / positive / absent / invalid | Provider-specific parsing preserves explicit zero, prefers the provider's documented field, rejects negative/nonfinite/nonnumeric values, and leaves missing money unknown. |
| R11 | Other providers expose cost_usd; unrelated cost has another meaning | Preserve the existing gateway field; do not interpret arbitrary providers' usage.cost as USD. |
| R12 | Response headers arrive before a delayed / aborted body | Latency measures through complete validated response, and the deadline applies during body reading; failures retain measured duration and actual deadline. |
| R13 | Free model timeout / historical missing fee | Missing charges remain unknown. No current catalog price or :free suffix rewrites historical fees. |
| R14 | Durable fee ledger / Decision record / authenticated RPC / UI | Cost, field/source, response ID, failure reason and deadline remain correlated; zero is known; reconnect/reload does not duplicate usage. |
| R15 | Legacy decision calls with no behavioral point/application evidence | Overview explicitly shows historical calls and missing behavior; changes/fallbacks are not presented as proven zero. |
| R16 | More than 18 records; a late failure | Run shape represents the full recorded range and retains the late error; its summary granularity is stated. |
| R17 | More than 200 requests or a missing sample | Rate plot has bounded points, preserves anomalies and gaps, identifies buckets and can locate an exact original request. Weighted rate is Σtokens / Σgeneration seconds. |
| R18 | Mouse / keyboard selection on the rate chart | Request selection and trajectory/context links identify the same original request; other views keep their current two-column ledger and inspectors. |
| R19 | Historical context manifests omit optional arrays | The existing growth chart still renders recorded input usage; malformed legacy metadata does not erase it. |
| R20 | Chinese / English, light / dark, narrow panel, empty/live run | Preserve four top summary cards and context columns; the small rate chart is immediately below context growth; text remains readable, missing data has an explanation, and no new tab is introduced. |

## Reproducible verification

Run `bun run scripts/verification/run-observability-workflow.ts` with `PHANERIS_TEST_BROWSER_CHANNEL=msedge` on machines without bundled Chromium. The workflow uses local controlled HTTP responses, the actual provider stream wrapper, host event adapter, durable accounting, session save/reload, authenticated RPC, and real Run components. It produces JSON assertions and screenshots under `.cache/run-observability/evidence/` without querying paid providers or changing user sessions.

Provider dispatch timing is the SDK's native payload callback immediately before dispatch, after extensions have finished preparing the payload. It is a client observation, not a socket write or GPU decode benchmark. Unsupported callbacks and ambiguous native attempts stay explicitly unavailable.
